import { randomUUID } from "node:crypto";
import type {
  ExpensePatch,
  ExpenseRepository,
  ExpenseRow,
  NewExpense,
} from "./repository.js";

/**
 * In-memory ExpenseRepository for tests — the time-entries twin of
 * services/auth/testing.ts's fakes. Honors the seam's semantics (firm
 * scoping, newest-first listing, soft delete) so service and route tests
 * exercise real logic without a database; the DB twin proves the Drizzle
 * binding stays behaviorally identical.
 */
export class InMemoryExpenseRepository implements ExpenseRepository {
  constructor(readonly expenses: ExpenseRow[]) {}

  async create(input: NewExpense): Promise<ExpenseRow> {
    const row: ExpenseRow = {
      id: randomUUID(),
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    // Newest first, mirroring the mock/reference unshift.
    this.expenses.unshift(row);
    return row;
  }

  async findById(firmId: string, id: string): Promise<ExpenseRow | null> {
    return (
      this.expenses.find(
        (e) => e.id === id && e.firmId === firmId && e.deletedAt === null,
      ) ?? null
    );
  }

  async listByFirm(firmId: string): Promise<ExpenseRow[]> {
    // unshift keeps the store newest-first, so filtering preserves the
    // contract order exactly (same-millisecond inserts included).
    return this.expenses.filter((e) => e.firmId === firmId && e.deletedAt === null);
  }

  async update(firmId: string, id: string, patch: ExpensePatch): Promise<ExpenseRow | null> {
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
