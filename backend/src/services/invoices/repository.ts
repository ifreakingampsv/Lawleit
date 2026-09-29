/**
 * Repository seam for invoices (ticket 13) — the leads seam's twin
 * (services/leads/repository.ts): services depend only on these interfaces;
 * the Drizzle binding (`drizzle.ts`) is the production implementation and
 * tests bind the in-memory fake (`in-memory.ts`), which is also what keeps
 * the suite green with no database present.
 *
 * Tenancy (ADR-0003): every method takes the caller's firm id and filters by
 * it; a cross-firm id must look up as "not found", never as an error that
 * leaks existence. The invoices tests assert that.
 */

/** The status vocabulary of the API contract (app/src/lib/data/types.ts InvoiceStatus). */
export const INVOICE_STATUSES = ["draft", "sent", "overdue", "paid"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** The line-kind vocabulary of the API contract (types.ts InvoiceLine.kind). */
export const INVOICE_LINE_KINDS = ["time", "expense", "flat"] as const;
export type InvoiceLineKind = (typeof INVOICE_LINE_KINDS)[number];

export interface InvoiceRow {
  id: string;
  firmId: string;
  /** Server-assigned "INV-XXXX" (invoice_number_counters); never client-set. */
  number: string;
  /** Null until linked; the API shape renders "" like the mock/reference. */
  clientId: string | null;
  caseId: string | null;
  status: string;
  /** Contract dates are ISO YYYY-MM-DD strings (days, not instants). */
  issueDate: string;
  dueDate: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface InvoiceLineRow {
  id: string;
  firmId: string;
  invoiceId: string;
  /** 0-based position the client sent the line at — the invoice's line order. */
  position: number;
  description: string;
  /** Hours for time lines (minutes/60), units otherwise — a JS number, hence double precision. */
  quantity: number;
  /** Per hour / per unit, integer paise (types.ts Paise). */
  rate: number;
  /** Server-computed round(quantity × rate), integer paise — never client-set. */
  amount: number;
  kind: string;
  /** V2 GST seam (nullable, server-untouched in V1): percent / integer paise. */
  taxRate: number | null;
  taxAmount: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The line shape the API contract exposes (types.ts InvoiceLine). */
export type ApiInvoiceLine = Pick<
  InvoiceLineRow,
  "id" | "description" | "quantity" | "rate" | "kind"
>;

/**
 * Destructuring is the whitelist — firm_id, invoice_id, position, the
 * server-computed `amount`, the V2 tax seam and the bookkeeping stamps cannot
 * leak, so responses are byte-shape compatible with the mock adapter's lines
 * (the client derives totals itself from quantity × rate).
 */
export function toApiInvoiceLine(row: InvoiceLineRow): ApiInvoiceLine {
  const { id, description, quantity, rate, kind } = row;
  return { id, description, quantity, rate, kind };
}

/** The invoice shape the API contract exposes (types.ts Invoice). */
export type ApiInvoice = Pick<InvoiceRow, "id" | "number" | "caseId" | "status"> & {
  /** Contract shape is `ID` — an empty string while there is no client. */
  clientId: string;
  /** Contract field names: `issued`/`due` over the row's issue_date/due_date. */
  issued: string;
  due: string;
  lines: ApiInvoiceLine[];
  notes?: string;
};

/**
 * Destructuring is the whitelist — firm_id and bookkeeping (created_at,
 * updated_at, deleted_at) cannot leak, and nullables vanish when empty, so
 * responses are byte-shape compatible with the mock adapter's invoices.
 */
export function toApiInvoice(row: InvoiceRow, lines: InvoiceLineRow[]): ApiInvoice {
  const api: ApiInvoice = {
    id: row.id,
    number: row.number,
    clientId: row.clientId ?? "",
    caseId: row.caseId ?? "",
    issued: row.issueDate,
    due: row.dueDate,
    status: row.status,
    lines: lines.map(toApiInvoiceLine),
  };
  if (row.notes !== null) api.notes = row.notes;
  return api;
}

export interface NewInvoice {
  firmId: string;
  number: string;
  clientId: string | null;
  caseId: string | null;
  status: string;
  issueDate: string;
  dueDate: string;
  notes: string | null;
}

/**
 * Server-managed fields (`number`, the stamps) are deliberately absent —
 * the number counter and the DB defaults own them.
 */
export interface InvoicePatch {
  clientId?: string | null;
  caseId?: string | null;
  status?: string;
  issueDate?: string;
  dueDate?: string;
  notes?: string | null;
}

/** One line to insert; `position` is assigned by the service (array order). */
export interface NewInvoiceLine {
  position: number;
  description: string;
  quantity: number;
  rate: number;
  /** Precomputed by the service (round(quantity × rate)) — the repo stores it verbatim. */
  amount: number;
  kind: string;
}

export interface InvoiceRepository {
  create(input: NewInvoice): Promise<InvoiceRow>;
  /** Live (non-deleted) invoice in the given firm; null otherwise. */
  findById(firmId: string, id: string): Promise<InvoiceRow | null>;
  /** The firm's live invoices, newest first (the mock/reference unshift). */
  listByFirm(firmId: string): Promise<InvoiceRow[]>;
  /** Live-row update; null when the row is missing, deleted, or another firm's. */
  update(firmId: string, id: string, patch: InvoicePatch): Promise<InvoiceRow | null>;
  /** Soft delete: stamps deleted_at, the row itself stays (ADR-0003 audit). */
  delete(firmId: string, id: string): Promise<boolean>;
}

export interface InvoiceLineRepository {
  /** Inserts the whole line set for one invoice of the firm. */
  createForInvoice(
    firmId: string,
    invoiceId: string,
    lines: NewInvoiceLine[],
  ): Promise<InvoiceLineRow[]>;
  /**
   * Every line of every live invoice of the firm, for list responses,
   * ordered by (invoice_id, position). The service groups by invoiceId and
   * maps each group in position order.
   */
  listByFirm(firmId: string): Promise<InvoiceLineRow[]>;
  /** The lines of one invoice of the firm, in position order. */
  listByInvoice(firmId: string, invoiceId: string): Promise<InvoiceLineRow[]>;
  /**
   * Replaces the whole line set of one invoice of the firm (the reference's
   * Object.assign swaps the array wholesale): hard-deletes the existing rows
   * and inserts the new set. Lines are a value set of the invoice — no
   * independent soft delete (see the schema note).
   */
  replaceForInvoice(
    firmId: string,
    invoiceId: string,
    lines: NewInvoiceLine[],
  ): Promise<InvoiceLineRow[]>;
}

/**
 * The per-firm sequence behind the server-assigned INV-XXXX numbers. `next`
 * must be atomic: two concurrent creates in one firm must reserve distinct
 * values (the Drizzle binding does it with one INSERT … ON CONFLICT DO UPDATE
 * inside the create transaction; the in-memory fake is single-threaded and
 * trivially atomic). Sequences start at 1 — the reference's +1044 offset is
 * its demo-seed legacy.
 */
export interface InvoiceNumberRepository {
  next(firmId: string): Promise<number>;
}
