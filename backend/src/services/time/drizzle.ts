import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { timeEntries } from "../../db/schema.js";
import type { DbExecutor } from "../auth/drizzle-repository.js";
import type {
  NewTimeEntry,
  TimeEntryPatch,
  TimeEntryRepository,
  TimeEntryRow,
} from "./repository.js";

/**
 * Drizzle/postgres.js binding of the time-entries repository seam (ticket 12)
 * — the production implementation used when DATABASE_URL is set. Every read
 * that serves a request filters soft deletes and the firm scope (ADR-0003);
 * the write path sets updated_at itself (no triggers, per drizzle/README.md).
 */

const liveEntry = () => isNull(timeEntries.deletedAt);

export class DrizzleTimeEntryRepository implements TimeEntryRepository {
  constructor(private readonly exec: DbExecutor) {}

  async create(input: NewTimeEntry): Promise<TimeEntryRow> {
    const [row] = await this.exec.insert(timeEntries).values(input).returning();
    if (!row) throw new Error("time entry insert returned no row");
    return row;
  }

  async findById(firmId: string, id: string): Promise<TimeEntryRow | null> {
    const [row] = await this.exec
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.id, id), eq(timeEntries.firmId, firmId), liveEntry()))
      .limit(1);
    return row ?? null;
  }

  async listByFirm(firmId: string): Promise<TimeEntryRow[]> {
    return this.exec
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.firmId, firmId), liveEntry()))
      // Newest first (the mock/reference unshift); id breaks ties between
      // rows sharing one timestamp.
      .orderBy(desc(timeEntries.createdAt), desc(timeEntries.id));
  }

  async listUninvoicedByCase(firmId: string, caseId: string): Promise<TimeEntryRow[]> {
    return this.exec
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.firmId, firmId),
          eq(timeEntries.caseId, caseId),
          eq(timeEntries.invoiced, false),
          liveEntry(),
        ),
      )
      .orderBy(desc(timeEntries.createdAt), desc(timeEntries.id));
  }

  async setInvoicedByIds(firmId: string, ids: string[], invoiced: boolean): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.exec
      .update(timeEntries)
      .set({ invoiced, updatedAt: new Date() })
      .where(
        and(
          eq(timeEntries.firmId, firmId),
          inArray(timeEntries.id, ids),
          liveEntry(),
        ),
      )
      .returning({ id: timeEntries.id });
    return rows.length;
  }

  async update(firmId: string, id: string, patch: TimeEntryPatch): Promise<TimeEntryRow | null> {
    const [row] = await this.exec
      .update(timeEntries)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(timeEntries.id, id), eq(timeEntries.firmId, firmId), liveEntry()))
      .returning();
    return row ?? null;
  }

  /** Soft delete: the row stays with deleted_at stamped (baseline convention). */
  async delete(firmId: string, id: string): Promise<boolean> {
    const [row] = await this.exec
      .update(timeEntries)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(timeEntries.id, id), eq(timeEntries.firmId, firmId), liveEntry()))
      .returning();
    return row !== undefined;
  }
}
