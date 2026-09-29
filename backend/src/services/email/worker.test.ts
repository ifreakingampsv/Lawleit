import { describe, expect, it } from "vitest";
import type {
  EmailOutboxRepository,
  NewOutboxEmail,
  OutboxEmailRow,
} from "./outbox.js";
import type { OutboxMessage, OutboxSender } from "./resend.js";
import { BACKOFF_CAP_MINUTES, EmailWorker, backoffDelay } from "./worker.js";

/**
 * The worker's logic, unit-tested with an in-memory outbox fake and
 * scriptable senders — no timers (tests call drainOnce directly), no
 * database, no network.
 */

const T0 = new Date("2026-09-29T10:00:00.000Z");

function inMemoryOutbox(seed: OutboxEmailRow[] = []): EmailOutboxRepository & { rows: OutboxEmailRow[] } {
  const rows = [...seed];
  return {
    rows,
    async enqueue(input: NewOutboxEmail, now = new Date()): Promise<OutboxEmailRow> {
      const row: OutboxEmailRow = {
        id: `row-${rows.length + 1}`,
        status: "pending",
        attempts: 0,
        lastError: null,
        availableAt: now,
        sentAt: null,
        createdAt: now,
        updatedAt: now,
        ...input,
      };
      rows.push(row);
      return row;
    },
    async due(now: Date, limit: number): Promise<OutboxEmailRow[]> {
      return rows
        .filter((r) => r.status === "pending" && r.availableAt.getTime() <= now.getTime())
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, limit);
    },
    async markSent(id, attempts, sentAt): Promise<void> {
      const row = rows.find((r) => r.id === id)!;
      row.status = "sent";
      row.attempts = attempts;
      row.sentAt = sentAt;
      row.lastError = null;
    },
    async markFailed(id, attempts, lastError, retryAvailableAt, now): Promise<void> {
      const row = rows.find((r) => r.id === id)!;
      row.status = retryAvailableAt === null ? "failed" : "pending";
      row.attempts = attempts;
      row.lastError = lastError;
      row.availableAt = retryAvailableAt ?? now;
    },
  };
}

function fakeSender(fn: (message: OutboxMessage) => Promise<void> = async () => {}): OutboxSender & { sent: OutboxMessage[] } {
  const sent: OutboxMessage[] = [];
  return {
    sent,
    async send(message: OutboxMessage): Promise<void> {
      sent.push(message);
      await fn(message);
    },
  };
}

