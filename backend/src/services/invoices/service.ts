import type { AuthRepositories } from "../auth/repository.js";
import { HttpError } from "../httpError.js";
import type { ApiInvoice, InvoiceLineKind, InvoicePatch, InvoiceStatus, InvoiceRow } from "./repository.js";
import { INVOICE_LINE_KINDS, INVOICE_STATUSES, toApiInvoice } from "./repository.js";

/** Shown (as a 400) when `status` is not in the contract's InvoiceStatus vocabulary. */
export const INVOICE_STATUS_MESSAGE = "Status must be draft, sent, overdue, or paid";
/** Shown (as a 400) when a line's `kind` is not in the contract's vocabulary. */
export const INVOICE_KIND_MESSAGE = "Line kind must be time, expense, or flat";
/** Shown (as a 400) when a clientId is not a uuid — the column is a uuid FK. */
export const INVOICE_CLIENT_MESSAGE = "Invalid client id";
/** Shown (as a 400) when a well-formed clientId is not a live contact of the firm. */
export const INVOICE_CLIENT_MISSING_MESSAGE = "Client not found";
/** Shown (as a 400) when a caseId is not a uuid — the column is a uuid FK. */
export const INVOICE_CASE_MESSAGE = "Invalid case id";
/** Shown (as a 400) when a well-formed caseId is not a live case of the firm. */
export const INVOICE_CASE_MISSING_MESSAGE = "Case not found";
/** Shown (as a 400) when an issued/due patch is not an ISO YYYY-MM-DD string. */
export const INVOICE_DATE_MESSAGE = "Date must be a YYYY-MM-DD string";
/** Shown (as a 400) when a line's rate is not a whole non-negative paise amount. */
export const INVOICE_RATE_MESSAGE = "Line rate must be a non-negative integer";
/** Shown (as a 400) when a line's quantity is not a finite non-negative number. */
export const INVOICE_QUANTITY_MESSAGE = "Line quantity must be a non-negative number";
/** Shown (as a 400) when the lines payload is over the size cap. */
export const INVOICE_LINES_MESSAGE = "Too many lines";

/** UUID shape of every production id (same rule as the :id params). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Upper bound for paise — int4/bigint safety with the /users hourlyRate cap. */
const MAX_PAISE = 1_000_000_000;
/** Upper bound for a line quantity (hours/units) — same order as the paise cap. */
const MAX_QUANTITY = 1_000_000;
/** Line-set size cap: practice invoices never approach it; abuse payloads do. */
const MAX_LINES = 200;

const LINE_DESCRIPTION_LIMIT = 4000;
const NOTES_LIMIT = 4000;

/**
 * The writable invoice input (create and patch). Deliberately free-form: the
 * reference backend and the mock adapter store these fields verbatim (no
 * trimming), and the parity checklist in the ticket depends on that.
 *
 * Not here at all — server-managed: `number` (the invoice_number_counters
 * sequence), `id`, `firmId`, the bookkeeping stamps. `issued`/`due` are
 * create-ignored (the reference stamps today / today+30 and reads neither
 * from the create body) but patchable (the reference's Object.assign lets
 * them move). The contract's Invoice carries no total/amountPaid fields, so
 * there is nothing to strip there — the zod route schema drops any
 * client-sent extras (the "client-sent totals are ignored" clause) and line
 * amounts are recomputed server-side on every write regardless of what
 * arrives.
 */
export interface InvoiceInput {
  clientId?: string | null;
  caseId?: string | null;
  status?: string;
  notes?: string | null;
  /** PATCH only: the contract's `issued`/`due` day strings. */
  issued?: string;
  due?: string;
  /** Replace the whole line set (the reference's Object.assign semantics). */
  lines?: InvoiceLineInput[];
}

export interface InvoiceLineInput {
  description?: string;
  quantity?: number;
  rate?: number;
  kind?: string;
}

/** A validated line with its server-computed paise amount. */
interface NormalizedLine {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
  kind: string;
}

