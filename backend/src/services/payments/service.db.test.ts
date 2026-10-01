import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, migrationsFolder, requireDb, type DbHandle } from "../../db/client.js";
import { createDrizzleRepositories } from "../auth/drizzle-repository.js";
import { AuthService } from "../auth/service.js";
import { CapturingMailer } from "../auth/testing.js";
import { ContactsService } from "../contacts/service.js";
import { InvoicesService } from "../invoices/service.js";
import { PaymentsService } from "./service.js";

/**
 * DB-backed twin of the payments suite (service.db.test.ts pattern): the
 * same flows as the in-memory route tests, run against real Postgres so the
 * Drizzle binding proves it implements the seam identically — newest-first
 * ordering, firm scoping, the in-transaction roll-up (partial draft stays
 * draft, Σ ≥ total flips paid), the date-mode-string day column, the bigint
 * paise amount readback, the NULLABLE invoice/client FKs behind unlinked
 * payments, and the trust_account flag round-trip (ticket 15's input).
 * Runs only when DATABASE_URL is exported and skips silently otherwise;
 * point it at a scratch database (truncates).
 */
describe.skipIf(!process.env.DATABASE_URL)("payments against Postgres", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = requireDb();
    await migrate(handle.db, { migrationsFolder });
  });

  afterEach(async () => {
    await handle.sql.unsafe(
      "truncate table case_number_counters, cases, contacts, documents, email_outbox, expenses, events, invoice_line_items, invoice_number_counters, invoices, lead_stage_history, leads, notifications, payments, tasks, thread_messages, threads, time_entries, password_reset_tokens, sessions, trust_transactions, users, firms cascade",
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
      invoices: new InvoicesService(repos),
      payments: new PaymentsService(repos),
    };
  }

  it("record → the columns really persisted on drizzle: day-string date, bigint paise amount, server status, nullable FKs", async () => {
    const mailer = new CapturingMailer();
    const { auth, contacts, invoices, payments } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;
    const client = await contacts.create(firmId, { name: "Paying Client" });
    const invoice = await invoices.create(firmId, {
      clientId: client.id,
      lines: [{ description: "Work", quantity: 1, rate: 500000, kind: "flat" }],
    });

    const today = new Date().toISOString().slice(0, 10);
    const payment = await payments.record(firmId, {
      invoiceId: invoice.id,
      amount: 250000,
      method: "echeck",
    });
    expect(payment).toMatchObject({
      invoiceId: invoice.id,
      clientId: client.id, // fell back to the invoice's client
      date: today,
      amount: 250000,
      method: "echeck",
      status: "deposited",
      trustAccount: false,
    });

    // An explicit no-client unlinked trust payment lands invoice_id/client_id NULL.
    const unlinked = await payments.record(firmId, {
      clientId: client.id, amount: 50000, trustAccount: true,
    });
    expect(unlinked).toMatchObject({ invoiceId: "", clientId: client.id, trustAccount: true });

    const rows = await handle.sql`
      select invoice_id, client_id, date::text as date_text, amount, method,
             status, trust_account, deleted_at
      from payments where id = ${payment.id}`;
    const row = rows[0] as {
      invoice_id: string; client_id: string; date_text: string; amount: string;
      method: string; status: string; trust_account: boolean; deleted_at: Date | null;
    };
    expect(row).toEqual({
      invoice_id: invoice.id,
      client_id: client.id,
      date_text: today,
      amount: "250000", // bigint reads back as a string here; exact paise
      method: "echeck",
      status: "deposited",
      trust_account: false,
      deleted_at: null,
    });

    const unlinkedRow = (await handle.sql`
      select invoice_id, trust_account from payments where id = ${unlinked.id}`)[0] as {
      invoice_id: string | null; trust_account: boolean;
    };
    expect(unlinkedRow.invoice_id).toBeNull();
    expect(unlinkedRow.trust_account).toBe(true);

    // Newest first — the reference unshifts.
    const listed = await payments.list(firmId);
    expect(listed.map((p) => p.amount)).toEqual([50000, 250000]);
  });

  it("roll-up commits with the payment: partial draft stays draft, Σ ≥ total flips paid, repeated reads agree", async () => {
    const mailer = new CapturingMailer();
    const { auth, invoices, payments } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;
    const invoice = await invoices.create(firmId, {
      lines: [{ description: "Work", quantity: 1, rate: 500000, kind: "flat" }],
    });

    await payments.record(firmId, { invoiceId: invoice.id, amount: 250000 });
    expect((await invoices.get(firmId, invoice.id)).status).toBe("draft");

    await payments.record(firmId, { invoiceId: invoice.id, amount: 250000, method: "card" });
    expect((await invoices.get(firmId, invoice.id)).status).toBe("paid");

    // The status is persisted, not derived at read time.
    const rows = await handle.sql`
      select status from invoices where id = ${invoice.id}`;
    expect((rows[0] as { status: string }).status).toBe("paid");

    // The roll-up's paid figure comes from the stored rows: two live payments.
    const sum = await handle.sql`
      select coalesce(sum(amount), 0) as total from payments
      where invoice_id = ${invoice.id} and status <> 'failed'`;
    expect(Number((sum[0] as { total: string }).total)).toBe(500000);
  });

  it("cross-firm isolation: another firm's invoice 404s, writes nothing, lists never leak", async () => {
    const mailer = new CapturingMailer();
    const { auth, invoices, payments } = build(mailer);
    const a = await firmWithOwner(auth, mailer, "owner@firm-a.example");
    const b = await firmWithOwner(auth, mailer, "owner@firm-b.example");
    const firmA = a.registered.firm.id;
    const firmB = b.registered.firm.id;

    const invoiceA = await invoices.create(firmA, {
      lines: [{ description: "Work", quantity: 1, rate: 500000, kind: "flat" }],
    });
    await payments.record(firmA, { invoiceId: invoiceA.id, amount: 250000 });
    const invoiceB = await invoices.create(firmB, {});

    for (const op of [
      () => payments.record(firmB, { invoiceId: invoiceA.id, amount: 250000 }),
      () => payments.record(firmB, { invoiceId: "00000000-0000-4000-8000-00000000dead", amount: 250000 }),
    ]) {
      await expect(op()).rejects.toMatchObject({
        statusCode: 404, message: "Invoice not found",
      });
    }

    expect(await payments.list(firmB)).toEqual([]);
    expect((await payments.list(firmA)).map((p) => p.invoiceId)).toEqual([invoiceA.id]);
    expect((await invoices.get(firmA, invoiceA.id)).status).toBe("draft");
    expect(invoiceB.id).toEqual(expect.any(String));
  });
});
