import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, migrationsFolder, requireDb, type DbHandle } from "../../db/client.js";
import { createDrizzleRepositories } from "../auth/drizzle-repository.js";
import { AuthService } from "../auth/service.js";
import { CapturingMailer } from "../auth/testing.js";
import { CasesService } from "../cases/service.js";
import {
  EXPENSE_AMOUNT_MESSAGE,
  EXPENSE_CASE_MESSAGE,
  EXPENSE_CASE_MISSING_MESSAGE,
  EXPENSE_CATEGORY_MESSAGE,
  ExpensesService,
} from "./service.js";

/**
 * DB-backed twin of the expenses suite (service.db.test.ts pattern): the
 * same flows as the in-memory route tests, run against real Postgres so the
 * Drizzle binding proves it implements the seam identically — newest-first
 * ordering, firm scoping, the soft delete behind 404s, the required case FK
 * with its default-to-newest-live-case resolution, the date (mode:string)
 * column, the bigint-paise amount stored verbatim, and the server-stamped
 * invoiced=false column default proven even for raw inserts. Runs only when
 * DATABASE_URL is exported and skips silently otherwise; point it at a
 * scratch database (truncates).
 */
describe.skipIf(!process.env.DATABASE_URL)("expenses against Postgres", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = requireDb();
    await migrate(handle.db, { migrationsFolder });
  });

  afterEach(async () => {
    await handle.sql.unsafe(
      "truncate table case_number_counters, cases, contacts, expenses, events, invoice_line_items, invoice_number_counters, invoices, lead_stage_history, leads, payments, tasks, time_entries, password_reset_tokens, sessions, trust_transactions, users, firms cascade",
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
      expenses: new ExpensesService(repos),
    };
  }

  it("create → reference defaults, contract shape, and the columns really persisted on drizzle", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases, expenses } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;
    const kase = await cases.create(firmId, { title: "Partition Suit" });

    const first = await expenses.create(firmId, {
      caseId: kase.id,
      date: "2026-10-01", description: "Court filing fee",
      amount: 250000, category: "filing",
    });
    expect(first).toEqual({
      id: first.id,
      caseId: kase.id,
      date: "2026-10-01",
      description: "Court filing fee",
      amount: 250000,
      billable: true,
      invoiced: false,
      category: "filing",
    });

    const second = await expenses.create(firmId, { description: "Copies" });
    expect(second).toMatchObject({
      caseId: kase.id, amount: 0, category: "other", billable: true, invoiced: false,
      date: new Date().toISOString().slice(0, 10),
    });

    // The required case FK, the mode:string date, the bigint paise amount,
    // and the server-stamped invoiced=false column default really persisted.
    const rows = await handle.sql`
      select case_id, date::text as date_text, amount, category, invoiced, deleted_at
      from expenses where id = ${first.id}`;
    const row = rows[0] as {
      case_id: string; date_text: string; amount: string;
      category: string; invoiced: boolean; deleted_at: Date | null;
    };
    expect(row.case_id).toBe(kase.id);
    expect(row.date_text).toBe("2026-10-01");
    expect(row.amount).toBe("250000"); // bigint reads back as a string here
    expect(row.category).toBe("filing");
    expect(row.invoiced).toBe(false);
    expect(row.deleted_at).toBeNull();

    // Newest first — the reference unshifts.
    const listed = await expenses.list(firmId);
    expect(listed.map((e) => e.id)).toEqual([second.id, first.id]);
  });

  it("the required case link: defaults to the newest live case; unknown or soft-deleted cases 400", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases, expenses } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    await expect(
      expenses.create(firmId, {}),
    ).rejects.toMatchObject({ statusCode: 400, message: EXPENSE_CASE_MISSING_MESSAGE });

    const older = await cases.create(firmId, { title: "Older Matter" });
    const newest = await cases.create(firmId, { title: "Newest Matter" });
    const defaulted = await expenses.create(firmId, {});
    expect(defaulted.caseId).toBe(newest.id);
    expect(defaulted.caseId).not.toBe(older.id);

    await expect(
      expenses.create(firmId, { caseId: "00000000-0000-4000-8000-00000000dead" }),
    ).rejects.toMatchObject({ statusCode: 400, message: EXPENSE_CASE_MISSING_MESSAGE });
    await expect(
      expenses.create(firmId, { caseId: "k1" }),
    ).rejects.toMatchObject({ statusCode: 400, message: EXPENSE_CASE_MESSAGE });

    await cases.delete(firmId, older.id);
    await expect(
      expenses.create(firmId, { caseId: older.id }),
    ).rejects.toMatchObject({ statusCode: 400, message: EXPENSE_CASE_MISSING_MESSAGE });

    // No rows were written by the failed creates beyond the defaulted one.
    expect((await expenses.list(firmId)).map((e) => e.caseId)).toEqual([newest.id]);
  });

  it("cross-firm isolation: other firm's expense 404s, lists never leak", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases, expenses } = build(mailer);
    const a = await firmWithOwner(auth, mailer, "owner@firm-a.example");
    const b = await firmWithOwner(auth, mailer, "owner@firm-b.example");
    const firmA = a.registered.firm.id;
    const firmB = b.registered.firm.id;

    const caseA = await cases.create(firmA, { title: "A's Matter" });
    const caseB = await cases.create(firmB, { title: "B's Matter" });
    const expenseA = await expenses.create(firmA, { caseId: caseA.id, amount: 100 });
    const expenseB = await expenses.create(firmB, { caseId: caseB.id, amount: 200 });

    for (const op of [
      () => expenses.update(firmB, expenseA.id, { description: "Hijacked" }),
      () => expenses.delete(firmB, expenseA.id),
    ]) {
      await expect(op()).rejects.toMatchObject({
        statusCode: 404, message: "Expense not found",
      });
    }
    expect((await expenses.list(firmA)).map((e) => e.id)).toEqual([expenseA.id]);
    expect((await expenses.list(firmB)).map((e) => e.id)).toEqual([expenseB.id]);
  });

  it("soft delete: the row stays with deleted_at stamped and reads drop it; invoiced rows stay CRUD-able", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases, expenses } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;
    const kase = await cases.create(firmId, { title: "Partition Suit" });

    const first = await expenses.create(firmId, { caseId: kase.id, amount: 100 });
    const second = await expenses.create(firmId, { caseId: kase.id, amount: 200 });
    await expenses.delete(firmId, first.id);

    await expect(expenses.update(firmId, first.id, { description: "Zombie" })).rejects.toMatchObject({
      statusCode: 404, message: "Expense not found",
    });
    expect((await expenses.list(firmId)).map((e) => e.id)).toEqual([second.id]);

    // The row itself survives (ADR-0003 audit trail) with deleted_at stamped.
    const rows = await handle.sql`select deleted_at from expenses where id = ${first.id}`;
    expect((rows[0] as { deleted_at: Date | null }).deleted_at).not.toBeNull();

    // Ticket 13's seam marks an expense invoiced; the reference gates
    // nothing, so patch/delete still flow.
    await handle.sql`update expenses set invoiced = true where id = ${second.id}`;
    const invoiced = await expenses.update(firmId, second.id, { amount: 300 });
    expect(invoiced.invoiced).toBe(true);
    expect(invoiced.amount).toBe(300);
    await expenses.delete(firmId, second.id);
    expect(await expenses.list(firmId)).toEqual([]);
  });

  it("validation is the service's: bad amounts, categories, ids and unknown cases are 400 before any insert", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases, expenses } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;
    const kase = await cases.create(firmId, { title: "Partition Suit" });

    await expect(
      expenses.create(firmId, { amount: 10.5 }),
    ).rejects.toMatchObject({ statusCode: 400, message: EXPENSE_AMOUNT_MESSAGE });
    await expect(
      expenses.create(firmId, { category: "hardware" }),
    ).rejects.toMatchObject({ statusCode: 400, message: EXPENSE_CATEGORY_MESSAGE });
    await expect(
      expenses.create(firmId, { caseId: "k1" }),
    ).rejects.toMatchObject({ statusCode: 400, message: EXPENSE_CASE_MESSAGE });
    await expect(
      expenses.create(firmId, { caseId: "00000000-0000-4000-8000-00000000dead" }),
    ).rejects.toMatchObject({ statusCode: 400, message: EXPENSE_CASE_MISSING_MESSAGE });
    // No rows were written by the failed creates.
    expect(await expenses.list(firmId)).toEqual([]);

    const real = await expenses.create(firmId, { caseId: kase.id, amount: 500 });
    expect((await expenses.list(firmId)).map((e) => e.id)).toEqual([real.id]);
  });

  it("ticket 13's invoiced seam: the unbilled selector and the flip path are firm-scoped and drizzle-persisted", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases, expenses } = build(mailer);
    const a = await firmWithOwner(auth, mailer, "owner@firm-a.example");
    const b = await firmWithOwner(auth, mailer, "owner@firm-b.example");
    const firmA = a.registered.firm.id;
    const firmB = b.registered.firm.id;

    const caseA = await cases.create(firmA, { title: "A's Matter" });
    const caseB = await cases.create(firmB, { title: "B's Matter" });
    const unbilled1 = await expenses.create(firmA, { caseId: caseA.id, amount: 100 });
    const unbilled2 = await expenses.create(firmA, { caseId: caseA.id, amount: 200 });
    const billed = await expenses.create(firmA, { caseId: caseA.id, amount: 300 });
    const foreign = await expenses.create(firmB, { caseId: caseB.id, amount: 400 });

    // The selector: only case A's uninvoiced live expenses, newest first —
    // the other firm's stay out even for the same case id.
    const unbilled = await expenses.listUninvoicedByCase(firmA, caseA.id);
    expect(unbilled.map((e) => e.id)).toEqual([billed.id, unbilled2.id, unbilled1.id]);
    expect(await expenses.listUninvoicedByCase(firmB, caseA.id)).toEqual([]);
    await expect(expenses.listUninvoicedByCase(firmA, "k1")).rejects.toMatchObject({
      statusCode: 400, message: EXPENSE_CASE_MESSAGE,
    });

    // The flip path: marks exactly the named live expenses of the firm.
    const moved = await expenses.setInvoiced(firmA, [unbilled1.id, billed.id, foreign.id], true);
    expect(moved).toBe(2); // the cross-firm id is silently inert
    expect(await expenses.listUninvoicedByCase(firmA, caseA.id).then((rows) => rows.map((e) => e.id)))
      .toEqual([unbilled2.id]);

    // Really persisted, and reversible (the un-mark path).
    const rows = await handle.sql`select id, invoiced from expenses where invoiced = true`;
    expect((rows as unknown as { id: string }[]).map((r) => r.id).sort()).toEqual([billed.id, unbilled1.id].sort());
    expect(await expenses.setInvoiced(firmA, [unbilled1.id], false)).toBe(1);
    expect((await expenses.listUninvoicedByCase(firmA, caseA.id)).map((e) => e.id))
      .toEqual([unbilled2.id, unbilled1.id]);
  });
});
