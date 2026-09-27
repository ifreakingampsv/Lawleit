import { and, desc, eq, isNull } from "drizzle-orm";
import { expenses } from "../../db/schema.js";
import type { DbExecutor } from "../auth/drizzle-repository.js";
import type {
  ExpensePatch,
  ExpenseRepository,
  ExpenseRow,
  NewExpense,
} from "./repository.js";

/**
 * Drizzle/postgres.js binding of the expenses repository seam (ticket 12) —
 * the production implementation used when DATABASE_URL is set. Every read
 * that serves a request filters soft deletes and the firm scope (ADR-0003);
 * the write path sets updated_at itself (no triggers, per drizzle/README.md).
 */

const liveExpense = () => isNull(expenses.deletedAt);

export class DrizzleExpenseRepository implements ExpenseRepository {
  constructor(private readonly exec: DbExecutor) {}

  async create(input: NewExpense): Promise<ExpenseRow> {
    const [row] = await this.exec.insert(expenses).values(input).returning();
    if (!row) throw new Error("expense insert returned no row");
    return row;
  }

  async findById(firmId: string, id: string): Promise<ExpenseRow | null> {
    const [row] = await this.exec
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, id), eq(expenses.firmId, firmId), liveExpense()))
      .limit(1);
    return row ?? null;
  }

  async listByFirm(firmId: string): Promise<ExpenseRow[]> {
    return this.exec
      .select()
      .from(expenses)
      .where(and(eq(expenses.firmId, firmId), liveExpense()))
      // Newest first (the mock/reference unshift); id breaks ties between
      // rows sharing one timestamp.
      .orderBy(desc(expenses.createdAt), desc(expenses.id));
  }

  async update(firmId: string, id: string, patch: ExpensePatch): Promise<ExpenseRow | null> {
    const [row] = await this.exec
      .update(expenses)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(expenses.id, id), eq(expenses.firmId, firmId), liveExpense()))
      .returning();
    return row ?? null;
  }

  /** Soft delete: the row stays with deleted_at stamped (baseline convention). */
  async delete(firmId: string, id: string): Promise<boolean> {
    const [row] = await this.exec
      .update(expenses)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(expenses.id, id), eq(expenses.firmId, firmId), liveExpense()))
      .returning();
    return row !== undefined;
  }
}
