import type { AuthRepositories } from "../auth/repository.js";
import { HttpError } from "../httpError.js";
import type { InvoiceRow } from "../invoices/repository.js";
import type { ApiPayment, PaymentMethod } from "./repository.js";
import { PAYMENT_METHODS, toApiPayment } from "./repository.js";
import { trustDepositDescription } from "../trust/service.js";

/** Shown (as a 400) when `method` is not in the contract's vocabulary. */
export const PAYMENT_METHOD_MESSAGE = "Method must be card, echeck, wallet, upi, or netbanking";
/** Shown (as a 400) when `amount` is not a whole positive paise amount. */
export const PAYMENT_AMOUNT_MESSAGE = "Amount must be a positive integer";
/** Shown (as a 400) when an invoiceId is not a uuid — the column is a uuid FK. */
export const PAYMENT_INVOICE_MESSAGE = "Invalid invoice id";
/** Shown (as a 400) when a clientId is not a uuid — the column is a uuid FK. */
export const PAYMENT_CLIENT_MESSAGE = "Invalid client id";
/** Shown (as a 400) when a well-formed clientId is not a live contact of the firm. */
export const PAYMENT_CLIENT_MISSING_MESSAGE = "Client not found";

/** UUID shape of every production id (same rule as the :id params). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Upper bound for paise — int4/bigint safety with the /users hourlyRate cap. */
const MAX_PAISE = 1_000_000_000;

/** The status a recorded payment lands in — the reference hard-codes "deposited". */
const RECORDED_STATUS = "deposited";

function checkUuid(value: string, message: string): void {
  if (!UUID_PATTERN.test(value)) throw new HttpError(400, message);
}

/**
 * "" and null mean "no link" (the invoices service's normalizeLink
 * convention); undefined means "not sent" (falls back to the invoice's
 * client below).
 */
function normalizeLink(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  return value === "" || value === null ? null : value;
}

/**
 * The writable recordPayment input (docs/API_CONTRACT.md POST /payments).
 * Server-managed: `id`, `date` (stamped today — the reference/mock ignore a
 * client-sent date), `status` (always "deposited"; the route schema strips a
 * client-sent one), `firmId`, the bookkeeping stamps. No PATCH/DELETE exists:
 * the contract and the reference define no payment-edit surface — recorded
 * payments are immutable in V1 (a mistake is corrected by recording
 * against the invoice, never by rewriting money history).
 */
export interface PaymentInput {
  invoiceId?: string | null;
  clientId?: string | null;
  amount?: number;
  method?: string;
  trustAccount?: boolean;
}

/**
 * Payments business logic (ticket 14) — money received, recorded manually
 * (V1: no gateway, no real money ever moves). Practice data of the firm:
 * every firm member records payments (the contract and the reference gate
 * nothing here, so neither do we), and the service is the choke point that
 * scopes every lookup by the session's firm (ADR-0003).
 *
 * The correctness core is the roll-up (contract §server-side responsibilities,
 * reference server.mjs rollUpInvoice): after every payment the invoice
 * status is re-derived in the SAME transaction from Σ(non-failed payments)
 * against the invoice total — and the total is the ticket-13 seam
 * (Σ stored line amounts via InvoicesService.totalPaise's exact math, never
 * a re-derivation from client floats):
 *
 *   paid ≥ total            → "paid"   (a draft lands directly on paid —
 *                                      recording never auto-sends)
 *   paid < total, was draft → "draft"  (the parity fix: a partially paid
 *                                      draft stays draft)
 *   paid < total, otherwise → "sent"   (sent/overdue roll back to sent)
 *
 * Repeated reads always agree: the payment insert, the Σ, the total and the
 * status update share one transaction, so no observer can see a payment
 * applied without its roll-up (or vice versa).
 *
 * Overpayment mirrors the reference exactly: accepted, no rejection and no
 * flag — Σ ≥ total simply reads "paid" (real firms pre-pay; V1 has no
 * credit-note concept to hang a warning on).
 */
