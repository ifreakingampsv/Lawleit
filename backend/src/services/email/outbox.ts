import { and, asc, eq, lte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { emailOutbox } from "../../db/schema.js";

/**
 * The outbox seam (ticket 18): durable rows that outlive failed sends. The
 * worker (worker.ts) is written against this interface and is unit-tested
 * with an in-memory fake; the Drizzle binding below is the production
 * implementation, exercised by the DB twin suite.
 */

export type OutboxKind = "reset" | "invite";
export type OutboxStatus = "pending" | "sent" | "failed";

export interface NewOutboxEmail {
  /** Soft link to firms (informational, no FK — see schema.ts). */
  firmId: string | null;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  kind: OutboxKind;
}

export interface OutboxEmailRow extends NewOutboxEmail {
  id: string;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  /** The row becomes drainable when available_at <= now. */
  availableAt: Date;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmailOutboxRepository {
  enqueue(input: NewOutboxEmail, now?: Date): Promise<OutboxEmailRow>;
  /** Due pending rows, oldest first, at most `limit`. */
  due(now: Date, limit: number): Promise<OutboxEmailRow[]>;
  /** Record a successful send (the attempt counts, sent_at stamps it). */
  markSent(id: string, attempts: number, sentAt: Date): Promise<void>;
  /**
   * Record a failed attempt. `retryAvailableAt` non-null keeps the row
   * pending with a pushed-out available_at (backoff); null poisons it —
   * status failed, never drained again.
   */
  markFailed(
    id: string,
    attempts: number,
    lastError: string,
    retryAvailableAt: Date | null,
    now: Date,
  ): Promise<void>;
}

export class DrizzleEmailOutbox implements EmailOutboxRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async enqueue(input: NewOutboxEmail, now: Date = new Date()): Promise<OutboxEmailRow> {
    const [row] = await this.db
      .insert(emailOutbox)
      .values({
        firmId: input.firmId,
        toEmail: input.to,
        subject: input.subject,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml,
        kind: input.kind,
        status: "pending",
        attempts: 0,
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("email_outbox insert returned no row");
    return this.toRow(row);
  }

  async due(now: Date, limit: number): Promise<OutboxEmailRow[]> {
    const rows = await this.db
      .select()
      .from(emailOutbox)
      .where(and(eq(emailOutbox.status, "pending"), lte(emailOutbox.availableAt, now)))
      .orderBy(asc(emailOutbox.createdAt), asc(emailOutbox.id))
      .limit(limit);
    return rows.map((row) => this.toRow(row));
  }

  async markSent(id: string, attempts: number, sentAt: Date): Promise<void> {
    await this.db
      .update(emailOutbox)
      .set({ status: "sent", attempts, sentAt, lastError: null, updatedAt: sentAt })
      .where(eq(emailOutbox.id, id));
  }

  async markFailed(
    id: string,
    attempts: number,
    lastError: string,
    retryAvailableAt: Date | null,
    now: Date,
  ): Promise<void> {
    await this.db
      .update(emailOutbox)
      .set({
        status: retryAvailableAt === null ? "failed" : "pending",
        attempts,
        lastError,
        availableAt: retryAvailableAt ?? now,
        updatedAt: now,
      })
      .where(eq(emailOutbox.id, id));
  }

  /** Drizzle types the nullable default columns loosely; normalize here. */
  private toRow(row: typeof emailOutbox.$inferSelect): OutboxEmailRow {
    return {
      id: row.id,
      firmId: row.firmId,
      to: row.toEmail,
      subject: row.subject,
      bodyText: row.bodyText,
      bodyHtml: row.bodyHtml,
      kind: row.kind as OutboxKind,
      status: row.status as OutboxStatus,
      attempts: row.attempts,
      lastError: row.lastError,
      availableAt: row.availableAt,
      sentAt: row.sentAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
