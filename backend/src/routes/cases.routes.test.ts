import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb } from "../db/client.js";
import type { AppConfig } from "../config.js";
import type { FastifyInstance } from "fastify";
import {
  BILLABLE_RATE_MESSAGE,
  CASE_ATTORNEY_MESSAGE,
  CASE_CLIENT_MESSAGE,
  CASE_CLIENT_MISSING_MESSAGE,
  CASE_DATE_MESSAGE,
  CASE_STAGE_MESSAGE,
  CASE_STATUS_MESSAGE,
} from "../services/cases/service.js";
import { CapturingMailer, inMemoryAuthRepositories } from "../services/auth/testing.js";

/**
 * Cases routes (ticket 10) — in-memory repos, contacts.routes.test.ts shape.
 * Behavior matrix, contract + reference backend (server.mjs) as north stars:
 *
 *   GET    /cases         200 array, newest first; ?status= exact match and
 *                         ?q= a case-insensitive substring over
 *                         `${number} ${title}` (the reference's semantics)
 *   POST   /cases         201 entity; server-assigned `YYYY-NNNN` number
 *                         (client-sent number ignored); reference defaults
 *                         (title "New matter", "General", intake, open,
 *                         openDate today, rate 300000 paise, trust 0)
 *   GET    /cases/:id     200 / 404 "Case not found"
 *   PATCH  /cases/:id     200 entity, only sent fields move / 404; the
 *                         contract defines no status-transition table, so
 *                         open/pending/closed move freely
 *   DELETE /cases/:id     204 / 404 — nothing blocks a delete (reference)
 *
 * Permissions: every firm member manages cases (practice data — no owner
 * gate). `number` and `trustBalance` are server-managed and cannot be moved
 * by create or patch. Cross-firm ids are 404s that leak nothing, and each
 * firm's number sequence is independent.
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

/** The UTC year the service stamps into new case numbers. */
const currentYear = () => new Date().toISOString().slice(0, 4);

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

/** Creates one client contact in the given firm; returns it. */
async function createContact(
  app: FastifyInstance,
  token: string,
  name: string,
): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: "POST", url: "/api/v1/contacts",
    headers: bearer(token),
    payload: { name, type: "client" },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as Record<string, unknown>;
}

