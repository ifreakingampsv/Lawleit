import { randomUUID } from "node:crypto";
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
 * In-memory invoice repositories for tests — the leads twin of
 * services/auth/testing.ts's fakes. Honors the seam's semantics (firm
 * scoping, newest-first listing, soft delete, value-set line replacement) so
 * service and route tests exercise real logic without a database; the DB twin
 * proves the Drizzle binding stays behaviorally identical.
 */
export class InMemoryInvoiceRepository implements InvoiceRepository {
  constructor(readonly invoices: InvoiceRow[]) {}

  async create(input: NewInvoice): Promise<InvoiceRow> {
    const row: InvoiceRow = {
      id: randomUUID(),
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    // Newest first, mirroring the mock/reference unshift.
    this.invoices.unshift(row);
    return row;
  }

  async findById(firmId: string, id: string): Promise<InvoiceRow | null> {
    return (
      this.invoices.find(
        (i) => i.id === id && i.firmId === firmId && i.deletedAt === null,
      ) ?? null
    );
  }

  async listByFirm(firmId: string): Promise<InvoiceRow[]> {
    // unshift keeps the store newest-first, so filtering preserves the
    // contract order exactly.
    return this.invoices.filter((i) => i.firmId === firmId && i.deletedAt === null);
  }

  async update(firmId: string, id: string, patch: InvoicePatch): Promise<InvoiceRow | null> {
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

/**
 * Line rows are hard-inserted/deleted (the value-set semantics); the store is
 * a flat array filtered by firm/invoice like the other module fakes. The
 * invoices store rides along so listByFirm can hide soft-deleted invoices'
 * lines exactly like the Drizzle binding's subquery.
 */
export class InMemoryInvoiceLineRepository implements InvoiceLineRepository {
  constructor(
    readonly invoices: InvoiceRow[],
    readonly invoiceLines: InvoiceLineRow[],
  ) {}

  private insert(firmId: string, invoiceId: string, lines: NewInvoiceLine[]): InvoiceLineRow[] {
    const rows: InvoiceLineRow[] = lines.map((line) => ({
      id: randomUUID(),
      firmId,
      invoiceId,
      ...line,
      taxRate: null,
      taxAmount: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    this.invoiceLines.push(...rows);
    return rows;
  }

  async createForInvoice(
    firmId: string,
    invoiceId: string,
    lines: NewInvoiceLine[],
  ): Promise<InvoiceLineRow[]> {
    return this.insert(firmId, invoiceId, lines);
  }

  async listByFirm(firmId: string): Promise<InvoiceLineRow[]> {
    return this.invoiceLines
      .filter(
        (l) =>
          l.firmId === firmId &&
          this.invoices.some((i) => i.id === l.invoiceId && i.deletedAt === null),
      )
      .sort((a, b) => a.invoiceId.localeCompare(b.invoiceId) || a.position - b.position);
  }

  async listByInvoice(firmId: string, invoiceId: string): Promise<InvoiceLineRow[]> {
    return this.invoiceLines
      .filter((l) => l.firmId === firmId && l.invoiceId === invoiceId)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  }

  async replaceForInvoice(
    firmId: string,
    invoiceId: string,
    lines: NewInvoiceLine[],
  ): Promise<InvoiceLineRow[]> {
    for (let index = this.invoiceLines.length - 1; index >= 0; index -= 1) {
      const line = this.invoiceLines[index]!;
      if (line.firmId === firmId && line.invoiceId === invoiceId) {
        this.invoiceLines.splice(index, 1);
      }
    }
    return this.insert(firmId, invoiceId, lines);
  }
}

/** Keyed by firmId — the in-memory twin of invoice_number_counters. */
export class InMemoryInvoiceNumberRepository implements InvoiceNumberRepository {
  constructor(readonly counters: Map<string, number>) {}

  async next(firmId: string): Promise<number> {
    const last = this.counters.get(firmId) ?? 0;
    const next = last + 1;
    this.counters.set(firmId, next);
    return next;
  }
}
