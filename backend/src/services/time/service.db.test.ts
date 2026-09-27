import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, migrationsFolder, requireDb, type DbHandle } from "../../db/client.js";
import { createDrizzleRepositories } from "../auth/drizzle-repository.js";
import { AuthService } from "../auth/service.js";
import { CapturingMailer } from "../auth/testing.js";
import { CasesService } from "../cases/service.js";
import {
  TIME_CASE_MESSAGE,
  TIME_CASE_MISSING_MESSAGE,
  TIME_MINUTES_MESSAGE,
  TIME_RATE_MESSAGE,
  TimeEntriesService,
} from "./service.js";

/**
 * DB-backed twin of the time-entries suite (service.db.test.ts pattern): the
 * same flows as the in-memory route tests, run against real Postgres so the
 * Drizzle binding proves it implements the seam identically — newest-first
 * ordering, firm scoping, the soft delete behind 404s, the required case FK
 * with its default-to-newest-live-case resolution, the date (mode:string)
 * column, the bigint-paise rate, and the server-stamped invoiced=false
 * column default proven even for raw inserts. Runs only when DATABASE_URL is
 * exported and skips silently otherwise; point it at a scratch database
 * (truncates).
 */
describe.skipIf(!process.env.DATABASE_URL)("time entries against Postgres", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = requireDb();
    await migrate(handle.db, { migrationsFolder });
  });

  afterEach(async () => {
    await handle.sql.unsafe(
      "truncate table case_number_counters, cases, contacts, expenses, events, tasks, time_entries, password_reset_tokens, sessions, users, firms cascade",
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
      time: new TimeEntriesService(repos),
    };
  }

  it("create → reference defaults, contract shape, and the columns really persisted on drizzle", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases, time } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;
    const kase = await cases.create(firmId, { title: "Partition Suit" });

    const first = await time.create(firmId, {
      caseId: kase.id,
      date: "2026-10-01", minutes: 90, rate: 450000,
      description: "Serve defence witness summons — partition suit",
      billable: true,
    });
    expect(first).toEqual({
      id: first.id,
      userId: registered.user.id,
      caseId: kase.id,
      date: "2026-10-01",
      minutes: 90,
      rate: 450000,
      description: "Serve defence witness summons — partition suit",
      billable: true,
      invoiced: false,
    });

    // The timer's stop call: one POST with the elapsed minutes — everything
    // omitted lands on the reference defaults (newest live case included).
    const second = await time.create(firmId, { minutes: 25, description: "Timer entry" });
    expect(second).toMatchObject({
      caseId: kase.id, userId: registered.user.id, minutes: 25,
      rate: 300000, billable: true, invoiced: false,
      date: new Date().toISOString().slice(0, 10),
    });

    // The required case FK, the mode:string date, the bigint paise rate, and
    // the server-stamped invoiced=false column default really persisted.
    const rows = await handle.sql`
      select case_id, user_id, date::text as date_text, minutes, rate, invoiced, deleted_at
      from time_entries where id = ${first.id}`;
    const row = rows[0] as {
      case_id: string; user_id: string; date_text: string;
      minutes: number; rate: string; invoiced: boolean; deleted_at: Date | null;
    };
    expect(row.case_id).toBe(kase.id);
    expect(row.user_id).toBe(registered.user.id);
    expect(row.date_text).toBe("2026-10-01");
    expect(row.minutes).toBe(90);
    expect(row.rate).toBe("450000"); // bigint reads back as a string here
    expect(row.invoiced).toBe(false);
    expect(row.deleted_at).toBeNull();

    // Newest first — the reference unshifts.
    const listed = await time.list(firmId);
    expect(listed.map((e) => e.id)).toEqual([second.id, first.id]);
  });

  it("the required case link: defaults to the newest live case; unknown or soft-deleted cases 400", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases, time } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    await expect(
      time.create(firmId, { minutes: 30 }),
    ).rejects.toMatchObject({ statusCode: 400, message: TIME_CASE_MISSING_MESSAGE });

    const older = await cases.create(firmId, { title: "Older Matter" });
    const newest = await cases.create(firmId, { title: "Newest Matter" });
    const defaulted = await time.create(firmId, { minutes: 30 });
    expect(defaulted.caseId).toBe(newest.id);
    expect(defaulted.caseId).not.toBe(older.id);

    await expect(
      time.create(firmId, { minutes: 30, caseId: "00000000-0000-4000-8000-00000000dead" }),
    ).rejects.toMatchObject({ statusCode: 400, message: TIME_CASE_MISSING_MESSAGE });
    await expect(
      time.create(firmId, { minutes: 30, caseId: "k1" }),
    ).rejects.toMatchObject({ statusCode: 400, message: TIME_CASE_MESSAGE });

    await cases.delete(firmId, older.id);
    await expect(
      time.create(firmId, { minutes: 30, caseId: older.id }),
    ).rejects.toMatchObject({ statusCode: 400, message: TIME_CASE_MISSING_MESSAGE });

    // No rows were written by the failed creates beyond the defaulted one.
    expect((await time.list(firmId)).map((e) => e.caseId)).toEqual([newest.id]);
  });

  it("cross-firm isolation: other firm's entry 404s, lists never leak", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases, time } = build(mailer);
    const a = await firmWithOwner(auth, mailer, "owner@firm-a.example");
    const b = await firmWithOwner(auth, mailer, "owner@firm-b.example");
    const firmA = a.registered.firm.id;
    const firmB = b.registered.firm.id;

    const caseA = await cases.create(firmA, { title: "A's Matter" });
    const caseB = await cases.create(firmB, { title: "B's Matter" });
    const entryA = await time.create(firmA, { caseId: caseA.id, minutes: 60 });
    const entryB = await time.create(firmB, { caseId: caseB.id, minutes: 30 });

    for (const op of [
      () => time.update(firmB, entryA.id, { description: "Hijacked" }),
      () => time.delete(firmB, entryA.id),
    ]) {
      await expect(op()).rejects.toMatchObject({
        statusCode: 404, message: "Time entry not found",
      });
    }
    expect((await time.list(firmA)).map((e) => e.id)).toEqual([entryA.id]);
    expect((await time.list(firmB)).map((e) => e.id)).toEqual([entryB.id]);
  });

  it("soft delete: the row stays with deleted_at stamped and reads drop it; invoiced rows stay CRUD-able", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases, time } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;
    const kase = await cases.create(firmId, { title: "Partition Suit" });

    const first = await time.create(firmId, { caseId: kase.id, minutes: 30 });
    const second = await time.create(firmId, { caseId: kase.id, minutes: 60 });
    await time.delete(firmId, first.id);

    await expect(time.update(firmId, first.id, { description: "Zombie" })).rejects.toMatchObject({
      statusCode: 404, message: "Time entry not found",
    });
    expect((await time.list(firmId)).map((e) => e.id)).toEqual([second.id]);

    // The row itself survives (ADR-0003 audit trail) with deleted_at stamped.
    const rows = await handle.sql`select deleted_at from time_entries where id = ${first.id}`;
    expect((rows[0] as { deleted_at: Date | null }).deleted_at).not.toBeNull();

    // Ticket 13's seam marks an entry invoiced; the reference gates nothing,
    // so patch/delete still flow.
    await handle.sql`update time_entries set invoiced = true where id = ${second.id}`;
    const invoiced = await time.update(firmId, second.id, { minutes: 45 });
    expect(invoiced.invoiced).toBe(true);
    expect(invoiced.minutes).toBe(45);
    await time.delete(firmId, second.id);
    expect(await time.list(firmId)).toEqual([]);
  });

  it("validation is the service's: bad numbers, bad ids and unknown cases are 400 before any insert", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases, time } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;
    const kase = await cases.create(firmId, { title: "Partition Suit" });

    await expect(
      time.create(firmId, { minutes: 1.5 }),
    ).rejects.toMatchObject({ statusCode: 400, message: TIME_MINUTES_MESSAGE });
    await expect(
      time.create(firmId, { rate: -1 }),
    ).rejects.toMatchObject({ statusCode: 400, message: TIME_RATE_MESSAGE });
    await expect(
      time.create(firmId, { caseId: "k1" }),
    ).rejects.toMatchObject({ statusCode: 400, message: TIME_CASE_MESSAGE });
    await expect(
      time.create(firmId, { caseId: "00000000-0000-4000-8000-00000000dead" }),
    ).rejects.toMatchObject({ statusCode: 400, message: TIME_CASE_MISSING_MESSAGE });
    // No rows were written by the failed creates.
    expect(await time.list(firmId)).toEqual([]);

    const real = await time.create(firmId, { caseId: kase.id, minutes: 60 });
    expect((await time.list(firmId)).map((e) => e.id)).toEqual([real.id]);
  });
});
