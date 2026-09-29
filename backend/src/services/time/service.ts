import type { AuthRepositories } from "../auth/repository.js";
import { HttpError } from "../httpError.js";
import type { ApiTimeEntry, TimeEntryPatch } from "./repository.js";
import { toApiTimeEntry } from "./repository.js";

/** Shown (as a 400) when the entry date is not an ISO YYYY-MM-DD string. */
export const TIME_DATE_MESSAGE = "Date must be a YYYY-MM-DD string";
/** Shown (as a 400) when a caseId is not a uuid — the column is a uuid FK. */
export const TIME_CASE_MESSAGE = "Invalid case id";
/** Shown (as a 400) when a well-formed caseId is not a live case of the firm, or when the required link has no case to default to. */
export const TIME_CASE_MISSING_MESSAGE = "Case not found";
/** Shown (as a 400) when a userId is not a uuid — the column is uuid. */
export const TIME_USER_MESSAGE = "Invalid user id";
/** Shown (as a 400) when minutes is not a whole non-negative number of minutes. */
export const TIME_MINUTES_MESSAGE = "Minutes must be a non-negative integer";
/** Shown (as a 400) when rate is not a whole non-negative paise amount. */
export const TIME_RATE_MESSAGE = "Rate must be a non-negative integer";
/** Shown (as a 400) when the firm somehow has no user to default the entry's user to. */
const NO_USER_MESSAGE = "Firm has no users";

/** UUID shape of every production id (same rule as the :id params). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Upper bound for minutes and paise — int4/bigint safety with the /users hourlyRate cap. */
const MAX_VALUE = 1_000_000_000;

const DESCRIPTION_LIMIT = [4000, "Description is too long"] as const;

/**
 * The writable time-entry input (create and patch). Deliberately free-form:
 * the reference backend and the mock adapter store these fields verbatim (no
 * trimming), and the parity checklist in the ticket depends on that.
 * `invoiced` is not here at all — server-managed: stamped false on create,
 * never client-writable (the events.`source` seam treatment); ticket 13's
 * invoice flow flips it through the service seam.
 */
export interface TimeEntryInput {
  caseId?: string | null;
  userId?: string;
  date?: string;
  minutes?: number;
  rate?: number;
  description?: string;
  billable?: boolean;
}

interface NormalizedInput {
  /**
   * The case link after normalization: undefined = untouched (patch), null =
   * "no case given" (create resolves the reference's `db.cases[0]` default;
   * patch rejects — a required link cannot be cleared), string = a
   * shape-checked candidate id.
   */
  caseId?: string | null;
  userId?: string;
  date?: string;
  minutes?: number;
  rate?: number;
  description?: string;
  billable?: boolean;
}

function checkLength(value: string, [max, message]: readonly [number, string]): void {
  if (value.length > max) throw new HttpError(400, message);
}

function checkUuid(value: string, message: string): void {
  if (!UUID_PATTERN.test(value)) throw new HttpError(400, message);
}

function checkIsoDate(value: string): void {
  if (!ISO_DATE_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, TIME_DATE_MESSAGE);
  }
}

function checkWhole(value: number, message: string): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_VALUE) {
    throw new HttpError(400, message);
  }
}

function normalizeInput(input: TimeEntryInput): NormalizedInput {
  const out: NormalizedInput = {};
  if (input.caseId !== undefined) {
    // "" and null both mean "no case given": create falls through to the
    // reference's default-case resolution, patch rejects (required link).
    out.caseId = input.caseId === "" || input.caseId === null ? null : input.caseId;
    if (out.caseId !== null) checkUuid(out.caseId, TIME_CASE_MESSAGE);
  }
  if (input.userId !== undefined) {
    checkUuid(input.userId, TIME_USER_MESSAGE);
    out.userId = input.userId;
  }
  if (input.date !== undefined) {
    checkIsoDate(input.date);
    out.date = input.date;
  }
  if (input.minutes !== undefined) {
    checkWhole(input.minutes, TIME_MINUTES_MESSAGE);
    out.minutes = input.minutes;
  }
  if (input.rate !== undefined) {
    checkWhole(input.rate, TIME_RATE_MESSAGE);
    out.rate = input.rate;
  }
  if (input.description !== undefined) {
    checkLength(input.description, DESCRIPTION_LIMIT);
    out.description = input.description;
  }
  if (input.billable !== undefined) out.billable = input.billable;
  return out;
}

function toPatch(normalized: NormalizedInput): TimeEntryPatch {
  const patch: TimeEntryPatch = {};
  if (normalized.caseId !== undefined && normalized.caseId !== null) patch.caseId = normalized.caseId;
  if (normalized.userId !== undefined) patch.userId = normalized.userId;
  if (normalized.date !== undefined) patch.date = normalized.date;
  if (normalized.minutes !== undefined) patch.minutes = normalized.minutes;
  if (normalized.rate !== undefined) patch.rate = normalized.rate;
  if (normalized.description !== undefined) patch.description = normalized.description;
  if (normalized.billable !== undefined) patch.billable = normalized.billable;
  return patch;
}

