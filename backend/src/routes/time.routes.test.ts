import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb } from "../db/client.js";
import type { AppConfig } from "../config.js";
import type { FastifyInstance } from "fastify";
import {
  TIME_CASE_MESSAGE,
  TIME_CASE_MISSING_MESSAGE,
  TIME_DATE_MESSAGE,
  TIME_MINUTES_MESSAGE,
  TIME_RATE_MESSAGE,
  TIME_USER_MESSAGE,
} from "../services/time/service.js";
import {
  CapturingMailer,
  inMemoryAuthRepositories,
} from "../services/auth/testing.js";
import type { AuthRepositories } from "../services/auth/repository.js";
import { InMemoryTimeEntryRepository } from "../services/time/in-memory.js";

/**
 * Time-entries routes (ticket 12) — in-memory repos, cases.routes.test.ts
 * shape. Behavior matrix, contract + reference backend (server.mjs) as north
 * stars:
 *
 *   GET  /time-entries    200 array, newest first (the reference unshifts)
 *   POST /time-entries    201 entity; reference defaults (date today,
 *                         minutes 0, rate 300000 paise, description "",
 *                         billable true, invoiced false — server-stamped);
 *                         the REQUIRED caseId defaults to the firm's newest
 *                         live case (the reference's db.cases[0])
 *   PATCH /time-entries/:id  200 entity, only sent fields move / 404.
 *                         No timer route exists — the contract expresses
 *                         start/stop as the UI's local clock plus one POST
 *                         with the elapsed minutes (AppShell.toggleTimer),
 *                         so "create/stop" lands entirely on POST defaults
 *   DELETE /time-entries/:id  204 / 404
 *
 * The reference gates nothing on `invoiced` (Object.assign / filter), so
 * neither do we — but the flag itself is server-managed: never
 * client-writable, stamped false on create (the events.`source` treatment).
 * Permissions: every firm member logs time (practice data — no owner gate).
 * Cross-firm ids are 404s that leak nothing.
 */

