import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb } from "../db/client.js";
import type { AppConfig } from "../config.js";
import type { FastifyInstance } from "fastify";
import {
  EVENT_ATTENDEE_MESSAGE,
  EVENT_CASE_MESSAGE,
  EVENT_CASE_MISSING_MESSAGE,
  EVENT_DATE_MESSAGE,
  EVENT_END_TIME_MESSAGE,
  EVENT_START_TIME_MESSAGE,
  EVENT_TYPE_MESSAGE,
} from "../services/events/service.js";
import { CapturingMailer, inMemoryAuthRepositories } from "../services/auth/testing.js";

/**
 * Events routes (ticket 11) — in-memory repos, cases.routes.test.ts shape.
 * Behavior matrix, contract + reference backend (server.mjs) as north stars:
 *
 *   GET  /events          200 array, insertion order (the reference PUSHes,
 *                        unlike contacts/cases); ?from=/?to= an inclusive
 *                        ISO-day range, both bounds optional
 *   POST /events          201 entity; reference defaults (title "New event",
 *                        date today, start "09:00", end "10:00", type
 *                        "meeting", color "#4B4ACF", attendeeIds [])
 *   PATCH /events/:id     200 entity, only sent fields move / 404
 *   DELETE /events/:id    204 / 404
 *
 * No GET /events/:id — the contract's only event read is the list.
 * The V2 cause-list seam (`source`, column default 'manual') is never in the
 * API shape and never client-settable. Permissions: every firm member manages
 * the calendar (practice data — no owner gate). Cross-firm ids are 404s that
 * leak nothing.
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

/** Creates one case in the given firm; returns it (events link to cases). */
async function createCase(
  app: FastifyInstance,
  token: string,
  title: string,
): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: "POST", url: "/api/v1/cases",
    headers: bearer(token),
    payload: { title },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as Record<string, unknown>;
}

