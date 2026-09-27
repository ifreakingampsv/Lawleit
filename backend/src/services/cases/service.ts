import type { AuthRepositories } from "../auth/repository.js";
import { HttpError } from "../httpError.js";
import type { ApiCase, CaseListFilter, CasePatch } from "./repository.js";
import { CASE_STAGES, CASE_STATUSES, toApiCase, type CaseStage, type CaseStatus } from "./repository.js";

/** Shown (as a 400) when `status` is not in the contract's Case vocabulary. */
export const CASE_STATUS_MESSAGE = "Status must be open, pending, or closed";
/** Shown (as a 400) when `stage` is not in the contract's CaseStage vocabulary. */
export const CASE_STAGE_MESSAGE =
  "Stage must be intake, discovery, consult, court date pending, negotiation, trial, or resolved";
/** Shown (as a 400) when a clientId is not a uuid — the column is uuid. */
export const CASE_CLIENT_MESSAGE = "Invalid client id";
/** Shown (as a 400) when a well-formed clientId is not a live contact of the firm. */
export const CASE_CLIENT_MISSING_MESSAGE = "Client not found";
/** Shown (as a 400) when a leadAttorneyId is not a uuid. */
export const CASE_ATTORNEY_MESSAGE = "Invalid attorney id";
/** Shown (as a 400) when a date field is not an ISO YYYY-MM-DD string. */
export const CASE_DATE_MESSAGE = "Date must be a YYYY-MM-DD string";
/** Shown (as a 400) when billableRate is not a non-negative integer paise amount. */
export const BILLABLE_RATE_MESSAGE = "Billable rate must be a non-negative integer";
/** Shown (as a 400) when the firm somehow has no user to default the attorney to. */
const NO_USER_MESSAGE = "Firm has no users";

/** UUID shape of every production id (same rule as the :id params). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RATE = 1_000_000_000;
/** The mock adapter's create default (₹3,000/hr in paise); the reference's 300 is its stale dollar-era value. */
const DEFAULT_BILLABLE_RATE = 300000;

const LENGTH_LIMITS = {
  title: [200, "Title is too long"],
  practiceArea: [120, "Practice area is too long"],
  description: [4000, "Description is too long"],
  statute: [200, "Statute is too long"],
} as const satisfies Record<string, [number, string]>;

/**
 * The writable case input (create and patch). Deliberately free-form: the
 * reference backend and the mock adapter store these fields verbatim (no
 * trimming), and the parity checklist in the ticket depends on that.
 * `number` and `trustBalance` are not here at all — they are server-managed
 * (the contract assigns numbers server-side; the trust ledger owns balances),
 * so a client-sent value is ignored rather than stored.
 */
export interface CaseInput {
  title?: string;
  clientId?: string | null;
  practiceArea?: string;
  stage?: string;
  status?: string;
  openDate?: string;
  courtDate?: string | null;
  statute?: string | null;
  leadAttorneyId?: string;
  description?: string;
  billableRate?: number;
}

function checkLength(value: string | null | undefined, field: keyof typeof LENGTH_LIMITS): void {
  const [max, message] = LENGTH_LIMITS[field];
  if ((value ?? "").length > max) throw new HttpError(400, message);
}

function checkUuid(value: string, message: string): void {
  if (!UUID_PATTERN.test(value)) throw new HttpError(400, message);
}

function checkIsoDate(value: string): void {
  if (!ISO_DATE_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, CASE_DATE_MESSAGE);
  }
}

function normalizePatch(patch: CaseInput): CasePatch {
  const out: CasePatch = {};
  if (patch.title !== undefined) {
    checkLength(patch.title, "title");
    out.title = patch.title;
  }
  if (patch.clientId !== undefined) {
    // "" (and null) clear the client, mirroring the mock/reference's empty-string default.
    out.clientId = patch.clientId === "" || patch.clientId === null ? null : patch.clientId;
    if (out.clientId !== null) checkUuid(out.clientId, CASE_CLIENT_MESSAGE);
  }
  if (patch.practiceArea !== undefined) {
    checkLength(patch.practiceArea, "practiceArea");
    out.practiceArea = patch.practiceArea;
  }
  if (patch.stage !== undefined) {
    if (!CASE_STAGES.includes(patch.stage as CaseStage)) throw new HttpError(400, CASE_STAGE_MESSAGE);
    out.stage = patch.stage;
  }
  if (patch.status !== undefined) {
    if (!CASE_STATUSES.includes(patch.status as CaseStatus)) {
      throw new HttpError(400, CASE_STATUS_MESSAGE);
    }
    out.status = patch.status;
  }
  if (patch.openDate !== undefined) {
    checkIsoDate(patch.openDate);
    out.openDate = patch.openDate;
  }
  if (patch.courtDate !== undefined) {
    if (patch.courtDate !== null) checkIsoDate(patch.courtDate);
    out.courtDate = patch.courtDate;
  }
  if (patch.statute !== undefined) {
    checkLength(patch.statute, "statute");
    out.statute = patch.statute;
  }
  if (patch.leadAttorneyId !== undefined) {
    checkUuid(patch.leadAttorneyId, CASE_ATTORNEY_MESSAGE);
    out.leadAttorneyId = patch.leadAttorneyId;
  }
  if (patch.description !== undefined) {
    checkLength(patch.description, "description");
    out.description = patch.description;
  }
  if (patch.billableRate !== undefined) {
    const rate = patch.billableRate;
    if (!Number.isInteger(rate) || rate < 0 || rate > MAX_RATE) {
      throw new HttpError(400, BILLABLE_RATE_MESSAGE);
    }
    out.billableRate = rate;
  }
  return out;
}

