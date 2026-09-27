import type { AuthRepositories } from "../auth/repository.js";
import { HttpError } from "../httpError.js";
import type { ApiExpense, ExpensePatch } from "./repository.js";
import { EXPENSE_CATEGORIES, toApiExpense, type ExpenseCategory } from "./repository.js";

/** Shown (as a 400) when the expense date is not an ISO YYYY-MM-DD string. */
export const EXPENSE_DATE_MESSAGE = "Date must be a YYYY-MM-DD string";
/** Shown (as a 400) when a caseId is not a uuid — the column is a uuid FK. */
export const EXPENSE_CASE_MESSAGE = "Invalid case id";
/** Shown (as a 400) when a well-formed caseId is not a live case of the firm, or when the required link has no case to default to. */
export const EXPENSE_CASE_MISSING_MESSAGE = "Case not found";
/** Shown (as a 400) when `category` is not in the contract's Expense vocabulary. */
export const EXPENSE_CATEGORY_MESSAGE = "Category must be filing, travel, copies, expert, or other";
/** Shown (as a 400) when amount is not a whole non-negative paise amount. */
export const EXPENSE_AMOUNT_MESSAGE = "Amount must be a non-negative integer";

/** UUID shape of every production id (same rule as the :id params). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Upper bound for paise — int4/bigint safety with the /users hourlyRate cap. */
const MAX_VALUE = 1_000_000_000;

const DESCRIPTION_LIMIT = [4000, "Description is too long"] as const;

/**
 * The writable expense input (create and patch). Deliberately free-form: the
 * reference backend and the mock adapter store these fields verbatim (no
 * trimming), and the parity checklist in the ticket depends on that.
 * `invoiced` is not here at all — server-managed: stamped false on create,
 * never client-writable (the events.`source` seam treatment); ticket 13's
 * invoice flow flips it through the service seam.
 */
export interface ExpenseInput {
  caseId?: string | null;
  date?: string;
  description?: string;
  amount?: number;
  billable?: boolean;
  category?: string;
}

interface NormalizedInput {
  /**
   * The case link after normalization: undefined = untouched (patch), null =
   * "no case given" (create resolves the reference's `db.cases[0]` default;
   * patch rejects — a required link cannot be cleared), string = a
   * shape-checked candidate id.
   */
  caseId?: string | null;
  date?: string;
  description?: string;
  amount?: number;
  billable?: boolean;
  category?: string;
}

function checkLength(value: string, [max, message]: readonly [number, string]): void {
  if (value.length > max) throw new HttpError(400, message);
}

function checkUuid(value: string, message: string): void {
  if (!UUID_PATTERN.test(value)) throw new HttpError(400, message);
}

function checkIsoDate(value: string): void {
  if (!ISO_DATE_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, EXPENSE_DATE_MESSAGE);
  }
}

function normalizeInput(input: ExpenseInput): NormalizedInput {
  const out: NormalizedInput = {};
  if (input.caseId !== undefined) {
    // "" and null both mean "no case given": create falls through to the
    // reference's default-case resolution, patch rejects (required link).
    out.caseId = input.caseId === "" || input.caseId === null ? null : input.caseId;
    if (out.caseId !== null) checkUuid(out.caseId, EXPENSE_CASE_MESSAGE);
  }
  if (input.date !== undefined) {
    checkIsoDate(input.date);
    out.date = input.date;
  }
  if (input.description !== undefined) {
    checkLength(input.description, DESCRIPTION_LIMIT);
    out.description = input.description;
  }
  if (input.amount !== undefined) {
    if (!Number.isInteger(input.amount) || input.amount < 0 || input.amount > MAX_VALUE) {
      throw new HttpError(400, EXPENSE_AMOUNT_MESSAGE);
    }
    out.amount = input.amount;
  }
  if (input.billable !== undefined) out.billable = input.billable;
  if (input.category !== undefined) {
    if (!EXPENSE_CATEGORIES.includes(input.category as ExpenseCategory)) {
      throw new HttpError(400, EXPENSE_CATEGORY_MESSAGE);
    }
    out.category = input.category;
  }
  return out;
}

