import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, migrationsFolder, requireDb, type DbHandle } from "../../db/client.js";
import { createDrizzleRepositories } from "../auth/drizzle-repository.js";
import { AuthService } from "../auth/service.js";
import { CapturingMailer } from "../auth/testing.js";
import { ContactsService } from "../contacts/service.js";
import {
  BILLABLE_RATE_MESSAGE,
  CASE_CLIENT_MESSAGE,
  CASE_CLIENT_MISSING_MESSAGE,
  CasesService,
} from "./service.js";

/**
 * DB-backed twin of the cases suite (service.db.test.ts pattern): the same
 * flows as the in-memory route tests, run against real Postgres so the
 * Drizzle binding proves it implements the seam identically — the atomic
 * per-firm-year number counter under concurrent creates, the SQL `?status=` /
 * `?q=` filter semantics, firm scoping, the soft delete behind 404s, and the
 * bigint paise columns. Runs only when DATABASE_URL is exported and skips
 * silently otherwise; point it at a scratch database (truncates).
 */
describe.skipIf(!process.env.DATABASE_URL)("cases against Postgres", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = requireDb();
    await migrate(handle.db, { migrationsFolder });
  });

  afterEach(async () => {
    await handle.sql.unsafe(
      "truncate table case_number_counters, cases, contacts, expenses, events, invoice_line_items, invoice_number_counters, invoices, lead_stage_history, leads, payments, tasks, time_entries, password_reset_tokens, sessions, users, firms cascade",
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
      contacts: new ContactsService(repos),
      cases: new CasesService(repos),
    };
  }

  const year = () => new Date().toISOString().slice(0, 4);

  it("create → reference defaults, contract shape, sequential per-firm-year numbers end to end on drizzle", async () => {
    const mailer = new CapturingMailer();
    const { auth, contacts, cases } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;
    const client = await contacts.create(firmId, { name: "Harish Chadha", type: "client" });

    const first = await cases.create(firmId, {
      title: "Chadha v. Khanna — Property Partition Suit",
      clientId: client.id, practiceArea: "Civil Litigation", billableRate: 500000,
      description: "Partition of ancestral property at Green Park.",
    });
    expect(first).toMatchObject({
      number: `${year()}-0001`,
      title: "Chadha v. Khanna — Property Partition Suit",
      clientId: client.id, practiceArea: "Civil Litigation", stage: "intake",
      status: "open", openDate: new Date().toISOString().slice(0, 10),
      leadAttorneyId: registered.user.id,
      billableRate: 500000, trustBalance: 0,
      description: "Partition of ancestral property at Green Park.",
    });
    expect(first).not.toHaveProperty("firmId");
    expect(first).not.toHaveProperty("courtDate");

    const second = await cases.create(firmId, {});
    expect(second.number).toBe(`${year()}-0002`);
    expect(second).toMatchObject({
      title: "New matter", clientId: "", practiceArea: "General",
      billableRate: 300000, trustBalance: 0,
    });

    // The bigint paise columns and the nullable client FK really persisted.
    const rows = await handle.sql`
      select number, client_id, billable_rate, trust_balance, deleted_at
      from cases where id = ${first.id}`;
    const row = rows[0] as {
      number: string; client_id: string | null;
      billable_rate: string | number; trust_balance: string | number; deleted_at: Date | null;
    };
    expect(row.number).toBe(`${year()}-0001`);
    expect(row.client_id).toBe(client.id);
    expect(Number(row.billable_rate)).toBe(500000);
    expect(Number(row.trust_balance)).toBe(0);
    expect(row.deleted_at).toBeNull();
  });

  it("concurrent creates reserve distinct numbers atomically (the counter row serializes them)", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    const created = await Promise.all(
      Array.from({ length: 5 }, (_, i) => cases.create(firmId, { title: `Matter ${i + 1}` })),
    );
    const numbers = created.map((c) => c.number);
    expect(new Set(numbers).size).toBe(5);
    expect([...numbers].sort()).toEqual(
      [1, 2, 3, 4, 5].map((n) => `${year()}-${String(n).padStart(4, "0")}`),
    );
  });

  it("filters: ?status= exact and ?q= substring over `number title` on real SQL", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    const open = await cases.create(firmId, { title: "Property Partition Suit" });
    await cases.create(firmId, { title: "Cheque Bounce Complaint", status: "pending" });
    const closed = await cases.create(firmId, { title: "Consumer Complaint", status: "closed" });

    expect(await cases.list(firmId)).toHaveLength(3);
    expect((await cases.list(firmId, { status: "open" })).map((c) => c.number))
      .toEqual([open.number]);
    expect(await cases.list(firmId, { status: "archived" })).toEqual([]);
    expect((await cases.list(firmId, { q: "PARTITION" })).map((c) => c.number))
      .toEqual([open.number]);
    expect((await cases.list(firmId, { q: open.number })).map((c) => c.id))
      .toEqual([open.id]);
    // The space-joined `number title` haystack, and literal wildcard chars.
    expect((await cases.list(firmId, { q: `${open.number} property` })).map((c) => c.id))
      .toEqual([open.id]);
    expect(await cases.list(firmId, { q: "%" })).toEqual([]);
    expect(closed.number).toBe(`${year()}-0003`);
  });

  it("cross-firm isolation: other firm's case 404s, lists never leak, counters are per firm", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases } = build(mailer);
    const a = await firmWithOwner(auth, mailer, "owner@firm-a.example");
    const b = await firmWithOwner(auth, mailer, "owner@firm-b.example");
    const firmA = a.registered.firm.id;
    const firmB = b.registered.firm.id;

    const caseA = await cases.create(firmA, { title: "A's Matter" });
    const caseB = await cases.create(firmB, { title: "B's Matter" });
    // Sequences are independent per firm: both firms' first case is -0001.
    expect(caseA.number).toBe(`${year()}-0001`);
    expect(caseB.number).toBe(`${year()}-0001`);

    for (const op of [
      () => cases.get(firmB, caseA.id),
      () => cases.update(firmB, caseA.id, { title: "Hijacked" }),
      () => cases.delete(firmB, caseA.id),
    ]) {
      await expect(op()).rejects.toMatchObject({
        statusCode: 404, message: "Case not found",
      });
    }
    expect((await cases.list(firmA)).map((c) => c.id)).toEqual([caseA.id]);
    expect((await cases.list(firmB)).map((c) => c.id)).toEqual([caseB.id]);
  });

  it("soft delete: the row stays with deleted_at stamped, reads drop it, and the number is never reused", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    const first = await cases.create(firmId, { title: "First" });
    const second = await cases.create(firmId, { title: "Second" });
    await cases.delete(firmId, first.id);

    await expect(cases.get(firmId, first.id)).rejects.toMatchObject({
      statusCode: 404, message: "Case not found",
    });
    expect((await cases.list(firmId)).map((c) => c.id)).toEqual([second.id]);

    // The row itself survives (ADR-0003 audit trail) with deleted_at stamped.
    const rows = await handle.sql`select deleted_at from cases where id = ${first.id}`;
    expect((rows[0] as { deleted_at: Date | null }).deleted_at).not.toBeNull();

    const third = await cases.create(firmId, { title: "Third" });
    expect(third.number).toBe(`${year()}-0003`);
  });

  it("number sequences are per firm-year: a fixed now in a later year restarts at -0001", async () => {
    const mailer = new CapturingMailer();
    const repos = createDrizzleRepositories(handle);
    const auth = new AuthService(repos, mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    const cases = new CasesService(repos, () => new Date("2027-03-04T10:00:00Z"));
    const future = await cases.create(firmId, { title: "Next Year's Matter" });
    expect(future.number).toBe("2027-0001");
    expect(future.openDate).toBe("2027-03-04");

    // The current year's counter is untouched by the other year's sequence.
    const present = await new CasesService(repos).create(firmId, { title: "This Year's Matter" });
    expect(present.number).toBe(`${year()}-0001`);
  });

  it("validation is the service's: bad client id shape and unknown client are 400 before any insert", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    await expect(
      cases.create(firmId, { title: "Bad Client", clientId: "c1" }),
    ).rejects.toMatchObject({ statusCode: 400, message: CASE_CLIENT_MESSAGE });
    await expect(
      cases.create(firmId, {
        title: "Unknown Client", clientId: "00000000-0000-4000-8000-00000000dead",
      }),
    ).rejects.toMatchObject({ statusCode: 400, message: CASE_CLIENT_MISSING_MESSAGE });
    await expect(
      cases.create(firmId, { title: "Bad Rate", billableRate: -1 }),
    ).rejects.toMatchObject({ statusCode: 400, message: BILLABLE_RATE_MESSAGE });
    // No counter was consumed by the failed creates.
    expect(await cases.list(firmId)).toEqual([]);

    const real = await cases.create(firmId, { title: "Good" });
    expect(real.number).toBe(`${year()}-0001`);
  });
});