/** Creates one event in the given firm; returns it. */
async function createEvent(
  app: FastifyInstance,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: "POST", url: "/api/v1/events",
    headers: bearer(token),
    payload: {
      title: "Hearing — Rawat writ, Court 5", date: "2026-10-01",
      start: "10:30", end: "11:30", location: "Delhi High Court",
      type: "court", color: "#4B4ACF",
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as Record<string, unknown>;
}

describe("events (ticket 11)", () => {
  let app: FastifyInstance;
  let mailer: CapturingMailer;
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
    app = await buildApp(testConfig, { sampleSeeding: false,
      repositories: inMemoryAuthRepositories(),
      mailer,
    });
    firmA = await signupFirm(app, mailer, "owner@firm-a.example", "Aditi");
    firmB = await signupFirm(app, mailer, "owner@firm-b.example", "Bharat");
  }

  it("create → 201 contract shape, reference defaults, case links, insertion order in the list", async () => {
    await setup();
    const kase = await createCase(app, firmA.token, "Chadha v. Khanna — Property Partition Suit");
    const first = await createEvent(app, firmA.token, {
      caseId: kase.id, attendeeIds: [firmA.userId],
    });
    const second = await createEvent(app, firmA.token, {
      title: "Deposition of Prem Lal — partition suit", date: "2026-10-02",
      start: "10:30", end: "13:00", location: "Saket District Court",
      attendeeIds: [], type: "court",
    });

    expect(first).toMatchObject({
      title: "Hearing — Rawat writ, Court 5", date: "2026-10-01",
      start: "10:30", end: "11:30", location: "Delhi High Court",
      caseId: kase.id, attendeeIds: [firmA.userId], type: "court", color: "#4B4ACF",
    });
    // Contract shape only — bookkeeping, the V2 source seam, and unset
    // nullables stay absent (byte-shape parity with the mock's events).
    for (const key of ["firmId", "createdAt", "updatedAt", "deletedAt", "source", "allDay", "reminders"]) {
      expect(first).not.toHaveProperty(key);
    }
    expect(typeof first.id).toBe("string");

    // The second event carries no case link: the key disappears entirely.
    expect(second).not.toHaveProperty("caseId");
    expect(second.caseId).toBeUndefined();

    // Insertion order, oldest first — the reference PUSHes (unlike
    // contacts/cases, which unshift).
    const list = await app.inject({ method: "GET", url: "/api/v1/events", headers: bearer(firmA.token) });
    expect(list.statusCode).toBe(200);
    const events = list.json() as { id: string; title: string }[];
    expect(events.map((e) => e.title)).toEqual([
      "Hearing — Rawat writ, Court 5", "Deposition of Prem Lal — partition suit",
    ]);
    await app.close();
  });

  it("create with an empty body lands on the reference defaults; server-managed fields cannot be forced", async () => {
    await setup();
    const res = await app.inject({
      method: "POST", url: "/api/v1/events", headers: bearer(firmA.token), payload: {},
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      title: "New event", date: new Date().toISOString().slice(0, 10),
      start: "09:00", end: "10:00", attendeeIds: [], type: "meeting", color: "#4B4ACF",
    });
    expect(res.json()).not.toHaveProperty("location");

    // Whole-entity save hardening: the V2 source seam and bookkeeping are
    // stripped — source stays the server's 'manual', never the client's.
    const sneaky = await app.inject({
      method: "POST", url: "/api/v1/events", headers: bearer(firmA.token),
      payload: {
        title: "Sneaky", id: "00000000-0000-4000-8000-000000000000",
        firmId: firmB.firmId, source: "cause_list", createdAt: "1999-01-01",
      },
    });
    expect(sneaky.statusCode).toBe(201);
    const created = sneaky.json() as Record<string, unknown>;
    expect(created.id).not.toBe("00000000-0000-4000-8000-000000000000");
    expect(created).not.toHaveProperty("firmId");
    expect(created).not.toHaveProperty("source");
    expect(created).not.toHaveProperty("createdAt");
    await app.close();
  });

  it("list-by-range: ?from=/?to= is the reference's inclusive day range, both bounds optional", async () => {
    await setup();
    await createEvent(app, firmA.token, { title: "Day minus one", date: "2026-09-30" });
    const inRange = await createEvent(app, firmA.token, { title: "Day zero", date: "2026-10-01" });
    const alsoInRange = await createEvent(app, firmA.token, { title: "Day five", date: "2026-10-05" });
    await createEvent(app, firmA.token, { title: "Day six", date: "2026-10-06" });

    const titles = async (query: string) => {
      const res = await app.inject({
        method: "GET", url: `/api/v1/events${query}`, headers: bearer(firmA.token),
      });
      expect(res.statusCode).toBe(200);
      return (res.json() as { title: string }[]).map((e) => e.title);
    };

    // No bounds → everything.
    expect(await titles("")).toHaveLength(4);
    // Inclusive on BOTH ends — the contract's "range is ISO dates, inclusive".
    expect(await titles("?from=2026-10-01&to=2026-10-05")).toEqual(["Day zero", "Day five"]);
    expect(await titles("?from=2026-10-01")).toEqual(["Day zero", "Day five", "Day six"]);
    expect(await titles("?to=2026-09-30")).toEqual(["Day minus one"]);
    expect(await titles("?from=2026-10-02&to=2026-10-04")).toEqual([]);
    // Malformed bounds are 400s before they can reach a SQL date cast.
    const bad = await app.inject({
      method: "GET", url: "/api/v1/events?from=31/12/2026", headers: bearer(firmA.token),
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: EVENT_DATE_MESSAGE });
    expect(inRange && alsoInRange).toBeTruthy();
    await app.close();
  });

  it("patch updates only the sent fields; allDay/reminders can be set and cleared; case links move", async () => {
    await setup();
    const kase = await createCase(app, firmA.token, "Matter One");
    const other = await createCase(app, firmA.token, "Matter Two");
    const event = await createEvent(app, firmA.token, { caseId: kase.id });

    const patched = await app.inject({
      method: "PATCH", url: `/api/v1/events/${event.id}`,
      headers: bearer(firmA.token),
      payload: {
        title: "Rescheduled hearing", date: "2026-10-09", start: "14:00", end: "15:00",
        allDay: false, reminders: ["1h", "15m"], caseId: other.id,
      },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      id: event.id, title: "Rescheduled hearing", date: "2026-10-09",
      start: "14:00", end: "15:00", allDay: false, reminders: ["1h", "15m"],
      caseId: other.id, location: "Delhi High Court", type: "court",
    });

    // null clears the optional fields — the keys disappear (cases.courtDate pattern).
    const cleared = await app.inject({
      method: "PATCH", url: `/api/v1/events/${event.id}`,
      headers: bearer(firmA.token), payload: { location: null, reminders: null, allDay: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).not.toHaveProperty("location");
    expect(cleared.json()).not.toHaveProperty("reminders");
    expect(cleared.json()).not.toHaveProperty("allDay");

    // "" also clears the case link (the cases.clientId treatment).
    const unlinked = await app.inject({
      method: "PATCH", url: `/api/v1/events/${event.id}`,
      headers: bearer(firmA.token), payload: { caseId: "" },
    });
    expect(unlinked.statusCode).toBe(200);
    expect(unlinked.json()).not.toHaveProperty("caseId");
    await app.close();
  });

  it("validation 400s carry the messages (type vocabulary, dates, times, case links, attendees, lengths)", async () => {
    await setup();
    for (const [payload, message] of [
      [{ title: "Bad Type", type: "hearing" }, EVENT_TYPE_MESSAGE],
      [{ title: "Bad Date", date: "31/12/2026" }, EVENT_DATE_MESSAGE],
      [{ title: "Bad Start", start: "9am" }, EVENT_START_TIME_MESSAGE],
      [{ title: "Bad End", end: "25:00" }, EVENT_END_TIME_MESSAGE],
      [{ title: "Bad Case", caseId: "k1" }, EVENT_CASE_MESSAGE],
      [{
        title: "Unknown Case",
        caseId: "00000000-0000-4000-8000-00000000dead",
      }, EVENT_CASE_MISSING_MESSAGE],
      [{ title: "Bad Attendee", attendeeIds: ["u1"] }, EVENT_ATTENDEE_MESSAGE],
      [{ title: "Too Many Attendees", attendeeIds: Array(101).fill(firmA.userId) }, "Too many attendees"],
      [{ title: "x".repeat(201) }, "Title is too long"],
      [{ title: "Long Location", location: "x".repeat(501) }, "Location is too long"],
      [{ title: "Long Color", color: "x".repeat(21) }, "Color is too long"],
      [{ title: "Long Reminder", reminders: ["x".repeat(41)] }, "Reminder is too long"],
    ] as [Record<string, unknown>, string][]) {
      const res = await app.inject({
        method: "POST", url: "/api/v1/events", headers: bearer(firmA.token), payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ error: message });
    }

    // Patch-side validation is the service's too.
    const event = await createEvent(app, firmA.token);
    const badPatch = await app.inject({
      method: "PATCH", url: `/api/v1/events/${event.id}`,
      headers: bearer(firmA.token), payload: { type: "hearing" },
    });
    expect(badPatch.statusCode).toBe(400);
    expect(badPatch.json()).toEqual({ error: EVENT_TYPE_MESSAGE });

    // A soft-deleted case is not a linkable case either.
    const kase = await createCase(app, firmA.token, "Doomed Matter");
    await app.inject({
      method: "DELETE", url: `/api/v1/cases/${kase.id}`, headers: bearer(firmA.token),
    });
    const deletedCase = await app.inject({
      method: "POST", url: "/api/v1/events", headers: bearer(firmA.token),
      payload: { title: "Orphan", caseId: kase.id },
    });
    expect(deletedCase.statusCode).toBe(400);
    expect(deletedCase.json()).toEqual({ error: EVENT_CASE_MISSING_MESSAGE });
    await app.close();
  });

  it("member-writable: an invited attorney creates, patches, and deletes events (unlike /users)", async () => {
    await setup();
    const member = await inviteAndOnboard(
      app, firmA, mailer, "Meera Iyer", "meera@firm-a.example", "attorney",
    );

    const created = await createEvent(app, member.token, { title: "Member's Hearing" });
    expect(created.title).toBe("Member's Hearing");

    const patched = await app.inject({
      method: "PATCH", url: `/api/v1/events/${created.id}`,
      headers: bearer(member.token), payload: { start: "16:00" },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { start: string }).start).toBe("16:00");

    const deleted = await app.inject({
      method: "DELETE", url: `/api/v1/events/${created.id}`,
      headers: bearer(member.token),
    });
    expect(deleted.statusCode).toBe(204);
    await app.close();
  });

  it("cross-firm isolation: firm B cannot patch or delete firm A's event; lists and ranges never leak", async () => {
    await setup();
    const eventA = await createEvent(app, firmA.token, { title: "A's Hearing", date: "2026-10-01" });
    await createEvent(app, firmB.token, { title: "B's Hearing", date: "2026-10-02" });

    const attempts: ["PATCH" | "DELETE", Record<string, unknown> | undefined][] = [
      ["PATCH", { title: "Hijacked" }],
      ["DELETE", undefined],
    ];
    for (const [method, payload] of attempts) {
      const res = await app.inject({
        method, url: `/api/v1/events/${eventA.id}`,
        headers: bearer(firmB.token), ...(payload ? { payload } : {}),
      });
      expect(res.statusCode, method).toBe(404);
      expect(res.json()).toEqual({ error: "Event not found" });
    }

    // Overlapping ranges never cross the boundary either.
    const listA = await app.inject({
      method: "GET", url: "/api/v1/events?from=2026-10-01&to=2026-10-02", headers: bearer(firmA.token),
    });
    expect((listA.json() as { title: string }[]).map((e) => e.title)).toEqual(["A's Hearing"]);
    const listB = await app.inject({
      method: "GET", url: "/api/v1/events?from=2026-10-01&to=2026-10-02", headers: bearer(firmB.token),
    });
    expect((listB.json() as { title: string }[]).map((e) => e.title)).toEqual(["B's Hearing"]);
    await app.close();
  });

  it("delete → 204; the event then leaves the list, and a repeat delete 404s", async () => {
    await setup();
    const event = await createEvent(app, firmA.token);

    const deleted = await app.inject({
      method: "DELETE", url: `/api/v1/events/${event.id}`, headers: bearer(firmA.token),
    });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe("");

    const list = await app.inject({ method: "GET", url: "/api/v1/events", headers: bearer(firmA.token) });
    expect(list.json()).toEqual([]);

    const repeat = await app.inject({
      method: "DELETE", url: `/api/v1/events/${event.id}`, headers: bearer(firmA.token),
    });
    expect(repeat.statusCode).toBe(404);
    expect(repeat.json()).toEqual({ error: "Event not found" });

    const malformed = await app.inject({
      method: "PATCH", url: "/api/v1/events/e1", headers: bearer(firmA.token), payload: {},
    });
    expect(malformed.statusCode).toBe(400);
    await app.close();
  });

  it("events need a session: anonymous reads and writes are 401", async () => {
    await setup();
    const probes: ["GET" | "POST" | "PATCH" | "DELETE", string][] = [
      ["GET", "/api/v1/events"],
      ["POST", "/api/v1/events"],
      ["PATCH", "/api/v1/events/00000000-0000-4000-8000-000000000000"],
      ["DELETE", "/api/v1/events/00000000-0000-4000-8000-000000000000"],
    ];
    for (const [method, url] of probes) {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Not signed in" });
    }
    await app.close();
  });

  it("without a database the events surface answers the 503 envelope", async () => {
    app = await buildApp(testConfig);
    const signup = await app.inject({
      method: "POST", url: "/api/v1/auth/signup",
      payload: { firstName: "A", lastName: "B", email: "a@b.co", firmName: "F", zip: "", phone: "" },
    });
    expect(signup.statusCode).toBe(503);

    const res = await app.inject({ method: "GET", url: "/api/v1/events" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/DATABASE_URL/);
    await app.close();
  });
});
