import type { GatewayCredentials } from "./service.js";

/**
 * GatewayService — the thin provider seam (ADR-0006): the collect/reconcile
 * flows depend only on this interface (create link, fetch link); the Razorpay
 * Payment Links client (`razorpay.ts`) is the production implementation and
 * tests bind a fake provider HTTP server behind the same interface — so a
 * future provider/model flip (a route/split model, a second provider) is an
 * implementation swap, not a redesign.
 *
 * Amounts are integer paise end to end. Credentials arrive decrypted from the
 * GatewayAccountService and exist only for the duration of the call — they
 * are never logged and never persisted here.
 */

/** The provider's own link status vocabulary (Razorpay Payment Links). */
export const PROVIDER_LINK_STATUSES = [
  "created", "partially_paid", "paid", "expired", "cancelled",
] as const;
export type ProviderLinkStatus = (typeof PROVIDER_LINK_STATUSES)[number];

export interface ProviderLinkInput {
  /** Integer paise — the invoice's outstanding total. */
  amount: number;
  /** The invoice id, echoed by the provider (Razorpay `reference_id`). */
  referenceId: string;
  /** Human-visible link description, e.g. "Invoice INV-0007". */
  description: string;
}

export interface ProviderLink {
  /** The provider's link id (e.g. link_XXXX) — reconciliation re-fetches by it. */
  id: string;
  /** The hosted checkout URL the firm shares with the client. */
  shortUrl: string;
  status: ProviderLinkStatus;
  /** Integer paise, as the provider stored it. */
  amount: number;
  /** The instrument the link's payment used (upi/netbanking/…), when the
   * provider reports one — the sync path (ticket 05) maps it into the
   * contract's method vocabulary; absent on a never-paid link. */
  method?: string | null;
}

/** Thrown by implementations on any provider-side failure (HTTP or network). */
export class GatewayProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayProviderError";
  }
}

export interface GatewayService {
  createLink(credentials: GatewayCredentials, input: ProviderLinkInput): Promise<ProviderLink>;
  fetchLink(credentials: GatewayCredentials, providerLinkId: string): Promise<ProviderLink>;
}
