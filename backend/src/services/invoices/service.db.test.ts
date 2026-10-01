import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, migrationsFolder, requireDb, type DbHandle } from "../../db/client.js";
import { createDrizzleRepositories } from "../auth/drizzle-repository.js";
import { AuthService } from "../auth/service.js";
import { CapturingMailer } from "../auth/testing.js";
import { CasesService } from "../cases/service.js";
import { ContactsService } from "../contacts/service.js";
import {
  INVOICE_CASE_MISSING_MESSAGE,
  INVOICE_CLIENT_MISSING_MESSAGE,
  InvoicesService,
} from "./service.js";

/**
 * DB-backed twin of the invoices suite (service.db.test.ts pattern): the
 * same flows as the in-memory route tests, run against real Postgres so the
 * Drizzle binding proves it implements the seam identically — newest-first
 * ordering, firm scoping, the soft delete behind 404s, the counter-backed
 * INV-XXXX numbering (atomic enough for two parallel creates), the
 * date-mode-string issue/due columns, the double-precision quantity
 * round-trip, the server-computed bigint-paise line amounts (exact even for
 * minutes/60 quantities), and the NULL V2 tax-seam columns. Runs only when
 * DATABASE_URL is exported and skips silently otherwise; point it at a
 * scratch database (truncates).
 */
