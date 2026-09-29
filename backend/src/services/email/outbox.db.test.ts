import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, migrationsFolder, requireDb, type DbHandle } from "../../db/client.js";
import { DrizzleEmailOutbox } from "./outbox.js";

/**
 * DB-backed twin for the outbox seam (service.db.test.ts pattern): proves the
 * Drizzle binding of EmailOutboxRepository on real Postgres — column defaults,
 * the due query's status/available_at filter, and both mark paths. Runs only
 * when DATABASE_URL is exported and skips silently otherwise; point it at a
 * scratch database (truncates).
 */
describe.skipIf(!process.env.DATABASE_URL)("email outbox against Postgres", () => {
  let handle: DbHandle;
  let outbox: DrizzleEmailOutbox;

  beforeAll(async () => {
    handle = requireDb();
    await migrate(handle.db, { migrationsFolder });
    outbox = new DrizzleEmailOutbox(handle.db);
  });

  afterEach(async () => {
    await handle.sql.unsafe(
      "truncate table case_number_counters, cases, contacts, documents, email_outbox, expenses, events, invoice_line_items, invoice_number_counters, invoices, lead_stage_history, leads, payments, tasks, time_entries, password_reset_tokens, sessions, trust_transactions, users, firms cascade",
    );
  });

  afterAll(async () => {
    await closeDb();
  });

  it("enqueue records a pending row with the defaults (attempts 0, available_at now)", async () => {
    const before = new Date();
    const row = await outbox.enqueue({
      firmId: null,
      to: "owner@firm.example",
      subject: "Reset your Lawleit password",
      bodyText: "http://localhost:5173/reset-password?token=tok",
      bodyHtml: "<html></html>",
      kind: "reset",
    });
    const after = new Date();

    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(0);
    expect(row.sentAt).toBeNull();
    expect(row.lastError).toBeNull();
    expect(row.availableAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(row.availableAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    expect(row.kind).toBe("reset");
  });

  it("firm_id is a soft link: any uuid round-trips, no FK constraint", async () => {
    const row = await outbox.enqueue({
      firmId: "00000000-0000-0000-0000-00000000000f",
      to: "a@b.example",
      subject: "s",
      bodyText: "t",
      bodyHtml: null,
      kind: "invite",
    });
    expect(row.firmId).toBe("00000000-0000-0000-0000-00000000000f");
  });

  it("due() returns only pending rows whose available_at has passed, oldest first", async () => {
    const now = new Date();
    const first = await outbox.enqueue(
      { firmId: null, to: "a@b.example", subject: "s", bodyText: "t", bodyHtml: null, kind: "reset" },
      new Date(now.getTime() - 5_000),
    );
    const second = await outbox.enqueue(
      { firmId: null, to: "c@d.example", subject: "s", bodyText: "t", bodyHtml: null, kind: "invite" },
      new Date(now.getTime() - 4_000),
    );
    await outbox.enqueue(
      { firmId: null, to: "e@f.example", subject: "s", bodyText: "t", bodyHtml: null, kind: "reset" },
      new Date(now.getTime() + 60_000), // not due yet
    );
    await outbox.markSent(second.id, 1, now); // terminal

    const due = await outbox.due(now, 10);
    expect(due.map((r) => r.id)).toEqual([first.id]);
  });

  it("due() honors the limit", async () => {
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      await outbox.enqueue(
        { firmId: null, to: `${i}@b.example`, subject: "s", bodyText: "t", bodyHtml: null, kind: "reset" },
        new Date(now.getTime() - 10_000 + i),
      );
    }
    expect((await outbox.due(now, 3)).length).toBe(3);
  });

  it("markSent stamps status/attempts/sent_at and clears the error", async () => {
    const row = await outbox.enqueue({
      firmId: null, to: "a@b.example", subject: "s", bodyText: "t", bodyHtml: null, kind: "reset",
    });
    await outbox.markFailed(row.id, 1, "transient", new Date(), new Date());
    const sentAt = new Date();
    await outbox.markSent(row.id, 2, sentAt);

    const rows = await handle.sql`select status, attempts, sent_at, last_error from email_outbox where id = ${row.id}`;
    const record = rows[0] as { status: string; attempts: number; sent_at: Date; last_error: string | null };
    expect(record.status).toBe("sent");
    expect(record.attempts).toBe(2);
    expect(record.sent_at).not.toBeNull();
    expect(record.last_error).toBeNull();
  });

  it("markFailed with a retry keeps the row pending and pushes available_at out (backoff)", async () => {
    const row = await outbox.enqueue({
      firmId: null, to: "a@b.example", subject: "s", bodyText: "t", bodyHtml: null, kind: "reset",
    });
    const now = new Date();
    const retryAt = new Date(now.getTime() + 2 * 60_000);
    await outbox.markFailed(row.id, 1, "Resend rejected the send (HTTP 500)", retryAt, now);

    const rows = await handle.sql`select status, attempts, last_error, available_at from email_outbox where id = ${row.id}`;
    const record = rows[0] as { status: string; attempts: number; last_error: string; available_at: Date };
    expect(record.status).toBe("pending");
    expect(record.attempts).toBe(1);
    expect(record.last_error).toContain("HTTP 500");
    expect(record.available_at.getTime()).toBe(retryAt.getTime());
  });

  it("markFailed with no retry poisons the row (status failed, never due again)", async () => {
    const row = await outbox.enqueue({
      firmId: null, to: "a@b.example", subject: "s", bodyText: "t", bodyHtml: null, kind: "invite",
    });
    const now = new Date();
    await outbox.markFailed(row.id, 8, "gave up", null, now);

    const rows = await handle.sql`select status, available_at from email_outbox where id = ${row.id}`;
    const record = rows[0] as { status: string; available_at: Date };
    expect(record.status).toBe("failed");
    expect((await outbox.due(new Date(now.getTime() + 3_600_000), 10)).map((r) => r.id)).not.toContain(row.id);
  });
});