/** Creates one case in the given firm with a full payload; returns it. */
async function createCase(
  app: FastifyInstance,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: "POST", url: "/api/v1/cases",
    headers: bearer(token),
    payload: {
      title: "Chadha v. Khanna — Property Partition Suit", practiceArea: "Civil Litigation",
      billableRate: 500000, description: "Partition of ancestral property at Green Park.",
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as Record<string, unknown>;
}

describe("cases (ticket 10)", () => {
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

  it("create → 201 contract shape, server-assigned YYYY-NNNN number (client-sent number ignored), newest first in the list", async () => {
    await setup();
    const client = await createContact(app, firmA.token, "Harish Chadha");
    const first = await createCase(app, firmA.token, {
      title: "Chadha v. Khanna — Property Partition Suit",
      clientId: client.id,
      // The client-sent number must be ignored: assignment is the server's.
      number: "9999-1234",
    });
    const second = await createCase(app, firmA.token, {
      title: "Sabharwal Traders v. Sanvar Textiles", practiceArea: "Cheque Bounce (s.138)",
      stage: "court date pending", status: "pending", courtDate: "2026-10-01",
      statute: "s.138 NI Act",
    });

    expect(first.number).toMatch(/^\d{4}-\d{4}$/);
    expect(first.number).toBe(`${currentYear()}-0001`);
    expect(first.number).not.toBe("9999-1234");
    expect(first).toMatchObject({
      title: "Chadha v. Khanna — Property Partition Suit",
      clientId: client.id,
      practiceArea: "Civil Litigation",
      stage: "intake",
      status: "open",
      openDate: new Date().toISOString().slice(0, 10),
      leadAttorneyId: firmA.userId, // the firm's first user, like the reference's db.users[0]
      billableRate: 500000,
      trustBalance: 0,
      description: "Partition of ancestral property at Green Park.",
    });
    // Contract shape only — bookkeeping and unset nullables stay absent.
    for (const key of ["firmId", "createdAt", "updatedAt", "deletedAt", "courtDate", "statute"]) {
      expect(first).not.toHaveProperty(key);
    }
    expect(second).toMatchObject({
      number: `${currentYear()}-0002`,
      stage: "court date pending", status: "pending",
      courtDate: "2026-10-01", statute: "s.138 NI Act",
    });

    const list = await app.inject({ method: "GET", url: "/api/v1/cases", headers: bearer(firmA.token) });
    expect(list.statusCode).toBe(200);
    const cases = list.json() as { id: string; number: string }[];
    expect(cases.map((c) => c.number)).toEqual([
      `${currentYear()}-0002`, `${currentYear()}-0001`,
    ]);
    expect(cases.every((c) => typeof c.id === "string" && c.id.length > 0)).toBe(true);
    await app.close();
  });

  it("create with an empty body lands on the reference defaults; server-managed fields cannot be forced", async () => {
    await setup();
    const res = await app.inject({
      method: "POST", url: "/api/v1/cases", headers: bearer(firmA.token), payload: {},
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      title: "New matter", clientId: "", practiceArea: "General",
      stage: "intake", status: "open",
      openDate: new Date().toISOString().slice(0, 10),
      leadAttorneyId: firmA.userId,
      description: "", billableRate: 300000, trustBalance: 0,
    });

    // Whole-entity save hardening: server-managed fields sent back by a UI
    // are stripped — the number is assigned, trust stays at 0, openDate is
    // today (create ignores it, exactly like the reference), and no firmId.
    const sneaky = await app.inject({
      method: "POST", url: "/api/v1/cases", headers: bearer(firmA.token),
      payload: {
        title: "Sneaky", id: "00000000-0000-4000-8000-000000000000",
        firmId: firmB.firmId, number: "9999-9999", trustBalance: 555,
        openDate: "1999-01-01",
      },
    });
    expect(sneaky.statusCode).toBe(201);
    const created = sneaky.json() as Record<string, unknown>;
    expect(created.id).not.toBe("00000000-0000-4000-8000-000000000000");
    expect(created.number).toBe(`${currentYear()}-0002`);
    expect(created.trustBalance).toBe(0);
    expect(created.openDate).toBe(new Date().toISOString().slice(0, 10));
    expect(created).not.toHaveProperty("firmId");
    await app.close();
  });

  it("get by id returns the entity; unknown, malformed, and foreign ids are not leaks", async () => {
    await setup();
    const kase = await createCase(app, firmA.token);

    const got = await app.inject({
      method: "GET", url: `/api/v1/cases/${kase.id}`, headers: bearer(firmA.token),
    });
    expect(got.statusCode).toBe(200);
    expect((got.json() as { id: string }).id).toBe(kase.id);

    const missing = await app.inject({
      method: "GET", url: "/api/v1/cases/00000000-0000-4000-8000-000000000000",
      headers: bearer(firmA.token),
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "Case not found" });

    const malformed = await app.inject({
      method: "GET", url: "/api/v1/cases/k1", headers: bearer(firmA.token),
    });
    expect(malformed.statusCode).toBe(400);
    await app.close();
  });

  it("patch updates only the sent fields; number, trustBalance and bookkeeping are immovable", async () => {
    await setup();
    const kase = await createCase(app, firmA.token);

    const patched = await app.inject({
      method: "PATCH", url: `/api/v1/cases/${kase.id}`,
      headers: bearer(firmA.token),
      payload: {
        title: "Renamed Matter", stage: "discovery", courtDate: "2026-11-15",
        statute: "Order XX CPC", billableRate: 450000,
      },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      id: kase.id, number: kase.number, title: "Renamed Matter", stage: "discovery",
      courtDate: "2026-11-15", statute: "Order XX CPC", billableRate: 450000,
      practiceArea: "Civil Litigation", status: "open",
    });

    // courtDate: null clears the optional field (the key disappears).
    const cleared = await app.inject({
      method: "PATCH", url: `/api/v1/cases/${kase.id}`,
      headers: bearer(firmA.token), payload: { courtDate: null, statute: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).not.toHaveProperty("courtDate");
    expect(cleared.json()).not.toHaveProperty("statute");

    // The server-managed fields cannot be moved by a patch either.
    const sneaky = await app.inject({
      method: "PATCH", url: `/api/v1/cases/${kase.id}`,
      headers: bearer(firmA.token),
      payload: {
        number: "9999-9999", trustBalance: 999,
        id: "00000000-0000-4000-8000-000000000000",
      },
    });
    expect(sneaky.statusCode).toBe(200);
    expect(sneaky.json()).toMatchObject({
      id: kase.id, number: kase.number, trustBalance: 0, title: "Renamed Matter",
    });
    await app.close();
  });

  it("status transitions per contract: the contract defines no transition table, so statuses move freely", async () => {
    await setup();
    const kase = await createCase(app, firmA.token);
    expect(kase.status).toBe("open");

    for (const status of ["pending", "closed", "open"]) {
      const res = await app.inject({
        method: "PATCH", url: `/api/v1/cases/${kase.id}`,
        headers: bearer(firmA.token), payload: { status },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { status: string }).status).toBe(status);
    }

    // Stages ride the same freedom (the mock's Object.assign semantics).
    for (const stage of ["discovery", "trial", "resolved", "intake"]) {
      const res = await app.inject({
        method: "PATCH", url: `/api/v1/cases/${kase.id}`,
        headers: bearer(firmA.token), payload: { stage },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { stage: string }).stage).toBe(stage);
    }
    await app.close();
  });

  it("filters: ?status= is an exact match and ?q= a case-insensitive substring over `number title`, like the reference", async () => {
    await setup();
    const open = await createCase(app, firmA.token, { title: "Property Partition Suit" });
    await createCase(app, firmA.token, {
      title: "Cheque Bounce Complaint", status: "pending",
    });
    const closed = await createCase(app, firmA.token, {
      title: "Consumer Complaint", status: "closed",
    });

    const list = async (query: string) => {
      const res = await app.inject({
        method: "GET", url: `/api/v1/cases${query}`, headers: bearer(firmA.token),
      });
      expect(res.statusCode).toBe(200);
      return (res.json() as { number: string }[]).map((c) => c.number);
    };

    expect(await list("")).toHaveLength(3);
    expect(await list("?status=open")).toEqual([open.number]);
    expect(await list("?status=pending")).toEqual([`${currentYear()}-0002`]);
    expect(await list("?status=archived")).toEqual([]);

    expect(await list("?q=partition")).toEqual([open.number]);
    expect(await list("?q=COMPLAINT")).toHaveLength(2);
    expect(await list(`?q=${open.number}`)).toEqual([open.number]);
    // The reference matches `${number} ${title}` — a query spanning the
    // boundary pins the space-joined concatenation.
    expect(await list(`?q=${encodeURIComponent(`${open.number} property`)}`)).toEqual([open.number]);
    // LIKE wildcard characters stay literal (the reference's .includes()).
    expect(await list(`?q=${encodeURIComponent("%")}`)).toEqual([]);
    expect(await list(`?q=${encodeURIComponent("zzz no match")}`)).toEqual([]);

    // The search never leaks the other firm's cases.
    await createCase(app, firmB.token, { title: "Property Partition Suit" });
    const listB = await app.inject({
      method: "GET", url: "/api/v1/cases?q=partition", headers: bearer(firmB.token),
    });
    expect((listB.json() as { number: string }[]).map((c) => c.number))
      .toEqual([`${currentYear()}-0001`]);
    expect(closed.number).toBe(`${currentYear()}-0003`);
    await app.close();
  });

  it("validation 400s carry the messages (vocabularies, client id, dates, rate, lengths) before anything is written", async () => {
    await setup();
    for (const [payload, message] of [
      [{ title: "Bad Status", status: "archived" }, CASE_STATUS_MESSAGE],
      [{ title: "Bad Stage", stage: "appeal" }, CASE_STAGE_MESSAGE],
      [{ title: "Bad Client", clientId: "c1" }, CASE_CLIENT_MESSAGE],
      [{
        title: "Unknown Client",
        clientId: "00000000-0000-4000-8000-00000000dead",
      }, CASE_CLIENT_MISSING_MESSAGE],
      [{ title: "Bad Attorney", leadAttorneyId: "u1" }, CASE_ATTORNEY_MESSAGE],
      [{ title: "Bad Date", courtDate: "31/12/2026" }, CASE_DATE_MESSAGE],
      [{ title: "Negative Rate", billableRate: -1 }, BILLABLE_RATE_MESSAGE],
      [{ title: "Fractional Rate", billableRate: 10.5 }, BILLABLE_RATE_MESSAGE],
      [{ title: "x".repeat(201) }, "Title is too long"],
      [{ description: "x".repeat(4001) }, "Description is too long"],
    ] as [Record<string, unknown>, string][]) {
      const res = await app.inject({
        method: "POST", url: "/api/v1/cases", headers: bearer(firmA.token), payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ error: message });
    }

    // Patch-side validation is the service's too.
    const kase = await createCase(app, firmA.token);
    const badPatch = await app.inject({
      method: "PATCH", url: `/api/v1/cases/${kase.id}`,
      headers: bearer(firmA.token), payload: { status: "archived" },
    });
    expect(badPatch.statusCode).toBe(400);
    expect(badPatch.json()).toEqual({ error: CASE_STATUS_MESSAGE });

    // The failed 400s consumed no numbers: the one good case is 0001.
    const list = await app.inject({ method: "GET", url: "/api/v1/cases", headers: bearer(firmA.token) });
    expect((list.json() as { number: string }[]).map((c) => c.number))
      .toEqual([`${currentYear()}-0001`]);
    await app.close();
  });

  it("member-writable: an invited attorney creates, patches, and deletes cases (unlike /users)", async () => {
    await setup();
    const member = await inviteAndOnboard(
      app, firmA, mailer, "Meera Iyer", "meera@firm-a.example", "attorney",
    );

    const created = await createCase(app, member.token, { title: "Member's Matter" });
    expect(created.title).toBe("Member's Matter");

    const patched = await app.inject({
      method: "PATCH", url: `/api/v1/cases/${created.id}`,
      headers: bearer(member.token), payload: { status: "pending" },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { status: string }).status).toBe("pending");

    const deleted = await app.inject({
      method: "DELETE", url: `/api/v1/cases/${created.id}`,
      headers: bearer(member.token),
    });
    expect(deleted.statusCode).toBe(204);
    await app.close();
  });

  it("cross-firm isolation: firm B cannot see, patch, or delete firm A's case; lists never leak; sequences are independent", async () => {
    await setup();
    const firstA = await createCase(app, firmA.token, { title: "A's First Matter" });
    await createCase(app, firmA.token, { title: "A's Second Matter" });
    const onlyB = await createCase(app, firmB.token, { title: "B's Own Matter" });

    // B's first case restarts the sequence: counters are per firm, not global.
    expect(onlyB.number).toBe(`${currentYear()}-0001`);
    expect(firstA.number).toBe(`${currentYear()}-0001`);

    const attempts: ["GET" | "PATCH" | "DELETE", Record<string, unknown> | undefined][] = [
      ["GET", undefined],
      ["PATCH", { title: "Hijacked" }],
      ["DELETE", undefined],
    ];
    for (const [method, payload] of attempts) {
      const res = await app.inject({
        method, url: `/api/v1/cases/${firstA.id}`,
        headers: bearer(firmB.token), ...(payload ? { payload } : {}),
      });
      expect(res.statusCode, method).toBe(404);
      expect(res.json()).toEqual({ error: "Case not found" });
    }

    const listA = await app.inject({ method: "GET", url: "/api/v1/cases", headers: bearer(firmA.token) });
    expect((listA.json() as { number: string }[]).map((c) => c.number)).toEqual([
      `${currentYear()}-0002`, `${currentYear()}-0001`,
    ]);
    const listB = await app.inject({ method: "GET", url: "/api/v1/cases", headers: bearer(firmB.token) });
    expect((listB.json() as { title: string }[]).map((c) => c.title)).toEqual(["B's Own Matter"]);
    await app.close();
  });

  it("rapid creates never collide on a number; a soft-deleted case's number is never reused", async () => {
    await setup();
    // Concurrent POSTs (the DB twin proves the atomicity on real Postgres).
    const created = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createCase(app, firmA.token, { title: `Matter ${i + 1}` }),
      ),
    );
    const numbers = created.map((c) => c.number as string);
    expect(new Set(numbers).size).toBe(5);
    expect([...numbers].sort()).toEqual(
      [1, 2, 3, 4, 5].map((n) => `${currentYear()}-${String(n).padStart(4, "0")}`),
    );

    // Deleting the first case frees nothing: the counter never walks back.
    const deleted = await app.inject({
      method: "DELETE", url: `/api/v1/cases/${created[0]!.id}`, headers: bearer(firmA.token),
    });
    expect(deleted.statusCode).toBe(204);
    const next = await createCase(app, firmA.token, { title: "Matter 6" });
    expect(next.number).toBe(`${currentYear()}-0006`);
    const list = await app.inject({ method: "GET", url: "/api/v1/cases", headers: bearer(firmA.token) });
    expect((list.json() as { number: string }[]).map((c) => c.number)).toEqual([
      `${currentYear()}-0006`,
      `${currentYear()}-0005`, `${currentYear()}-0004`,
      `${currentYear()}-0003`, `${currentYear()}-0002`,
    ]);
    await app.close();
  });

  it("delete → 204; the case then 404s, leaves the list, and a repeat delete 404s", async () => {
    await setup();
    const kase = await createCase(app, firmA.token);

    const deleted = await app.inject({
      method: "DELETE", url: `/api/v1/cases/${kase.id}`, headers: bearer(firmA.token),
    });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe("");

    const gone = await app.inject({
      method: "GET", url: `/api/v1/cases/${kase.id}`, headers: bearer(firmA.token),
    });
    expect(gone.statusCode).toBe(404);

    const list = await app.inject({ method: "GET", url: "/api/v1/cases", headers: bearer(firmA.token) });
    expect(list.json()).toEqual([]);

    const repeat = await app.inject({
      method: "DELETE", url: `/api/v1/cases/${kase.id}`, headers: bearer(firmA.token),
    });
    expect(repeat.statusCode).toBe(404);
    expect(repeat.json()).toEqual({ error: "Case not found" });
    await app.close();
  });

  it("cases need a session: anonymous reads and writes are 401", async () => {
    await setup();
    const probes: ["GET" | "POST", string][] = [
      ["GET", "/api/v1/cases"],
      ["POST", "/api/v1/cases"],
      ["GET", "/api/v1/cases/00000000-0000-4000-8000-000000000000"],
    ];
    for (const [method, url] of probes) {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Not signed in" });
    }
    await app.close();
  });

  it("without a database the cases surface answers the 503 envelope", async () => {
    app = await buildApp(testConfig);
    const signup = await app.inject({
      method: "POST", url: "/api/v1/auth/signup",
      payload: { firstName: "A", lastName: "B", email: "a@b.co", firmName: "F", zip: "", phone: "" },
    });
    expect(signup.statusCode).toBe(503);

    const res = await app.inject({ method: "GET", url: "/api/v1/cases" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/DATABASE_URL/);
    await app.close();
  });
});
