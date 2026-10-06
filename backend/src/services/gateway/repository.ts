/**
 * Repository seam for the gateway module (V2 slice 1, tickets 02–05) — the
 * payments seam's twin (services/payments/repository.ts): services depend
 * only on these interfaces; the Drizzle binding (`drizzle.ts`) is the
 * production implementation and tests bind the in-memory fake
 * (`in-memory.ts`), which is also what keeps the suite green with no
 * database present.
 *
 * Tenancy (ADR-0003): every method takes the caller's firm id and filters by
 * it; a cross-firm id must look up as "not found", never as an error that
 * leaks existence.
 */

/** The provider vocabulary of the API contract — one value this slice (ADR-0006). */
export const GATEWAY_PROVIDERS = ["razorpay"] as const;
export type GatewayProvider = (typeof GATEWAY_PROVIDERS)[number];

/** The link-status vocabulary of the API contract (types.ts PaymentLink.status). */
export const PAYMENT_LINK_STATUSES = ["active", "paid", "expired", "cancelled"] as const;
export type PaymentLinkStatus = (typeof PAYMENT_LINK_STATUSES)[number];

/**
 * A connected gateway account row. `keySecret`/`webhookSecret` hold
 * AES-256-GCM ciphertexts at rest (services/gateway/encryption.ts) — the
 * plaintexts exist only inside the service layer, decrypted in memory for a
 * gateway call, and are whitelisted out of every API response.
 */
export interface GatewayAccountRow {
  id: string;
  firmId: string;
  provider: string;
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  enabled: boolean;
  /** The operator-facing "connected since" stamp (updated on connect/replace). */
  connectedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * The connection status the API contract exposes (docs/API_CONTRACT.md
 * GET /gateway/account): no secret fields exist in this shape — destructuring
 * is the whitelist, so a leaked screen can never compromise the firm's
 * Razorpay account (spec story 2).
 */
export interface ApiGatewayAccount {
  connected: boolean;
  provider: string | null;
  keyId: string | null;
  enabled: boolean;
  /** Full ISO timestamp (an instant, not a contract day). */
  connectedAt: string | null;
}

export function notConnected(): ApiGatewayAccount {
  return { connected: false, provider: null, keyId: null, enabled: false, connectedAt: null };
}

/** Destructuring is the whitelist — the encrypted secrets cannot leak. */
export function toApiGatewayAccount(row: GatewayAccountRow): ApiGatewayAccount {
  const { provider, keyId, enabled, connectedAt } = row;
  return {
    connected: true,
    provider,
    keyId,
    enabled,
    connectedAt: connectedAt.toISOString(),
  };
}

/** One gateway account to write (secrets arrive already encrypted). */
export interface NewGatewayAccount {
  firmId: string;
  provider: string;
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  enabled: boolean;
  connectedAt: Date;
}

/** A replace (the PUT's upsert path) — secrets re-encrypted by the service. */
export interface GatewayAccountPatch {
  provider?: string;
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string;
  enabled?: boolean;
  connectedAt?: Date;
}

export interface GatewayAccountRepository {
  /** The firm's live (non-deleted) account; null when not connected. */
  findByFirm(firmId: string): Promise<GatewayAccountRow | null>;
  create(input: NewGatewayAccount): Promise<GatewayAccountRow>;
  /** Live-row update; null when the row is missing, deleted, or another firm's. */
  update(firmId: string, patch: GatewayAccountPatch): Promise<GatewayAccountRow | null>;
  /** Soft disconnect: stamps deleted_at, the row itself stays (ADR-0003 audit). */
  delete(firmId: string): Promise<boolean>;
}

/**
 * A payment link row (ticket 03) — the local mirror of one Razorpay Payment
 * Link for one invoice. `amount` is integer paise; `status` is the contract's
 * active/paid/expired/cancelled vocabulary.
 */
export interface PaymentLinkRow {
  id: string;
  firmId: string;
  invoiceId: string;
  provider: string;
  /** The provider's link id (link_XXXX) — reconciliation re-fetches by it. */
  providerLinkId: string;
  shortUrl: string;
  amount: number;
  status: string;
  /** Full ISO timestamp in the API shape (an instant, not a contract day). */
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** The link shape the API contract exposes (docs/API_CONTRACT.md). */
export type ApiPaymentLink = Pick<
  PaymentLinkRow,
  "id" | "invoiceId" | "provider" | "providerLinkId" | "shortUrl" | "amount" | "status"
> & { createdAt: string };

/** Destructuring is the whitelist — firm_id and bookkeeping cannot leak. */
export function toApiPaymentLink(row: PaymentLinkRow): ApiPaymentLink {
  const { id, invoiceId, provider, providerLinkId, shortUrl, amount, status, createdAt } = row;
  return { id, invoiceId, provider, providerLinkId, shortUrl, amount, status, createdAt: createdAt.toISOString() };
}

/** One payment link to insert; the service owns every field. */
export interface NewPaymentLink {
  firmId: string;
  invoiceId: string;
  provider: string;
  providerLinkId: string;
  shortUrl: string;
  amount: number;
  status: string;
}

export interface PaymentLinkRepository {
  create(input: NewPaymentLink): Promise<PaymentLinkRow>;
  /** Live (non-deleted) link in the given firm; null otherwise. */
  findById(firmId: string, id: string): Promise<PaymentLinkRow | null>;
  /** The live link with this provider link id in the firm; null otherwise —
   * the webhook's (ticket 04) and the sync's (ticket 05) entry point. */
  findByProviderLinkId(firmId: string, providerLinkId: string): Promise<PaymentLinkRow | null>;
  /** One invoice's live links, newest first (the mock/reference unshift). */
  listByInvoice(firmId: string, invoiceId: string): Promise<PaymentLinkRow[]>;
  /** Live-row update (status transitions); null when missing/foreign/deleted. */
  update(firmId: string, id: string, patch: PaymentLinkPatch): Promise<PaymentLinkRow | null>;
}

export interface PaymentLinkPatch {
  status?: string;
}

/**
 * One stored webhook delivery (ticket 04) — the idempotency ledger's row.
 * The UNIQUE (provider, provider_event_id) index is the dedupe wall: the
 * Drizzle insert of a replayed event dies with the 23505 unique violation
 * inside the caller's transaction (so the payment it would produce writes
 * nothing), and the in-memory fake mirrors that with the same error shape.
 */
export interface GatewayEventRow {
  id: string;
  firmId: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  createdAt: Date;
  updatedAt: Date;
}

/** One delivery to store; the service owns every field. */
export interface NewGatewayEvent {
  firmId: string;
  provider: string;
  providerEventId: string;
  eventType: string;
}

export interface GatewayEventRepository {
  create(input: NewGatewayEvent): Promise<GatewayEventRow>;
  /** Live rows for the firm, newest first (the audit listing). */
  listByFirm(firmId: string): Promise<GatewayEventRow[]>;
}
