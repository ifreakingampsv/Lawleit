import { and, desc, eq, isNull } from "drizzle-orm";
import { tasks } from "../../db/schema.js";
import type { DbExecutor } from "../auth/drizzle-repository.js";
import type {
  TaskPatch,
  TaskRepository,
  TaskRow,
  NewTask,
} from "./repository.js";

/**
 * Drizzle/postgres.js binding of the tasks repository seam (ticket 11) —
 * the production implementation used when DATABASE_URL is set. Every read
 * that serves a request filters soft deletes and the firm scope (ADR-0003);
 * the write path sets updated_at itself (no triggers, per drizzle/README.md).
 */

const liveTask = () => isNull(tasks.deletedAt);

export class DrizzleTaskRepository implements TaskRepository {
  constructor(private readonly exec: DbExecutor) {}

  async create(input: NewTask): Promise<TaskRow> {
    const [row] = await this.exec.insert(tasks).values(input).returning();
    if (!row) throw new Error("task insert returned no row");
    return row;
  }

  async findById(firmId: string, id: string): Promise<TaskRow | null> {
    const [row] = await this.exec
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.firmId, firmId), liveTask()))
      .limit(1);
    return row ?? null;
  }

  async listByFirm(firmId: string): Promise<TaskRow[]> {
    return this.exec
      .select()
      .from(tasks)
      .where(and(eq(tasks.firmId, firmId), liveTask()))
      // Newest first (the mock/reference unshift); id breaks ties between
      // rows sharing one timestamp.
      .orderBy(desc(tasks.createdAt), desc(tasks.id));
  }

  async update(firmId: string, id: string, patch: TaskPatch): Promise<TaskRow | null> {
    const [row] = await this.exec
      .update(tasks)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(tasks.id, id), eq(tasks.firmId, firmId), liveTask()))
      .returning();
    return row ?? null;
  }

  /** Soft delete: the row stays with deleted_at stamped (baseline convention). */
  async delete(firmId: string, id: string): Promise<boolean> {
    const [row] = await this.exec
      .update(tasks)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tasks.id, id), eq(tasks.firmId, firmId), liveTask()))
      .returning();
    return row !== undefined;
  }
}
