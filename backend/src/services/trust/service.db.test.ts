import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, migrationsFolder, requireDb, type DbHandle } from "../../db/client.js";
import { createDrizzleRepositories } from "../auth/drizzle-repository.js";
import { AuthService } from "../auth/service.js";
import { CapturingMailer } from "../auth/testing.js";
import { ContactsService } from "../contacts/service.js";
import { InvoicesService } from "../invoices/service.js";
import { PaymentsService } from "../payments/service.js";
import { TRUST_CLIENT_MISSING_MESSAGE, TrustService } from "./service.js";

/**
 * DB-backed twin of the trust suite (service.db.test.ts pattern): the same
 * flows as the in-memory tests, run against real Postgres so the Drizzle
 * binding proves it implements the seam identically — append-order listing,
 * firm scoping, the day-string date, the SIGNED bigint paise amount and
 * balance_after readback, the NULLABLE client/case FKs behind unlinked
 * deposits, the seq insertion-order stamp, the ticket-14 hook (a
 * trust-flagged payment appends its entry in the payment's own transaction),
 * the per-client advisory lock under genuine concurrent appends, and
 * reconcile detecting a tampered balance. Runs only when DATABASE_URL is
 * exported and skips silently otherwise; point it at a scratch database
 * (truncates).
 */
