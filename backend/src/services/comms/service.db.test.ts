import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, migrationsFolder, requireDb, type DbHandle } from "../../db/client.js";
import { createDrizzleRepositories } from "../auth/drizzle-repository.js";
import { AuthService } from "../auth/service.js";
import { CapturingMailer } from "../auth/testing.js";
import {
  CommsService,
  NOTIFICATION_KIND_MESSAGE,
  THREAD_CASE_MISSING_MESSAGE,
  THREAD_CHANNEL_MESSAGE,
  THREAD_CLIENT_MISSING_MESSAGE,
  THREAD_MESSAGE_AT_MESSAGE,
  THREAD_SENDER_MESSAGE,
} from "./service.js";

/**
 * DB-backed twin of the comms suite (service.db.test.ts pattern): the same
 * flows as the in-memory route tests, run against real Postgres so the
 * Drizzle binding proves it implements the seam identically — newest-first
 * thread listing, oldest-last messages on the seq stamp, the append-only
 * message log, firm-scoped read-marking, and the notification bell. Runs
 * only when DATABASE_URL is exported and skips silently otherwise; point it
 * at a scratch database (truncates).
 */
describe.skipIf(!process.env.DATABASE_URL)("comms against Postgres", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = requireDb();
    await migrate(handle.db, { migrationsFolder });
  });

  afterEach(async () => {
    await handle.sql.unsafe(
      "truncate table case_number_counters, cases, contacts, documents, email_outbox, expenses, events, invoice_line_items, invoice_number_counters, invoices, lead_stage_history, leads, notifications, payments, tasks, thread_messages, threads, time_entries, password_reset_tokens, sessions, trust_transactions, users, firms cascade",
    );
  });

  afterAll(async () => {
    await closeDb();
  });

  /** A firm whose owner has a working password (signup leaves none). */
  async function firmWithOwner(
    auth: AuthService,
    mailer: CapturingMailer,
    email: string,
  ) {
    const registered = await auth.register({
      firstName: "Owner", lastName: "Of Firm", email,
      firmName: `Firm of ${email}`, zip: "", phone: "",
    });
    await auth.requestPasswordReset(email);
    await auth.consumePasswordReset(mailer.sends[mailer.sends.length - 1]!.token, "password-123");
    const session = await auth.login(email, "password-123");
    return { registered, session };
  }

  function build(mailer: CapturingMailer) {
    const repos = createDrizzleRepositories(handle);
    return {
      auth: new AuthService(repos, mailer),
      repos,
      comms: new CommsService(repos),
    };
  }

  it("create → reference defaults, contract shape, newest-first threads with messages oldest-last on drizzle", async () => {
    const mailer = new CapturingMailer();
    const { auth, comms } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    const first = await comms.create(firmId, {
      subject: "Final arguments date confirmed", channel: "secure",
      messages: [
        { from: "client", authorName: "Harish Chadha", body: "Is the 9th confirmed?", at: "2026-09-30T09:12:00.000Z" },
        { from: "firm", authorName: "Arjun Kaul", body: "Yes — 10:00 AM." },
      ],
    });
    expect(first).toMatchObject({
      subject: "Final arguments date confirmed", clientId: "", channel: "secure", unread: false,
    });
    expect(first.messages.map((m) => [m.from, m.authorName, m.body])).toEqual([
      ["client", "Harish Chadha", "Is the 9th confirmed?"],
      ["firm", "Arjun Kaul", "Yes — 10:00 AM."],
    ]);
    expect(first.messages[0]!.at).toBe("2026-09-30T09:12:00.000Z");
    expect(first.messages[1]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    for (const key of ["firmId", "seq", "updatedAt", "deletedAt"]) {
      expect(first).not.toHaveProperty(key);
    }
    expect(first.messages.every((m) => !("seq" in m || "firmId" in m))).toBe(true);

    const second = await comms.create(firmId, { subject: "Vendor agreements — round 2", channel: "email" });
    const rows = await comms.list(firmId);
    expect(rows.map((t) => t.id)).toEqual([second.id, first.id]);
    expect(rows[1]!.messages).toHaveLength(2);

    // The bigserial seq really persisted the append order (int8 reads back
    // as a string and truncate keeps the sequence running — the trust
    // twin's rationale — so assert strict +1 steps, not absolute values).
    const seqs = (await handle.sql`select seq from thread_messages order by seq`)
      .map((r) => Number((r as { seq: string }).seq));
    expect(seqs).toEqual([seqs[0], seqs[0]! + 1]);
  });

  it("create links a live client and case; dangling links are 400s, unread is server-managed", async () => {
    const mailer = new CapturingMailer();
    const { auth, repos, comms } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    const client = await repos.contacts.create({
      firmId, type: "client", name: "Harish Chadha", company: null,
      email: "", phone: "", address: "", caseIds: [], notes: null,
    });
    const kase = await repos.cases.create({
      firmId, number: "2026-0001", title: "Chadha v. Meridian", clientId: client.id,
      practiceArea: "Commercial Litigation", stage: "trial", status: "open",
      openDate: "2026-01-12", courtDate: null, statute: null, leadAttorneyId: registered.user.id,
      description: "", billableRate: 300000, trustBalance: 0,
    });

    const linked = await comms.create(firmId, {
      subject: "Hearing logistics", clientId: client.id, caseId: kase.id,
    });
    expect(linked.clientId).toBe(client.id);
    expect(linked.caseId).toBe(kase.id);
    expect(linked.unread).toBe(false);

    await expect(
      comms.create(firmId, { clientId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toMatchObject({ statusCode: 400, message: THREAD_CLIENT_MISSING_MESSAGE });
    await expect(
      comms.create(firmId, { caseId: "00000000-0000-4000-8000-000000000042" }),
    ).rejects.toMatchObject({ statusCode: 400, message: THREAD_CASE_MISSING_MESSAGE });

    // The soft links really persisted as uuid FKs.
    const row = (await handle.sql`select client_id, case_id from threads where id = ${linked.id}`)[0] as {
      client_id: string; case_id: string;
    };
    expect(row.client_id).toBe(client.id);
    expect(row.case_id).toBe(kase.id);
  });

  it("sendMessage appends oldest-last with the session author; markRead flips unread; both 404 cross-firm", async () => {
    const mailer = new CapturingMailer();
    const { auth, comms } = build(mailer);
    const a = await firmWithOwner(auth, mailer, "owner@firm-a.example");
    const b = await firmWithOwner(auth, mailer, "owner@firm-b.example");

    const thread = await comms.create(a.registered.firm.id, {
      subject: "Possession letter received",
      messages: [{ from: "client", authorName: "Kavita Menon", body: "Another offer letter today." }],
    });

    const sent = await comms.sendMessage(
      a.registered.firm.id, a.session.user.name, thread.id, "Do not accept possession.",
    );
    expect(sent.messages.map((m) => [m.from, m.authorName, m.body])).toEqual([
      ["client", "Kavita Menon", "Another offer letter today."],
      ["firm", a.session.user.name, "Do not accept possession."],
    ]);
    // The reference touches neither unread nor anything else on append.
    expect(sent.unread).toBe(thread.unread);

    await comms.markRead(a.registered.firm.id, thread.id);
    const listed = await comms.list(a.registered.firm.id);
    expect(listed[0]!.unread).toBe(false);

    for (const op of [
      () => comms.sendMessage(b.registered.firm.id, b.session.user.name, thread.id, "Hijacked"),
      () => comms.markRead(b.registered.firm.id, thread.id),
      () => comms.markRead(a.registered.firm.id, "00000000-0000-4000-8000-000000000000"),
    ]) {
      await expect(op()).rejects.toMatchObject({ statusCode: 404, message: "Thread not found" });
    }
    // B's firm saw none of it — no message row leaked into their scope.
    expect(await comms.list(b.registered.firm.id)).toEqual([]);

    // The append really persisted and the thread's updated_at moved.
    const rows = await handle.sql`select body, "from" from thread_messages order by seq`;
    expect(rows.map((r) => (r as { body: string }).body)).toEqual([
      "Another offer letter today.", "Do not accept possession.",
    ]);
    const stamp = (await handle.sql`select created_at, updated_at from threads where id = ${thread.id}`)[0] as {
      created_at: Date | string; updated_at: Date | string;
    };
    expect(new Date(stamp.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(stamp.created_at).getTime());
  });

  it("validation is the service's: channel/sender vocabulary, backdated stamp shape, lengths", async () => {
    const mailer = new CapturingMailer();
    const { auth, comms } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    await expect(comms.create(firmId, { channel: "fax" })).rejects.toMatchObject({
      statusCode: 400, message: THREAD_CHANNEL_MESSAGE,
    });
    await expect(
      comms.create(firmId, { messages: [{ from: "vendor", body: "hi" }] }),
    ).rejects.toMatchObject({ statusCode: 400, message: THREAD_SENDER_MESSAGE });
    await expect(
      comms.create(firmId, { messages: [{ body: "hi", at: "not-a-timestamp" }] }),
    ).rejects.toMatchObject({ statusCode: 400, message: THREAD_MESSAGE_AT_MESSAGE });
    await expect(comms.create(firmId, { subject: "x".repeat(201) })).rejects.toMatchObject({
      statusCode: 400, message: "Subject is too long",
    });
    await expect(
      comms.create(firmId, { messages: [{ body: "x".repeat(4001) }] }),
    ).rejects.toMatchObject({ statusCode: 400, message: "Message is too long" });
    await expect(
      comms.create(firmId, { messages: Array(101).fill({ body: "hi" }) }),
    ).rejects.toMatchObject({ statusCode: 400, message: "Too many messages" });

    const created = await comms.create(firmId, {});
    expect(created).toMatchObject({ subject: "(no subject)", channel: "secure", unread: false });
    expect(created.messages).toEqual([]);
    expect((await comms.list(firmId)).map((t) => t.id)).toEqual([created.id]);
  });

  it("notifications: newest-first per firm, kind vocabulary enforced, mark-all-read flips only that firm's", async () => {
    const mailer = new CapturingMailer();
    const { auth, repos, comms } = build(mailer);
    const a = await firmWithOwner(auth, mailer, "owner@firm-a.example");
    const b = await firmWithOwner(auth, mailer, "owner@firm-b.example");

    const bell = new CommsService(repos);
    await bell.createNotification(a.registered.firm.id, { text: "Payment received", kind: "payment", at: new Date("2026-09-30T10:00:00.000Z") });
    await bell.createNotification(a.registered.firm.id, { text: "Older deadline", kind: "deadline", at: new Date("2026-09-29T10:00:00.000Z") });
    await bell.createNotification(b.registered.firm.id, { text: "B's own", kind: "info" });

    const listed = await comms.listNotifications(a.registered.firm.id);
    expect(listed.map((n) => [n.text, n.kind, n.read])).toEqual([
      ["Payment received", "payment", false],
      ["Older deadline", "deadline", false],
    ]);
    expect(listed[0]!.at).toBe("2026-09-30T10:00:00.000Z");
    expect(listed.every((n) => !("firmId" in n))).toBe(true);

    await expect(bell.createNotification(a.registered.firm.id, { text: "Bad", kind: "fax" }))
      .rejects.toMatchObject({ statusCode: 400, message: NOTIFICATION_KIND_MESSAGE });

    await comms.markNotificationsRead(a.registered.firm.id);
    expect((await comms.listNotifications(a.registered.firm.id)).every((n) => n.read)).toBe(true);
    expect((await comms.listNotifications(b.registered.firm.id)).every((n) => n.read)).toBe(false);

    // The read flags really persisted, and B's rows were untouched in the DB.
    const reads = await handle.sql`select firm_id, read from notifications order by firm_id`;
    expect(reads.map((r) => [(r as { firm_id: string }).firm_id, (r as { read: boolean }).read]))
      .toEqual([[a.registered.firm.id, true], [a.registered.firm.id, true], [b.registered.firm.id, false]]);
  });
});
