import { randomUUID } from "node:crypto";
import type {
  NewTimeEntry,
  TimeEntryPatch,
  TimeEntryRepository,
  TimeEntryRow,
} from "./repository.js";

/**
 * In-memory TimeEntryRepository for tests — the tasks twin of
 * services/auth/testing.ts's fakes. Honors the seam's semantics (firm
 * scoping, newest-first listing, soft delete) so service and route tests
 * exercise real logic without a database; the DB twin proves the Drizzle
 * binding stays behaviorally identical.
 */
export class InMemoryTimeEntryRepository implements TimeEntryRepository {
  constructor(readonly timeEntries: TimeEntryRow[]) {}

  async create(input: NewTimeEntry): Promise<TimeEntryRow> {
    const row: TimeEntryRow = {
      id: randomUUID(),
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    // Newest first, mirroring the mock/reference unshift.
    this.timeEntries.unshift(row);
    return row;
  }

  async findById(firmId: string, id: string): Promise<TimeEntryRow | null> {
    return (
      this.timeEntries.find(
        (t) => t.id === id && t.firmId === firmId && t.deletedAt === null,
      ) ?? null
    );
  }

  async listByFirm(firmId: string): Promise<TimeEntryRow[]> {
    // unshift keeps the store newest-first, so filtering preserves the
    // contract order exactly (same-millisecond inserts included).
    return this.timeEntries.filter((t) => t.firmId === firmId && t.deletedAt === null);
  }

  async listUninvoicedByCase(firmId: string, caseId: string): Promise<TimeEntryRow[]> {
    return this.timeEntries.filter(
      (t) =>
        t.firmId === firmId && t.caseId === caseId && !t.invoiced && t.deletedAt === null,
    );
  }

  async setInvoicedByIds(firmId: string, ids: string[], invoiced: boolean): Promise<number> {
    const wanted = new Set(ids);
    let moved = 0;
    for (const entry of this.timeEntries) {
      if (entry.firmId === firmId && wanted.has(entry.id) && entry.deletedAt === null) {
        entry.invoiced = invoiced;
        entry.updatedAt = new Date();
        moved += 1;
      }
    }
    return moved;
  }

  async update(firmId: string, id: string, patch: TimeEntryPatch): Promise<TimeEntryRow | null> {
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