describe.skipIf(!process.env.DATABASE_URL)("trust ledger against Postgres", () => {
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
      contacts: new ContactsService(repos),
      invoices: new InvoicesService(repos),
      payments: new PaymentsService(repos),
      trust: new TrustService(repos),
    };
  }

  it("append → the columns really persisted on drizzle: day-string date, SIGNED bigint paise, nullable FKs, seq append order — and the ticket-14 hook appends in the payment's transaction", async () => {
    const mailer = new CapturingMailer();
    const { auth, contacts, invoices, payments, trust } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;
    const client = await contacts.create(firmId, { name: "Trust Client" });
    const invoice = await invoices.create(firmId, {
      clientId: client.id,
      lines: [{ description: "Work", quantity: 1, rate: 500000, kind: "flat" }],
    });

    // Linked trust payment through the hook: the ledger entry commits with
    // the payment, carrying the invoice's number/case/client.
    await payments.record(firmId, {
      invoiceId: invoice.id, amount: 250000, trustAccount: true,
    });
    // Unlinked trust deposit: null case, the same client's chain continues.
    await payments.record(firmId, { clientId: client.id, amount: 100000, trustAccount: true });
    // A disbursement (−) through the service seam: the chain carries it.
    await trust.append(firmId, { clientId: client.id, amount: -200000, description: "Fees transferred" });

    const listed = await trust.list(firmId);
    expect(listed).toHaveLength(3);
    expect(listed.map((t) => [t.amount, t.balanceAfter])).toEqual([
      [250000, 250000],
      [100000, 350000],
      [-200000, 150000],
    ]);
    expect(listed[0]!.clientId).toBe(client.id);
    expect(listed[0]!.caseId).toBe(""); // the invoice has no case — null renders ""
    expect(listed[0]!.description).toBe(
      `Trust deposit — invoice ${(await invoices.get(firmId, invoice.id)).number}`,
    );
    expect(listed[1]!.description).toBe("Trust deposit — invoice (unlinked)");

    // The rows really persisted: day strings, bigint-as-string paise, NULL
    // FKs where the entry is unlinked, seq strictly increasing in append
    // order, no updated_at/deleted_at columns at all.
    const rows = (await handle.sql`
      select client_id, case_id, date::text as date_text, amount, balance_after,
             seq::text as seq, description
      from trust_transactions order by seq`) as unknown as {
      client_id: string; case_id: string | null; date_text: string; amount: string;
      balance_after: string; seq: string; description: string;
    }[];
    expect(rows).toHaveLength(3);
    const [first, second, third] = rows as [
      (typeof rows)[number], (typeof rows)[number], (typeof rows)[number],
    ];
    expect(first.date_text).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.amount).toBe("250000");
    expect(first.balance_after).toBe("250000");
    expect(first.client_id).toBe(client.id);
    expect(first.case_id).toBeNull();
    expect(second.case_id).toBeNull();
    expect(third.amount).toBe("-200000");
    expect(third.balance_after).toBe("150000");
    // bigserial (int8) reads back as a string; truncate keeps the sequence
    // running, so assert strict +1 steps, not absolute values.
    const seqs = [first, second, third].map((r) => Number(r.seq));
    expect(seqs).toEqual([seqs[0], seqs[0]! + 1, seqs[0]! + 2]);

    // Reconcile recomputes the chain from the history alone: clean here.
    expect(await trust.reconcile(firmId)).toEqual({
      ok: true, entries: 3, clients: 1, mismatches: [],
    });
  });

  it("genuinely concurrent appends for the same client serialize on the advisory lock — the balance chain never forks", async () => {
    const mailer = new CapturingMailer();
    const { auth, contacts, trust } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;
    const client = await contacts.create(firmId, { name: "Racing Client" });
    const other = await contacts.create(firmId, { name: "Quiet Client" });

    // Fifteen appends racing through their own transactions: twelve on one
    // client, five on another. Without the per-client lock two same-client
    // transactions would read the same predecessor and fork the chain.
    const racing = Array.from({ length: 12 }, (_, i) =>
      trust.append(firmId, { clientId: client.id, amount: i + 1, description: "Deposit" }),
    );
    const quiet = Array.from({ length: 5 }, () =>
      trust.append(firmId, { clientId: other.id, amount: 100000, description: "Deposit" }),
    );
    const settled = await Promise.all([...racing, ...quiet]);
    expect(settled).toHaveLength(17);

    // Every client's chain: balanceAfter is the exact running Σ of the
    // amounts appended so far — 78 = Σ 1..12 and 500000 = 5 × 100000 — and
    // each client's seqs are strictly increasing in append order.
    const rows = (await handle.sql`
      select client_id, amount::text as amount, balance_after::text as balance_after,
             seq::text as seq
      from trust_transactions order by client_id, seq`) as unknown as {
      client_id: string; amount: string; balance_after: string; seq: string;
    }[];
    const perClient = new Map<string, { amount: number; balanceAfter: number; seq: number }[]>();
    for (const row of rows) {
      const list = perClient.get(row.client_id) ?? [];
      const running = (list[list.length - 1]?.balanceAfter ?? 0) + Number(row.amount);
      expect(Number(row.balance_after), JSON.stringify(row)).toBe(running);
      list.push({ amount: Number(row.amount), balanceAfter: running, seq: Number(row.seq) });
      perClient.set(row.client_id, list);
    }
    expect(perClient.get(client.id)).toHaveLength(12);
    expect(perClient.get(other.id)).toHaveLength(5);
    expect(perClient.get(client.id)!.at(-1)!.balanceAfter).toBe(78);
    expect(perClient.get(other.id)!.at(-1)!.balanceAfter).toBe(500000);
    for (const entries of perClient.values()) {
      const seqs = entries.map((e) => e.seq);
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    }

    expect((await trust.reconcile(firmId)).ok).toBe(true);
  });

  it("a tampered ledger is detected: one corrupted balance_after is reported with the recomputed value", async () => {
    const mailer = new CapturingMailer();
    const { auth, contacts, trust } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;
    const client = await contacts.create(firmId, { name: "Audited Client" });
    await trust.append(firmId, { clientId: client.id, amount: 500000 });
    await trust.append(firmId, { clientId: client.id, amount: -200000 });
    await trust.append(firmId, { clientId: client.id, amount: 100000 });

    // Tamper OUTSIDE the service (what a stray UPDATE would do).
    await handle.sql`
      update trust_transactions set balance_after = 999999 where amount = -200000`;

    const report = await trust.reconcile(firmId);
    expect(report.ok).toBe(false);
    expect(report.entries).toBe(3);
    expect(report.mismatches).toEqual([
      expect.objectContaining({ clientId: client.id, stored: 999999, computed: 300000 }),
    ]);

    // The ledger stays append-only through the service — no API path exists
    // to "fix" the row; correction is a raw-SQL operator's prerogative, and
    // once the stored value agrees with the history again, reconcile goes
    // green (it is a pure recomputation, never a repair).
    await handle.sql`update trust_transactions set balance_after = 300000 where amount = -200000`;
    expect((await trust.reconcile(firmId)).ok).toBe(true);
    expect(await trust.list(firmId)).toHaveLength(3);
  });

  it("cross-firm isolation on Postgres: a foreign client appends nothing, lists and reconcile never leak", async () => {
    const mailer = new CapturingMailer();
    const { auth, contacts, trust } = build(mailer);
    const a = await firmWithOwner(auth, mailer, "owner@firm-a.example");
    const b = await firmWithOwner(auth, mailer, "owner@firm-b.example");
    const firmA = a.registered.firm.id;
    const firmB = b.registered.firm.id;

    const clientA = await contacts.create(firmA, { name: "Firm A Client" });
    await trust.append(firmA, { clientId: clientA.id, amount: 500000, description: "Retainer" });

    for (const clientId of [clientA.id, "00000000-0000-4000-8000-00000000dead"]) {
      await expect(
        trust.append(firmB, { clientId, amount: 250000 }),
      ).rejects.toMatchObject({ statusCode: 400, message: TRUST_CLIENT_MISSING_MESSAGE });
    }

    expect(await trust.list(firmB)).toEqual([]);
    expect(await trust.reconcile(firmB)).toEqual({
      ok: true, entries: 0, clients: 0, mismatches: [],
    });
    const ledgerA = await trust.list(firmA);
    expect(ledgerA).toHaveLength(1);
    expect(ledgerA[0]!.balanceAfter).toBe(500000);
    expect((await trust.reconcile(firmA)).ok).toBe(true);
  });

  it("a soft-deleted client: no new entries on Postgres either, the money history survives untouched", async () => {
    const mailer = new CapturingMailer();
    const { auth, contacts, trust } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;
    const client = await contacts.create(firmId, { name: "Departing Client" });
    await trust.append(firmId, { clientId: client.id, amount: 750000, description: "Retainer" });

    await contacts.delete(firmId, client.id);

    await expect(
      trust.append(firmId, { clientId: client.id, amount: -250000 }),
    ).rejects.toMatchObject({ statusCode: 400, message: TRUST_CLIENT_MISSING_MESSAGE });

    const ledger = await trust.list(firmId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ clientId: client.id, amount: 750000, balanceAfter: 750000 });
    expect((await trust.reconcile(firmId)).ok).toBe(true);
  });
});
