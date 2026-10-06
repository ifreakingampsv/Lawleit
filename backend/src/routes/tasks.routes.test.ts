import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb } from "../db/client.js";
import type { AppConfig } from "../config.js";
import type { FastifyInstance } from "fastify";
import {
  TASK_ASSIGNEE_MESSAGE,
  TASK_CASE_MESSAGE,
  TASK_CASE_MISSING_MESSAGE,
  TASK_DUE_DATE_MESSAGE,
  TASK_PRIORITY_MESSAGE,
  TASK_STATUS_MESSAGE,
} from "../services/tasks/service.js";
import { CapturingMailer, inMemoryAuthRepositories } from "../services/auth/testing.js";

/**
 * Tasks routes (ticket 11) — in-memory repos, cases.routes.test.ts shape.
 * Behavior matrix, contract + reference backend (server.mjs) as north stars:
 *
 *   GET  /tasks          200 array, newest first (the reference unshifts)
 *   POST /tasks          201 entity; reference defaults (title "New task",
 *                        dueDate today, priority "medium", status "todo",
 *                        assignee = the firm's first user)
 *   PATCH /tasks/:id     200 entity, only sent fields move / 404.
 *                        Completion IS a status patch — the contract's Task
 *                        has no completedAt field and defines no enforced
 *                        transition table, so todo/in_progress/blocked/done
 *                        move freely (the mock's Object.assign semantics)
 *   DELETE /tasks/:id    204 / 404
 *
 * No GET /tasks/:id — the contract's only task read is the list.
 * Permissions: every firm member manages tasks (practice data — no owner
 * gate). Cross-firm ids are 404s that leak nothing.
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

/** Creates one case in the given firm; returns it (tasks link to cases). */
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

