import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, migrationsFolder, requireDb, type DbHandle } from "../../db/client.js";
import { createDrizzleRepositories } from "../auth/drizzle-repository.js";
import { AuthService } from "../auth/service.js";
import { CapturingMailer } from "../auth/testing.js";
import { CasesService } from "../cases/service.js";
import {
  TASK_CASE_MESSAGE,
  TASK_CASE_MISSING_MESSAGE,
  TASK_PRIORITY_MESSAGE,
  TASK_STATUS_MESSAGE,
  TasksService,
} from "./service.js";

/**
 * DB-backed twin of the tasks suite (service.db.test.ts pattern): the same
 * flows as the in-memory route tests, run against real Postgres so the
 * Drizzle binding proves it implements the seam identically — newest-first
 * ordering, firm scoping, the soft delete behind 404s, the date
 * (mode:string) due-date column with the timestamptz created_at collapsing
 * to the contract's ISO day, and the status-patch completion semantics.
 * Runs only when DATABASE_URL is exported and skips silently otherwise;
 * point it at a scratch database (truncates).
 */
describe.skipIf(!process.env.DATABASE_URL)("tasks against Postgres", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = requireDb();
    await migrate(handle.db, { migrationsFolder });
  });

  afterEach(async () => {
    await handle.sql.unsafe(
      "truncate table case_number_counters, cases, contacts, expenses, events, lead_stage_history, leads, tasks, time_entries, password_reset_tokens, sessions, users, firms cascade",
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
      cases: new CasesService(repos),
      tasks: new TasksService(repos),
    };
  }

  it("create → reference defaults, contract shape, and the columns really persisted on drizzle", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases, tasks } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;
    const kase = await cases.create(firmId, { title: "Partition Suit" });

    const first = await tasks.create(firmId, {
      title: "Serve defence witness summons — partition suit",
      dueDate: "2026-10-01", priority: "high", status: "in_progress",
      caseId: kase.id, description: "Prem Lal and the 2009 settlement record.",
    });
    expect(first).toMatchObject({
      title: "Serve defence witness summons — partition suit",
      dueDate: "2026-10-01", priority: "high", status: "in_progress",
      caseId: kase.id, assigneeId: registered.user.id,
      description: "Prem Lal and the 2009 settlement record.",
      createdAt: new Date().toISOString().slice(0, 10),
    });
    expect(first).not.toHaveProperty("firmId");

    const second = await tasks.create(firmId, {});
    expect(second).toMatchObject({
      title: "New task", dueDate: new Date().toISOString().slice(0, 10),
      priority: "medium", status: "todo", assigneeId: registered.user.id,
    });
    expect(second).not.toHaveProperty("caseId");

    // The nullable case FK, the mode:string due date, and the timestamptz
    // created_at (collapsed to the ISO day in the API shape) really persisted.
    const rows = await handle.sql`
      select case_id, due_date::text as due_date_text,
             (created_at at time zone 'utc')::date::text as created_date_text, deleted_at
      from tasks where id = ${first.id}`;
    const row = rows[0] as {
      case_id: string | null; due_date_text: string;
      created_date_text: string; deleted_at: Date | null;
    };
    expect(row.case_id).toBe(kase.id);
    expect(row.due_date_text).toBe("2026-10-01");
    expect(row.created_date_text).toBe(new Date().toISOString().slice(0, 10));
    expect(row.deleted_at).toBeNull();

    // Newest first — the reference unshifts.
    const listed = await tasks.list(firmId);
    expect(listed.map((t) => t.id)).toEqual([second.id, first.id]);
  });

  it("completion is a status patch end to end: any contract status may be set in any order", async () => {
    const mailer = new CapturingMailer();
    const { auth, tasks } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    const task = await tasks.create(firmId, { title: "File reply", status: "todo" });
    for (const status of ["done", "in_progress", "blocked", "todo"]) {
      const updated = await tasks.update(firmId, task.id, { status });
      expect(updated.status).toBe(status);
    }
    expect((await tasks.list(firmId))[0]!.status).toBe("todo");
  });

  it("cross-firm isolation: other firm's task 404s, lists never leak", async () => {
    const mailer = new CapturingMailer();
    const { auth, tasks } = build(mailer);
    const a = await firmWithOwner(auth, mailer, "owner@firm-a.example");
    const b = await firmWithOwner(auth, mailer, "owner@firm-b.example");
    const firmA = a.registered.firm.id;
    const firmB = b.registered.firm.id;

    const taskA = await tasks.create(firmA, { title: "A's Task" });
    const taskB = await tasks.create(firmB, { title: "B's Task" });

    for (const op of [
      () => tasks.update(firmB, taskA.id, { title: "Hijacked" }),
      () => tasks.delete(firmB, taskA.id),
    ]) {
      await expect(op()).rejects.toMatchObject({
        statusCode: 404, message: "Task not found",
      });
    }
    expect((await tasks.list(firmA)).map((t) => t.id)).toEqual([taskA.id]);
    expect((await tasks.list(firmB)).map((t) => t.id)).toEqual([taskB.id]);
  });

  it("soft delete: the row stays with deleted_at stamped and reads drop it", async () => {
    const mailer = new CapturingMailer();
    const { auth, tasks } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    const first = await tasks.create(firmId, { title: "First" });
    const second = await tasks.create(firmId, { title: "Second" });
    await tasks.delete(firmId, first.id);

    await expect(tasks.update(firmId, first.id, { title: "Zombie" })).rejects.toMatchObject({
      statusCode: 404, message: "Task not found",
    });
    expect((await tasks.list(firmId)).map((t) => t.id)).toEqual([second.id]);

    // The row itself survives (ADR-0003 audit trail) with deleted_at stamped.
    const rows = await handle.sql`select deleted_at from tasks where id = ${first.id}`;
    expect((rows[0] as { deleted_at: Date | null }).deleted_at).not.toBeNull();
  });

  it("validation is the service's: bad case id, unknown case, bad priority and status are 400 before any insert", async () => {
    const mailer = new CapturingMailer();
    const { auth, tasks } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    await expect(
      tasks.create(firmId, { title: "Bad Case", caseId: "k1" }),
    ).rejects.toMatchObject({ statusCode: 400, message: TASK_CASE_MESSAGE });
    await expect(
      tasks.create(firmId, {
        title: "Unknown Case", caseId: "00000000-0000-4000-8000-00000000dead",
      }),
    ).rejects.toMatchObject({ statusCode: 400, message: TASK_CASE_MISSING_MESSAGE });
    await expect(
      tasks.create(firmId, { title: "Bad Priority", priority: "urgent" }),
    ).rejects.toMatchObject({ statusCode: 400, message: TASK_PRIORITY_MESSAGE });
    await expect(
      tasks.create(firmId, { title: "Bad Status", status: "archived" }),
    ).rejects.toMatchObject({ statusCode: 400, message: TASK_STATUS_MESSAGE });
    // No rows were written by the failed creates.
    expect(await tasks.list(firmId)).toEqual([]);

    const real = await tasks.create(firmId, { title: "Good" });
    expect((await tasks.list(firmId)).map((t) => t.id)).toEqual([real.id]);
  });
});
