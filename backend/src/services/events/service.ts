import type { AuthRepositories } from "../auth/repository.js";
import { HttpError } from "../httpError.js";
import type { ApiEvent, EventListFilter, EventPatch, EventType } from "./repository.js";
import { EVENT_TYPES, toApiEvent } from "./repository.js";

/** Shown (as a 400) when `type` is not in the contract's CalendarEvent vocabulary. */
export const EVENT_TYPE_MESSAGE = "Type must be meeting, court, deadline, personal, or task";
/** Shown (as a 400) when the event date is not an ISO YYYY-MM-DD string. */
export const EVENT_DATE_MESSAGE = "Date must be a YYYY-MM-DD string";
/** Shown (as a 400) when start/end is not an "HH:MM" time-of-day string. */
export const EVENT_START_TIME_MESSAGE = "Start time must be an HH:MM string";
export const EVENT_END_TIME_MESSAGE = "End time must be an HH:MM string";
/** Shown (as a 400) when a caseId is not a uuid — the column is uuid. */
export const EVENT_CASE_MESSAGE = "Invalid case id";
/** Shown (as a 400) when a well-formed caseId is not a live case of the firm. */
export const EVENT_CASE_MISSING_MESSAGE = "Case not found";
/** Shown (as a 400) when an attendeeIds entry is not a uuid — the column is uuid[]. */
export const EVENT_ATTENDEE_MESSAGE = "Invalid attendee id";

/** UUID shape of every production id (same rule as the :id params). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** The contract's "HH:MM" time-of-day shape (types.ts: start "11:00"). */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_ATTENDEES = 100;
const MAX_REMINDERS = 10;

const LENGTH_LIMITS = {
  title: [200, "Title is too long"],
  location: [500, "Location is too long"],
  color: [20, "Color is too long"],
  reminder: [40, "Reminder is too long"],
} as const satisfies Record<string, [number, string]>;

/**
 * The writable event input (create and patch). Deliberately free-form: the
 * reference backend and the mock adapter store these fields verbatim (no
 * trimming), and the parity checklist in the ticket depends on that.
 * `source` (the V2 cause-list seam) is not here at all — server-managed:
 * every V1 event is 'manual' and the contract's CalendarEvent has no source
 * field, so a client-sent value is stripped by the zod schema and ignored.
 */
export interface EventInput {
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

function checkLength(value: string | null | undefined, field: keyof typeof LENGTH_LIMITS): void {
  const [max, message] = LENGTH_LIMITS[field];
  if ((value ?? "").length > max) throw new HttpError(400, message);
}

function checkUuid(value: string, message: string): void {
  if (!UUID_PATTERN.test(value)) throw new HttpError(400, message);
}

function checkIsoDate(value: string): void {
  if (!ISO_DATE_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, EVENT_DATE_MESSAGE);
  }
}

function checkTime(value: string, field: "start" | "end"): void {
  if (!TIME_PATTERN.test(value)) {
    throw new HttpError(
      400,
      field === "start" ? EVENT_START_TIME_MESSAGE : EVENT_END_TIME_MESSAGE,
    );
  }
}

function validateType(type: string): void {
  if (!EVENT_TYPES.includes(type as EventType)) {
    throw new HttpError(400, EVENT_TYPE_MESSAGE);
  }
}

function validateAttendeeIds(attendeeIds: string[]): void {
  if (attendeeIds.length > MAX_ATTENDEES) throw new HttpError(400, "Too many attendees");
  for (const id of attendeeIds) {
    checkUuid(id, EVENT_ATTENDEE_MESSAGE);
  }
}

function validateReminders(reminders: string[]): void {
  if (reminders.length > MAX_REMINDERS) throw new HttpError(400, "Too many reminders");
  for (const reminder of reminders) {
    checkLength(reminder, "reminder");
  }
}

