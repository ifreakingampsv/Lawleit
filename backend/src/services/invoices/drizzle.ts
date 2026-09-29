import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { invoiceLineItems, invoiceNumberCounters, invoices } from "../../db/schema.js";
import type { DbExecutor } from "../auth/drizzle-repository.js";
import type {
  InvoiceLineRepository,
  InvoiceLineRow,
  InvoiceNumberRepository,
  InvoicePatch,
  InvoiceRepository,
  InvoiceRow,
  NewInvoice,
  NewInvoiceLine,
} from "./repository.js";

/**
 * Drizzle/postgres.js binding of the invoices repository seam (ticket 13) —
 * the production implementation used when DATABASE_URL is set. Every read
 * that serves a request filters soft deletes and the firm scope (ADR-0003);
 * the write path sets updated_at itself (no triggers, per drizzle/README.md).
 */

const liveInvoice = () => isNull(invoices.deletedAt);

export class DrizzleInvoiceRepository implements InvoiceRepository {
  constructor(private readonly exec: DbExecutor) {}

  async create(input: NewInvoice): Promise<InvoiceRow> {
    const [row] = await this.exec.insert(invoices).values(input).returning();
    if (!row) throw new Error("invoice insert returned no row");
    return row;
  }

  async findById(firmId: string, id: string): Promise<InvoiceRow | null> {
    const [row] = await this.exec
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.firmId, firmId), liveInvoice()))
      .limit(1);
    return row ?? null;
  }

  async listByFirm(firmId: string): Promise<InvoiceRow[]> {
    return this.exec
      .select()
      .from(invoices)
      .where(and(eq(invoices.firmId, firmId), liveInvoice()))
      // Newest first (the mock/reference unshift); id breaks ties between
      // rows sharing one timestamp.
      .orderBy(desc(invoices.createdAt), desc(invoices.id));
  }

  async update(firmId: string, id: string, patch: InvoicePatch): Promise<InvoiceRow | null> {
    const [row] = await this.exec
      .update(invoices)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(invoices.id, id), eq(invoices.firmId, firmId), liveInvoice()))
      .returning();
    return row ?? null;
  }

  /** Soft delete: the row stays with deleted_at stamped (baseline convention). */
  async delete(firmId: string, id: string): Promise<boolean> {
    const [row] = await this.exec
      .update(invoices)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(invoices.id, id), eq(invoices.firmId, firmId), liveInvoice()))
      .returning();
    return row !== undefined;
  }
}

export class DrizzleInvoiceLineRepository implements InvoiceLineRepository {
  constructor(private readonly exec: DbExecutor) {}

  async createForInvoice(
    firmId: string,
    invoiceId: string,
    lines: NewInvoiceLine[],
  ): Promise<InvoiceLineRow[]> {
    if (lines.length === 0) return [];
    const rows = await this.exec
      .insert(invoiceLineItems)
      .values(lines.map((line) => ({ ...line, firmId, invoiceId })))
      .returning();
    // Restored to position order: RETURNING order follows insertion, which is
    // the service's array order anyway — the sort is belt and braces.
    return rows.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  }

  /**
   * Lines of the firm's live invoices only: the subquery keeps soft-deleted
   * invoices' lines out of list responses without a join against invoices.
   */
  async listByFirm(firmId: string): Promise<InvoiceLineRow[]> {
    const liveIds = this.exec
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.firmId, firmId), liveInvoice()));
    return this.exec
      .select()
      .from(invoiceLineItems)
      .where(and(eq(invoiceLineItems.firmId, firmId), inArray(invoiceLineItems.invoiceId, liveIds)))
      .orderBy(asc(invoiceLineItems.invoiceId), asc(invoiceLineItems.position));
  }

  async listByInvoice(firmId: string, invoiceId: string): Promise<InvoiceLineRow[]> {
    return this.exec
      .select()
      .from(invoiceLineItems)
      .where(
        and(
          eq(invoiceLineItems.firmId, firmId),
          eq(invoiceLineItems.invoiceId, invoiceId),
        ),
      )
      .orderBy(asc(invoiceLineItems.position), asc(invoiceLineItems.id));
  }

  async replaceForInvoice(
    firmId: string,
    invoiceId: string,
    lines: NewInvoiceLine[],
  ): Promise<InvoiceLineRow[]> {
    // The value-set swap: hard delete then re-insert (the schema note explains
    // why lines carry no soft delete of their own).
    await this.exec
      .delete(invoiceLineItems)
      .where(
        and(
          eq(invoiceLineItems.firmId, firmId),
          eq(invoiceLineItems.invoiceId, invoiceId),
        ),
      );
    return this.createForInvoice(firmId, invoiceId, lines);
  }
}

export class DrizzleInvoiceNumberRepository implements InvoiceNumberRepository {
  constructor(private readonly exec: DbExecutor) {}

  /**
   * Atomically reserves the next sequence for the firm: one
   * INSERT … ON CONFLICT DO UPDATE — the counter row's lock serializes
   * concurrent creates in the firm until the create transaction commits, so
   * no two invoices can draw the same number. Distinct firms have distinct
   * counter rows, so sequences are independent.
   */
  async next(firmId: string): Promise<number> {
    const [row] = await this.exec
      .insert(invoiceNumberCounters)
      .values({ firmId, lastValue: 1, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: invoiceNumberCounters.firmId,
        set: { lastValue: sql`${invoiceNumberCounters.lastValue} + 1`, updatedAt: new Date() },
      })
      .returning({ lastValue: invoiceNumberCounters.lastValue });
    if (!row) throw new Error("invoice number counter upsert returned no row");
    return row.lastValue;
  }
}
