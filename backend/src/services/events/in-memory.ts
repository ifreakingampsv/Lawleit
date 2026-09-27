import { randomUUID } from "node:crypto";
import type {
  EventListFilter,
  EventPatch,
  EventRepository,
  EventRow,
  NewEvent,
} from "./repository.js";

/**
 * In-memory EventRepository for tests — the events twin of
 * services/auth/testing.ts's fakes. Honors the seam's semantics (firm
 * scoping, insertion-order listing, the reference's ?from=/?to= matching,
 * soft delete) so service and route tests exercise real logic without a
 * database; the DB twin proves the Drizzle binding stays behaviorally
 * identical.
 */
export class InMemoryEventRepository implements EventRepository {
  constructor(readonly events: EventRow[]) {}

  async create(input: NewEvent): Promise<EventRow> {
    const row: EventRow = {
      id: randomUUID(),
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    // The mock/reference PUSH new events (insertion order, oldest first) —
    // the deliberate difference from contacts/cases, which unshift.
    this.events.push(row);
    return row;
  }

  async findById(firmId: string, id: string): Promise<EventRow | null> {
    return (
      this.events.find(
        (e) => e.id === id && e.firmId === firmId && e.deletedAt === null,
      ) ?? null
    );
  }

  async listByFirm(firmId: string, filter: EventListFilter): Promise<EventRow[]> {
    // push keeps the store in insertion order, so filtering preserves the
    // contract order exactly. Range matching is the reference backend's:
    // inclusive day-string comparison, both bounds optional.
    return this.events.filter((e) => {
      if (e.firmId !== firmId || e.deletedAt !== null) return false;
      if (filter.from !== undefined && e.date < filter.from) return false;
      if (filter.to !== undefined && e.date > filter.to) return false;
      return true;
    });
  }

  async update(firmId: string, id: string, patch: EventPatch): Promise<EventRow | null> {
    const row = await this.findById(firmId, id);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date() });
    return row;
  }

  /** Soft delete — the row stays in the store with deleted_at stamped. */
  async delete(firmId: string, id: string): Promise<boolean> {
    const row = await this.findById(firmId, id);
    if (!row) return false;
    row.deletedAt = new Date();
    row.updatedAt = row.deletedAt;
    return true;
  }
}
