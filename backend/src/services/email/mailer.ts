import { ConsoleMailer, type InviteEmail, type Mailer, type PasswordResetEmail } from "../auth/mailer.js";
import type { DbHandle } from "../../db/client.js";
import type { EmailConfig } from "../../config.js";
import { DrizzleEmailOutbox, type EmailOutboxRepository } from "./outbox.js";
import { pickSender } from "./resend.js";
import { EmailWorker } from "./worker.js";
import { renderPasswordResetEmail, renderUserInviteEmail, type RenderedEmail } from "./templates.js";

/**
 * The ticket-18 Mailer binding: the SAME interface the auth services already
 * call, implemented as write-to-outbox + drain immediately. Chosen over an
 * EmailService-with-enqueue() refactor because it keeps every call site
 * (AuthService, UserService, routes wiring, CapturingMailer tests) untouched
 * — the seam's whole point is that nothing above it changes.
 *
 * enqueue-then-drain-immediately: the row is durable BEFORE any provider is
 * contacted, then the drain runs inline so delivery is immediate (the UX the
 * old stub had), while failures are recorded on the row and survive restarts
 * (the interval worker retries). drainOnce never rejects, so a dead provider
 * degrades to "logged + queued", never to a failed API response — the reset
 * token row already exists and the response must not depend on email
 * reachability.
 */
export class OutboxMailer implements Mailer {
  constructor(
    private readonly outbox: EmailOutboxRepository,
    private readonly worker: Pick<EmailWorker, "drainOnce">,
    private readonly baseUrl: string,
  ) {}

  async sendPasswordReset(email: PasswordResetEmail): Promise<void> {
    await this.enqueue(renderPasswordResetEmail(email, this.baseUrl), email.firmId ?? null);
  }

  async sendUserInvite(email: InviteEmail): Promise<void> {
    await this.enqueue(renderUserInviteEmail(email, this.baseUrl), email.firmId ?? null);
  }

  private async enqueue(rendered: RenderedEmail, firmId: string | null): Promise<void> {
    await this.outbox.enqueue({
      firmId,
      to: rendered.to,
      subject: rendered.subject,
      bodyText: rendered.bodyText,
      bodyHtml: rendered.bodyHtml,
      kind: rendered.kind,
    });
    await this.worker.drainOnce();
  }
}

/** What buildApp gets: the Mailer binding plus worker lifecycle hooks. */
export interface EmailDelivery {
  mailer: Mailer;
  start(): void;
  stop(): void;
}

/** Worker knobs surfaced for tests (defaults live in worker.ts). */
export interface CreateEmailDeliveryOptions {
  intervalMs?: number;
  maxAttempts?: number;
  batchSize?: number;
  now?: () => Date;
  log?: (line: string) => void;
}

/**
 * The production pipeline (ticket 18):
 *
 * - No DATABASE_URL → stateless boot, nothing durable exists → the plain
 *   ConsoleMailer, byte-identical to the pre-18 behavior.
 * - Database, RESEND_API_KEY unset → outbox rows + console sender (links in
 *   the log) — dev behavior today, but every send is now recorded and the
 *   retry machinery is live.
 * - Database + key → outbox rows + Resend delivery with backoff retries.
 */
export function createEmailDelivery(
  email: EmailConfig,
  db: DbHandle | null,
  options: CreateEmailDeliveryOptions = {},
): EmailDelivery {
  if (!db) {
    return { mailer: new ConsoleMailer(), start() {}, stop() {} };
  }
  const outbox = new DrizzleEmailOutbox(db.db);
  const worker = new EmailWorker({ outbox, sender: pickSender(email), ...options });
  return {
    mailer: new OutboxMailer(outbox, worker, email.baseUrl),
    start: () => worker.start(),
    stop: () => worker.stop(),
  };
}