/** Creates one task in the given firm; returns it. */
async function createTask(
  app: FastifyInstance,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: "POST", url: "/api/v1/tasks",
    headers: bearer(token),
    payload: {
      title: "Serve defence witness summons — partition suit",
      dueDate: "2026-10-01", priority: "high", status: "in_progress",
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as Record<string, unknown>;
}

describe("tasks (ticket 11)", () => {
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

  it("create → 201 contract shape, reference defaults, case links, newest first in the list", async () => {
    await setup();
    const kase = await createCase(app, firmA.token, "Chadha v. Khanna — Property Partition Suit");
    const first = await createTask(app, firmA.token, {
      caseId: kase.id, assigneeId: firmA.userId,
      description: "Prem Lal and the 2009 settlement record.",
    });
    const second = await createTask(app, firmA.token, {
      title: "File written submissions — Rawat writ",
      dueDate: "2026-10-02", priority: "high", status: "in_progress",
    });

    expect(first).toMatchObject({
      title: "Serve defence witness summons — partition suit",
      dueDate: "2026-10-01", priority: "high", status: "in_progress",
      caseId: kase.id, assigneeId: firmA.userId,
      description: "Prem Lal and the 2009 settlement record.",
      createdAt: new Date().toISOString().slice(0, 10),
    });
    // Contract shape only — bookkeeping and unset nullables stay absent
    // (byte-shape parity with the mock's tasks).
    for (const key of ["firmId", "updatedAt", "deletedAt"]) {
      expect(first).not.toHaveProperty(key);
    }
    expect(typeof first.id).toBe("string");

    // No case link and no description: the keys disappear entirely.
    expect(second).not.toHaveProperty("caseId");
    expect(second).not.toHaveProperty("description");

    // Newest first — the reference unshifts (unlike events, which push).
    const list = await app.inject({ method: "GET", url: "/api/v1/tasks", headers: bearer(firmA.token) });
    expect(list.statusCode).toBe(200);
    const tasks = list.json() as { id: string; title: string }[];
    expect(tasks.map((t) => t.title)).toEqual([
      "File written submissions — Rawat writ",
      "Serve defence witness summons — partition suit",
    ]);
    await app.close();
  });

  it("create with an empty body lands on the reference defaults; server-managed fields cannot be forced", async () => {
    await setup();
    const res = await app.inject({
      method: "POST", url: "/api/v1/tasks", headers: bearer(firmA.token), payload: {},
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      title: "New task", dueDate: new Date().toISOString().slice(0, 10),
      priority: "medium", status: "todo",
      // The assignee defaults to the firm's first user (the reference's db.users[0]).
      assigneeId: firmA.userId,
      createdAt: new Date().toISOString().slice(0, 10),
    });
    expect(res.json()).not.toHaveProperty("caseId");

    // Whole-entity save hardening: server-managed fields sent back by a UI
    // are stripped — no id/firmId/createdAt control.
    const sneaky = await app.inject({
      method: "POST", url: "/api/v1/tasks", headers: bearer(firmA.token),
      payload: {
        title: "Sneaky", id: "00000000-0000-4000-8000-000000000000",
        firmId: firmB.firmId, createdAt: "1999-01-01",
      },
    });
    expect(sneaky.statusCode).toBe(201);
    const created = sneaky.json() as Record<string, unknown>;
    expect(created.id).not.toBe("00000000-0000-4000-8000-000000000000");
    expect(created).not.toHaveProperty("firmId");
    expect(created.createdAt).toBe(new Date().toISOString().slice(0, 10));
    await app.close();
  });

  it("completion semantics: a status patch completes; the contract defines no transition table, so statuses move freely", async () => {
    await setup();
    const task = await createTask(app, firmA.token, { status: "todo" });
    expect(task.status).toBe("todo");

    // The UI's exact completion call: PATCH { status } (TasksPage.setStage).
    const done = await app.inject({
      method: "PATCH", url: `/api/v1/tasks/${task.id}`,
      headers: bearer(firmA.token), payload: { status: "done" },
    });
    expect(done.statusCode).toBe(200);
    expect((done.json() as { status: string }).status).toBe("done");

    // Free transitions — the contract's "todo → in_progress → blocked/done"
    // documents the UI flow, not a server-enforced machine (mock Object.assign).
    for (const status of ["todo", "in_progress", "blocked", "done"]) {
      const res = await app.inject({
        method: "PATCH", url: `/api/v1/tasks/${task.id}`,
        headers: bearer(firmA.token), payload: { status },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { status: string }).status).toBe(status);
    }
    await app.close();
  });

  it("patch updates only the sent fields; description and case links clear with null/empty", async () => {
    await setup();
    const kase = await createCase(app, firmA.token, "Matter One");
    const other = await createCase(app, firmA.token, "Matter Two");
    const task = await createTask(app, firmA.token, {
      caseId: kase.id, description: "Prem Lal and the 2009 settlement record.",
    });

    const patched = await app.inject({
      method: "PATCH", url: `/api/v1/tasks/${task.id}`,
      headers: bearer(firmA.token),
      payload: {
        title: "Renamed task", dueDate: "2026-10-15", priority: "low",
        assigneeId: firmA.userId, caseId: other.id,
      },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      id: task.id, title: "Renamed task", dueDate: "2026-10-15", priority: "low",
      status: "in_progress", caseId: other.id,
      description: "Prem Lal and the 2009 settlement record.",
    });

    // null clears the optional fields — the keys disappear.
    const cleared = await app.inject({
      method: "PATCH", url: `/api/v1/tasks/${task.id}`,
      headers: bearer(firmA.token), payload: { description: null, caseId: "" },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).not.toHaveProperty("description");
    expect(cleared.json()).not.toHaveProperty("caseId");

    // Server-managed bookkeeping cannot be moved by a patch either.
    const sneaky = await app.inject({
      method: "PATCH", url: `/api/v1/tasks/${task.id}`,
      headers: bearer(firmA.token),
      payload: { id: "00000000-0000-4000-8000-000000000000", createdAt: "1999-01-01" },
    });
    expect(sneaky.statusCode).toBe(200);
    expect(sneaky.json()).toMatchObject({ id: task.id });
    expect((sneaky.json() as { createdAt: string }).createdAt)
      .toBe(new Date().toISOString().slice(0, 10));
    await app.close();
  });

  it("validation 400s carry the messages (vocabularies, case links, assignee, dates, lengths) before anything is written", async () => {
    await setup();
    for (const [payload, message] of [
      [{ title: "Bad Priority", priority: "urgent" }, TASK_PRIORITY_MESSAGE],
      [{ title: "Bad Status", status: "archived" }, TASK_STATUS_MESSAGE],
      [{ title: "Bad Due Date", dueDate: "31/12/2026" }, TASK_DUE_DATE_MESSAGE],
      [{ title: "Bad Case", caseId: "k1" }, TASK_CASE_MESSAGE],
      [{
        title: "Unknown Case",
        caseId: "00000000-0000-4000-8000-00000000dead",
      }, TASK_CASE_MISSING_MESSAGE],
      [{ title: "Bad Assignee", assigneeId: "u1" }, TASK_ASSIGNEE_MESSAGE],
      [{ title: "x".repeat(201) }, "Title is too long"],
      [{ title: "Long Description", description: "x".repeat(4001) }, "Description is too long"],
    ] as [Record<string, unknown>, string][]) {
      const res = await app.inject({
        method: "POST", url: "/api/v1/tasks", headers: bearer(firmA.token), payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ error: message });
    }

    // Patch-side validation is the service's too.
    const task = await createTask(app, firmA.token);
    const badPatch = await app.inject({
      method: "PATCH", url: `/api/v1/tasks/${task.id}`,
      headers: bearer(firmA.token), payload: { priority: "urgent" },
    });
    expect(badPatch.statusCode).toBe(400);
    expect(badPatch.json()).toEqual({ error: TASK_PRIORITY_MESSAGE });

    // A soft-deleted case is not a linkable case either.
    const kase = await createCase(app, firmA.token, "Doomed Matter");
    await app.inject({
      method: "DELETE", url: `/api/v1/cases/${kase.id}`, headers: bearer(firmA.token),
    });
    const deletedCase = await app.inject({
      method: "POST", url: "/api/v1/tasks", headers: bearer(firmA.token),
      payload: { title: "Orphan", caseId: kase.id },
    });
    expect(deletedCase.statusCode).toBe(400);
    expect(deletedCase.json()).toEqual({ error: TASK_CASE_MISSING_MESSAGE });
    await app.close();
  });

  it("member-writable: an invited paralegal creates, completes, and deletes tasks (unlike /users)", async () => {
    await setup();
    const member = await inviteAndOnboard(
      app, firmA, mailer, "Sanjay Rao", "sanjay@firm-a.example", "paralegal",
    );

    const created = await createTask(app, member.token, { title: "Member's Task" });
    expect(created.title).toBe("Member's Task");

    const done = await app.inject({
      method: "PATCH", url: `/api/v1/tasks/${created.id}`,
      headers: bearer(member.token), payload: { status: "done" },
    });
    expect(done.statusCode).toBe(200);
    expect((done.json() as { status: string }).status).toBe("done");

    const deleted = await app.inject({
      method: "DELETE", url: `/api/v1/tasks/${created.id}`,
      headers: bearer(member.token),
    });
    expect(deleted.statusCode).toBe(204);
    await app.close();
  });

  it("cross-firm isolation: firm B cannot patch or delete firm A's task; lists never leak", async () => {
    await setup();
    const taskA = await createTask(app, firmA.token, { title: "A's Task" });
    const taskB = await createTask(app, firmB.token, { title: "B's Task" });

    const attempts: ["PATCH" | "DELETE", Record<string, unknown> | undefined][] = [
      ["PATCH", { title: "Hijacked" }],
      ["DELETE", undefined],
    ];
    for (const [method, payload] of attempts) {
      const res = await app.inject({
        method, url: `/api/v1/tasks/${taskA.id}`,
        headers: bearer(firmB.token), ...(payload ? { payload } : {}),
      });
      expect(res.statusCode, method).toBe(404);
      expect(res.json()).toEqual({ error: "Task not found" });
    }

    const listA = await app.inject({ method: "GET", url: "/api/v1/tasks", headers: bearer(firmA.token) });
    expect((listA.json() as { title: string }[]).map((t) => t.title)).toEqual(["A's Task"]);
    const listB = await app.inject({ method: "GET", url: "/api/v1/tasks", headers: bearer(firmB.token) });
    expect((listB.json() as { title: string }[]).map((t) => t.title)).toEqual(["B's Task"]);
    expect(taskB).toBeTruthy();
    await app.close();
  });

  it("delete → 204; the task then leaves the list, and a repeat delete 404s", async () => {
    await setup();
    const task = await createTask(app, firmA.token);

    const deleted = await app.inject({
      method: "DELETE", url: `/api/v1/tasks/${task.id}`, headers: bearer(firmA.token),
    });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe("");

    const list = await app.inject({ method: "GET", url: "/api/v1/tasks", headers: bearer(firmA.token) });
    expect(list.json()).toEqual([]);

    const repeat = await app.inject({
      method: "DELETE", url: `/api/v1/tasks/${task.id}`, headers: bearer(firmA.token),
    });
    expect(repeat.statusCode).toBe(404);
    expect(repeat.json()).toEqual({ error: "Task not found" });

    const malformed = await app.inject({
      method: "PATCH", url: "/api/v1/tasks/t1", headers: bearer(firmA.token), payload: {},
    });
    expect(malformed.statusCode).toBe(400);
    await app.close();
  });

  it("tasks need a session: anonymous reads and writes are 401", async () => {
    await setup();
    const probes: ["GET" | "POST" | "PATCH" | "DELETE", string][] = [
      ["GET", "/api/v1/tasks"],
      ["POST", "/api/v1/tasks"],
      ["PATCH", "/api/v1/tasks/00000000-0000-4000-8000-000000000000"],
      ["DELETE", "/api/v1/tasks/00000000-0000-4000-8000-000000000000"],
    ];
    for (const [method, url] of probes) {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Not signed in" });
    }
    await app.close();
  });

  it("without a database the tasks surface answers the 503 envelope", async () => {
    app = await buildApp(testConfig);
    const signup = await app.inject({
      method: "POST", url: "/api/v1/auth/signup",
      payload: { firstName: "A", lastName: "B", email: "a@b.co", firmName: "F", zip: "", phone: "" },
    });
    expect(signup.statusCode).toBe(503);

    const res = await app.inject({ method: "GET", url: "/api/v1/tasks" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/DATABASE_URL/);
    await app.close();
  });
});
