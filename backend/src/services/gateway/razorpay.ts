import {
  GatewayProviderError,
  type GatewayService,
  type ProviderLink,
  type ProviderLinkInput,
} from "./provider.js";
import type { GatewayCredentials } from "./service.js";

/**
 * The Razorpay Payment Links client (V2 slice 1, tickets 03/05) — the
 * production GatewayService implementation. Thin on purpose: two calls, both
 * HTTP Basic with the FIRM's own key id/secret (ADR-0006 — the credentials
 * ride every request and are never persisted or logged here), and one shared
 * error mapping (any non-2xx or network failure → GatewayProviderError, the
 * service's cue for the clean 502 envelope).
 *
 * `baseUrl` is the seam the tests use to point the client at a fake provider
 * HTTP server; production uses the default api.razorpay.com.
 */
export class RazorpayGateway implements GatewayService {
  constructor(private readonly baseUrl = "https://api.razorpay.com/v1") {}

  async createLink(credentials: GatewayCredentials, input: ProviderLinkInput): Promise<ProviderLink> {
    const body = {
      amount: input.amount, // integer paise, the API's native unit
      currency: "INR",
      reference_id: input.referenceId,
      description: input.description,
    };
    return this.request(credentials, "POST", "payment_links", body);
  }

  async fetchLink(credentials: GatewayCredentials, providerLinkId: string): Promise<ProviderLink> {
    return this.request(credentials, "GET", `payment_links/${encodeURIComponent(providerLinkId)}`);
  }

  private async request(
    credentials: GatewayCredentials,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<ProviderLink> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/${path}`, {
        method,
        headers: {
          // HTTP Basic with the firm's key id/secret — the only place the
          // decrypted secret material exists outside the account service.
          Authorization: `Basic ${Buffer.from(
            `${credentials.keyId}:${credentials.keySecret}`,
          ).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new GatewayProviderError("payment gateway unreachable");
    }
    if (!res.ok) throw new GatewayProviderError(`payment gateway answered ${res.status}`);
    const data = (await res.json()) as {
      id?: string; short_url?: string; status?: string; amount?: number;
      payments?: { method?: string }[];
    };
    if (!data.id || !data.short_url || !data.status || typeof data.amount !== "number") {
      throw new GatewayProviderError("payment gateway answered an unexpected shape");
    }
    return {
      id: data.id,
      shortUrl: data.short_url,
      status: data.status as ProviderLink["status"],
      amount: data.amount,
      // The instrument of the link's first payment, when the provider embeds
      // its payments (it does on a paid link); absent otherwise.
      method: data.payments?.[0]?.method ?? null,
    };
  }
}

/** Production binding — the real Razorpay endpoint. */
export function createRazorpayGateway(): GatewayService {
  return new RazorpayGateway();
}