function toPatch(normalized: NormalizedInput): ExpensePatch {
  const patch: ExpensePatch = {};
  if (normalized.caseId !== undefined && normalized.caseId !== null) patch.caseId = normalized.caseId;
  if (normalized.date !== undefined) patch.date = normalized.date;
  if (normalized.description !== undefined) patch.description = normalized.description;
  if (normalized.amount !== undefined) patch.amount = normalized.amount;
  if (normalized.billable !== undefined) patch.billable = normalized.billable;
  if (normalized.category !== undefined) patch.category = normalized.category;
  return patch;
}

/**
 * Expenses business logic (ticket 12). Practice data of the firm: every firm
 * member manages it (the contract and the reference backend gate nothing
 * here, so neither do we). The service is the choke point that scopes every
 * lookup by the session's firm (ADR-0003) and enforces the reference
 * backend's defaults, newest-first order and soft delete.
 *
 * Amounts: the contract's Expense.amount is integer paise supplied by the
 * client (the UI converts rupees via rupeesToPaise) and stored verbatim —
 * the smoke posts a plain integer and reads it back unchanged. There is no
 * server-side derivation or rounding to mirror; integer paise cannot round.
 *
 * The required case link mirrors the time-entries service: an omitted caseId
 * defaults to the firm's newest live case (the reference's `db.cases[0]`,
 * its store being newest-first) and 400s "Case not found" when the firm has
 * no live case to bill against.
 */
export class ExpensesService {
  constructor(
    private readonly repos: AuthRepositories,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Newest first — the mock and the reference both unshift new expenses. */
  async list(firmId: string): Promise<ApiExpense[]> {
    const rows = await this.repos.expenses.listByFirm(firmId);
    return rows.map(toApiExpense);
  }

  /**
   * POST /expenses → 201 with the created entity. Defaults mirror the
   * reference backend exactly: date today, description "", amount 0,
   * billable true, category "other", invoiced false (server-stamped, never
   * read from the input).
   */
  async create(firmId: string, input: ExpenseInput): Promise<ApiExpense> {
    const normalized = normalizeInput(input);
    const today = this.now().toISOString().slice(0, 10);
    const row = await this.repos.transaction(async (tx) => {
      let caseId: string;
      if (normalized.caseId === undefined || normalized.caseId === null) {
        const newest = (await tx.cases.listByFirm(firmId, {}))[0];
        if (!newest) throw new HttpError(400, EXPENSE_CASE_MISSING_MESSAGE);
        caseId = newest.id;
      } else {
        const linked = await tx.cases.findById(firmId, normalized.caseId);
        if (!linked) throw new HttpError(400, EXPENSE_CASE_MISSING_MESSAGE);
        caseId = linked.id;
      }
      return tx.expenses.create({
        firmId,
        caseId,
        date: normalized.date ?? today,
        description: normalized.description ?? "",
        amount: normalized.amount ?? 0,
        billable: normalized.billable ?? true,
        invoiced: false,
        category: normalized.category ?? "other",
      });
    });
    return toApiExpense(row);
  }

  /**
   * PATCH /expenses/:id — only the sent fields move (mock Object.assign).
   * The case link may be re-pointed (existence-checked) but never cleared:
   * `null`/`""` are 400 "Invalid case id" — a required link has no null.
   */
  async update(firmId: string, id: string, patch: ExpenseInput): Promise<ApiExpense> {
    const normalized = normalizeInput(patch);
    const caseLink = normalized.caseId;
    if (caseLink === null) throw new HttpError(400, EXPENSE_CASE_MESSAGE);
    const row = await this.repos.transaction(async (tx) => {
      if (caseLink !== undefined) {
        const linked = await tx.cases.findById(firmId, caseLink);
        if (!linked) throw new HttpError(400, EXPENSE_CASE_MISSING_MESSAGE);
      }
      return tx.expenses.update(firmId, id, toPatch(normalized));
    });
    if (!row) throw new HttpError(404, "Expense not found");
    return toApiExpense(row);
  }

  /** DELETE /expenses/:id → 204. Soft delete per the baseline convention. */
  async delete(firmId: string, id: string): Promise<void> {
    const deleted = await this.repos.expenses.delete(firmId, id);
    if (!deleted) throw new HttpError(404, "Expense not found");
  }
}