/**
 * Time entries business logic (ticket 12). Practice data of the firm: every
 * firm member logs time (the contract and the reference backend gate nothing
 * here, so neither do we). The service is the choke point that scopes every
 * lookup by the session's firm (ADR-0003) and enforces the reference
 * backend's defaults, newest-first order and soft delete.
 *
 * Timer semantics (the contract's "create/stop timer pair"): the contract
 * defines NO timer route — the UI runs the clock locally (AppShell
 * TimerState) and stopping it is one `POST /time-entries` carrying the
 * elapsed `{ minutes, description, billable, date }` (AppShell.toggleTimer).
 * Everything the stop call omits lands on the reference defaults here:
 * `caseId` → the firm's newest live case (the reference's `db.cases[0]`, its
 * store being newest-first), `userId` → the firm's first user, `rate` →
 * 300000 paise/hr, `date` → today, `minutes` → 0.
 *
 * Amounts: the contract's TimeEntry carries `minutes` and `rate` but NO
 * amount — value is derived client-side as (minutes / 60) × rate
 * (TimePage's reducers), exactly like the reference, which computes nothing
 * server-side. So there is no server-side rounding policy to mirror: both
 * fields are stored verbatim as integers (paise for `rate`), and integer
 * paise cannot round.
 */
export class TimeEntriesService {
  constructor(
    private readonly repos: AuthRepositories,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Newest first — the mock and the reference both unshift new entries. */
  async list(firmId: string): Promise<ApiTimeEntry[]> {
    const rows = await this.repos.timeEntries.listByFirm(firmId);
    return rows.map(toApiTimeEntry);
  }

  /**
   * POST /time-entries → 201 with the created entity. Defaults mirror the
   * reference backend exactly; the required case link defaults to the firm's
   * newest live case when the body omits one (400 "Case not found" when the
   * firm has no live case to attach work to). `invoiced` is stamped false
   * server-side and never read from the input.
   */
  async create(firmId: string, input: TimeEntryInput): Promise<ApiTimeEntry> {
    const normalized = normalizeInput(input);
    const today = this.now().toISOString().slice(0, 10);
    const row = await this.repos.transaction(async (tx) => {
      // Required-case resolution: explicit link first (existence-checked),
      // else the firm's newest live case.
      let caseId: string;
      if (normalized.caseId === undefined || normalized.caseId === null) {
        const newest = (await tx.cases.listByFirm(firmId, {}))[0];
        if (!newest) throw new HttpError(400, TIME_CASE_MISSING_MESSAGE);
        caseId = newest.id;
      } else {
        const linked = await tx.cases.findById(firmId, normalized.caseId);
        if (!linked) throw new HttpError(400, TIME_CASE_MISSING_MESSAGE);
        caseId = linked.id;
      }

      // The entry's user defaults to the firm's first user (the reference's
      // db.users[0], same default as the tasks assignee).
      let userId = normalized.userId;
      if (userId === undefined) {
        const first = (await tx.users.listByFirm(firmId))[0];
        if (!first) throw new HttpError(400, NO_USER_MESSAGE);
        userId = first.id;
      }

      return tx.timeEntries.create({
        firmId,
        caseId,
        userId,
        date: normalized.date ?? today,
        minutes: normalized.minutes ?? 0,
        rate: normalized.rate ?? 300000,
        description: normalized.description ?? "",
        billable: normalized.billable ?? true,
        invoiced: false,
      });
    });
    return toApiTimeEntry(row);
  }

  /**
   * PATCH /time-entries/:id — only the sent fields move (mock Object.assign).
   * The case link may be re-pointed (existence-checked) but never cleared:
   * `null`/`""` are 400 "Invalid case id" — a required link has no null.
   */
  async update(firmId: string, id: string, patch: TimeEntryInput): Promise<ApiTimeEntry> {
    const normalized = normalizeInput(patch);
    const caseLink = normalized.caseId;
    if (caseLink === null) throw new HttpError(400, TIME_CASE_MESSAGE);
    const row = await this.repos.transaction(async (tx) => {
      if (caseLink !== undefined) {
        const linked = await tx.cases.findById(firmId, caseLink);
        if (!linked) throw new HttpError(400, TIME_CASE_MISSING_MESSAGE);
      }
      return tx.timeEntries.update(firmId, id, toPatch(normalized));
    });
    if (!row) throw new HttpError(404, "Time entry not found");
    return toApiTimeEntry(row);
  }

  /** DELETE /time-entries/:id → 204. Soft delete per the baseline convention. */
  async delete(firmId: string, id: string): Promise<void> {
    const deleted = await this.repos.timeEntries.delete(firmId, id);
    if (!deleted) throw new HttpError(404, "Time entry not found");
  }

  /**
   * Ticket 13's unbilled selector (the handoff's listUninvoicedByCase): the
   * firm's live, not-yet-invoiced entries for one case, newest first — the
   * list an invoice builder draws its time lines from. A malformed caseId is
   * the same 400 the create path uses; a well-formed unknown (or other
   * firm's) case is simply an empty list — a selector leaks nothing.
   */
  async listUninvoicedByCase(firmId: string, caseId: string): Promise<ApiTimeEntry[]> {
    if (!UUID_PATTERN.test(caseId)) throw new HttpError(400, TIME_CASE_MESSAGE);
    const rows = await this.repos.timeEntries.listUninvoicedByCase(firmId, caseId);
    return rows.map(toApiTimeEntry);
  }

  /**
   * Ticket 13's flip path (the handoff's markInvoiced): stamps `invoiced` on
   * the given entries of the firm. This is the ONLY route to the flag — it
   * is server-managed end to end (never client-writable, the create path
   * stamps false), so an invoice flow marks entries through here and a
   * reversal un-marks them here too. Returns the number of live entries
   * moved (cross-firm and soft-deleted ids are silently inert).
   */
  async setInvoiced(firmId: string, ids: string[], invoiced: boolean): Promise<number> {
    for (const id of ids) {
      if (!UUID_PATTERN.test(id)) throw new HttpError(400, "Invalid time entry id");
    }
    return this.repos.timeEntries.setInvoicedByIds(firmId, ids, invoiced);
  }
}
