import type { ApiUser, AuthRepositories } from "../auth/repository.js";
import { isUniqueViolation } from "../auth/service.js";
import { HttpError } from "../httpError.js";
import { decryptSecret, deriveAesKey, encryptSecret } from "./encryption.js";
import type { ApiGatewayAccount } from "./repository.js";
import { GATEWAY_PROVIDERS, notConnected, toApiGatewayAccount } from "./repository.js";

/** Shown (as a 503) when the API runs without GATEWAY_ENCRYPTION_KEY — the operator step. */
export const GATEWAY_ENCRYPTION_REQUIRED =
  "Payments gateway not configured — set GATEWAY_ENCRYPTION_KEY (see .env.example)";
/** Shown (as a 403) when a non-owner touches the gateway connection (the invite-form rule). */
export const GATEWAY_FORBIDDEN = "Only the firm owner can manage the payments gateway";
/** Shown (as a 400) when `provider` is not in the contract's vocabulary. */
export const GATEWAY_PROVIDER_MESSAGE = "Provider must be razorpay";
/** Shown (as a 400) when a required key field is missing/blank. */
export const GATEWAY_FIELD_MESSAGE = "Key id, key secret, and webhook secret are required";
/** Shown (as a 409) when two connects race (the partial unique firm_id index fired). */
export const GATEWAY_CONNECTED_MESSAGE = "Gateway account already connected";

/** The writable connect input (docs/API_CONTRACT.md PUT /gateway/account). */
export interface GatewayConnectInput {
  provider?: string;
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string;
}

/**
 * The decrypted credentials the collect flow (ticket 03) needs to call the
 * firm's gateway. Exists only in memory — never logged, never returned by
 * any API response (spec Q16).
 */
export interface GatewayCredentials {
  provider: string;
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

/**
 * The firm's gateway account (V2 slice 1, ticket 02) — connect/replace/
 * disconnect the firm's OWN Razorpay account by pasting its API keys
 * (ADR-0006 bring-your-own-keys; money settles to the firm's bank).
 *
 * Authorization lives here, not in the routes (ADR-0003): connect/disconnect
 * are owner-only (the invite-form rule — staff must never repoint where the
 * firm's money lands, spec story 4), while reading the connection status is
 * every member's (the settings card renders it). Secrets are AES-256-GCM
 * encrypted at rest with GATEWAY_ENCRYPTION_KEY (optional config — unset
 * means the feature is inert and every gateway WRITE answers 503 naming the
 * operator step; boot succeeds), write-only over the API, never logged.
 */
export class GatewayAccountService {
  constructor(
    private readonly repos: AuthRepositories,
    private readonly encryptionKey: string | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * GET /gateway/account — the status shape only (docs/API_CONTRACT.md):
   * connected/provider/keyId/enabled/connectedAt. Needs no encryption key
   * (nothing is decrypted) and no owner role, so the settings card works for
   * every member and for an API running without the key.
   */
  async status(firmId: string): Promise<ApiGatewayAccount> {
    const row = await this.repos.gatewayAccounts.findByFirm(firmId);
    return row ? toApiGatewayAccount(row) : notConnected();
  }

  /**
   * PUT /gateway/account → the status shape. Owner-only; upserts the one
   * per-firm account (replace = rotate keys). Secrets are encrypted here —
   * the repository only ever sees ciphertext, and no code path returns or
   * logs them.
   */
  async connect(actor: ApiUser, input: GatewayConnectInput): Promise<ApiGatewayAccount> {
    if (!this.encryptionKey) throw new HttpError(503, GATEWAY_ENCRYPTION_REQUIRED);
    this.requireOwner(actor);
    return this.upsert(actor.firmId, input);
  }

  /** The owner gate, shared with ticket 05's disconnect; 403 like POST /users. */
  private requireOwner(actor: ApiUser): void {
    if (actor.role !== "owner") throw new HttpError(403, GATEWAY_FORBIDDEN);
  }

  private async upsert(firmId: string, input: GatewayConnectInput): Promise<ApiGatewayAccount> {
    const provider = input.provider === undefined ? "razorpay" : input.provider;
    if (!GATEWAY_PROVIDERS.includes(provider as (typeof GATEWAY_PROVIDERS)[number])) {
      throw new HttpError(400, GATEWAY_PROVIDER_MESSAGE);
    }
    const keyId = input.keyId ?? "";
    const keySecret = input.keySecret ?? "";
    const webhookSecret = input.webhookSecret ?? "";
    if (!keyId.trim() || !keySecret.trim() || !webhookSecret.trim()) {
      throw new HttpError(400, GATEWAY_FIELD_MESSAGE);
    }

    const aesKey = deriveAesKey(this.encryptionKey!);
    const patch = {
      provider,
      keyId,
      keySecret: encryptSecret(keySecret, aesKey),
      webhookSecret: encryptSecret(webhookSecret, aesKey),
      enabled: true,
      connectedAt: this.now(),
    };

    try {
      const row = await this.repos.transaction(async (tx) => {
        // One account per firm: a live row is replaced in place (rotation);
        // a disconnect's soft delete freed the slot, so a fresh row is born.
        const existing = await tx.gatewayAccounts.findByFirm(firmId);
        if (existing) return tx.gatewayAccounts.update(firmId, patch);
        return tx.gatewayAccounts.create({ firmId, ...patch });
      });
      return toApiGatewayAccount(row!);
    } catch (error) {
      // Raced double-connect (the partial unique index fires between our read
      // and the insert): the DB twin suite proves this path on real Postgres.
      if (isUniqueViolation(error)) throw new HttpError(409, GATEWAY_CONNECTED_MESSAGE);
      throw error;
    }
  }

  /**
   * DELETE /gateway/account → 204. Owner-only; soft delete — the row (and
   * its past connections) stays for the audit, and the freed firm can
   * connect again (the partial unique index only covers live rows).
   */
  async disconnect(actor: ApiUser): Promise<void> {
    if (!this.encryptionKey) throw new HttpError(503, GATEWAY_ENCRYPTION_REQUIRED);
    this.requireOwner(actor);
    const deleted = await this.repos.gatewayAccounts.delete(actor.firmId);
    if (!deleted) throw new HttpError(404, "Gateway account not connected");
  }

  /**
   * The firm's decrypted gateway credentials for outgoing gateway calls (the
   * collect/reconcile paths of tickets 03/05). Null when not connected; 503
   * when the encryption key is missing (the credentials cannot even be
   * decrypted, and the feature is inert by design in that state).
   */
  async credentials(firmId: string): Promise<GatewayCredentials | null> {
    if (!this.encryptionKey) throw new HttpError(503, GATEWAY_ENCRYPTION_REQUIRED);
    const row = await this.repos.gatewayAccounts.findByFirm(firmId);
    if (!row || !row.enabled) return null;
    const aesKey = deriveAesKey(this.encryptionKey);
    return {
      provider: row.provider,
      keyId: row.keyId,
      keySecret: decryptSecret(row.keySecret, aesKey),
      webhookSecret: decryptSecret(row.webhookSecret, aesKey),
    };
  }
}
