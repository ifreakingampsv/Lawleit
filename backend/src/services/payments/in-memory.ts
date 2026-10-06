import { randomUUID } from "node:crypto";
import type { NewPayment, PaymentRepository, PaymentRow } from "./repository.js";

/**
 * In-memory payment repository for tests — the invoices twin of
 * services/auth/testing.ts's fakes. Honors the seam's semantics (firm
 * scoping, newest-first listing, the non-failed sum) so service and route
 * tests exercise real logic without a database; the DB twin proves the
 * Drizzle binding stays behaviorally identical.
 */
export class InMemoryPaymentRepository implements PaymentRepository {
  constructor(readonly payments: PaymentRow[]) {}

  async create(input: NewPayment): Promise<PaymentRow> {
    const row: PaymentRow = {
      id: randomUUID(),
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    // Newest first, mirroring the mock/reference unshift.
    this.payments.unshift(row);
    return row;
  }

  async listByFirm(firmId: string): Promise<PaymentRow[]> {
    // unshift keeps the store newest-first, so filtering preserves the
    // contract order exactly.
    return this.payments.filter((p) => p.firmId === firmId && p.deletedAt === null);
  }

  async sumNonFailedForInvoice(firmId: string, invoiceId: string): Promise<number> {
    return this.payments
      .filter(
        (p) =>
          p.firmId === firmId &&
          p.invoiceId === invoiceId &&
          p.status !== "failed" &&
          p.deletedAt === null,
      )
      .reduce((sum, p) => sum + p.amount, 0);
  }

  async softDelete(firmId: string, id: string): Promise<boolean> {
    const row = this.payments.find(
      (p) => p.id === id && p.firmId === firmId && p.deletedAt === null,
    );
    if (!row) return false;
    row.deletedAt = new Date();
    return true;
  }
}
