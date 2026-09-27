import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { events } from "../../db/schema.js";
import type { DbExecutor } from "../auth/drizzle-repository.js";
import type {
  EventListFilter,
  EventPatch,
  EventRepository,
  EventRow,
  NewEvent,
} from "./repository.js";

/**
 * Drizzle/postgres.js binding of the events repository seam (ticket 11) —
 * the production implementation used when DATABASE_URL is set. Every read
 * that serves a request filters soft deletes and the firm scope (ADR-0003);
 * the write path sets updated_at itself (no triggers, per drizzle/README.md).
 */

const liveEvent = () => isNull(events.deletedAt);

export class DrizzleEventRepository implements EventRepository {
  constructor(private readonly exec: DbExecutor) {}

  async create(input: NewEvent): Promise<EventRow> {
    const [row] = await this.exec.insert(events).values(input).returning();
    if (!row) throw new Error("event insert returned no row");
    return row;
  }

  async findById(firmId: string, id: string): Promise<EventRow | null> {
    const [row] = await this.exec
      .select()
      .from(events)
      .where(and(eq(events.id, id), eq(events.firmId, firmId), liveEvent()))
      .limit(1);
    return row ?? null;
  }

  async listByFirm(firmId: string, filter: EventListFilter): Promise<EventRow[]> {
    const conditions = [eq(events.firmId, firmId), liveEvent()];
    // The reference's inclusive day-range semantics; `date` is a
    // mode:string column, so the comparison stays an ISO-day string compare.
    if (filter.from !== undefined) conditions.push(gte(events.date, filter.from));
    if (filter.to !== undefined) conditions.push(lte(events.date, filter.to));
    return this.exec
      .select()
      .from(events)
      .where(and(...conditions))
      // Insertion order, oldest first — the mock/reference PUSH new events
      // (the deliberate difference from contacts/cases); id breaks ties
      // between rows sharing one timestamp.
      .orderBy(asc(events.createdAt), asc(events.id));
  }

  async update(firmId: string, id: string, patch: EventPatch): Promise<EventRow | null> {
    const [row] = await this.exec
      .update(events)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(events.id, id), eq(events.firmId, firmId), liveEvent()))
      .returning();
    return row ?? null;
  }

  /** Soft delete: the row stays with deleted_at stamped (baseline convention). */
  async delete(firmId: string, id: string): Promise<boolean> {
    const [row] = await this.exec
      .update(events)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(events.id, id), eq(events.firmId, firmId), liveEvent()))
      .returning();
    return row !== undefined;
  }
}