function normalizePatch(patch: EventInput): EventPatch {
  const out: EventPatch = {};
  if (patch.title !== undefined) {
    checkLength(patch.title, "title");
    out.title = patch.title;
  }
  if (patch.date !== undefined) {
    checkIsoDate(patch.date);
    out.date = patch.date;
  }
  if (patch.start !== undefined) {
    checkTime(patch.start, "start");
    out.start = patch.start;
  }
  if (patch.end !== undefined) {
    checkTime(patch.end, "end");
    out.end = patch.end;
  }
  if (patch.allDay !== undefined) {
    out.allDay = patch.allDay;
  }
  if (patch.location !== undefined) {
    checkLength(patch.location, "location");
    out.location = patch.location;
  }
  if (patch.caseId !== undefined) {
    // "" (and null) clear the case link, mirroring the cases.clientId treatment.
    out.caseId = patch.caseId === "" || patch.caseId === null ? null : patch.caseId;
    if (out.caseId !== null) checkUuid(out.caseId, EVENT_CASE_MESSAGE);
  }
  if (patch.attendeeIds !== undefined) {
    validateAttendeeIds(patch.attendeeIds);
    out.attendeeIds = patch.attendeeIds;
  }
  if (patch.type !== undefined) {
    validateType(patch.type);
    out.type = patch.type;
  }
  if (patch.color !== undefined) {
    checkLength(patch.color, "color");
    out.color = patch.color;
  }
  if (patch.reminders !== undefined) {
    if (patch.reminders !== null) validateReminders(patch.reminders);
    out.reminders = patch.reminders;
  }
  return out;
}

/**
 * Events business logic (ticket 11). Practice data of the firm: every firm
 * member manages it (unlike users — the contract and the reference backend
 * gate nothing here, so neither do we). The service is the choke point that
 * scopes every lookup by the session's firm (ADR-0003) and enforces the
 * reference backend's defaults, list semantics and soft delete.
 *
 * The calendar dates are ISO calendar days, not instants — the contract's
 * Conventions say so ("Dates are ISO YYYY-MM-DD (days)…") and the
 * mock/reference filter with day-string comparison — so no timezone
 * normalization happens anywhere on this surface.
 */
export class EventsService {
  constructor(
    private readonly repos: AuthRepositories,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The reference's inclusive day-range filter; bounds validated first. */
  async list(firmId: string, filter: EventListFilter = {}): Promise<ApiEvent[]> {
    if (filter.from !== undefined) checkIsoDate(filter.from);
    if (filter.to !== undefined) checkIsoDate(filter.to);
    const rows = await this.repos.events.listByFirm(firmId, filter);
    return rows.map(toApiEvent);
  }

  /**
   * POST /events → 201 with the created entity. Defaults mirror the reference
   * backend exactly: title "New event", date today, start "09:00", end
   * "10:00", type "meeting", color "#4B4ACF", attendeeIds [], no location /
   * case link / allDay / reminders until set. `source` is stamped 'manual'
   * (the V2 cause-list seam stays closed in V1).
   */
  async create(firmId: string, input: EventInput): Promise<ApiEvent> {
    const patch = normalizePatch(input);
    const today = this.now().toISOString().slice(0, 10);
    const row = await this.repos.transaction(async (tx) => {
      if (patch.caseId !== undefined && patch.caseId !== null) {
        const linked = await tx.cases.findById(firmId, patch.caseId);
        if (!linked) throw new HttpError(400, EVENT_CASE_MISSING_MESSAGE);
      }
      return tx.events.create({
        firmId,
        title: patch.title ?? "New event",
        date: patch.date ?? today,
        start: patch.start ?? "09:00",
        end: patch.end ?? "10:00",
        allDay: patch.allDay ?? null,
        location: patch.location ?? null,
        caseId: patch.caseId ?? null,
        attendeeIds: patch.attendeeIds ?? [],
        type: patch.type ?? "meeting",
        color: patch.color ?? "#4B4ACF",
        reminders: patch.reminders ?? null,
        source: "manual",
      });
    });
    return toApiEvent(row);
  }

  /**
   * PATCH /events/:id — only the sent fields move (mock Object.assign). The
   * `source` seam never moves: the patch type does not carry it.
   */
  async update(firmId: string, id: string, patch: EventInput): Promise<ApiEvent> {
    const normalized = normalizePatch(patch);
    const row = await this.repos.transaction(async (tx) => {
      if (normalized.caseId !== undefined && normalized.caseId !== null) {
        const linked = await tx.cases.findById(firmId, normalized.caseId);
        if (!linked) throw new HttpError(400, EVENT_CASE_MISSING_MESSAGE);
      }
      return tx.events.update(firmId, id, normalized);
    });
    if (!row) throw new HttpError(404, "Event not found");
    return toApiEvent(row);
  }

  /** DELETE /events/:id → 204. Soft delete per the baseline convention. */
  async delete(firmId: string, id: string): Promise<void> {
    const deleted = await this.repos.events.delete(firmId, id);
    if (!deleted) throw new HttpError(404, "Event not found");
  }
}
