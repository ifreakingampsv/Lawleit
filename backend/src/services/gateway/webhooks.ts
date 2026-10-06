import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { AuthRepositories } from "../auth/repository.js";
import { isUniqueViolation } from "../auth/service.js";
import { HttpError } from "../httpError.js";
import { PAYMENT_METHODS } from "../payments/repository.js";
import type { PaymentsService } from "../payments/service.js";
import type { GatewayAccountService, GatewayCredentials } from "./service.js";

/** Shown (as a 404) when the URL's firm has no verifiable gateway account. */
export const WEBHOOK_FIRM_UNKNOWN = "Gateway account not connected";
/** Shown (as a 400) when the X-Razorpay-Signature HMAC check fails. */
export const WEBHOOK_SIGNATURE_INVALID = "Invalid webhook signature";
/** Shown (as a 400) when the body is not a Razorpay-shaped webhook payload. */
export const WEBHOOK_BODY_INVALID = "Invalid webhook payload";

/** The only event that records money this slice; everything else is ledger-only. */
const MONEY_EVENT = "payment_link.paid";

/**
 * A parsed Razorpay webhook body — only the fields this slice consumes; the
 * rest of the payload is ignored (and never stored: the ledger row keeps the
 * event ids and type, not the raw payload, so no client data is copied).
 */
export interface WebhookBody {
  event?: string;
  payload?: {
    payment_link?: { entity?: { id?: string } };
    payment?: { entity?: { method?: string } };
  };
}

/** The webhook outcome — returned in the 200 body for debuggability. */
export interface WebhookOutcome {
  /** A payment was recorded (the event was payment_link.paid for a live link). */
  recorded: boolean;
  /** The delivery had been processed before (replay — nothing was written). */
  duplicate: boolean;
}

function verifySignature(rawBody: string, webhookSecret: string, signature: string): boolean {
  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  // timingSafeEqual throws on length mismatch — map that to "invalid" too.
  return a.length === b.length && timingSafeEqual(a, b);
}

function mapMethod(method: unknown): string {
  return typeof method === "string" && (PAYMENT_METHODS as readonly string[]).includes(method)
    ? method
    : "card";
}

/**
 * The Razorpay webhook receiver (V2 slice 1, ticket 04) — public,
 * server-to-server, verified before anything happens:
 *
 *   1. The URL names the firm; the check secret is THAT firm's decrypted
 *      webhook secret, so firm A's secret can never authorize a delivery
 *      aimed at firm B (cross-firm isolation, spec story 14). An unknown,
 *      disconnected, or undecryptable firm is uniformly 404.
 *   2. HMAC-SHA256 over the RAW request body (X-Razorpay-Signature) is
 *      mandatory — a 400 before any processing on absence or mismatch.
 *   3. The event row and the payment it produces commit in ONE transaction:
 *      the UNIQUE (provider, provider_event_id) index is the dedupe wall, so
 *      a replayed delivery aborts at insert time and writes nothing — mapped
 *      to a no-op 200 (Razorpay retries until it sees 2xx).
 *
 * Only payment_link.paid records money, through the SAME service path as the
 * manual route (PaymentsService.recordWithin — validation, roll-up, and the
 * trust hook included), with the method mapped from the payment entity and
 * `trustAccount` hard-wired false: gateway money can never enter the trust
 * ledger (spec Q12). Every other event type is stored and ignored.
 */
export class GatewayWebhookService {
  constructor(
    private readonly repos: AuthRepositories,
    private readonly accounts: GatewayAccountService,
    private readonly payments: PaymentsService,
  ) {}

  async handle(
    firmId: string,
    rawBody: string,
    signature: string | undefined,
    providerEventIdHeader?: string,
  ): Promise<WebhookOutcome> {
    let credentials: GatewayCredentials;
    try {
      credentials = (await this.accounts.credentials(firmId)) as GatewayCredentials;
    } catch {
      // No encryption key (or undecryptable) — indistinguishable from
      // not-connected by design; the firm in the URL is simply unverifiable.
      throw new HttpError(404, WEBHOOK_FIRM_UNKNOWN);
    }
    if (!credentials) throw new HttpError(404, WEBHOOK_FIRM_UNKNOWN);

    if (!signature || !verifySignature(rawBody, credentials.webhookSecret, signature)) {
      throw new HttpError(400, WEBHOOK_SIGNATURE_INVALID);
    }

    let body: WebhookBody;
    try {
      body = JSON.parse(rawBody) as WebhookBody;
    } catch {
      throw new HttpError(400, WEBHOOK_BODY_INVALID);
    }
    const event = body.event;
    if (!event) throw new HttpError(400, WEBHOOK_BODY_INVALID);

    // Razorpay sends X-Razorpay-Event-Id; absent (hand-rolled replays, tests),
    // the raw body's hash is a stable stand-in — identical bytes, identical id.
    const providerEventId =
      providerEventIdHeader ?? createHash("sha256").update(rawBody).digest("hex");

    try {
      return await this.repos.transaction(async (tx) => {
        await tx.gatewayEvents.create({
          firmId,
          provider: credentials.provider,
          providerEventId,
          eventType: event,
        });

        if (event !== MONEY_EVENT) return { recorded: false, duplicate: false };
        const providerLinkId = body.payload?.payment_link?.entity?.id;
        if (!providerLinkId) return { recorded: false, duplicate: false };

        const link = await tx.paymentLinks.findByProviderLinkId(firmId, providerLinkId);
        if (!link || link.status === "paid") return { recorded: false, duplicate: false };

        await this.payments.recordWithin(tx, firmId, {
          invoiceId: link.invoiceId,
          amount: link.amount,
          method: mapMethod(body.payload?.payment?.entity?.method),
          trustAccount: false,
        });
        await tx.paymentLinks.update(firmId, link.id, { status: "paid" });
        return { recorded: true, duplicate: false };
      });
    } catch (error) {
      // The replay path: the event row's unique index fired inside the
      // transaction, so NOTHING was written (the payment insert after it
      // rolled back with the transaction). A no-op 200 stops the retries.
      if (isUniqueViolation(error)) return { recorded: false, duplicate: true };
      throw error;
    }
  }
}