function checkUuid(value: string, message: string): void {
  if (!UUID_PATTERN.test(value)) throw new HttpError(400, message);
}

function checkIsoDate(value: string, message: string): void {
  if (!ISO_DATE_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, message);
  }
}

/**
 * The line math, server-side: amount = round(quantity × rate) in integer
 * paise. Time lines carry hours (the client's minutes/60 — a repeating
 * binary fraction), and an integer paise rate times any minutes/60 quantity
 * rounds to the exact real-math paise (10/60 × 300000 = 50000 exactly; the
 * float product lands within half a paise of it) — the round is what keeps
 * the money integral end to end. The invoice total is Σ amount.
 */
function computeAmount(quantity: number, rate: number): number {
  return Math.round(quantity * rate);
}

function normalizeLine(line: InvoiceLineInput): NormalizedLine {
  const quantity = line.quantity;
  if (
    typeof quantity !== "number" ||
    !Number.isFinite(quantity) ||
    quantity < 0 ||
    quantity > MAX_QUANTITY
  ) {
    throw new HttpError(400, INVOICE_QUANTITY_MESSAGE);
  }
  const rate = line.rate;
  if (typeof rate !== "number" || !Number.isInteger(rate) || rate < 0 || rate > MAX_PAISE) {
    throw new HttpError(400, INVOICE_RATE_MESSAGE);
  }
  const description = line.description ?? "";
  if (description.length > LINE_DESCRIPTION_LIMIT) {
    throw new HttpError(400, "Line description is too long");
  }
  const kind = line.kind ?? "flat";
  if (!INVOICE_LINE_KINDS.includes(kind as InvoiceLineKind)) {
    throw new HttpError(400, INVOICE_KIND_MESSAGE);
  }
  return { description, quantity, rate, amount: computeAmount(quantity, rate), kind };
}

/**
 * Client-link normalization: "" and null both mean "no link" (the
 * reference's empty-string default, rendered as "" back), a non-empty value
 * must be a uuid (existence is checked in the transaction).
 */
function normalizeLink(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value === "" || value === null ? null : value;
}

/**
 * Invoices business logic (ticket 13) — the money chain starts here, so
 * correctness is the standard. Practice data of the firm: every firm member
 * manages it (the contract and the reference backend gate nothing here, so
 * neither do we), and the service is the choke point that scopes every
 * lookup by the session's firm (ADR-0003) and enforces the reference
 * backend's defaults and soft delete.
 *
 * What the server owns (the contract's server-side responsibilities):
 * INV-XXXX number assignment (the per-firm counter, in the same transaction
 * as the create), the issued=today / due=today+30 stamps, and the line math
 * — every line's amount is computed here from quantity × rate and stored
 * with the line, so the invoice total (Σ amounts) is a server-side integer-
 * paise derivation. Client-sent totals, ids, and amounts have no path in.
 */
