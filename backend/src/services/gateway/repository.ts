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
