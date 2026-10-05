import { describe, expect, it } from "vitest";
import { ConsoleMailer } from "../auth/mailer.js";
import type { AppConfig, EmailConfig } from "../../config.js";
import type { EmailOutboxRepository, NewOutboxEmail, OutboxEmailRow } from "./outbox.js";
import { OutboxMailer, createEmailDelivery } from "./mailer.js";
import { EmailWorker } from "./worker.js";

/**
 * The seam test: the ticket-18 binding keeps the Mailer interface the auth
 * services already call — these tests drive it exactly like AuthService and
 * UserService do (sendPasswordReset / sendUserInvite with the token envelope)
 * and assert the outbox behavior around it.
 */

const T0 = new Date("2026-09-29T10:00:00.000Z");
const BASE_URL = "https://app.lawleit.in";

function inMemoryOutbox(): EmailOutboxRepository & { rows: OutboxEmailRow[] } {
  const rows: OutboxEmailRow[] = [];
  return {
    rows,
    async enqueue(input: NewOutboxEmail): Promise<OutboxEmailRow> {
      const row: OutboxEmailRow = {
        id: `row-${rows.length + 1}`,
        status: "pending",
        attempts: 0,
        lastError: null,
        availableAt: T0,
        sentAt: null,
        createdAt: T0,
        updatedAt: T0,
        ...input,
      };
      rows.push(row);
      return row;
    },
    async due(now: Date, limit: number): Promise<OutboxEmailRow[]> {
      return rows
        .filter((r) => r.status === "pending" && r.availableAt.getTime() <= now.getTime())
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

function build(outbox = inMemoryOutbox(), sender = { send: async () => {} }) {
  const worker = new EmailWorker({ outbox, sender, now: () => T0 });
  return { outbox, worker, mailer: new OutboxMailer(outbox, worker, BASE_URL) };
}

describe("OutboxMailer (the Mailer binding)", () => {
  it("sendPasswordReset enqueues a branded reset row and drains it immediately", async () => {
    const { outbox, mailer } = build();

    await mailer.sendPasswordReset({
      to: "owner@firm.example",
      token: "tok-1",
      expiresAt: "2026-09-29T11:00:00.000Z",
      firmId: "firm-1",
    });

    expect(outbox.rows).toHaveLength(1);
    const row = outbox.rows[0]!;
    expect(row.kind).toBe("reset");
    expect(row.firmId).toBe("firm-1");
    expect(row.to).toBe("owner@firm.example");
    expect(row.status).toBe("sent"); // the awaited immediate drain
    expect(row.attempts).toBe(1);
    expect(row.sentAt).toEqual(T0);
    expect(row.bodyText).toContain(`${BASE_URL}/reset-password?token=tok-1`);
    expect(row.subject).toContain("Lawleit");
  });

  it("sendUserInvite enqueues an invite row with the actor's firm", async () => {
    const { outbox, mailer } = build();

    await mailer.sendUserInvite({
      to: "new.member@firm.example",
      token: "inv-1",
      expiresAt: "2026-10-06T11:00:00.000Z",
      firmId: "firm-2",
    });

    const row = outbox.rows[0]!;
    expect(row.kind).toBe("invite");
    expect(row.firmId).toBe("firm-2");
    expect(row.bodyText).toContain("token=inv-1");
  });

  it("a missing firmId records null (the informational soft link is optional)", async () => {
    const { outbox, mailer } = build();
    await mailer.sendPasswordReset({
      to: "owner@firm.example",
      token: "t",
      expiresAt: "2026-09-29T11:00:00.000Z",
    });
    expect(outbox.rows[0]!.firmId).toBeNull();
  });

  it("delivery failure never rejects the caller: row stays pending with backoff", async () => {
    const { outbox, mailer } = build(inMemoryOutbox(), {
      send: async () => {
        throw new Error("provider down");
      },
    });

    await expect(
      mailer.sendPasswordReset({
        to: "owner@firm.example",
        token: "tok-1",
        expiresAt: "2026-09-29T11:00:00.000Z",
      }),
    ).resolves.toBeUndefined(); // the auth flow's response must not depend on email reachability

    const row = outbox.rows[0]!;
    expect(row.status).toBe("pending"); // durable, the worker retries
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe("provider down");
  });
});

describe("createEmailDelivery (config → binding)", () => {
  const email: EmailConfig = {
    from: "Lawleit <onboarding@resend.dev>",
    resendApiKey: null,
    baseUrl: BASE_URL,
  };

  const config: AppConfig = {
    port: 0,
    corsOrigins: [],
    sessionSecret: "s",
    databaseUrl: null,
    cookieSameSite: "lax",
    cookieSecure: false,
    storage: null,
    email,
    gatewayEncryptionKey: null,
  };
  it("a full AppConfig literal (as buildApp consumes) includes email", () => {
    expect(config.email.resendApiKey).toBeNull();
  });

  it("no DATABASE_URL → ConsoleMailer (stateless boots, behavior identical to pre-18)", () => {
    const delivery = createEmailDelivery(email, null);
    expect(delivery.mailer).toBeInstanceOf(ConsoleMailer);
    expect(() => delivery.start()).not.toThrow();
    expect(() => delivery.stop()).not.toThrow();
  });

  it("database present → OutboxMailer binding with a started, stoppable worker", () => {
    // The pipeline is only wired here (the drizzle outbox never queries in
    // this test — row-level behavior is proven by the OutboxMailer suite).
    const handle = {
      sql: undefined as never,
      db: {} as never,
      ping: async () => {},
      close: async () => {},
    };
    const delivery = createEmailDelivery(email, handle, { now: () => T0 });
    expect(delivery.mailer).not.toBeInstanceOf(ConsoleMailer);
    // start() kicks an immediate drain on an empty outbox and stops cleanly —
    // the lifecycle buildApp ties into (start at boot, stop on onClose).
    expect(() => {
      delivery.start();
      delivery.stop();
    }).not.toThrow();
  });

  it("worker knobs flow through (maxAttempts steers the poison point)", async () => {
    const outbox = inMemoryOutbox();
    const sender = {
      send: async () => {
        throw new Error("down");
      },
    };
    const worker = new EmailWorker({ outbox, sender, maxAttempts: 2, now: () => T0 });
    const mailer = new OutboxMailer(outbox, worker, BASE_URL);
    await mailer.sendUserInvite({
      to: "a@b.example",
      token: "t1",
      expiresAt: "2026-09-29T11:00:00.000Z",
    });
    // One drain: attempts 1, backoff scheduled.
    expect(outbox.rows[0]!.attempts).toBe(1);
    outbox.rows[0]!.availableAt = T0;
    await mailer.sendUserInvite({
      to: "c@d.example",
      token: "t2",
      expiresAt: "2026-09-29T11:00:00.000Z",
    });
    // The enqueued-then-drained second row pushed the first row's attempts to
    // the poison point on this second pass.
    const poisoned = outbox.rows.find((r) => r.status === "failed");
    expect(poisoned).toBeDefined();
    expect(poisoned!.attempts).toBe(2);
  });
});