export class PaymentsService {
  constructor(
    private readonly repos: AuthRepositories,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Newest first — the mock and the reference both unshift new payments. */
  async list(firmId: string): Promise<ApiPayment[]> {
    const rows = await this.repos.payments.listByFirm(firmId);
    return rows.map(toApiPayment);
  }

  /**
   * POST /payments → 201 with the created payment. Validation order: shape
   * (uuid/amount/method 400s) before anything is written, then the invoice
   * existence check inside the transaction (404 for a missing, foreign, or
   * soft-deleted invoice — cross-firm ids leak nothing), then the insert and
   * the roll-up commit together.
   *
   * An absent/"" invoiceId is a valid UNLINKED payment (the reference and
   * the mock both store one, and the app tests pin it as the trust-deposit
   * seam): no roll-up runs, and a trust-flagged payment appends its ledger
   * entry in the same transaction (the ticket-15 hook below).
   */
  async record(firmId: string, input: PaymentInput): Promise<ApiPayment> {
    const amount = input.amount;
    if (
      typeof amount !== "number" ||
      !Number.isInteger(amount) ||
      amount <= 0 ||
      amount > MAX_PAISE
    ) {
      throw new HttpError(400, PAYMENT_AMOUNT_MESSAGE);
    }
    const method = input.method === undefined ? "card" : this.normalizeMethod(input.method);
    const invoiceId = normalizeLink(input.invoiceId);
    if (invoiceId) checkUuid(invoiceId, PAYMENT_INVOICE_MESSAGE);
    const clientId = normalizeLink(input.clientId);
    if (clientId) checkUuid(clientId, PAYMENT_CLIENT_MESSAGE);
    const trustAccount = input.trustAccount ?? false;

    // Server-stamped day (both the reference and the mock ignore client dates).
    const date = this.now().toISOString().slice(0, 10);

    const row = await this.repos.transaction(async (tx) => {
      let invoice: InvoiceRow | null = null;
      if (invoiceId) {
        invoice = await tx.invoices.findById(firmId, invoiceId);
        if (!invoice) throw new HttpError(404, "Invoice not found");
      }

      // The reference's `b.clientId ?? invoice?.clientId`: an absent clientId
      // falls back to the invoice's; an explicit "" is no client.
      let resolvedClientId: string | null = null;
      if (clientId) {
        const client = await tx.contacts.findById(firmId, clientId);
        if (!client) throw new HttpError(400, PAYMENT_CLIENT_MISSING_MESSAGE);
        resolvedClientId = client.id;
      } else if (clientId === undefined && invoice) {
        resolvedClientId = invoice.clientId;
      }

      const payment = await tx.payments.create({
        firmId,
        invoiceId: invoiceId ?? null,
        clientId: resolvedClientId,
        date,
        amount,
        method,
        status: RECORDED_STATUS,
        trustAccount,
      });

      if (invoice) await this.rollUp(tx, firmId, invoice);

      // ── TICKET 15 HOOK (trust ledger) — WIRED ────────────────────────────
      // A trust-flagged payment appends its append-only ledger entry in THIS
      // transaction, after the roll-up, exactly as the reference's
      // appendTrust: the running balance is computed by the repository seam
      // (tx.trust.append — previous balanceAfter + amount, concurrent
      // same-client appends serialized on a per-client advisory lock), so the
      // payment, the roll-up and the ledger entry commit or roll back
      // together. clientId is the payment's already-validated live in-firm
      // client (null → the unattributed ledger bucket, the reference's "");
      // caseId comes from the linked invoice (null when unlinked) and the
      // description is the reference's byte-identical deposit string.
      if (payment.trustAccount) {
        await tx.trust.append({
          firmId,
          clientId: payment.clientId,
          caseId: invoice?.caseId ?? null,
          date: payment.date,
          description: trustDepositDescription(invoice?.number ?? null),
          amount: payment.amount,
        });
      }
      // ────────────────────────────────────────────────────────────────────

      return payment;
    });
    return toApiPayment(row);
  }

  /**
   * The contract's roll-up, re-derived inside the caller's transaction: the
   * total is the exact Σ of the stored line amounts (the invoice row was
   * firm-resolved by the caller) and `paid` is the repository's non-failed
   * sum including the payment this transaction just inserted. The rule is
   * the reference's rollUpInvoice verbatim.
   */
  private async rollUp(tx: AuthRepositories, firmId: string, invoice: InvoiceRow): Promise<void> {
    const lines = await tx.invoiceLines.listByInvoice(firmId, invoice.id);
    const total = lines.reduce((sum, line) => sum + line.amount, 0);
    const paid = await tx.payments.sumNonFailedForInvoice(firmId, invoice.id);
    const status = paid >= total ? "paid" : invoice.status === "draft" ? "draft" : "sent";
    await tx.invoices.update(firmId, invoice.id, { status });
  }

  private normalizeMethod(method: string): string {
    if (!PAYMENT_METHODS.includes(method as PaymentMethod)) {
      throw new HttpError(400, PAYMENT_METHOD_MESSAGE);
    }
    return method;
  }
}
