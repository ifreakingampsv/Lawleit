import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, migrationsFolder, requireDb, type DbHandle } from "../../db/client.js";
import { createDrizzleRepositories } from "../auth/drizzle-repository.js";
import { AuthService } from "../auth/service.js";
import { CapturingMailer } from "../auth/testing.js";
import { CasesService } from "../cases/service.js";
import {
  EVENT_CASE_MESSAGE,
  EVENT_CASE_MISSING_MESSAGE,
  EVENT_DATE_MESSAGE,
  EVENT_TYPE_MESSAGE,
  EventsService,
} from "./service.js";

/**
 * DB-backed twin of the events suite (service.db.test.ts pattern): the same
 * flows as the in-memory route tests, run against real Postgres so the
 * Drizzle binding proves it implements the seam identically — the SQL
 * inclusive day-range filter, firm scoping, the soft delete behind 404s, the
 * date (mode:string) day columns, and ticket 11's V2 seam: the `source`
 * column exists, defaults to 'manual' at the database level, and carries no
 * client-facing surface. Runs only when DATABASE_URL is exported and skips
 * silently otherwise; point it at a scratch database (truncates).
 */
describe.skipIf(!process.env.DATABASE_URL)("events against Postgres", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = requireDb();
    await migrate(handle.db, { migrationsFolder });
  });

  afterEach(async () => {
    await handle.sql.unsafe(
      "truncate table case_number_counters, cases, contacts, documents, expenses, events, invoice_line_items, invoice_number_counters, invoices, lead_stage_history, leads, payments, tasks, time_entries, password_reset_tokens, sessions, trust_transactions, users, firms cascade",
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
      events: new EventsService(repos),
    };
  }

  it("create → reference defaults, contract shape, and the case link really persisted on drizzle", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases, events } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;
    const kase = await cases.create(firmId, { title: "Partition Suit" });

    const first = await events.create(firmId, {
      title: "Hearing — Rawat writ, Court 5", date: "2026-10-01",
      start: "10:30", end: "11:30", location: "Delhi High Court",
      caseId: kase.id, attendeeIds: [registered.user.id], type: "court",
    });
    expect(first).toMatchObject({
      title: "Hearing — Rawat writ, Court 5", date: "2026-10-01",
      start: "10:30", end: "11:30", location: "Delhi High Court",
      caseId: kase.id, attendeeIds: [registered.user.id], type: "court", color: "#4B4ACF",
    });
    expect(first).not.toHaveProperty("firmId");
    expect(first).not.toHaveProperty("source");
    expect(first).not.toHaveProperty("allDay");

    const second = await events.create(firmId, {});
    expect(second).toMatchObject({
      title: "New event", date: new Date().toISOString().slice(0, 10),
      start: "09:00", end: "10:00", attendeeIds: [], type: "meeting", color: "#4B4ACF",
    });
    expect(second).not.toHaveProperty("caseId");

    // The uuid[] attendees, the nullable case FK and the mode:string date
    // column really persisted; source is the V1 'manual' seam value.
    const rows = await handle.sql`
      select case_id, attendee_ids, date::text as date_text, source, deleted_at
      from events where id = ${first.id}`;
    const row = rows[0] as {
      case_id: string | null; attendee_ids: string[];
      date_text: string; source: string; deleted_at: Date | null;
    };
    expect(row.case_id).toBe(kase.id);
    expect(row.attendee_ids).toEqual([registered.user.id]);
    expect(row.date_text).toBe("2026-10-01");
    expect(row.source).toBe("manual");
    expect(row.deleted_at).toBeNull();

    // Insertion order, oldest first — the reference PUSHes.
    const listed = await events.list(firmId);
    expect(listed.map((e) => e.id)).toEqual([first.id, second.id]);
  });

  it("the source column's database default is 'manual' even for inserts that omit it (the V2 seam stays closed)", async () => {
    const mailer = new CapturingMailer();
    const { auth } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    // Raw insert without source — exactly what a V2 cause-list importer will
    // do deliberately differently; today the column default carries V1.
    const rows = await handle.sql`
      insert into events (firm_id, title, date, start, "end")
      values (${firmId}, 'Cause list placeholder', '2026-10-01', '09:00', '10:00')
      returning source`;
    expect((rows[0] as { source: string }).source).toBe("manual");
  });

  it("list-by-range: the inclusive day range filters on real SQL, bounds optional", async () => {
    const mailer = new CapturingMailer();
    const { auth, events } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    await events.create(firmId, { title: "Day minus one", date: "2026-09-30" });
    const inRange = await events.create(firmId, { title: "Day zero", date: "2026-10-01" });
    const alsoInRange = await events.create(firmId, { title: "Day five", date: "2026-10-05" });
    await events.create(firmId, { title: "Day six", date: "2026-10-06" });

    expect(await events.list(firmId)).toHaveLength(4);
    expect((await events.list(firmId, { from: "2026-10-01", to: "2026-10-05" })).map((e) => e.id))
      .toEqual([inRange.id, alsoInRange.id]);
    expect((await events.list(firmId, { from: "2026-10-01" })).map((e) => e.title))
      .toEqual(["Day zero", "Day five", "Day six"]);
    expect((await events.list(firmId, { to: "2026-09-30" })).map((e) => e.title))
      .toEqual(["Day minus one"]);
    expect(await events.list(firmId, { from: "2026-10-02", to: "2026-10-04" })).toEqual([]);
  });

  it("cross-firm isolation: other firm's event 404s, lists never leak", async () => {
    const mailer = new CapturingMailer();
    const { auth, events } = build(mailer);
    const a = await firmWithOwner(auth, mailer, "owner@firm-a.example");
    const b = await firmWithOwner(auth, mailer, "owner@firm-b.example");
    const firmA = a.registered.firm.id;
    const firmB = b.registered.firm.id;

    const eventA = await events.create(firmA, { title: "A's Hearing", date: "2026-10-01" });
    const eventB = await events.create(firmB, { title: "B's Hearing", date: "2026-10-01" });

    for (const op of [
      () => events.update(firmB, eventA.id, { title: "Hijacked" }),
      () => events.delete(firmB, eventA.id),
    ]) {
      await expect(op()).rejects.toMatchObject({
        statusCode: 404, message: "Event not found",
      });
    }
    expect((await events.list(firmA)).map((e) => e.id)).toEqual([eventA.id]);
    expect((await events.list(firmB)).map((e) => e.id)).toEqual([eventB.id]);
    expect((await events.list(firmA, { from: "2026-10-01", to: "2026-10-01" })))
      .toHaveLength(1);
  });

  it("soft delete: the row stays with deleted_at stamped and reads drop it", async () => {
    const mailer = new CapturingMailer();
    const { auth, events } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    const first = await events.create(firmId, { title: "First" });
    const second = await events.create(firmId, { title: "Second" });
    await events.delete(firmId, first.id);

    await expect(events.update(firmId, first.id, { title: "Zombie" })).rejects.toMatchObject({
      statusCode: 404, message: "Event not found",
    });
    expect((await events.list(firmId)).map((e) => e.id)).toEqual([second.id]);

    // The row itself survives (ADR-0003 audit trail) with deleted_at stamped.
    const rows = await handle.sql`select deleted_at from events where id = ${first.id}`;
    expect((rows[0] as { deleted_at: Date | null }).deleted_at).not.toBeNull();
  });

  it("validation is the service's: bad case id, unknown case, bad date and bad type are 400 before any insert", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases, events } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    await expect(
      events.create(firmId, { title: "Bad Case", caseId: "k1" }),
    ).rejects.toMatchObject({ statusCode: 400, message: EVENT_CASE_MESSAGE });
    await expect(
      events.create(firmId, {
        title: "Unknown Case", caseId: "00000000-0000-4000-8000-00000000dead",
      }),
    ).rejects.toMatchObject({ statusCode: 400, message: EVENT_CASE_MISSING_MESSAGE });
    await expect(
      events.create(firmId, { title: "Bad Date", date: "31/12/2026" }),
    ).rejects.toMatchObject({ statusCode: 400, message: EVENT_DATE_MESSAGE });
    await expect(
      events.create(firmId, { title: "Bad Type", type: "hearing" }),
    ).rejects.toMatchObject({ statusCode: 400, message: EVENT_TYPE_MESSAGE });
    // No rows were written by the failed creates.
    expect(await events.list(firmId)).toEqual([]);

    const kase = await cases.create(firmId, { title: "Real Matter" });
    const real = await events.create(firmId, { title: "Good", caseId: kase.id });
    expect((await events.list(firmId)).map((e) => e.id)).toEqual([real.id]);
  });
});
