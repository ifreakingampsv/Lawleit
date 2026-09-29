/**
 * Repository seam for payments (ticket 14) — the module seams' twin
 * (services/invoices/repository.ts): services depend only on these interfaces;
 * the Drizzle binding (`drizzle.ts`) is the production implementation and
 * tests bind the in-memory fake (`in-memory.ts`), which is also what keeps
 * the suite green with no database present.
 *
 * Tenancy (ADR-0003): every method takes the caller's firm id and filters by
 * it; a cross-firm id must look up as "not found", never as an error that
 * leaks existence. The payments tests assert that.
 */

/** The method vocabulary of the API contract (app/src/lib/data/types.ts Payment.method). */
export const PAYMENT_METHODS = ["card", "echeck", "wallet"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * The status vocabulary of the API contract (types.ts Payment.status). V1
 * records always land "deposited" (server-managed); "pending"/"failed" exist
 * for the V2 gateway seam, and the roll-up's `<> 'failed'` filter mirrors the
 * reference for that day.
 */
export const PAYMENT_STATUSES = ["pending", "deposited", "failed"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface PaymentRow {
  id: string;
  firmId: string;
  /** Null for an unlinked payment (the reference's "" — the trust-deposit seam). */
  invoiceId: string | null;
  /** Null when the payment carries no client (renders "" like the reference). */
  clientId: string | null;
  /** Contract dates are ISO YYYY-MM-DD strings (days, not instants). */
  date: string;
  /** Integer paise (types.ts Paise) — service-validated > 0, never client-floated. */
  amount: number;
  method: string;
  /** Server-managed; V1 always writes "deposited". */
  status: string;
  /** The contract's trustAccount flag — ticket 15's ledger-append trigger. */
  trustAccount: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * The payment shape the API contract exposes (types.ts Payment): all ids are
 * `ID` strings — null links render "" (the invoices mapper's convention).
 */
export type ApiPayment = Pick<
  PaymentRow,
  "id" | "date" | "amount" | "method" | "status" | "trustAccount"
> & {
  invoiceId: string;
  clientId: string;
};

/**
 * Destructuring is the whitelist — firm_id and the bookkeeping stamps
 * (created_at, updated_at, deleted_at) cannot leak, so responses are
 * byte-shape compatible with the mock adapter's payments.
 */
export function toApiPayment(row: PaymentRow): ApiPayment {
  const { id, invoiceId, clientId, date, amount, method, status, trustAccount } = row;
  return { id, invoiceId: invoiceId ?? "", clientId: clientId ?? "", date, amount, method, status, trustAccount };
}

/**
 * One payment to insert. Server-managed fields are deliberately absent from
 * the service's perspective: `id` (the DB default), `date` (the service
 * stamps today — the reference/mock ignore client dates), `status`
 * (hard-coded "deposited", the reference's value), and the bookkeeping
 * stamps. The repo stores the rest verbatim.
 */
export interface NewPayment {
  firmId: string;
  invoiceId: string | null;
  clientId: string | null;
  date: string;
  amount: number;
  method: string;
  status: string;
  trustAccount: boolean;
}

export interface PaymentRepository {
  create(input: NewPayment): Promise<PaymentRow>;
  /** The firm's live payments, newest first (the mock/reference unshift). */
  listByFirm(firmId: string): Promise<PaymentRow[]>;
  /**
   * Σ of one invoice's non-failed payments' amounts, integer paise — the
   * `paid` figure of the contract's roll-up rule (paid when Σ(payments) ≥
   * total). Firm-scoped like every read; soft-deleted rows (no V1 writer,
   * the convention's belt) are excluded so a future void path cannot
   * silently re-inflate the total.
   */
  sumNonFailedForInvoice(firmId: string, invoiceId: string): Promise<number>;
}
