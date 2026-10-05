import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb } from "../db/client.js";
import type { AppConfig } from "../config.js";
import type { FastifyInstance } from "fastify";
import { CapturingMailer, inMemoryAuthRepositories } from "../services/auth/testing.js";
import type { AuthRepositories } from "../services/auth/repository.js";
import {
  THREAD_CASE_MISSING_MESSAGE,
  THREAD_CHANNEL_MESSAGE,
  THREAD_CLIENT_MISSING_MESSAGE,
  THREAD_MESSAGE_AT_MESSAGE,
  THREAD_SENDER_MESSAGE,
} from "../services/comms/service.js";

/**
 * Comms routes (ticket 20) — in-memory repos, isolation.test.ts shape.
 * Behavior matrix, contract + reference backend (server.mjs) as north stars:
 *
 *   GET  /threads                 200 array, newest first (the reference
 *                                 unshifts), messages embedded oldest last
 *   POST /threads                 201 entity; reference defaults (subject
 *                                 "(no subject)", channel "secure", unread
 *                                 false — server-managed); messages import
 *   POST /threads/:id/messages    200 WHOLE thread, appended entry
 *                                 from:"firm" authored by the session user
 *   POST /threads/:id/read        204; unread → false / 404 "Thread not found"
 *   GET  /notifications           200 array, newest first
 *   POST /notifications/read      204; every row of the firm flips read
 *   GET  /reports                 200 static catalog (routes/reports test)
 *
 * Permissions: every firm member manages communications (practice data — no
 * owner gate, unlike /users; the contract and the reference gate nothing).
 * Cross-firm ids are 404s that leak nothing. The bell starts empty — the
 * reference generates no notifications at runtime (its three rows are seed
 * data), so the only write surface is mark-all-read.
 */

const testConfig: AppConfig = {
  port: 0,
  corsOrigins: ["http://localhost:5173"],
  sessionSecret: "test-secret",
  databaseUrl: null,
  cookieSameSite: "lax",
  cookieSecure: false,
  email: { from: "Lawleit <test@lawleit.example>", resendApiKey: null, baseUrl: "http://localhost:5173" },
  gatewayEncryptionKey: null,
};

interface FirmContext {
  token: string;
  userId: string;
  firmId: string;
  email: string;
}

interface MemberContext {
  token: string;
  userId: string;
  email: string;
}

