import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb } from "../db/client.js";
import type { AppConfig } from "../config.js";
import type { FastifyInstance } from "fastify";
import {
  EXPENSE_AMOUNT_MESSAGE,
  EXPENSE_CASE_MESSAGE,
  EXPENSE_CASE_MISSING_MESSAGE,
  EXPENSE_CATEGORY_MESSAGE,
  EXPENSE_DATE_MESSAGE,
} from "../services/expenses/service.js";
import {
  CapturingMailer,
  inMemoryAuthRepositories,
} from "../services/auth/testing.js";
import type { AuthRepositories } from "../services/auth/repository.js";
import { InMemoryExpenseRepository } from "../services/expenses/in-memory.js";

/**
 * Expenses routes (ticket 12) — in-memory repos, time.routes.test.ts shape.
 * Behavior matrix, contract + reference backend (server.mjs) as north stars:
 *
 *   GET  /expenses       200 array, newest first (the reference unshifts)
 *   POST /expenses       201 entity; reference defaults (date today,
 *                        description "", amount 0, billable true,
 *                        category "other", invoiced false — server-stamped);
 *                        the REQUIRED caseId defaults to the firm's newest
 *                        live case (the reference's db.cases[0])
 *   PATCH /expenses/:id  200 entity, only sent fields move / 404
 *   DELETE /expenses/:id 204 / 404
 *
 * `amount` is integer paise stored verbatim — the client owns the rupee
 * conversion (rupeesToPaise), the reference computes nothing server-side,
 * and the smoke's round-trip (55 in → 55 out) pins the same. The reference
 * gates nothing on `invoiced`, so neither do we — but the flag itself is
 * server-managed: never client-writable, stamped false on create (the
 * events.`source` treatment). Permissions: every firm member manages
 * expenses (practice data — no owner gate). Cross-firm ids are 404s that
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

/** Creates one case in the given firm; returns it (expenses bill cases). */
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

