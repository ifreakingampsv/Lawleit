import type { AuthRepositories } from "../auth/repository.js";
import { HttpError } from "../httpError.js";
import { GatewayProviderError, type GatewayService } from "./provider.js";
import type { ApiPaymentLink } from "./repository.js";
import { toApiPaymentLink } from "./repository.js";
import type { GatewayAccountService } from "./service.js";

/** Shown (as a 503) when the firm has no connected gateway — the owner step. */
export const PAYMENT_LINK_NOT_CONNECTED =
  "No payment gateway connected — the firm owner must connect one in Settings";
/** Shown (as a 409) when the invoice is already settled — nothing left to collect. */
export const PAYMENT_LINK_PAID_MESSAGE = "Invoice is already paid";
/** Shown (as a 502) when the provider rejects or errors — clean, action-less envelope. */
export const PAYMENT_LINK_PROVIDER_FAILED =
  "The payment gateway did not accept the link — try again shortly";

/**
 * The provider's link status → the contract's link status. Razorpay's
 * "created" is the contract's "active"; the rest map 1:1.
 */
function contractStatus(providerStatus: string): string {
  switch (providerStatus) {
    case "created": return "active";
    case "paid": return "paid";
    case "expired": return "expired";
    case "cancelled": return "cancelled";
    default: return "active";
  }
}

/**
 * Collect via payment link (V2 slice 1, ticket 03) — any firm user turns a
 * draft/sent/overdue invoice into a hosted Razorpay Payment Link for the
 * invoice's OUTSTANDING amount (Σ line amounts − Σ non-failed payments,
 * integer paise), created through the firm's own connected gateway account
 * (ADR-0006). Practice data: no owner gate (matches the V1 payments
 * permission) — connecting the gateway is the owner-only step, collecting is
 * everyone's.
 *
 * Check order is the contract's: 404 (unknown/foreign/soft-deleted invoice)
 * before 409 (paid — a settled invoice is never collectible, even before the
 * gateway check, so the smoke suite can pin the copy on any conforming
 * server) before 503 (no connected gateway / no encryption key — the
 * owner/operator step). Provider failures surface as a clean 502 envelope —
 * never a stack trace, never credentials.
 */
export class PaymentLinkService {
  constructor(
    private readonly repos: AuthRepositories,
    private readonly accounts: GatewayAccountService,
    private readonly gateway: GatewayService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * POST /invoices/:id/payment-link → 201 the link shape. The provider call
   * happens BEFORE the insert: a link row exists only when the provider
   * accepted the creation (a row pointing at a rejected provider link would
   * be a lie in the history).
   */
  async create(firmId: string, invoiceId: string): Promise<ApiPaymentLink> {
    const invoice = await this.repos.invoices.findById(firmId, invoiceId);
    if (!invoice) throw new HttpError(404, "Invoice not found");
    if (invoice.status === "paid") throw new HttpError(409, PAYMENT_LINK_PAID_MESSAGE);

    const credentials = await this.credentials(firmId);

    const lines = await this.repos.invoiceLines.listByInvoice(firmId, invoiceId);
    const total = lines.reduce((sum, line) => sum + line.amount, 0);
    const paid = await this.repos.payments.sumNonFailedForInvoice(firmId, invoiceId);
    const outstanding = total - paid;
    if (outstanding <= 0) throw new HttpError(409, PAYMENT_LINK_PAID_MESSAGE);

    const providerLink = await this.gateway
      .createLink(credentials, {
        amount: outstanding,
        referenceId: invoice.id,
        description: `Invoice ${invoice.number}`,
      })
      .catch((error: unknown) => {
        if (error instanceof GatewayProviderError) {
          throw new HttpError(502, PAYMENT_LINK_PROVIDER_FAILED);
        }
        throw error;
      });

    const row = await this.repos.paymentLinks.create({
      firmId,
      invoiceId,
      provider: credentials.provider,
      providerLinkId: providerLink.id,
      shortUrl: providerLink.shortUrl,
      amount: outstanding,
      status: contractStatus(providerLink.status),
    });
    return toApiPaymentLink(row);
  }

  /** GET /invoices/:id/payment-links → the history, newest first. 404 as above. */
  async list(firmId: string, invoiceId: string): Promise<ApiPaymentLink[]> {
    const invoice = await this.repos.invoices.findById(firmId, invoiceId);
    if (!invoice) throw new HttpError(404, "Invoice not found");
    const rows = await this.repos.paymentLinks.listByInvoice(firmId, invoiceId);
    return rows.map(toApiPaymentLink);
  }

  /**
   * The firm's credentials or the 503 that explains what is missing. Two
   * distinct steps with distinct copy: no encryption key set (the operator's
   * env — the account service's own 503 propagates) vs no connected account
   * (the owner's Settings step).
   */
  private async credentials(firmId: string) {
    const credentials = await this.accounts.credentials(firmId);
    if (!credentials) throw new HttpError(503, PAYMENT_LINK_NOT_CONNECTED);
    return credentials;
  }
}