/**
 * Cases business logic (ticket 10). Practice data of the firm: every firm
 * member manages it (unlike users — the contract and the reference backend
 * gate nothing here, so neither do we). The service is the choke point that
 * scopes every lookup by the session's firm (ADR-0003), assigns numbers
 * server-side in the contract's `YYYY-NNNN` format, and enforces the
 * reference backend's defaults and soft delete.
 *
 * Number assignment design (one line): the reference counts rows
 * (`length + 50`), which reuses numbers after deletions and collides under
 * concurrent creates, so the safest matching behavior is a per-(firm, year)
 * counter row incremented by an atomic INSERT … ON CONFLICT DO UPDATE inside
 * the create transaction — the row lock serializes concurrent creates, the
 * sequences stay independent per firm and per year, and no number is ever
 * reused (the demo seed's +50 offset has no production seed to clear).
 */
export class CasesService {
  constructor(
    private readonly repos: AuthRepositories,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Newest first — the mock and the reference both unshift new cases. */
  async list(firmId: string, filter: CaseListFilter = {}): Promise<ApiCase[]> {
    const rows = await this.repos.cases.listByFirm(firmId, filter);
    return rows.map(toApiCase);
  }

  /** 404 for missing, soft-deleted, and other firms' cases alike. */
  async get(firmId: string, id: string): Promise<ApiCase> {
    const row = await this.repos.cases.findById(firmId, id);
    if (!row) throw new HttpError(404, "Case not found");
    return toApiCase(row);
  }

  /**
   * POST /cases → 201 with the created entity. Defaults mirror the reference
   * backend exactly: title "New matter", empty clientId ("" in the contract
   * shape), practiceArea "General", stage "intake", status "open", openDate
   * today (a client-sent openDate is ignored there too), description "",
   * billableRate 300000 paise (the mock's default; the reference's 300 is its
   * dollar-era value), trustBalance 0. The lead attorney defaults to the
   * firm's first user (the reference's `db.users[0]`), and the number is
   * assigned by the per-firm-year counter — never taken from the client.
   */
  async create(firmId: string, input: CaseInput): Promise<ApiCase> {
    const patch = normalizePatch(input);
    const today = this.now().toISOString().slice(0, 10);
    const year = Number(today.slice(0, 4));
    const row = await this.repos.transaction(async (tx) => {
      if (patch.clientId !== undefined && patch.clientId !== null) {
        const client = await tx.contacts.findById(firmId, patch.clientId);
        if (!client) throw new HttpError(400, CASE_CLIENT_MISSING_MESSAGE);
      }
      let leadAttorneyId = patch.leadAttorneyId;
      if (leadAttorneyId === undefined) {
        const users = await tx.users.listByFirm(firmId);
        const first = users[0];
        if (!first) throw new HttpError(400, NO_USER_MESSAGE);
        leadAttorneyId = first.id;
      }
      const seq = await tx.caseNumbers.next(firmId, year);
      return tx.cases.create({
        firmId,
        number: `${year}-${String(seq).padStart(4, "0")}`,
        title: patch.title ?? "New matter",
        clientId: patch.clientId ?? null,
        practiceArea: patch.practiceArea ?? "General",
        stage: patch.stage ?? "intake",
        status: patch.status ?? "open",
        openDate: today,
        courtDate: patch.courtDate ?? null,
        statute: patch.statute ?? null,
        leadAttorneyId,
        description: patch.description ?? "",
        billableRate: patch.billableRate ?? DEFAULT_BILLABLE_RATE,
        trustBalance: 0,
      });
    });
    return toApiCase(row);
  }

  /**
   * PATCH /cases/:id — only the sent fields move (mock Object.assign). The
   * contract defines no status-transition table for cases, so any contract
   * status may be set in any order (free transitions are pinned by tests).
   * `number` and `trustBalance` never move: the zod schemas strip them, and
   * the patch type does not carry them.
   */
  async update(firmId: string, id: string, patch: CaseInput): Promise<ApiCase> {
    const normalized = normalizePatch(patch);
    const row = await this.repos.transaction(async (tx) => {
      if (normalized.clientId !== undefined && normalized.clientId !== null) {
        const client = await tx.contacts.findById(firmId, normalized.clientId);
        if (!client) throw new HttpError(400, CASE_CLIENT_MISSING_MESSAGE);
      }
      return tx.cases.update(firmId, id, normalized);
    });
    if (!row) throw new HttpError(404, "Case not found");
    return toApiCase(row);
  }

  /**
   * DELETE /cases/:id → 204. The reference and the contract block nothing
   * (dependents are out of V1 scope until tickets 11–13); the delete is a
   * soft delete per the baseline convention — the row stays with deleted_at
   * stamped, reads drop it, and the counter never reuses its number.
   */
  async delete(firmId: string, id: string): Promise<void> {
    const deleted = await this.repos.cases.delete(firmId, id);
    if (!deleted) throw new HttpError(404, "Case not found");
  }
}