export class InvoicesService {
  constructor(
    private readonly repos: AuthRepositories,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Newest first — the mock and the reference both unshift new invoices.
   * Every invoice carries its lines (the contract's Invoice embeds them; the
   * UI reads lines off the list response).
   */
  async list(firmId: string): Promise<ApiInvoice[]> {
    const [rows, allLines] = await Promise.all([
      this.repos.invoices.listByFirm(firmId),
      this.repos.invoiceLines.listByFirm(firmId),
    ]);
    const byInvoice = new Map<string, typeof allLines>();
    for (const line of allLines) {
      const group = byInvoice.get(line.invoiceId);
      if (group) group.push(line);
      else byInvoice.set(line.invoiceId, [line]);
    }
    return rows.map((row) => toApiInvoice(row, byInvoice.get(row.id) ?? []));
  }

  /** 404 for missing, soft-deleted, and other firms' invoices alike. */
  async get(firmId: string, id: string): Promise<ApiInvoice> {
    const row = await this.repos.invoices.findById(firmId, id);
    if (!row) throw new HttpError(404, "Invoice not found");
    const lines = await this.repos.invoiceLines.listByInvoice(firmId, id);
    return toApiInvoice(row, lines);
  }

  /**
   * The invoice total in integer paise: the exact Σ of the server-computed
   * line amounts — never a re-derivation from float quantities. Ticket 14's
   * payment roll-up reads this (the contract's rule: paid when
   * Σ(payments) ≥ total, a draft staying draft on partial payment).
   * 404 for a missing, foreign, or soft-deleted invoice.
   */
  async totalPaise(firmId: string, invoiceId: string): Promise<number> {
    const row = await this.repos.invoices.findById(firmId, invoiceId);
    if (!row) throw new HttpError(404, "Invoice not found");
    const lines = await this.repos.invoiceLines.listByInvoice(firmId, invoiceId);
    return lines.reduce((sum, line) => sum + line.amount, 0);
  }

  /**
   * POST /invoices → 201 with the created entity. Defaults mirror the
   * reference backend exactly: status draft, empty client/case links ("" in
   * the contract shape), issued today, due today+30, notes absent unless
   * sent, lines empty when the body omits them. The number comes from the
   * per-firm counter in the create transaction — never from the client.
   */
  async create(firmId: string, input: InvoiceInput): Promise<ApiInvoice> {
    // The reference defaults an absent status to "draft"; a sent one must be
    // in the contract's vocabulary.
    const status = input.status === undefined ? "draft" : this.normalizeStatus(input.status);
    const notes = input.notes === undefined ? null : this.normalizeNotes(input.notes);
    // Create resolves an absent link to "no link" (the reference's "" default).
    const clientId = normalizeLink(input.clientId) ?? null;
    const caseId = normalizeLink(input.caseId) ?? null;
    if (clientId) checkUuid(clientId, INVOICE_CLIENT_MESSAGE);
    if (caseId) checkUuid(caseId, INVOICE_CASE_MESSAGE);
    const lines = this.normalizeLines(input.lines ?? []);

    const at = this.now();
    const today = at.toISOString().slice(0, 10);
    const due = new Date(at.getTime() + 30 * 864e5).toISOString().slice(0, 10);

    const row = await this.repos.transaction(async (tx) => {
      if (clientId) {
        const client = await tx.contacts.findById(firmId, clientId);
        if (!client) throw new HttpError(400, INVOICE_CLIENT_MISSING_MESSAGE);
      }
      if (caseId) {
        const linked = await tx.cases.findById(firmId, caseId);
        if (!linked) throw new HttpError(400, INVOICE_CASE_MISSING_MESSAGE);
      }
      const seq = await tx.invoiceNumbers.next(firmId);
      const invoice = await tx.invoices.create({
        firmId,
        number: `INV-${String(seq).padStart(4, "0")}`,
        clientId,
        caseId,
        status,
        issueDate: today,
        dueDate: due,
        notes,
      });
      await tx.invoiceLines.createForInvoice(
        firmId,
        invoice.id,
        lines.map((line, position) => ({ ...line, position })),
      );
      return invoice;
    });
    return this.withLines(firmId, row);
  }

  /**
   * PATCH /invoices/:id — only the sent fields move (mock Object.assign).
   * Status transitions are free within the contract's vocabulary (the
   * reference lets any value through; the UI's Send / Mark-as-paid buttons
   * drive draft → sent → paid directly, and ticket 14's payments roll-up
   * drives the same statuses on payment events). A patch that carries
   * `lines` replaces the whole set with fresh server-computed amounts (the
   * reference swaps the array wholesale); `number`/`id` are server-managed
   * and cannot move. 404 is decided before any write: a foreign or
   * soft-deleted id must not touch its lines.
   */
  async update(firmId: string, id: string, patch: InvoiceInput): Promise<ApiInvoice> {
    const clientId = normalizeLink(patch.clientId);
    const caseId = normalizeLink(patch.caseId);
    if (clientId) checkUuid(clientId, INVOICE_CLIENT_MESSAGE);
    if (caseId) checkUuid(caseId, INVOICE_CASE_MESSAGE);
    const status = patch.status !== undefined ? this.normalizeStatus(patch.status) : undefined;
    const notes = patch.notes !== undefined ? this.normalizeNotes(patch.notes) : undefined;
    if (patch.issued !== undefined) checkIsoDate(patch.issued, INVOICE_DATE_MESSAGE);
    if (patch.due !== undefined) checkIsoDate(patch.due, INVOICE_DATE_MESSAGE);
    const lines = patch.lines !== undefined ? this.normalizeLines(patch.lines) : undefined;

    const invoicePatch: InvoicePatch = {};
    if (clientId !== undefined) invoicePatch.clientId = clientId;
    if (caseId !== undefined) invoicePatch.caseId = caseId;
    if (status !== undefined) invoicePatch.status = status;
    if (notes !== undefined) invoicePatch.notes = notes;
    if (patch.issued !== undefined) invoicePatch.issueDate = patch.issued;
    if (patch.due !== undefined) invoicePatch.dueDate = patch.due;

    const row = await this.repos.transaction(async (tx) => {
      const current = await tx.invoices.findById(firmId, id);
      if (!current) return null;
      if (clientId) {
        const client = await tx.contacts.findById(firmId, clientId);
        if (!client) throw new HttpError(400, INVOICE_CLIENT_MISSING_MESSAGE);
      }
      if (caseId) {
        const linked = await tx.cases.findById(firmId, caseId);
        if (!linked) throw new HttpError(400, INVOICE_CASE_MISSING_MESSAGE);
      }
      if (lines) {
        // The value-set swap: an explicit lines array always replaces, even
        // when the row update that follows would otherwise be empty.
        await tx.invoiceLines.replaceForInvoice(
          firmId,
          id,
          lines.map((line, position) => ({ ...line, position })),
        );
      }
      return tx.invoices.update(firmId, id, invoicePatch);
    });
    if (!row) throw new HttpError(404, "Invoice not found");
    return this.withLines(firmId, row);
  }

  /**
   * DELETE /invoices/:id → 204. The reference and the contract block nothing
   * — draft, sent, and paid invoices all delete (the partially-paid roll-up
   * behavior is a payments concern, ticket 14; deletion itself is ungated).
   * Soft delete per the baseline convention; the counter never reuses the
   * number. The reference does not un-mark anything on deletion (its create
   * flow never marks time/expenses invoiced), so neither does this — the
   * invoiced-flag seam in services/time + services/expenses is the flip
   * path, deliberately not wired into invoice CRUD (the contract's
   * InvoiceLine carries no source-entry reference, so a create cannot know
   * which entries a line came from).
   */
  async delete(firmId: string, id: string): Promise<void> {
    const deleted = await this.repos.invoices.delete(firmId, id);
    if (!deleted) throw new HttpError(404, "Invoice not found");
  }

  private normalizeStatus(status: string): string {
    if (!INVOICE_STATUSES.includes(status as InvoiceStatus)) {
      throw new HttpError(400, INVOICE_STATUS_MESSAGE);
    }
    return status;
  }

  private normalizeNotes(notes: string | null): string | null {
    if (notes !== null && notes.length > NOTES_LIMIT) {
      throw new HttpError(400, "Notes are too long");
    }
    return notes;
  }

  private normalizeLines(lines: InvoiceLineInput[]): NormalizedLine[] {
    if (lines.length > MAX_LINES) throw new HttpError(400, INVOICE_LINES_MESSAGE);
    return lines.map(normalizeLine);
  }

  /** Re-reads the persisted lines for the response (positions + server ids). */
  private async withLines(firmId: string, row: InvoiceRow): Promise<ApiInvoice> {
    const lines = await this.repos.invoiceLines.listByInvoice(firmId, row.id);
    return toApiInvoice(row, lines);
  }
}
