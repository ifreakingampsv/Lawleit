/**
 * Repository seam for leads (ticket 16) — the cases seam's twin
 * (services/cases/repository.ts): services depend only on these interfaces;
 * the Drizzle binding (`drizzle.ts`) is the production implementation and
 * tests bind the in-memory fake (`in-memory.ts`), which is also what keeps
 * the suite green with no database present.
 *
 * Tenancy (ADR-0003): every method takes the caller's firm id and filters by
 * it; a cross-firm id must look up as "not found", never as an error that
 * leaks existence. The leads tests assert that.
 */

/** The stage vocabulary of the API contract (app/src/lib/data/types.ts LeadStage). */
export const LEAD_STAGES = [
  "new",
  "consult scheduled",
  "contacted",
  "fee agreement",
  "converted",
  "lost",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/** The source vocabulary of the API contract (types.ts Lead["source"]). */
export const LEAD_SOURCES = ["website", "referral", "call", "ads", "walk-in"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

/** One entry of the contract's `activity: { at, text }[]` log. `at` is a full ISO timestamp. */
export interface LeadActivityEntry {
  at: string;
  text: string;
}

export interface LeadRow {
  id: string;
  firmId: string;
  name: string;
  email: string;
  phone: string;
  source: string;
  stage: string;
  practiceArea: string;
  /** Integer paise (types.ts Paise) — the estimated matter value. */
  value: number;
  notes: string | null;
  /** Newest-first activity log; the server appends stage-move/conversion entries. */
  activity: LeadActivityEntry[];
  /** Conversion links (ticket 16) — DB-only traceability; the API shape never exposes them. */
  convertedCaseId: string | null;
  convertedContactId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** The lead shape the API contract exposes (types.ts Lead). */
export type ApiLead = Pick<
  LeadRow,
  "id" | "name" | "email" | "phone" | "source" | "stage" | "practiceArea" | "value"
> & {
  notes?: string;
  activity: LeadActivityEntry[];
  /** Contract shape is an ISO date (YYYY-MM-DD), not a timestamp. */
  createdAt: string;
};

/**
 * Destructuring is the whitelist — firm_id, the conversion links and
 * bookkeeping (updated_at, deleted_at) cannot leak. `createdAt` collapses to
 * its UTC date part and a null `notes` vanishes, so responses are byte-shape
 * compatible with the mock adapter's leads.
 */
export function toApiLead(row: LeadRow): ApiLead {
  const api: ApiLead = {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    source: row.source,
    stage: row.stage,
    practiceArea: row.practiceArea,
    value: row.value,
    activity: row.activity.map((entry) => ({ ...entry })),
    createdAt: row.createdAt.toISOString().slice(0, 10),
  };
  if (row.notes !== null) api.notes = row.notes;
  return api;
}

export interface NewLead {
  firmId: string;
  name: string;
  email: string;
  phone: string;
  source: string;
  stage: string;
  practiceArea: string;
  value: number;
  notes: string | null;
  /** The server-built initial log (["Lead created"]) — never client-sent. */
  activity: LeadActivityEntry[];
}

/**
 * Writable lead columns for a live-row update. `activity` and the conversion
 * links are SERVER-MANAGED: the zod schemas never accept them from clients —
 * the service writes the stage-move/conversion entries itself (the contract
 * makes appending to `activity` a server responsibility) and only the
 * conversion transaction stamps the links.
 */
export interface LeadPatch {
  name?: string;
  email?: string;
  phone?: string;
  source?: string;
  stage?: string;
  practiceArea?: string;
  value?: number;
  notes?: string | null;
  activity?: LeadActivityEntry[];
  convertedCaseId?: string | null;
  convertedContactId?: string | null;
}

export interface LeadRepository {
  create(input: NewLead): Promise<LeadRow>;
  /** Live (non-deleted) lead in the given firm; null otherwise. */
  findById(firmId: string, id: string): Promise<LeadRow | null>;
  /** The firm's live leads, newest first (the mock/reference unshift). */
  listByFirm(firmId: string): Promise<LeadRow[]>;
  /** Live-row update; null when the row is missing, deleted, or another firm's. */
  update(firmId: string, id: string, patch: LeadPatch): Promise<LeadRow | null>;
  /** Soft delete: stamps deleted_at, the row itself stays (ADR-0003 audit). */
  delete(firmId: string, id: string): Promise<boolean>;
}

export interface LeadStageHistoryRow {
  id: string;
  firmId: string;
  leadId: string;
  fromStage: string;
  toStage: string;
  /** The user that made the move — a soft link (no FK), the lead_attorney_id pattern. */
  changedBy: string;
  /** The move's instant; also stamped into the matching `activity` entry. */
  at: Date;
}

export interface NewStageHistoryEntry {
  firmId: string;
  leadId: string;
  fromStage: string;
  toStage: string;
  changedBy: string;
  at: Date;
}

/**
 * The append-only relational audit trail behind the contract's "stage moves
 * append to `activity`" — one row per actual stage change. `activity` (on the
 * lead) is the client-facing log; this is the queryable record.
 */
export interface LeadStageHistoryRepository {
  record(input: NewStageHistoryEntry): Promise<void>;
  /** The lead's moves, newest first. */
  listByLead(firmId: string, leadId: string): Promise<LeadStageHistoryRow[]>;
}