function sampleRow(overrides: Partial<OutboxEmailRow> = {}): OutboxEmailRow {
  return {
    id: "row-1",
    firmId: null,
    to: "owner@firm.example",
    subject: "Reset your Lawleit password",
    bodyText: "http://localhost:5173/reset-password?token=tok",
    bodyHtml: "<html></html>",
    kind: "reset",
    status: "pending",
    attempts: 0,
    lastError: null,
    availableAt: T0,
    sentAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function buildWorker(outbox: EmailOutboxRepository, sender: OutboxSender, opts: { log?: (l: string) => void; maxAttempts?: number } = {}) {
  const logs: string[] = [];
  const worker = new EmailWorker({
    outbox,
    sender,
    log: opts.log ?? ((line) => logs.push(line)),
    maxAttempts: opts.maxAttempts,
    now: () => T0,
  });
  return { worker, logs };
}

describe("email worker", () => {
  it("drains due rows: sender gets the message, row marked sent with attempts + sent_at", async () => {
    const outbox = inMemoryOutbox([sampleRow()]);
    const sender = fakeSender();
    const { worker } = buildWorker(outbox, sender);

    await worker.drainOnce();

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toMatchObject({
      id: "row-1",
      kind: "reset",
      to: "owner@firm.example",
      subject: "Reset your Lawleit password",
      bodyHtml: "<html></html>",
    });
    const row = outbox.rows[0]!;
    expect(row.status).toBe("sent");
    expect(row.attempts).toBe(1);
    expect(row.sentAt).toEqual(T0);
    expect(row.lastError).toBeNull();
  });

  it("skips rows that are not due yet and terminal rows", async () => {
    const outbox = inMemoryOutbox([
      sampleRow({ id: "future", availableAt: new Date(T0.getTime() + 60_000) }),
      sampleRow({ id: "sent", status: "sent" }),
      sampleRow({ id: "failed", status: "failed" }),
      sampleRow({ id: "due" }),
    ]);
    const sender = fakeSender();
    const { worker } = buildWorker(outbox, sender);

    await worker.drainOnce();

    expect(sender.sent.map((m) => m.id)).toEqual(["due"]);
  });

  it("failing sender: attempts increment, error recorded, backoff grows exponentially", async () => {
    const outbox = inMemoryOutbox([sampleRow()]);
    const sender = fakeSender(async () => {
      throw new Error("Resend rejected the send (HTTP 422): domain not verified");
    });
    const { worker, logs } = buildWorker(outbox, sender);

    await worker.drainOnce();
    let row = outbox.rows[0]!;
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain("HTTP 422");
    expect(row.sentAt).toBeNull();
    expect(row.availableAt.getTime()).toBe(T0.getTime() + 2 * 60_000); // 2^1 min
    expect(logs.some((l) => l.includes("retrying"))).toBe(true);

    // Retry #1 is still in the future for T0 — pull it due and drain again.
    row.availableAt = T0;
    await worker.drainOnce();
    row = outbox.rows[0]!;
    expect(row.attempts).toBe(2);
    expect(row.availableAt.getTime()).toBe(T0.getTime() + 4 * 60_000); // 2^2 min
  });

  it("backoffDelay caps at one hour", () => {
    expect(backoffDelay(1, T0).getTime()).toBe(T0.getTime() + 2 * 60_000);
    expect(backoffDelay(6, T0).getTime()).toBe(T0.getTime() + BACKOFF_CAP_MINUTES * 60_000);
    expect(backoffDelay(20, T0).getTime()).toBe(T0.getTime() + BACKOFF_CAP_MINUTES * 60_000);
  });

  it("poisons after maxAttempts: status failed, never drained again, logged loudly", async () => {
    const seed = sampleRow({ attempts: 7 }); // one attempt away from the (default 8) cap
    const outbox = inMemoryOutbox([seed]);
    const sender = fakeSender(async () => {
      throw new Error("still down");
    });
    const { worker, logs } = buildWorker(outbox, sender);

    await worker.drainOnce();

    const row = outbox.rows[0]!;
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(8);
    expect(row.lastError).toBe("still down");
    expect(sender.sent).toHaveLength(1); // attempted exactly once more, then poisoned

    const loud = logs.find((l) => l.includes("POISON"));
    expect(loud).toBeDefined();
    expect(loud).toContain("owner@firm.example");
    expect(loud).toContain("8 attempts");

    // The poisoned row no longer matches the due query.
    await worker.drainOnce();
    expect(sender.sent).toHaveLength(1);
  });

  it("in-flight guard: overlapping drains collapse into one pass (no double send)", async () => {
    const outbox = inMemoryOutbox([sampleRow()]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sender = fakeSender(async () => {
      await gate; // first send blocks mid-flight
    });
    const { worker } = buildWorker(outbox, sender);

    const first = worker.drainOnce();
    const second = worker.drainOnce(); // must join the running pass
    expect(sender.sent).toHaveLength(0); // nothing sent while gated
    release();
    await Promise.all([first, second]);

    expect(sender.sent).toHaveLength(1);
    expect(outbox.rows[0]!.status).toBe("sent");
  });

  it("a due-read failure is logged, never thrown (drains must not crash callers)", async () => {
    const failing: EmailOutboxRepository = {
      enqueue: async () => {
        throw new Error("no enqueue in this test");
      },
      due: async () => {
        throw new Error("database down");
      },
      markSent: async () => {},
      markFailed: async () => {},
    };
    const { worker, logs } = buildWorker(failing, fakeSender());
    await expect(worker.drainOnce()).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes("database down"))).toBe(true);
  });
});