/** Creates one expense in the given firm; returns it. */
async function createExpense(
  app: FastifyInstance,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: "POST", url: "/api/v1/expenses",
    headers: bearer(token),
    payload: {
      date: "2026-10-01", description: "Court filing fee — Rawat writ",
      amount: 250000, category: "filing",
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as Record<string, unknown>;
}

describe("expenses (ticket 12)", () => {
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
    const first = await createExpense(app, firmA.token, { caseId: kase.id });
    const second = await createExpense(app, firmA.token, {
      description: "Expert witness advance — Menon succession",
      amount: 1500000, category: "expert",
    });

    expect(first).toEqual({
      id: first.id,
      caseId: kase.id,
      date: "2026-10-01",
      description: "Court filing fee — Rawat writ",
      amount: 250000,
      billable: true,
      invoiced: false,
      category: "filing",
    });
    // Exact contract shape — bookkeeping never leaks (byte-shape parity with
    // the mock adapter's expenses).
    for (const key of ["firmId", "userId", "createdAt", "updatedAt", "deletedAt"]) {
      expect(first).not.toHaveProperty(key);
    }

    // Newest first — the reference unshifts.
    const list = await app.inject({
      method: "GET", url: "/api/v1/expenses", headers: bearer(firmA.token),
    });
    expect(list.statusCode).toBe(200);
    const expenses = list.json() as { id: string }[];
    expect(expenses.map((e) => e.id)).toEqual([second.id, first.id]);
  });

  it("an absent body lands on the reference defaults; server-managed fields cannot be forced", async () => {
    await setup();
    const kase = await createCase(app, firmA.token, "Matter One");
    const bare = await app.inject({
      method: "POST", url: "/api/v1/expenses", headers: bearer(firmA.token), payload: {},
    });
    expect(bare.statusCode).toBe(201);
    expect(bare.json()).toMatchObject({
      caseId: kase.id,
      date: new Date().toISOString().slice(0, 10),
      description: "", amount: 0, billable: true, category: "other", invoiced: false,
    });

    // Whole-entity save hardening: server-managed fields sent back by a UI
    // are stripped — no id/firmId/invoiced control.
    const sneaky = await app.inject({
      method: "POST", url: "/api/v1/expenses", headers: bearer(firmA.token),
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
    const defaulted = await createExpense(app, firmA.token, {});
    expect(defaulted.caseId).toBe(newest.id);
    expect(defaulted.caseId).not.toBe(older.id);

    // A firm with no live case at all has nothing to default to.
    const noCases = await app.inject({
      method: "POST", url: "/api/v1/expenses", headers: bearer(firmB.token), payload: {},
    });
    expect(noCases.statusCode).toBe(400);
    expect(noCases.json()).toEqual({ error: EXPENSE_CASE_MISSING_MESSAGE });

    await createCase(app, firmB.token, "B's Own Matter");
    for (const [payload, message] of [
      [{ caseId: "00000000-0000-4000-8000-00000000dead" }, EXPENSE_CASE_MISSING_MESSAGE],
      [{ caseId: (await createCase(app, firmB.token, "B Foreign")).id }, EXPENSE_CASE_MISSING_MESSAGE],
      [{ caseId: "k1" }, EXPENSE_CASE_MESSAGE],
    ] as [Record<string, unknown>, string][]) {
      const res = await app.inject({
        method: "POST", url: "/api/v1/expenses", headers: bearer(firmA.token), payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ error: message });
    }

    const doomed = await createCase(app, firmA.token, "Doomed Matter");
    await app.inject({
      method: "DELETE", url: `/api/v1/cases/${doomed.id}`, headers: bearer(firmA.token),
    });
    const deletedCase = await app.inject({
      method: "POST", url: "/api/v1/expenses", headers: bearer(firmA.token),
      payload: { caseId: doomed.id },
    });
    expect(deletedCase.statusCode).toBe(400);
    expect(deletedCase.json()).toEqual({ error: EXPENSE_CASE_MISSING_MESSAGE });

    // Patch-side: re-pointing works, clearing ("", null) does not.
    const expense = await createExpense(app, firmA.token, { caseId: older.id });
    const relinked = await app.inject({
      method: "PATCH", url: `/api/v1/expenses/${expense.id}`,
      headers: bearer(firmA.token), payload: { caseId: newest.id },
    });
    expect(relinked.statusCode).toBe(200);
    expect((relinked.json() as { caseId: string }).caseId).toBe(newest.id);

    for (const caseId of ["", null]) {
      const cleared = await app.inject({
        method: "PATCH", url: `/api/v1/expenses/${expense.id}`,
        headers: bearer(firmA.token), payload: { caseId },
      });
      expect(cleared.statusCode).toBe(400);
      expect(cleared.json()).toEqual({ error: EXPENSE_CASE_MESSAGE });
    }
  });

  it("patch updates only the sent fields; server-managed fields cannot be forced", async () => {
    await setup();
    const kase = await createCase(app, firmA.token, "Matter One");
    const expense = await createExpense(app, firmA.token, { caseId: kase.id });

    const patched = await app.inject({
      method: "PATCH", url: `/api/v1/expenses/${expense.id}`,
      headers: bearer(firmA.token),
      payload: {
        amount: 99000, description: "Revised court fee",
        date: "2026-10-15", billable: false, category: "copies",
      },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      id: expense.id, amount: 99000, description: "Revised court fee",
      date: "2026-10-15", billable: false, category: "copies", caseId: kase.id,
    });

    // invoiced never moves from the client side; id stays put.
    const sneaky = await app.inject({
      method: "PATCH", url: `/api/v1/expenses/${expense.id}`,
      headers: bearer(firmA.token),
      payload: { invoiced: true, id: "00000000-0000-4000-8000-000000000000" },
    });
    expect(sneaky.statusCode).toBe(200);
    expect((sneaky.json() as { invoiced: boolean }).invoiced).toBe(false);
    expect((sneaky.json() as { id: string }).id).toBe(expense.id);
  });

  it("invoiced expenses are still patchable and deletable (the reference gates nothing); the flag itself stays server-managed", async () => {
    await setup();
    await createCase(app, firmA.token, "Matter One");
    const expense = await createExpense(app, firmA.token, {});
    // Simulate ticket 13's invoice flow marking the expense through the seam
    // (the only writer of `invoiced`), then confirm CRUD still flows.
    const store = (repos.expenses as InMemoryExpenseRepository).expenses;
    const row = store.find((r) => r.id === expense.id)!;
    row.invoiced = true;

    const patched = await app.inject({
      method: "PATCH", url: `/api/v1/expenses/${expense.id}`,
      headers: bearer(firmA.token), payload: { amount: 100 },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { invoiced: boolean }).invoiced).toBe(true);
    expect((patched.json() as { amount: number }).amount).toBe(100);

    const deleted = await app.inject({
      method: "DELETE", url: `/api/v1/expenses/${expense.id}`, headers: bearer(firmA.token),
    });
    expect(deleted.statusCode).toBe(204);
  });

  it("validation 400s carry the messages (amounts, dates, categories, case shapes, lengths) before anything is written", async () => {
    await setup();
    await createCase(app, firmA.token, "Matter One");
    for (const [payload, message] of [
      [{ amount: -1 }, EXPENSE_AMOUNT_MESSAGE],
      [{ amount: 10.5 }, EXPENSE_AMOUNT_MESSAGE],
      [{ date: "31/12/2026" }, EXPENSE_DATE_MESSAGE],
      [{ category: "hardware" }, EXPENSE_CATEGORY_MESSAGE],
      [{ caseId: "k1" }, EXPENSE_CASE_MESSAGE],
      [{ description: "x".repeat(4001) }, "Description is too long"],
    ] as [Record<string, unknown>, string][]) {
      const res = await app.inject({
        method: "POST", url: "/api/v1/expenses", headers: bearer(firmA.token), payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ error: message });
    }

    // Patch-side validation is the service's too.
    const expense = await createExpense(app, firmA.token, {});
    const badPatch = await app.inject({
      method: "PATCH", url: `/api/v1/expenses/${expense.id}`,
      headers: bearer(firmA.token), payload: { category: "hardware" },
    });
    expect(badPatch.statusCode).toBe(400);
    expect(badPatch.json()).toEqual({ error: EXPENSE_CATEGORY_MESSAGE });
  });

  it("member-writable: an invited paralegal creates, patches, and deletes expenses (unlike /users)", async () => {
    await setup();
    await createCase(app, firmA.token, "Matter One");
    const member = await inviteAndOnboard(
      app, firmA, mailer, "Sanjay Rao", "sanjay@firm-a.example", "paralegal",
    );

    const created = await createExpense(app, member.token, { description: "Member's expense" });
    expect(created.description).toBe("Member's expense");

    const patched = await app.inject({
      method: "PATCH", url: `/api/v1/expenses/${created.id}`,
      headers: bearer(member.token), payload: { amount: 500 },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { amount: number }).amount).toBe(500);

    const deleted = await app.inject({
      method: "DELETE", url: `/api/v1/expenses/${created.id}`,
      headers: bearer(member.token),
    });
    expect(deleted.statusCode).toBe(204);
  });

  it("cross-firm isolation: firm B cannot patch or delete firm A's expense; lists never leak", async () => {
    await setup();
    await createCase(app, firmA.token, "A's Matter");
    await createCase(app, firmB.token, "B's Matter");
    const expenseA = await createExpense(app, firmA.token, { description: "A's expense" });
    const expenseB = await createExpense(app, firmB.token, { description: "B's expense" });

    const attempts: ["PATCH" | "DELETE", Record<string, unknown> | undefined][] = [
      ["PATCH", { description: "Hijacked" }],
      ["DELETE", undefined],
    ];
    for (const [method, payload] of attempts) {
      const res = await app.inject({
        method, url: `/api/v1/expenses/${expenseA.id}`,
        headers: bearer(firmB.token), ...(payload ? { payload } : {}),
      });
      expect(res.statusCode, method).toBe(404);
      expect(res.json()).toEqual({ error: "Expense not found" });
    }

    const listA = await app.inject({
      method: "GET", url: "/api/v1/expenses", headers: bearer(firmA.token),
    });
    expect((listA.json() as { description: string }[]).map((e) => e.description))
      .toEqual(["A's expense"]);
    const listB = await app.inject({
      method: "GET", url: "/api/v1/expenses", headers: bearer(firmB.token),
    });
    expect((listB.json() as { description: string }[]).map((e) => e.description))
      .toEqual(["B's expense"]);
    expect(expenseB).toBeTruthy();
  });

  it("delete → 204; the expense then leaves the list, and a repeat delete 404s", async () => {
    await setup();
    await createCase(app, firmA.token, "Matter One");
    const expense = await createExpense(app, firmA.token, {});

    const deleted = await app.inject({
      method: "DELETE", url: `/api/v1/expenses/${expense.id}`, headers: bearer(firmA.token),
    });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe("");

    const list = await app.inject({
      method: "GET", url: "/api/v1/expenses", headers: bearer(firmA.token),
    });
    expect(list.json()).toEqual([]);

    const repeat = await app.inject({
      method: "DELETE", url: `/api/v1/expenses/${expense.id}`, headers: bearer(firmA.token),
    });
    expect(repeat.statusCode).toBe(404);
    expect(repeat.json()).toEqual({ error: "Expense not found" });

    const malformed = await app.inject({
      method: "PATCH", url: "/api/v1/expenses/x1", headers: bearer(firmA.token), payload: {},
    });
    expect(malformed.statusCode).toBe(400);
  });

  it("expenses need a session: anonymous reads and writes are 401", async () => {
    await setup();
    const probes: ["GET" | "POST" | "PATCH" | "DELETE", string][] = [
      ["GET", "/api/v1/expenses"],
      ["POST", "/api/v1/expenses"],
      ["PATCH", "/api/v1/expenses/00000000-0000-4000-8000-000000000000"],
      ["DELETE", "/api/v1/expenses/00000000-0000-4000-8000-000000000000"],
    ];
    for (const [method, url] of probes) {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Not signed in" });
    }
  });

  it("without a database the expenses surface answers the 503 envelope", async () => {
    app = await buildApp(testConfig);
    const res = await app.inject({ method: "GET", url: "/api/v1/expenses" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/DATABASE_URL/);
  });
});
