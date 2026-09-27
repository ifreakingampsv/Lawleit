/**
 * Repository seam for events (ticket 11) — the contacts/cases seam's twin
 * (services/contacts/repository.ts): services depend only on these interfaces;
 * the Drizzle binding (`drizzle.ts`) is the production implementation and
 * tests bind the in-memory fake (`in-memory.ts`), which is also what keeps
 * the suite green with no database present.
 *
 * Tenancy (ADR-0003): every method takes the caller's firm id and filters by
 * it; a cross-firm id must look up as "not found", never as an error that
 * leaks existence. The events tests assert that.
 */

/** The type vocabulary of the API contract (app/src/lib/data/types.ts CalendarEvent). */
export const EVENT_TYPES = ["meeting", "court", "deadline", "personal", "task"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface EventRow {
  id: string;
  firmId: string;
  title: string;
  /** Contract dates are ISO YYYY-MM-DD strings (days, not instants). */
  date: string;
  /** The contract's "HH:MM" time-of-day strings, stored verbatim. */
  start: string;
  end: string;
  /** Null = unset (the key stays absent from the API shape, like the mock). */
  allDay: boolean | null;
  location: string | null;
  /** Nullable FK to the firm's cases; null = firm-wide event. */
  caseId: string | null;
  /** Soft link to firm users — existence is not enforced (contacts.case_ids pattern). */
  attendeeIds: string[];
  type: string;
  color: string;
  reminders: string[] | null;
  /**
   * Ticket 11's V2 seam: 'manual' for every V1 event (the column default);
   * a V2 court cause-list feed will stamp its own value. Never client-writable
   * and never exposed in the API shape — the contract's CalendarEvent has no
   * source field, and the mapper's whitelist keeps responses byte-shape
   * compatible with the mock adapter.
   */
  source: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** The event shape the API contract exposes (types.ts CalendarEvent). */
export type ApiEvent = Pick<
  EventRow,
  "id" | "title" | "date" | "start" | "end" | "attendeeIds" | "type" | "color"
> & {
  allDay?: boolean;
  location?: string;
  caseId?: string;
  reminders?: string[];
};

/**
 * Destructuring is the whitelist — firm_id, source and bookkeeping
 * (created_at, updated_at, deleted_at) cannot leak, and unset nullables
 * vanish, so responses are byte-shape compatible with the mock adapter's
 * events (a JSON.stringify'd row with `caseId: undefined` drops the key).
 */
export function toApiEvent(row: EventRow): ApiEvent {
  const api: ApiEvent = {
    id: row.id,
    title: row.title,
    date: row.date,
    start: row.start,
    end: row.end,
    attendeeIds: [...row.attendeeIds],
    type: row.type,
    color: row.color,
  };
  if (row.allDay !== null) api.allDay = row.allDay;
  if (row.location !== null) api.location = row.location;
  if (row.caseId !== null) api.caseId = row.caseId;
  if (row.reminders !== null) api.reminders = [...row.reminders];
  return api;
}

export interface NewEvent {
  firmId: string;
  title: string;
  date: string;
  start: string;
  end: string;
  allDay: boolean | null;
  location: string | null;
  caseId: string | null;
  attendeeIds: string[];
  type: string;
  color: string;
  reminders: string[] | null;
  /** The service only ever writes 'manual' in V1; the column default matches. */
  source: string;
}

export interface EventPatch {
  title?: string;
  date?: string;
  start?: string;
  end?: string;
  allDay?: boolean | null;
  location?: string | null;
  caseId?: string | null;
  attendeeIds?: string[];
  type?: string;
  color?: string;
  reminders?: string[] | null;
}

/**
 * GET /events?from=&to= — inclusive ISO-day range, both bounds optional, the
 * reference backend's exact semantics:
 * `(!from || e.date >= from) && (!to || e.date <= to)`.
 */
export interface EventListFilter {
  from?: string;
  to?: string;
}

export interface EventRepository {
  create(input: NewEvent): Promise<EventRow>;
  /** Live (non-deleted) event in the given firm; null otherwise. */
  findById(firmId: string, id: string): Promise<EventRow | null>;
  /**
   * The firm's live events narrowed by the reference's list semantics — an
   * inclusive day range, bounds optional. The mock/reference PUSH new events,
   * so listing order is insertion order (oldest first) — unlike contacts and
   * cases, which unshift.
   */
  listByFirm(firmId: string, filter: EventListFilter): Promise<EventRow[]>;
  /** Live-row update; null when the row is missing, deleted, or another firm's. */
  update(firmId: string, id: string, patch: EventPatch): Promise<EventRow | null>;
  /** Soft delete: stamps deleted_at, the row itself stays (ADR-0003 audit). */
  delete(firmId: string, id: string): Promise<boolean>;
}
