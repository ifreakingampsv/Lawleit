import type { EmailConfig } from "../../config.js";

/**
 * The outbound delivery seam (ticket 18): everything the worker needs to know
 * about "put this message on the wire". Two bindings ship — a minimal typed
 * fetch client for Resend's HTTP API (dependency-free: the official SDK adds
 * a dependency tree for one POST we already fully type here) and a console
 * logger that stands in when RESEND_API_KEY is unset (the link lands in the
 * server log — the same dev handoff the old stub provided).
 *
 * A sender either resolves (the provider accepted the message) or throws —
 * throwing is what drives the worker's retry/backoff machinery, so senders
 * must never swallow errors.
 */

/** One drainable message, lifted from an outbox row. */
export interface OutboxMessage {
  id: string;
  kind: "reset" | "invite";
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
}

export interface OutboxSender {
  send(message: OutboxMessage): Promise<void>;
}

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Resend's POST /emails request body — only the fields we use. */
interface ResendSendBody {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
}

/** Bounded wait: a hung provider must not hang the drain (or the request
 * that triggered the immediate drain) — the row just retries later. */
export const RESEND_TIMEOUT_MS = 10_000;

export function createResendSender(options: {
  apiKey: string;
  from: string;
  /** Test seam — defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): OutboxSender {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? RESEND_TIMEOUT_MS;
  return {
    async send(message: OutboxMessage): Promise<void> {
      const body: ResendSendBody = {
        from: options.from,
        to: [message.to],
        subject: message.subject,
        text: message.bodyText,
        ...(message.bodyHtml !== null ? { html: message.bodyHtml } : {}),
      };
      const response = await doFetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        // The response body names the operator-fixable cause (unverified
        // domain, invalid key, suppression) — include it, truncated.
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        throw new Error(
          `Resend rejected the send (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
        );
      }
    },
  };
}

/**
 * No-API-key delivery: log the message (the reset/invite link inside
 * bodyText is the dev handoff — copy it from the server output), then
 * resolve so the outbox row records the "send" like any other.
 */
export function createConsoleSender(log: (line: string) => void = (line) => console.log(line)): OutboxSender {
  return {
    async send(message: OutboxMessage): Promise<void> {
      log(`[email:console] ${message.kind} → ${message.to} — ${message.subject}\n${message.bodyText}`);
    },
  };
}

/** Config → sender binding: Resend when the key exists, console otherwise. */
export function pickSender(email: EmailConfig): OutboxSender {
  return email.resendApiKey
    ? createResendSender({ apiKey: email.resendApiKey, from: email.from })
    : createConsoleSender();
}
