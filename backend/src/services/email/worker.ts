import type { EmailOutboxRepository, OutboxEmailRow } from "./outbox.js";
import type { OutboxSender } from "./resend.js";

/**
 * The outbox drain worker (ticket 18): a plain module — no timers of its own
 * unless start() is called — so tests drive drainOnce() directly with a fake
 * sender and never wait on real intervals.
 *
 * Semantics per drain: take up to `batchSize` due pending rows (oldest
 * first), attempt each once, then either mark it sent (attempts/sent_at
 * recorded) or record the failure — exponential backoff via available_at =
 * now + 2^attempts minutes (capped at one hour), and after `maxAttempts`
 * failures the row is poisoned: status failed, never drained again, logged
 * loudly (the operator's signal that an email silently died).
 *
 * One worker per process; the in-flight guard makes overlapping drains
 * (interval tick while an immediate drain is still running) collapse into
 * the running one instead of double-sending.
 */

export const DEFAULT_INTERVAL_MS = 30_000;
export const DEFAULT_MAX_ATTEMPTS = 8;
export const DEFAULT_BATCH_SIZE = 20;
/** Backoff ceiling: 2^n minutes grows fast; past attempt 6 it pins here. */
export const BACKOFF_CAP_MINUTES = 60;

export interface EmailWorkerOptions {
  outbox: EmailOutboxRepository;
  sender: OutboxSender;
  /** start() tick period; the immediate drain on enqueue is separate. */
  intervalMs?: number;
  maxAttempts?: number;
  batchSize?: number;
  now?: () => Date;
  /** Injectable logger — tests collect lines instead of spying on console. */
  log?: (line: string) => void;
}

/** available_at for a row that just failed its `attempts`-th try. */
export function backoffDelay(attempts: number, now: Date): Date {
  const minutes = Math.min(2 ** attempts, BACKOFF_CAP_MINUTES);
  return new Date(now.getTime() + minutes * 60_000);
}

export class EmailWorker {
  private readonly outbox: EmailOutboxRepository;
  private readonly sender: OutboxSender;
  private readonly intervalMs: number;
  private readonly maxAttempts: number;
  private readonly batchSize: number;
  private readonly now: () => Date;
  private readonly log: (line: string) => void;
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight: Promise<void> | null = null;

  constructor(options: EmailWorkerOptions) {
    this.outbox = options.outbox;
    this.sender = options.sender;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? ((line) => console.log(line));
  }

  /** Server startup: drain immediately, then keep the clock ticking. */
  start(): void {
    if (this.timer) return;
    void this.drainOnce();
    this.timer = setInterval(() => void this.drainOnce(), this.intervalMs);
    // The HTTP listener keeps the process alive; a dangling timer after a
    // missed stop() must not be what blocks exit.
    this.timer.unref?.();
  }

  /** Graceful shutdown clears the tick; an in-flight drain runs to completion. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * One drain pass. Never rejects — a drain must not take the request (or
   * the process) down with a failed send; every outcome is recorded on the
   * row and/or logged here.
   */
  drainOnce(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const run = this.drain().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  private async drain(): Promise<void> {
    let batch: OutboxEmailRow[];
    try {
      batch = await this.outbox.due(this.now(), this.batchSize);
    } catch (error) {
      this.log(`[email:outbox] drain could not read due rows: ${errorMessage(error)}`);
      return;
    }
    for (const row of batch) {
      await this.attempt(row);
    }
  }

  private async attempt(row: OutboxEmailRow): Promise<void> {
    const attempts = row.attempts + 1;
    try {
      await this.sender.send({
        id: row.id,
        kind: row.kind,
        to: row.to,
        subject: row.subject,
        bodyText: row.bodyText,
        bodyHtml: row.bodyHtml,
      });
      await this.outbox.markSent(row.id, attempts, this.now());
    } catch (error) {
      const message = errorMessage(error);
      if (attempts >= this.maxAttempts) {
        // Poison: log loudly — the recipient is waiting on an email the
        // system has given up on, so this must be unmissable in the logs.
        this.log(
          `[email:outbox] POISON — giving up on ${row.kind} to ${row.to} (outbox ${row.id}) after ${attempts} attempts; marked failed. Last error: ${message}`,
        );
        await this.outbox.markFailed(row.id, attempts, message, null, this.now());
      } else {
        const availableAt = backoffDelay(attempts, this.now());
        this.log(
          `[email:outbox] send failed for ${row.kind} to ${row.to} (outbox ${row.id}, attempt ${attempts}/${this.maxAttempts}), retrying after ${availableAt.toISOString()} — ${message}`,
        );
        await this.outbox.markFailed(row.id, attempts, message, availableAt, this.now());
      }
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
