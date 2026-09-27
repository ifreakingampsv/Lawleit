/**
 * Repository seam for time entries (ticket 12) — the tasks seam's twin
 * (services/tasks/repository.ts): services depend only on these interfaces;
 * the Drizzle binding (`drizzle.ts`) is the production implementation and
 * tests bind the in-memory fake (`in-memory.ts`), which is also what keeps
 * the suite green with no database present.
 *
 * Tenancy (ADR-0003): every method takes the caller's firm id and filters by
 * it; a cross-firm id must look up as "not found", never as an error that
 * leaks existence. The time-entries tests assert that.
 */

export interface TimeEntryRow {
  id: string;
  firmId: string;
  /** Required FK — a time entry always bills a matter (unlike events/tasks). */
  caseId: string;
  /** FK-less soft link (cases.lead_attorney_id / tasks.assignee_id pattern). */
  userId: string;
  /** Contract dates are ISO YYYY-MM-DD strings (days, not instants). */
  date: string;
  minutes: number;
  /** Per hour, integer paise (types.ts Paise). */
  rate: number;
  description: string;
  billable: boolean;
  /** Server-stamped false; ticket 13's invoice flow flips it via the seam. */
  invoiced: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** The time-entry shape the API contract exposes (types.ts TimeEntry). */
export type ApiTimeEntry = Pick<
  TimeEntryRow,
  "id" | "userId" | "caseId" | "date" | "minutes" | "rate" | "description" | "billable" | "invoiced"
>;

/**
 * Destructuring is the whitelist — firm_id and bookkeeping (created_at,
 * updated_at, deleted_at) cannot leak, so responses are byte-shape compatible
 * with the mock adapter's timeEntries. The contract's TimeEntry carries every
 * field required, so nothing drops conditionally.
 */
export function toApiTimeEntry(row: TimeEntryRow): ApiTimeEntry {
  const { id, userId, caseId, date, minutes, rate, description, billable, invoiced } = row;
  return { id, userId, caseId, date, minutes, rate, description, billable, invoiced };
}

export interface NewTimeEntry {
  firmId: string;
  caseId: string;
  userId: string;
  date: string;
  minutes: number;
  rate: number;
  description: string;
  billable: boolean;
  invoiced: boolean;
}

/**
 * The patch a client can move. `invoiced` is deliberately absent — it is
 * server-managed end to end (stamped false on create, never client-writable,
 * the events.`source` seam treatment); ticket 13's invoice flow flips it
 * through its own seam. `caseId` is a required link: a patch may re-point it
 * but never clear it, so the type carries no null.
 */
export interface TimeEntryPatch {
  caseId?: string;
  userId?: string;
  date?: string;
  minutes?: number;
  rate?: number;
  description?: string;
  billable?: boolean;
}

export interface TimeEntryRepository {
  create(input: NewTimeEntry): Promise<TimeEntryRow>;
  /** Live (non-deleted) entry in the given firm; null otherwise. */
  findById(firmId: string, id: string): Promise<TimeEntryRow | null>;
  /** The firm's live entries, newest first (the mock/reference unshift). */
  listByFirm(firmId: string): Promise<TimeEntryRow[]>;
  /** Live-row update; null when the row is missing, deleted, or another firm's. */
  update(firmId: string, id: string, patch: TimeEntryPatch): Promise<TimeEntryRow | null>;
  /** Soft delete: stamps deleted_at, the row itself stays (ADR-0003 audit). */
  delete(firmId: string, id: string): Promise<boolean>;
}