describe.skipIf(!process.env.DATABASE_URL)("invoices against Postgres", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = requireDb();
    await migrate(handle.db, { migrationsFolder });
  });

  afterEach(async () => {
    await handle.sql.unsafe(
      "truncate table case_number_counters, cases, contacts, documents, email_outbox, expenses, events, invoice_line_items, invoice_number_counters, invoices, lead_stage_history, leads, payments, tasks, time_entries, password_reset_tokens, sessions, trust_transactions, users, firms cascade",
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
      contacts: new ContactsService(repos),
      invoices: new InvoicesService(repos),
    };
  }

  it("create → reference defaults, contract shape, and the columns really persisted on drizzle", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases, contacts, invoices } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;
    const kase = await cases.create(firmId, { title: "Partition Suit" });
    const client = await contacts.create(firmId, { name: "Invoice Client" });

    const today = new Date().toISOString().slice(0, 10);
    const due = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    const first = await invoices.create(firmId, {
      clientId: client.id,
      caseId: kase.id,
      notes: "Net 30.",
      lines: [
        { description: "Consult (1.5 hrs)", quantity: 1.5, rate: 300000, kind: "time" },
        { description: "Court filing fee", quantity: 1, rate: 20000, kind: "expense" },
      ],
    });
    expect(first).toMatchObject({
      number: "INV-0001",
      clientId: client.id,
      caseId: kase.id,
      issued: today,
      due,
      status: "draft",
      notes: "Net 30.",
    });
    expect(first.lines.map((l) => l.quantity)).toEqual([1.5, 1]);

    // The bare create lands on every reference default.
    const bare = await invoices.create(firmId, {});
    expect(bare).toMatchObject({
      number: "INV-0002", clientId: "", caseId: "", status: "draft",
      issued: today, due, lines: [],
    });

    // Newest first — the reference unshifts.
    const listed = await invoices.list(firmId);
    expect(listed.map((i) => i.number)).toEqual(["INV-0002", "INV-0001"]);

    // The invoice row, its line rows and the counter really persisted: the
    // date columns as day strings, quantity as an exact double, rate/amount
    // as bigint paise (Number() cast — bigint reads back as a string here),
    // the V2 tax seam NULL, and the partial-unique-backed counter row at 2.
    const rows = await handle.sql`
      select number, client_id, case_id, status, issue_date::text as issue_text,
             due_date::text as due_text, notes, deleted_at
      from invoices where id = ${first.id}`;
    const row = rows[0] as {
      number: string; client_id: string; case_id: string; status: string;
      issue_text: string; due_text: string; notes: string | null; deleted_at: Date | null;
    };
    expect(row.number).toBe("INV-0001");
    expect(row.client_id).toBe(client.id);
    expect(row.case_id).toBe(kase.id);
    expect(row.status).toBe("draft");
    expect(row.issue_text).toBe(today);
    expect(row.due_text).toBe(due);
    expect(row.notes).toBe("Net 30.");
    expect(row.deleted_at).toBeNull();

    const lineRows = await handle.sql`
      select position, description, quantity, rate, amount, kind, tax_rate, tax_amount
      from invoice_line_items where invoice_id = ${first.id} order by position`;
    expect(lineRows).toHaveLength(2);
    const line0 = lineRows[0] as {
      position: number; description: string; quantity: number; rate: string;
      amount: string; kind: string; tax_rate: string | null; tax_amount: string | null;
    };
    expect(line0).toEqual({
      position: 0, description: "Consult (1.5 hrs)", quantity: 1.5, rate: "300000",
      amount: "450000", kind: "time", tax_rate: null, tax_amount: null,
    });
    expect((lineRows[1] as { amount: string }).amount).toBe("20000");

    const counters = await handle.sql`
      select last_value from invoice_number_counters where firm_id = ${firmId}`;
    expect(Number((counters[0] as { last_value: number }).last_value)).toBe(2);
  });

  it("the line math is exact paise even for minutes/60 quantities", async () => {
    const mailer = new CapturingMailer();
    const { auth, invoices } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    const created = await invoices.create(firmId, {
      lines: [
        { description: "90 min", quantity: 90 / 60, rate: 300000, kind: "time" },
        { description: "10 min", quantity: 10 / 60, rate: 300000, kind: "time" },
        { description: "1 min", quantity: 1 / 60, rate: 300000, kind: "time" },
        { description: "7 min at odd rate", quantity: 7 / 60, rate: 450000, kind: "time" },
      ],
    });
    const stored = await handle.sql`
      select description, amount from invoice_line_items
      where invoice_id = ${created.id} order by position`;
    expect(stored.map((r) => [(r as { description: string }).description, Number((r as { amount: string }).amount)]))
      .toEqual([
        ["90 min", 450000],
        ["10 min", 50000],
        ["1 min", 5000],
        ["7 min at odd rate", 52500], // 7 × 450000 / 60, exact real math
      ]);

    // The total seam ticket 14's roll-up reads: the exact Σ of the stored
    // amounts — 505000 (450000 + 50000 + 5000) + 52500 — and 404 for an
    // unknown invoice.
    expect(await invoices.totalPaise(firmId, created.id)).toBe(557500);
    await expect(invoices.totalPaise(firmId, "00000000-0000-4000-8000-00000000dead"))
      .rejects.toMatchObject({ statusCode: 404, message: "Invoice not found" });
  });

  it("numbering: sequential per firm, independent across firms, and safe under two parallel creates", async () => {
    const mailer = new CapturingMailer();
    const { auth, invoices } = build(mailer);
    const a = await firmWithOwner(auth, mailer, "owner@firm-a.example");
    const b = await firmWithOwner(auth, mailer, "owner@firm-b.example");
    const firmA = a.registered.firm.id;
    const firmB = b.registered.firm.id;

    const first = await invoices.create(firmA, {});
    const second = await invoices.create(firmA, {});
    expect([first.number, second.number]).toEqual(["INV-0001", "INV-0002"]);

    const bFirst = await invoices.create(firmB, {});
    expect(bFirst.number).toBe("INV-0001");

    // Two parallel creates in one firm: the counter row's lock serializes the
    // sequence — distinct numbers, both created, no unique violation.
    const [p1, p2] = await Promise.all([
      invoices.create(firmA, {}),
      invoices.create(firmA, {}),
    ]);
    expect(new Set([p1.number, p2.number]).size).toBe(2);
    expect([p1.number, p2.number].sort()).toEqual(["INV-0003", "INV-0004"]);
    expect((await invoices.list(firmA)).length).toBe(4);
  });

  it("status and date patches persist; a lines patch replaces the set (old rows hard-deleted, amounts recomputed)", async () => {
    const mailer = new CapturingMailer();
    const { auth, invoices } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    const created = await invoices.create(firmId, {
      lines: [{ description: "Old line", quantity: 1, rate: 100000, kind: "flat" }],
    });

    const updated = await invoices.update(firmId, created.id, {
      status: "sent",
      issued: "2026-09-01",
      due: "2026-10-01",
      lines: [
        { description: "New work (6 hrs)", quantity: 6, rate: 300000, kind: "time" },
        { description: "Copies", quantity: 3, rate: 2500, kind: "expense" },
      ],
    });
    expect(updated).toMatchObject({ status: "sent", issued: "2026-09-01", due: "2026-10-01" });

    // The value set was swapped in the same transaction: exactly the new lines
    // remain, and the double-precision quantity round-trips exactly.
    const rows = await handle.sql`
      select description, quantity, rate, amount, kind
      from invoice_line_items where invoice_id = ${created.id} order by position`;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [
      (r as { description: string }).description,
      (r as { quantity: number }).quantity,
      Number((r as { rate: string }).rate),
      Number((r as { amount: string }).amount),
    ])).toEqual([
      ["New work (6 hrs)", 6, 300000, 1800000],
      ["Copies", 3, 2500, 7500],
    ]);

    const invoiceRow = await handle.sql`
      select status, issue_date::text as issue_text from invoices where id = ${created.id}`;
    expect((invoiceRow[0] as { status: string; issue_text: string })).toEqual({
      status: "sent", issue_text: "2026-09-01",
    });
  });

  it("cross-firm isolation: other firm's invoice 404s, lists never leak", async () => {
    const mailer = new CapturingMailer();
    const { auth, invoices } = build(mailer);
    const a = await firmWithOwner(auth, mailer, "owner@firm-a.example");
    const b = await firmWithOwner(auth, mailer, "owner@firm-b.example");
    const firmA = a.registered.firm.id;
    const firmB = b.registered.firm.id;

    const invoiceA = await invoices.create(firmA, { lines: [{ quantity: 1, rate: 100 }] });
    const invoiceB = await invoices.create(firmB, {});

    for (const op of [
      () => invoices.get(firmB, invoiceA.id),
      () => invoices.update(firmB, invoiceA.id, { status: "paid" }),
      () => invoices.delete(firmB, invoiceA.id),
    ]) {
      await expect(op()).rejects.toMatchObject({
        statusCode: 404, message: "Invoice not found",
      });
    }
    expect((await invoices.list(firmA)).map((i) => i.id)).toEqual([invoiceA.id]);
    expect((await invoices.list(firmB)).map((i) => i.id)).toEqual([invoiceB.id]);
  });

  it("soft delete: the row stays with deleted_at stamped, reads drop it, and the number is never reused", async () => {
    const mailer = new CapturingMailer();
    const { auth, invoices } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    const first = await invoices.create(firmId, {});
    const second = await invoices.create(firmId, {});
    await invoices.delete(firmId, second.id);

    await expect(invoices.update(firmId, second.id, { status: "paid" })).rejects.toMatchObject({
      statusCode: 404, message: "Invoice not found",
    });
    expect((await invoices.list(firmId)).map((i) => i.id)).toEqual([first.id]);

    // The row itself survives (ADR-0003 audit trail) with deleted_at stamped,
    // and its line rows ride along behind the invoice join.
    const rows = await handle.sql`select deleted_at from invoices where id = ${second.id}`;
    expect((rows[0] as { deleted_at: Date | null }).deleted_at).not.toBeNull();

    const third = await invoices.create(firmId, {});
    expect(third.number).toBe("INV-0003");
    expect(third.number).not.toBe(second.number);
  });

  it("links are existence-checked: unknown or foreign cases/clients are 400s before anything is written", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases, contacts, invoices } = build(mailer);
    const a = await firmWithOwner(auth, mailer, "owner@firm-a.example");
    const b = await firmWithOwner(auth, mailer, "owner@firm-b.example");
    const firmA = a.registered.firm.id;
    const firmB = b.registered.firm.id;

    const caseB = await cases.create(firmB, { title: "B's Matter" });
    const contactB = await contacts.create(firmB, { name: "B's Client" });

    for (const input of [
      { caseId: caseB.id },
      { clientId: contactB.id },
      { caseId: "00000000-0000-4000-8000-00000000dead" },
    ]) {
      await expect(invoices.create(firmA, input)).rejects.toMatchObject({
        statusCode: 400,
        message: input.clientId !== undefined
          ? INVOICE_CLIENT_MISSING_MESSAGE
          : INVOICE_CASE_MISSING_MESSAGE,
      });
    }
    // Nothing was written by the failed creates.
    expect(await invoices.list(firmA)).toEqual([]);

    const linked = await invoices.create(firmA, {
      caseId: (await cases.create(firmA, { title: "A's Matter" })).id,
      clientId: (await contacts.create(firmA, { name: "A's Client" })).id,
    });
    expect(linked.caseId).not.toBe("");
    expect(linked.clientId).not.toBe("");
  });
});