const testConfig: AppConfig = {
  port: 0,
  corsOrigins: ["http://localhost:5173"],
  sessionSecret: "test-secret",
  databaseUrl: null,
  cookieSameSite: "lax",
  cookieSecure: false,
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

/** Creates one case in the given firm; returns it (entries bill cases). */
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

/** Creates one time entry in the given firm; returns it. */
async function createEntry(
  app: FastifyInstance,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: "POST", url: "/api/v1/time-entries",
    headers: bearer(token),
    payload: {
      date: "2026-10-01", minutes: 90, rate: 450000,
      description: "Drafted the written statement — Rawat writ",
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as Record<string, unknown>;
}

describe("time entries (ticket 12)", () => {
  let app: FastifyInstance;
  let mailer: CapturingMailer;
  let repos: AuthRepositories;
  let firmA: FirmContext;
  let firmB: FirmContext;

  afterEach(async () => {
    await app.close();
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

  it("create → 201 contract shape, reference defaults, required case link, newest first in the list", async () => {
    await setup();
    const kase = await createCase(app, firmA.token, "Chadha v. Khanna — Property Partition Suit");
    const first = await createEntry(app, firmA.token, { caseId: kase.id });
    const second = await createEntry(app, firmA.token, {
      description: "Client consult — Menon succession",
      minutes: 45,
    });

    expect(first).toEqual({
      id: first.id,
      userId: firmA.userId,
      caseId: kase.id,
      date: "2026-10-01",
      minutes: 90,
      rate: 450000,
      description: "Drafted the written statement — Rawat writ",
      billable: true,
      invoiced: false,
    });
    // Exact contract shape — bookkeeping never leaks (byte-shape parity with
    // the mock adapter's timeEntries).
    for (const key of ["firmId", "createdAt", "updatedAt", "deletedAt"]) {
      expect(first).not.toHaveProperty(key);
    }

    // Newest first — the reference unshifts.
    const list = await app.inject({
      method: "GET", url: "/api/v1/time-entries", headers: bearer(firmA.token),
    });
    expect(list.statusCode).toBe(200);
    const entries = list.json() as { id: string }[];
    expect(entries.map((e) => e.id)).toEqual([second.id, first.id]);
  });

  it("stopping the UI's timer is one POST with the elapsed minutes; omitted fields land on the reference defaults", async () => {
    await setup();
    const kase = await createCase(app, firmA.token, "Matter for the timer");
    // AppShell.toggleTimer's exact stop payload — no caseId, no rate, no user.
    const stopped = await app.inject({
      method: "POST", url: "/api/v1/time-entries", headers: bearer(firmA.token),
      payload: {
        minutes: 25, description: "Timer entry", billable: true,
        date: new Date().toISOString().slice(0, 10),
      },
    });
    expect(stopped.statusCode).toBe(201);
    expect(stopped.json()).toMatchObject({
      minutes: 25, description: "Timer entry", billable: true,
      date: new Date().toISOString().slice(0, 10),
      // Defaults: the firm's newest live case (the reference's db.cases[0]),
      // the firm's first user, ₹300/hr in paise, not invoiced.
      caseId: kase.id, userId: firmA.userId, rate: 300000, invoiced: false,
    });

    // An absent body lands on every reference default (minutes 0 included).
    const bare = await app.inject({
      method: "POST", url: "/api/v1/time-entries", headers: bearer(firmA.token), payload: {},
    });
    expect(bare.statusCode).toBe(201);
    expect(bare.json()).toMatchObject({
      minutes: 0, rate: 300000, description: "", billable: true, invoiced: false,
      date: new Date().toISOString().slice(0, 10),
    });

    // Whole-entity save hardening: server-managed fields sent back by a UI
    // are stripped — no id/firmId/invoiced control.
    const sneaky = await app.inject({
      method: "POST", url: "/api/v1/time-entries", headers: bearer(firmA.token),
      payload: {
        description: "Sneaky", invoiced: true,
        id: "00000000-0000-4000-8000-000000000000", firmId: firmB.firmId,
      },
    });
    expect(sneaky.statusCode).toBe(201);
    const created = sneaky.json() as Record<string, unknown>;
    expect(created.id).not.toBe("00000000-0000-4000-8000-000000000000");
    expect(created).not.toHaveProperty("firmId");
    expect(created.invoiced).toBe(false);
  });

  it("the required case link: defaults to the newest live case; unknown, foreign, soft-deleted and malformed ids are 400s", async () => {
    await setup();
    const older = await createCase(app, firmA.token, "Older Matter");
    const newest = await createCase(app, firmA.token, "Newest Matter");

    // Omitted → the firm's newest live case (the reference's db.cases[0]).
    const defaulted = await createEntry(app, firmA.token, {});
    expect(defaulted.caseId).toBe(newest.id);
    expect(defaulted.caseId).not.toBe(older.id);

    // null means "no case given" too (the mock's nullish default).
    const nulled = await createEntry(app, firmA.token, { caseId: null });
    expect(nulled.caseId).toBe(newest.id);

    // A firm with no live case at all has nothing to default to.
    const noCases = await app.inject({
      method: "POST", url: "/api/v1/time-entries", headers: bearer(firmB.token), payload: {},
    });
    expect(noCases.statusCode).toBe(400);
    expect(noCases.json()).toEqual({ error: TIME_CASE_MISSING_MESSAGE });

    // Unknown (well-formed), cross-firm, and soft-deleted cases are all
    // "Case not found"; a non-uuid is a shape 400.
    await createCase(app, firmB.token, "B's Own Matter");
    for (const [payload, message] of [
      [{ caseId: "00000000-0000-4000-8000-00000000dead" }, TIME_CASE_MISSING_MESSAGE],
      [{ caseId: (await createCase(app, firmB.token, "B Foreign")).id }, TIME_CASE_MISSING_MESSAGE],
      [{ caseId: "k1" }, TIME_CASE_MESSAGE],
    ] as [Record<string, unknown>, string][]) {
      const res = await app.inject({
        method: "POST", url: "/api/v1/time-entries", headers: bearer(firmA.token), payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ error: message });
    }

    const doomed = await createCase(app, firmA.token, "Doomed Matter");
    await app.inject({
      method: "DELETE", url: `/api/v1/cases/${doomed.id}`, headers: bearer(firmA.token),
    });
    const deletedCase = await app.inject({
      method: "POST", url: "/api/v1/time-entries", headers: bearer(firmA.token),
      payload: { caseId: doomed.id },
    });
    expect(deletedCase.statusCode).toBe(400);
    expect(deletedCase.json()).toEqual({ error: TIME_CASE_MISSING_MESSAGE });

    // Patch-side: re-pointing works, clearing ("", null) does not.
    const entry = await createEntry(app, firmA.token, { caseId: older.id });
    const relinked = await app.inject({
      method: "PATCH", url: `/api/v1/time-entries/${entry.id}`,
      headers: bearer(firmA.token), payload: { caseId: newest.id },
    });
    expect(relinked.statusCode).toBe(200);
    expect((relinked.json() as { caseId: string }).caseId).toBe(newest.id);

    for (const caseId of ["", null]) {
      const cleared = await app.inject({
        method: "PATCH", url: `/api/v1/time-entries/${entry.id}`,
        headers: bearer(firmA.token), payload: { caseId },
      });
      expect(cleared.statusCode).toBe(400);
      expect(cleared.json()).toEqual({ error: TIME_CASE_MESSAGE });
    }
  });

  it("patch updates only the sent fields; server-managed fields cannot be forced", async () => {
    await setup();
    const kase = await createCase(app, firmA.token, "Matter One");
    const entry = await createEntry(app, firmA.token, { caseId: kase.id });

    const patched = await app.inject({
      method: "PATCH", url: `/api/v1/time-entries/${entry.id}`,
      headers: bearer(firmA.token),
      payload: {
        minutes: 120, rate: 600000, description: "Revised scope",
        date: "2026-10-15", billable: false, userId: firmA.userId,
      },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      id: entry.id, minutes: 120, rate: 600000, description: "Revised scope",
      date: "2026-10-15", billable: false, caseId: kase.id,
    });

    // invoiced never moves from the client side; id/firmId stay put.
    const sneaky = await app.inject({
      method: "PATCH", url: `/api/v1/time-entries/${entry.id}`,
      headers: bearer(firmA.token),
      payload: {
        invoiced: true, id: "00000000-0000-4000-8000-000000000000",
      },
    });
    expect(sneaky.statusCode).toBe(200);
    expect((sneaky.json() as { invoiced: boolean }).invoiced).toBe(false);
    expect((sneaky.json() as { id: string }).id).toBe(entry.id);
  });

  it("invoiced entries are still patchable and deletable (the reference gates nothing); the flag itself stays server-managed", async () => {
    await setup();
    await createCase(app, firmA.token, "Matter One");
    const entry = await createEntry(app, firmA.token, {});
    // Simulate ticket 13's invoice flow marking the entry through the seam
    // (the only writer of `invoiced`), then confirm CRUD still flows.
    const store = (repos.timeEntries as InMemoryTimeEntryRepository).timeEntries;
    const row = store.find((r) => r.id === entry.id)!;
    row.invoiced = true;

    const patched = await app.inject({
      method: "PATCH", url: `/api/v1/time-entries/${entry.id}`,
      headers: bearer(firmA.token), payload: { minutes: 30 },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { invoiced: boolean }).invoiced).toBe(true);
    expect((patched.json() as { minutes: number }).minutes).toBe(30);

    const deleted = await app.inject({
      method: "DELETE", url: `/api/v1/time-entries/${entry.id}`, headers: bearer(firmA.token),
    });
    expect(deleted.statusCode).toBe(204);
  });

  it("validation 400s carry the messages (numbers, dates, case and user shapes, lengths) before anything is written", async () => {
    await setup();
    await createCase(app, firmA.token, "Matter One");
    for (const [payload, message] of [
      [{ minutes: -5 }, TIME_MINUTES_MESSAGE],
      [{ minutes: 1.5 }, TIME_MINUTES_MESSAGE],
      [{ rate: -1 }, TIME_RATE_MESSAGE],
      [{ rate: 99.5 }, TIME_RATE_MESSAGE],
      [{ date: "31/12/2026" }, TIME_DATE_MESSAGE],
      [{ caseId: "k1" }, TIME_CASE_MESSAGE],
      [{ userId: "u1" }, TIME_USER_MESSAGE],
      [{ description: "x".repeat(4001) }, "Description is too long"],
    ] as [Record<string, unknown>, string][]) {
      const res = await app.inject({
        method: "POST", url: "/api/v1/time-entries", headers: bearer(firmA.token), payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ error: message });
    }

    // Patch-side validation is the service's too.
    const entry = await createEntry(app, firmA.token, {});
    const badPatch = await app.inject({
      method: "PATCH", url: `/api/v1/time-entries/${entry.id}`,
      headers: bearer(firmA.token), payload: { minutes: 1.5 },
    });
    expect(badPatch.statusCode).toBe(400);
    expect(badPatch.json()).toEqual({ error: TIME_MINUTES_MESSAGE });
  });

  it("member-writable: an invited paralegal logs, patches, and deletes time (unlike /users)", async () => {
    await setup();
    await createCase(app, firmA.token, "Matter One");
    const member = await inviteAndOnboard(
      app, firmA, mailer, "Sanjay Rao", "sanjay@firm-a.example", "paralegal",
    );

    const created = await createEntry(app, member.token, { description: "Member's work" });
    expect(created.description).toBe("Member's work");

    const patched = await app.inject({
      method: "PATCH", url: `/api/v1/time-entries/${created.id}`,
      headers: bearer(member.token), payload: { minutes: 15 },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { minutes: number }).minutes).toBe(15);

    const deleted = await app.inject({
      method: "DELETE", url: `/api/v1/time-entries/${created.id}`,
      headers: bearer(member.token),
    });
    expect(deleted.statusCode).toBe(204);
  });

  it("cross-firm isolation: firm B cannot patch or delete firm A's entry; lists never leak", async () => {
    await setup();
    await createCase(app, firmA.token, "A's Matter");
    await createCase(app, firmB.token, "B's Matter");
    const entryA = await createEntry(app, firmA.token, { description: "A's work" });
    const entryB = await createEntry(app, firmB.token, { description: "B's work" });

    const attempts: ["PATCH" | "DELETE", Record<string, unknown> | undefined][] = [
      ["PATCH", { description: "Hijacked" }],
      ["DELETE", undefined],
    ];
    for (const [method, payload] of attempts) {
      const res = await app.inject({
        method, url: `/api/v1/time-entries/${entryA.id}`,
        headers: bearer(firmB.token), ...(payload ? { payload } : {}),
      });
      expect(res.statusCode, method).toBe(404);
      expect(res.json()).toEqual({ error: "Time entry not found" });
    }

    const listA = await app.inject({
      method: "GET", url: "/api/v1/time-entries", headers: bearer(firmA.token),
    });
    expect((listA.json() as { description: string }[]).map((e) => e.description))
      .toEqual(["A's work"]);
    const listB = await app.inject({
      method: "GET", url: "/api/v1/time-entries", headers: bearer(firmB.token),
    });
    expect((listB.json() as { description: string }[]).map((e) => e.description))
      .toEqual(["B's work"]);
    expect(entryB).toBeTruthy();
  });

  it("delete → 204; the entry then leaves the list, and a repeat delete 404s", async () => {
    await setup();
    await createCase(app, firmA.token, "Matter One");
    const entry = await createEntry(app, firmA.token, {});

    const deleted = await app.inject({
      method: "DELETE", url: `/api/v1/time-entries/${entry.id}`, headers: bearer(firmA.token),
    });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe("");

    const list = await app.inject({
      method: "GET", url: "/api/v1/time-entries", headers: bearer(firmA.token),
    });
    expect(list.json()).toEqual([]);

    const repeat = await app.inject({
      method: "DELETE", url: `/api/v1/time-entries/${entry.id}`, headers: bearer(firmA.token),
    });
    expect(repeat.statusCode).toBe(404);
    expect(repeat.json()).toEqual({ error: "Time entry not found" });

    const malformed = await app.inject({
      method: "PATCH", url: "/api/v1/time-entries/t1", headers: bearer(firmA.token), payload: {},
    });
    expect(malformed.statusCode).toBe(400);
  });

  it("time entries need a session: anonymous reads and writes are 401", async () => {
    await setup();
    const probes: ["GET" | "POST" | "PATCH" | "DELETE", string][] = [
      ["GET", "/api/v1/time-entries"],
      ["POST", "/api/v1/time-entries"],
      ["PATCH", "/api/v1/time-entries/00000000-0000-4000-8000-000000000000"],
      ["DELETE", "/api/v1/time-entries/00000000-0000-4000-8000-000000000000"],
    ];
    for (const [method, url] of probes) {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Not signed in" });
    }
  });

  it("without a database the time-entries surface answers the 503 envelope", async () => {
    app = await buildApp(testConfig);
    const res = await app.inject({ method: "GET", url: "/api/v1/time-entries" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/DATABASE_URL/);
  });
});

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