/** Registers one firm with a working password; returns its session context. */
async function signupFirm(
  app: FastifyInstance,
  mailer: CapturingMailer,
  email: string,
  ownerName: string,
): Promise<FirmContext> {
  const signup = await app.inject({
    method: "POST", url: "/api/v1/auth/signup",
    payload: {
      firstName: ownerName, lastName: "& Partners", email,
      firmName: `Firm of ${ownerName}`, zip: "110001", employees: 3, phone: "",
    },
  });
  expect(signup.statusCode).toBe(201);
  const created = signup.json() as { user: { id: string }; firm: { id: string } };

  await app.inject({ method: "POST", url: "/api/v1/auth/password-reset", payload: { email } });
  await app.inject({
    method: "POST", url: "/api/v1/auth/password-reset/consume",
    payload: { token: mailer.sends[mailer.sends.length - 1]!.token, password: "password-123" },
  });
  const login = await app.inject({
    method: "POST", url: "/api/v1/auth/login", payload: { email, password: "password-123" },
  });
  expect(login.statusCode).toBe(200);
  return {
    token: (login.json() as { token: string }).token,
    userId: created.user.id,
    firmId: created.firm.id,
    email,
  };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** Owner invites a user, then the invitee sets a password and logs in. */
async function inviteAndOnboard(
  app: FastifyInstance,
  owner: FirmContext,
  mailer: CapturingMailer,
  name: string,
  email: string,
  role: string,
): Promise<MemberContext> {
  const created = await app.inject({
    method: "POST", url: "/api/v1/users",
    headers: bearer(owner.token),
    payload: { name, email, role },
  });
  expect(created.statusCode).toBe(201);
  const userId = (created.json() as { id: string }).id;

  const invite = mailer.invites[mailer.invites.length - 1]!;
  const consume = await app.inject({
    method: "POST", url: "/api/v1/auth/password-reset/consume",
    payload: { token: invite.token, password: "member-pass-123" },
  });
  expect(consume.statusCode).toBe(204);
  const login = await app.inject({
    method: "POST", url: "/api/v1/auth/login", payload: { email, password: "member-pass-123" },
  });
  expect(login.statusCode).toBe(200);
  return { token: (login.json() as { token: string }).token, userId, email };
}

/** Creates one thread in the given firm; returns it. */
async function createThread(
  app: FastifyInstance,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: "POST", url: "/api/v1/threads",
    headers: bearer(token),
    payload: {
      subject: "Final arguments date confirmed", channel: "secure",
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as Record<string, unknown>;
}

describe("comms (ticket 20)", () => {
  let app: FastifyInstance;
  let mailer: CapturingMailer;
  let repos: AuthRepositories;
  let firmA: FirmContext;
  let firmB: FirmContext;

  afterEach(async () => {
    await closeDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  // Two firms share one repo set on one app — same as two tenants on one API.
  async function setup(): Promise<void> {
    mailer = new CapturingMailer();
    repos = inMemoryAuthRepositories();
    app = await buildApp(testConfig, { repositories: repos, mailer });
    firmA = await signupFirm(app, mailer, "owner@firm-a.example", "Aditi");
    firmB = await signupFirm(app, mailer, "owner@firm-b.example", "Bharat");
  }

  it("create → 201 contract shape with the reference defaults; unread is server-managed; list is newest first", async () => {
    await setup();
    const first = await createThread(app, firmA.token, {
      subject: "Final arguments date confirmed",
      messages: [
        { from: "client", authorName: "Harish Chadha", body: "Is the 9th confirmed?", at: "2026-09-30T09:12:00.000Z" },
        { from: "firm", authorName: "Arjun Kaul", body: "Yes — 10:00 AM." },
      ],
    });
    // Contract shape: MessageThread fields only — firmId and bookkeeping stay put.
    expect(first).toMatchObject({
      subject: "Final arguments date confirmed", clientId: "", channel: "secure", unread: false,
    });
    expect(first).not.toHaveProperty("firmId");
    expect((first.messages as Record<string, unknown>[]).map((m) => m.authorName))
      .toEqual(["Harish Chadha", "Arjun Kaul"]);
    expect((first.messages as Record<string, unknown>[])[0]).toEqual({
      id: expect.any(String), from: "client", authorName: "Harish Chadha",
      body: "Is the 9th confirmed?", at: "2026-09-30T09:12:00.000Z",
    });

    // Whole-entity save hardening: a client-sent unread and id are stripped.
    const sneaky = await createThread(app, firmA.token, {
      subject: "Sneaky", unread: true, id: "00000000-0000-4000-8000-000000000000", firmId: firmB.firmId,
    });
    expect(sneaky).toMatchObject({ subject: "Sneaky", unread: false });
    expect(sneaky.id).not.toBe("00000000-0000-4000-8000-000000000000");

    const second = await createThread(app, firmA.token, { subject: "Vendor agreements — round 2" });
    const list = await app.inject({ method: "GET", url: "/api/v1/threads", headers: bearer(firmA.token) });
    expect(list.statusCode).toBe(200);
    const threads = list.json() as { id: string; subject: string }[];
    // Newest first: Vendor agreements, then the sneaky create, then the first.
    expect(threads.map((t) => t.subject)).toEqual([
      "Vendor agreements — round 2", "Sneaky", "Final arguments date confirmed",
    ]);
    expect(threads[2]!.id).toBe(first.id);
    void second;
    await app.close();
  });

  it("create with an empty body lands on the reference defaults; the UI's compose payload round-trips", async () => {
    await setup();
    const res = await app.inject({
      method: "POST", url: "/api/v1/threads", headers: bearer(firmA.token),
      payload: { subject: "", clientId: "", channel: "email", messages: [] },
    });
    expect(res.statusCode).toBe(201);
    // The reference defaults subject "(no subject)" for an absent one; the UI
    // sends its own fallback, so "" only arises from API callers — the
    // reference would store it verbatim, and so do we (free-form strings).
    expect(res.json()).toMatchObject({ subject: "", clientId: "", channel: "email", unread: false, messages: [] });

    const bare = await app.inject({
      method: "POST", url: "/api/v1/threads", headers: bearer(firmA.token), payload: {},
    });
    expect(bare.statusCode).toBe(201);
    expect(bare.json()).toMatchObject({ subject: "(no subject)", channel: "secure", clientId: "" });
    expect(bare.json()).not.toHaveProperty("caseId");
    await app.close();
  });

  it("client and case links are validated: uuid shape then live in-firm existence (400s, never a dangling FK)", async () => {
    await setup();
    const contact = await app.inject({
      method: "POST", url: "/api/v1/contacts", headers: bearer(firmA.token),
      payload: { name: "Harish Chadha", type: "client" },
    });
    const clientId = (contact.json() as { id: string }).id;
    const kase = await app.inject({
      method: "POST", url: "/api/v1/cases", headers: bearer(firmA.token),
      payload: { title: "Chadha v. Meridian", clientId },
    });
    expect(kase.statusCode).toBe(201);
    const caseId = (kase.json() as { id: string }).id;

    const linked = await createThread(app, firmA.token, { clientId, caseId });
    expect(linked.clientId).toBe(clientId);
    expect(linked.caseId).toBe(caseId);

    const dangling = await app.inject({
      method: "POST", url: "/api/v1/threads", headers: bearer(firmA.token),
      payload: { clientId: "00000000-0000-4000-8000-000000000000" },
    });
    expect(dangling.statusCode).toBe(400);
    expect(dangling.json()).toEqual({ error: THREAD_CLIENT_MISSING_MESSAGE });

    const danglingCase = await app.inject({
      method: "POST", url: "/api/v1/threads", headers: bearer(firmA.token),
      payload: { caseId: "00000000-0000-4000-8000-000000000099" },
    });
    expect(danglingCase.statusCode).toBe(400);
    expect(danglingCase.json()).toEqual({ error: THREAD_CASE_MISSING_MESSAGE });

    const malformed = await app.inject({
      method: "POST", url: "/api/v1/threads", headers: bearer(firmA.token),
      payload: { clientId: "k1" },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toEqual({ error: "Invalid client id" });
    await app.close();
  });

  it("sendMessage appends oldest-last with the session user as author and returns the WHOLE thread (200)", async () => {
    await setup();
    const thread = await createThread(app, firmA.token, {
      messages: [{ from: "client", authorName: "Harish Chadha", body: "Is the 9th confirmed?" }],
    });
    const threadId = thread.id as string;

    const sent = await app.inject({
      method: "POST", url: `/api/v1/threads/${threadId}/messages`,
      headers: bearer(firmA.token), payload: { body: "Yes — Saket District Court at 10:00 AM." },
    });
    expect(sent.statusCode).toBe(200);
    const updated = sent.json() as {
      id: string; messages: { from: string; authorName: string; body: string; at: string }[];
    };
    expect(updated.id).toBe(threadId);
    expect(updated.messages.map((m) => [m.from, m.authorName, m.body])).toEqual([
      ["client", "Harish Chadha", "Is the 9th confirmed?"],
      // The reference hard-codes from:"firm" and uses ctx.session.user.name.
      ["firm", "Aditi & Partners", "Yes — Saket District Court at 10:00 AM."],
    ]);
    expect(updated.messages[1]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The reference touches neither unread nor the links on append.
    expect(updated).toMatchObject({ subject: thread.subject, unread: thread.unread, clientId: thread.clientId });

    // The list now carries the appended entry as the preview (last message).
    const list = await app.inject({ method: "GET", url: "/api/v1/threads", headers: bearer(firmA.token) });
    const listed = (list.json() as { id: string; messages: { body: string }[] }[]).find((t) => t.id === threadId);
    expect(listed!.messages.at(-1)!.body).toBe("Yes — Saket District Court at 10:00 AM.");

    // An absent body appends the reference's "" entry.
    const empty = await app.inject({
      method: "POST", url: `/api/v1/threads/${threadId}/messages`, headers: bearer(firmA.token),
    });
    expect(empty.statusCode).toBe(200);
    expect(((empty.json() as { messages: { body: string }[] }).messages.at(-1))!.body).toBe("");
    await app.close();
  });

  it("markThreadRead → 204, unread flips in the list; repeat marks and unknown ids behave", async () => {
    await setup();
    const thread = await createThread(app, firmA.token);

    const marked = await app.inject({
      method: "POST", url: `/api/v1/threads/${thread.id}/read`, headers: bearer(firmA.token),
    });
    expect(marked.statusCode).toBe(204);
    expect(marked.body).toBe("");

    const list = await app.inject({ method: "GET", url: "/api/v1/threads", headers: bearer(firmA.token) });
    expect((list.json() as { unread: boolean }[])[0]!.unread).toBe(false);

    const repeat = await app.inject({
      method: "POST", url: `/api/v1/threads/${thread.id}/read`, headers: bearer(firmA.token),
    });
    expect(repeat.statusCode).toBe(204);

    const missing = await app.inject({
      method: "POST", url: "/api/v1/threads/00000000-0000-4000-8000-000000000000/read",
      headers: bearer(firmA.token),
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "Thread not found" });

    const malformed = await app.inject({
      method: "POST", url: "/api/v1/threads/not-a-uuid/read", headers: bearer(firmA.token),
    });
    expect(malformed.statusCode).toBe(400);
    await app.close();
  });

  it("validation 400s carry the contract-style messages (channel/sender vocabulary, stamp shape, lengths)", async () => {
    await setup();
    const cases: [Record<string, unknown>, string][] = [
      [{ channel: "fax" }, THREAD_CHANNEL_MESSAGE],
      [{ messages: [{ from: "vendor", body: "hi" }] }, THREAD_SENDER_MESSAGE],
      [{ messages: [{ body: "hi", at: "not-a-timestamp" }] }, THREAD_MESSAGE_AT_MESSAGE],
      [{ subject: "x".repeat(201) }, "Subject is too long"],
      [{ messages: [{ body: "x".repeat(4001) }] }, "Message is too long"],
      [{ messages: Array(101).fill({ body: "hi" }) }, "Too many messages"],
    ];
    for (const [payload, message] of cases) {
      const res = await app.inject({
        method: "POST", url: "/api/v1/threads", headers: bearer(firmA.token), payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ error: message });
    }
    // A send with an over-long body 400s too — and appends nothing.
    const thread = await createThread(app, firmA.token);
    const long = await app.inject({
      method: "POST", url: `/api/v1/threads/${thread.id}/messages`,
      headers: bearer(firmA.token), payload: { body: "x".repeat(4001) },
    });
    expect(long.statusCode).toBe(400);
    expect(long.json()).toEqual({ error: "Message is too long" });
    const list = await app.inject({ method: "GET", url: "/api/v1/threads", headers: bearer(firmA.token) });
    expect(((list.json() as { messages: unknown[] }[])[0])!.messages).toEqual([]);
    await app.close();
  });

  it("every firm member manages communications — invited attorney creates, sends, and reads", async () => {
    await setup();
    const member = await inviteAndOnboard(
      app, firmA, mailer, "Meera Iyer", "meera@firm-a.example", "attorney",
    );

    const created = await createThread(app, member.token, { subject: "Member's thread" });
    expect(created.subject).toBe("Member's thread");

    const sent = await app.inject({
      method: "POST", url: `/api/v1/threads/${created.id}/messages`,
      headers: bearer(member.token), payload: { body: "From the attorney" },
    });
    expect(sent.statusCode).toBe(200);
    expect((sent.json() as { messages: { authorName: string }[] }).messages.at(-1)!.authorName)
      .toBe("Meera Iyer");

    const read = await app.inject({
      method: "POST", url: `/api/v1/threads/${created.id}/read`, headers: bearer(member.token),
    });
    expect(read.statusCode).toBe(204);
    await app.close();
  });

  it("cross-firm isolation: firm B cannot see, send to, or read-mark firm A's thread; lists never leak", async () => {
    await setup();
    const threadA = await createThread(app, firmA.token, {
      subject: "A's private thread",
      messages: [{ from: "client", authorName: "Harish", body: "A's business" }],
    });

    for (const [method, url, payload] of [
      ["GET", `/api/v1/threads`, undefined],
      ["POST", `/api/v1/threads/${threadA.id}/messages`, { body: "Hijacked" }],
      ["POST", `/api/v1/threads/${threadA.id}/read`, undefined],
    ] as ["GET" | "POST", string, Record<string, unknown> | undefined][]) {
      const res = await app.inject({
        method, url, headers: bearer(firmB.token), ...(payload ? { payload } : {}),
      });
      if (method === "GET") {
        expect(res.json()).toEqual([]);
      } else {
        expect(res.statusCode, method).toBe(404);
        expect(res.json()).toEqual({ error: "Thread not found" });
      }
    }

    // B's list shows only B's own threads — A's never leaks.
    await createThread(app, firmB.token, { subject: "B's own" });
    const listB = await app.inject({ method: "GET", url: "/api/v1/threads", headers: bearer(firmB.token) });
    expect((listB.json() as { subject: string }[]).map((t) => t.subject)).toEqual(["B's own"]);

    // A's thread is untouched by all of it.
    const listA = await app.inject({ method: "GET", url: "/api/v1/threads", headers: bearer(firmA.token) });
    const listedA = listA.json() as { id: string; messages: { body: string }[] }[];
    expect(listedA.map((t) => t.id)).toEqual([threadA.id]);
    expect(listedA[0]!.messages).toHaveLength(1);
    await app.close();
  });

  it("notifications: the bell starts empty, mark-read 204s an empty firm too, seeded rows flip only their firm's", async () => {
    await setup();

    const emptyList = await app.inject({
      method: "GET", url: "/api/v1/notifications", headers: bearer(firmA.token),
    });
    expect(emptyList.statusCode).toBe(200);
    expect(emptyList.json()).toEqual([]);

    const emptyMark = await app.inject({
      method: "POST", url: "/api/v1/notifications/read", headers: bearer(firmA.token),
    });
    expect(emptyMark.statusCode).toBe(204);

    // Seed both firms' bells through the repo seam (no V1 route generates rows).
    await repos.notifications.create({
      firmId: firmA.firmId, text: "Payment of ₹5,000 received", kind: "payment",
      read: false, at: new Date("2026-09-30T10:00:00.000Z"),
    });
    await repos.notifications.create({
      firmId: firmA.firmId, text: "Deposition tomorrow", kind: "deadline",
      read: false, at: new Date("2026-09-29T10:00:00.000Z"),
    });
    await repos.notifications.create({
      firmId: firmB.firmId, text: "B's own", kind: "info", read: false, at: new Date("2026-09-28T10:00:00.000Z"),
    });

    const list = await app.inject({
      method: "GET", url: "/api/v1/notifications", headers: bearer(firmA.token),
    });
    const notifications = list.json() as Record<string, unknown>[];
    expect(notifications.map((n) => [n.text, n.kind, n.read])).toEqual([
      ["Payment of ₹5,000 received", "payment", false],
      ["Deposition tomorrow", "deadline", false],
    ]);
    // Contract shape: Notification fields only.
    expect(notifications[0]).toEqual({
      id: expect.any(String), text: "Payment of ₹5,000 received",
      at: "2026-09-30T10:00:00.000Z", read: false, kind: "payment",
    });

    const marked = await app.inject({
      method: "POST", url: "/api/v1/notifications/read", headers: bearer(firmA.token),
    });
    expect(marked.statusCode).toBe(204);
    const after = await app.inject({
      method: "GET", url: "/api/v1/notifications", headers: bearer(firmA.token),
    });
    expect((after.json() as { read: boolean }[]).every((n) => n.read)).toBe(true);
    // B's bell was untouched.
    const listB = await app.inject({
      method: "GET", url: "/api/v1/notifications", headers: bearer(firmB.token),
    });
    expect((listB.json() as { read: boolean }[]).every((n) => !n.read)).toBe(true);
    await app.close();
  });

  it("threads and notifications need a session: anonymous reads and writes are 401", async () => {
    await setup();
    const probes: ["GET" | "POST", string][] = [
      ["GET", "/api/v1/threads"],
      ["POST", "/api/v1/threads"],
      ["POST", "/api/v1/threads/00000000-0000-4000-8000-000000000000/messages"],
      ["POST", "/api/v1/threads/00000000-0000-4000-8000-000000000000/read"],
      ["GET", "/api/v1/notifications"],
      ["POST", "/api/v1/notifications/read"],
      ["GET", "/api/v1/reports"],
    ];
    for (const [method, url] of probes) {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Not signed in" });
    }
    await app.close();
  });

  it("without a database the comms and reports surfaces answer the 503 envelope", async () => {
    app = await buildApp(testConfig);
    const res = await app.inject({ method: "GET", url: "/api/v1/threads" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/DATABASE_URL/);

    const reports = await app.inject({ method: "GET", url: "/api/v1/reports" });
    expect(reports.statusCode).toBe(503);
    expect(reports.json().error).toMatch(/DATABASE_URL/);
    await app.close();
  });
});
