import { randomUUID } from "node:crypto";
import type {
  TaskPatch,
  TaskRepository,
  TaskRow,
  NewTask,
} from "./repository.js";

/**
 * In-memory TaskRepository for tests — the tasks twin of
 * services/auth/testing.ts's fakes. Honors the seam's semantics (firm
 * scoping, newest-first listing, soft delete) so service and route tests
 * exercise real logic without a database; the DB twin proves the Drizzle
 * binding stays behaviorally identical.
 */
export class InMemoryTaskRepository implements TaskRepository {
  constructor(readonly tasks: TaskRow[]) {}

  async create(input: NewTask): Promise<TaskRow> {
    const row: TaskRow = {
      id: randomUUID(),
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    // Newest first, mirroring the mock/reference unshift.
    this.tasks.unshift(row);
    return row;
  }

  async findById(firmId: string, id: string): Promise<TaskRow | null> {
    return (
      this.tasks.find(
        (t) => t.id === id && t.firmId === firmId && t.deletedAt === null,
      ) ?? null
    );
  }

  async listByFirm(firmId: string): Promise<TaskRow[]> {
    // unshift keeps the store newest-first, so filtering preserves the
    // contract order exactly (same-millisecond inserts included).
    return this.tasks.filter((t) => t.firmId === firmId && t.deletedAt === null);
  }

  async update(firmId: string, id: string, patch: TaskPatch): Promise<TaskRow | null> {
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
