import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { payments } from "../../db/schema.js";
import type { DbExecutor } from "../auth/drizzle-repository.js";
import type { NewPayment, PaymentRepository, PaymentRow } from "./repository.js";

/**
 * Drizzle/postgres.js binding of the payments repository seam (ticket 14) —
 * the production implementation used when DATABASE_URL is set. Every read
 * that serves a request filters soft deletes and the firm scope (ADR-0003);
 * the write path sets updated_at itself (no triggers, per drizzle/README.md).
 */

const livePayment = () => isNull(payments.deletedAt);

export class DrizzlePaymentRepository implements PaymentRepository {
  constructor(private readonly exec: DbExecutor) {}

  async create(input: NewPayment): Promise<PaymentRow> {
    const [row] = await this.exec.insert(payments).values(input).returning();
    if (!row) throw new Error("payment insert returned no row");
    return row;
  }

  async listByFirm(firmId: string): Promise<PaymentRow[]> {
    return this.exec
      .select()
      .from(payments)
      .where(and(eq(payments.firmId, firmId), livePayment()))
      // Newest first (the mock/reference unshift); id breaks ties between
      // rows sharing one timestamp.
      .orderBy(desc(payments.createdAt), desc(payments.id));
  }

  async sumNonFailedForInvoice(firmId: string, invoiceId: string): Promise<number> {
    const [row] = await this.exec
      // sum(bigint) returns numeric — read it as a string and cast exactly once.
      .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
      .from(payments)
      .where(
        and(
          eq(payments.firmId, firmId),
          eq(payments.invoiceId, invoiceId),
          // The reference's roll-up filter (status !== "failed"), mirrored.
          ne(payments.status, "failed"),
          livePayment(),
        ),
      );
    return Number(row?.total ?? 0);
  }

  async softDelete(firmId: string, id: string): Promise<boolean> {
    const [row] = await this.exec
      .update(payments)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(payments.id, id), eq(payments.firmId, firmId), livePayment()))
      .returning();
    return row !== undefined;
  }
}
