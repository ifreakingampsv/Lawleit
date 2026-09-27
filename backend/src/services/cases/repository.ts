/**
 * Repository seam for cases (ticket 10) — the contacts seam's twin
 * (services/contacts/repository.ts): services depend only on these interfaces;
 * the Drizzle binding (`drizzle.ts`) is the production implementation and
 * tests bind the in-memory fake (`in-memory.ts`), which is also what keeps
 * the suite green with no database present.
 *
 * Tenancy (ADR-0003): every method takes the caller's firm id and filters by
 * it; a cross-firm id must look up as "not found", never as an error that
 * leaks existence. The cases tests assert that.
 */

/** The status vocabulary of the API contract (app/src/lib/data/types.ts CaseStatus). */
export const CASE_STATUSES = ["open", "pending", "closed"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** The stage vocabulary of the API contract (types.ts CaseStage). */
export const CASE_STAGES = [
  "intake",
  "discovery",
  "consult",
  "court date pending",
  "negotiation",
  "trial",
  "resolved",
] as const;
export type CaseStage = (typeof CASE_STAGES)[number];

export interface CaseRow {
  id: string;
  firmId: string;
  /** Server-assigned "YYYY-NNNN" (case_number_counters); never client-set. */
  number: string;
  title: string;
  /** Null until the matter has a client; the API shape renders "" like the mock/reference. */
  clientId: string | null;
  practiceArea: string;
  stage: string;
  status: string;
  /** Contract dates are ISO YYYY-MM-DD strings. */
  openDate: string;
  courtDate: string | null;
  statute: string | null;
  leadAttorneyId: string;
  description: string;
  /** Integer paise (types.ts Paise). */
  billableRate: number;
  /** Integer paise; owned by the trust ledger, never a client patch. */
  trustBalance: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** The case shape the API contract exposes (types.ts Case). */
export type ApiCase = Pick<
  CaseRow,
  | "id"
  | "number"
  | "title"
  | "practiceArea"
  | "stage"
  | "status"
  | "openDate"
  | "leadAttorneyId"
  | "description"
  | "billableRate"
  | "trustBalance"
> & {
  /** Contract shape is `ID` — an empty string while the matter has no client. */
  clientId: string;
  courtDate?: string;
  statute?: string;
};

/**
 * Destructuring is the whitelist — firm_id and bookkeeping (created_at,
 * updated_at, deleted_at) cannot leak, and nullables vanish when empty, so
 * responses are byte-shape compatible with the mock adapter's cases.
 */
export function toApiCase(row: CaseRow): ApiCase {
  const api: ApiCase = {
    id: row.id,
    number: row.number,
    title: row.title,
    clientId: row.clientId ?? "",
    practiceArea: row.practiceArea,
    stage: row.stage,
    status: row.status,
    openDate: row.openDate,
    leadAttorneyId: row.leadAttorneyId,
    description: row.description,
    billableRate: row.billableRate,
    trustBalance: row.trustBalance,
  };
  if (row.courtDate !== null) api.courtDate = row.courtDate;
  if (row.statute !== null) api.statute = row.statute;
  return api;
}

export interface NewCase {
  firmId: string;
  number: string;
  title: string;
  clientId: string | null;
  practiceArea: string;
  stage: string;
  status: string;
  openDate: string;
  courtDate: string | null;
  statute: string | null;
  leadAttorneyId: string;
  description: string;
  billableRate: number;
  trustBalance: number;
}

/**
 * Server-managed fields (`number`, `trustBalance`) are deliberately absent —
 * the number counter and the trust ledger own them.
 */
export interface CasePatch {
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

/** GET /cases?status=&q= — semantics mirror the reference backend exactly. */
export interface CaseListFilter {
  status?: string;
  q?: string;
}

export interface CaseRepository {
  create(input: NewCase): Promise<CaseRow>;
  /** Live (non-deleted) case in the given firm; null otherwise. */
  findById(firmId: string, id: string): Promise<CaseRow | null>;
  /**
   * The firm's live cases, newest first (the mock/reference unshift), narrowed
   * by the reference's list semantics: `status` exact match, `q` a
   * case-insensitive substring over `` `${number} ${title}` ``.
   */
  listByFirm(firmId: string, filter: CaseListFilter): Promise<CaseRow[]>;
  /** Live-row update; null when the row is missing, deleted, or another firm's. */
  update(firmId: string, id: string, patch: CasePatch): Promise<CaseRow | null>;
  /** Soft delete: stamps deleted_at, the row itself stays (ADR-0003 audit). */
  delete(firmId: string, id: string): Promise<boolean>;
}

/**
 * The per-firm-year sequence behind the server-assigned case numbers. `next`
 * must be atomic: two concurrent creates in one firm-year must reserve
 * distinct values (the Drizzle binding does it with one
 * INSERT … ON CONFLICT DO UPDATE inside the create transaction; the in-memory
 * fake is single-threaded and trivially atomic).
 */
export interface CaseNumberRepository {
  next(firmId: string, year: number): Promise<number>;
}
