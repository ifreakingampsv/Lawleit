import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb } from "../db/client.js";
import type { AppConfig } from "../config.js";
import type { FastifyInstance } from "fastify";
import { InMemoryTrustRepository } from "../services/trust/in-memory.js";
import {
  TRUST_AMOUNT_MESSAGE,
  TRUST_CLIENT_MESSAGE,
  TRUST_CLIENT_MISSING_MESSAGE,
  TRUST_DATE_MESSAGE,
  TrustService,
} from "../services/trust/service.js";
import type { TrustTransactionRow } from "../services/trust/repository.js";
import type { TrustEntryInput } from "../services/trust/service.js";
import { CapturingMailer, inMemoryAuthRepositories } from "../services/auth/testing.js";
import type { AuthRepositories } from "../services/auth/repository.js";

/**
 * Trust ledger routes + service (ticket 15) — in-memory repos,
 * payments.routes.test.ts shape. The correctness-critical module; the
 * behavior matrix, contract + reference backend (server.mjs) as north stars:
 *
 *   GET  /trust/transactions   200 array in APPEND order (oldest first —
 *                              the reference's db.trust order), firm-scoped
 *   POST /payments             with trustAccount: true appends the ledger
 *                              entry in the SAME transaction (the ticket-14
 *                              hook): description/caseId/date/amount exactly
 *                              the reference's appendTrust, running
 *                              balanceAfter per client
 *
 * and, at the service seam (the contract defines no deposit/withdrawal or
 * reconcile ROUTE — none is invented):
 *
 *   TrustService.append        deposits (+) and disbursements (−) with the
 *                              same running-balance rule (the V2 retainer
 *                              seam; the deposit→withdraw→deposit chain tests)
 *   TrustService.reconcile     recomputes the balance chain from the
 *                              append-only history alone and reports drift —
 *                              a tampered balanceAfter is detected
 *
 * Permissions: every firm member reads the ledger (practice data, no owner
 * gate). Anonymous 401; no-database 503 envelope.
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

/** The UTC day the services stamp into `date`. */
const today = () => new Date().toISOString().slice(0, 10);

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

/** Creates one client contact in the given firm. */
async function createClient(
  app: FastifyInstance,
  token: string,
  name: string,
): Promise<{ id: string }> {
  const res = await app.inject({
    method: "POST", url: "/api/v1/contacts", headers: bearer(token),
    payload: { name },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string };
}

/** Creates one invoice (default total 500000 paise) in the given firm. */
async function createInvoice(
  app: FastifyInstance,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown> & { id: string }> {
  const res = await app.inject({
    method: "POST", url: "/api/v1/invoices",
    headers: bearer(token),
    payload: {
      lines: [{ description: "Professional services", quantity: 1, rate: 500000, kind: "flat" }],
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as Record<string, unknown> & { id: string };
}

/** Records one payment; returns the response (never throws on status). */
async function postPayment(
  app: FastifyInstance,
  token: string,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const res = await app.inject({
    method: "POST", url: "/api/v1/payments", headers: bearer(token), payload,
  });
  return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
}

/** The firm's ledger as the client sees it (append order). */
async function getLedger(
  app: FastifyInstance,
  token: string,
): Promise<Record<string, unknown>[]> {
  const res = await app.inject({
    method: "GET", url: "/api/v1/trust/transactions", headers: bearer(token),
  });
  expect(res.statusCode).toBe(200);
  return res.json() as Record<string, unknown>[];
}

/**
 * The running-balance invariant, checked per client over the append-ordered
 * ledger: every entry's balanceAfter is exactly the sum of the amounts seen
 * so far for that client. Returns the last balance per client.
 */
function assertContinuousChain(
  entries: { clientId: string; amount: number; balanceAfter: number }[],
): Map<string, number> {
  const running = new Map<string, number>();
  for (const entry of entries) {
    const expected = (running.get(entry.clientId) ?? 0) + entry.amount;
    expect(entry.balanceAfter, JSON.stringify(entry)).toBe(expected);
    running.set(entry.clientId, expected);
  }
  return running;
}

describe("trust ledger (ticket 15)", () => {
  let app: FastifyInstance;
  let mailer: CapturingMailer;
  let repos: AuthRepositories;
  let trust: TrustService;
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
    repos = inMemoryAuthRepositories();
    trust = new TrustService(repos);
    app = await buildApp(testConfig, { repositories: repos, mailer });
    firmA = await signupFirm(app, mailer, "owner@firm-a.example", "Aditi");
    firmB = await signupFirm(app, mailer, "owner@firm-b.example", "Bharat");
  }

  it("the ticket-14 hook: a trust-flagged payment appends the reference's ledger entry in the same transaction — linked, unlinked, running balance", async () => {
    await setup();
    const client = await createClient(app, firmA.token, "Trust Client");
    const kase = await app.inject({
      method: "POST", url: "/api/v1/cases", headers: bearer(firmA.token),
      payload: { title: "Partition suit", clientId: client.id },
    });
    expect(kase.statusCode).toBe(201);
    const caseId = (kase.json() as { id: string }).id;
    const invoice = await createInvoice(app, firmA.token, { clientId: client.id, caseId });

    // Linked trust payment: the entry carries the invoice's number, case and client.
    const first = await postPayment(app, firmA.token, {
      invoiceId: invoice.id, amount: 250000, trustAccount: true,
    });
    expect(first.statusCode).toBe(201);

    let ledger = await getLedger(app, firmA.token);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toEqual({
      id: expect.any(String),
      clientId: client.id,
      caseId,
      date: today(),
      description: `Trust deposit — invoice ${String(invoice.number)}`,
      amount: 250000,
      balanceAfter: 250000,
    });

    // Unlinked trust deposit: "(unlinked)", no case, same client's chain continues.
    const unlinked = await postPayment(app, firmA.token, {
      clientId: client.id, amount: 100000, trustAccount: true,
    });
    expect(unlinked.statusCode).toBe(201);
    ledger = await getLedger(app, firmA.token);
    expect(ledger).toHaveLength(2);
    expect(ledger[1]).toMatchObject({
      clientId: client.id,
      caseId: "",
      description: "Trust deposit — invoice (unlinked)",
      amount: 100000,
      balanceAfter: 350000, // the running balance, not the payment amount
    });

    // A non-trust payment appends NOTHING (roll-up only).
    const plain = await postPayment(app, firmA.token, { invoiceId: invoice.id, amount: 250000 });
    expect(plain.statusCode).toBe(201);
    expect(await getLedger(app, firmA.token)).toHaveLength(2);

    // Contract shape only — firmId, the DB-only seq and bookkeeping stay absent.
    for (const key of ["firmId", "seq", "createdAt", "updatedAt", "deletedAt"]) {
      expect(ledger[0]).not.toHaveProperty(key);
    }
    await app.close();
  });

  it("the ledger lists in append order (oldest first, the reference's db.trust order) and a new client's chain starts at its own deposit", async () => {
    await setup();
    const client = await createClient(app, firmA.token, "Retainer Client");
    const ledgerBefore = await getLedger(app, firmA.token);
    expect(ledgerBefore).toEqual([]);

    for (const amount of [500000, 250000]) {
      const res = await postPayment(app, firmA.token, {
        clientId: client.id, amount, trustAccount: true,
      });
      expect(res.statusCode).toBe(201);
    }
    const ledger = await getLedger(app, firmA.token);
    expect(ledger.map((t) => t.amount)).toEqual([500000, 250000]);
    expect(ledger.map((t) => t.balanceAfter)).toEqual([500000, 750000]);
    await app.close();
  });

  it("deposit → withdraw → deposit produces the exact balanceAfter chain (service seam; the contract exposes no disbursement route)", async () => {
    await setup();
    const client = await createClient(app, firmA.token, "Chain Client");
    const other = await createClient(app, firmA.token, "Other Client");

    // Interleaved chains for two clients must never touch.
    await trust.append(firmA.firmId, { clientId: client.id, amount: 500000, description: "Retainer deposit" });
    await trust.append(firmA.firmId, { clientId: other.id, amount: 1000000, description: "Retainer deposit" });
    await trust.append(firmA.firmId, { clientId: client.id, amount: -200000, description: "Fees transferred" });
    await trust.append(firmA.firmId, { clientId: other.id, amount: -400000, description: "Fees transferred" });
    await trust.append(firmA.firmId, { clientId: client.id, amount: 100000, description: "Top-up" });
    await trust.append(firmA.firmId, { clientId: other.id, amount: -600000, description: "Refund of unspent retainer to client" });

    const ledger = await getLedger(app, firmA.token);
    expect(ledger.map((t) => t.balanceAfter)).toEqual([500000, 1000000, 300000, 600000, 400000, 0]);
    assertContinuousChain(ledger as never);

    // The date defaults to today when absent (the reference's `today()`), and
    // a signed amount round-trips verbatim.
    expect(ledger.every((t) => t.date === today())).toBe(true);
    expect(ledger[2]!.amount).toBe(-200000);

    // A clean ledger reconciles: continuity asserted from the history alone.
    const report = await trust.reconcile(firmA.firmId);
    expect(report).toEqual({ ok: true, entries: 6, clients: 2, mismatches: [] });
    await app.close();
  });

  it("concurrent appends for the same client never fork the balance chain", async () => {
    await setup();
    const client = await createClient(app, firmA.token, "Concurrent Client");
    const other = await createClient(app, firmA.token, "Unaffected Client");

    // Eighteen simultaneous trust deposits racing through the same hook —
    // twelve on one client, six on another. Each append's read-then-write is
    // serialized (Drizzle: per-client advisory lock; in-memory: no await
    // between read and push), so no observer can ever see a fork.
    const deposits = Array.from({ length: 12 }, (_, i) =>
      postPayment(app, firmA.token, {
        clientId: client.id, amount: i + 1, trustAccount: true,
      }),
    );
    const others = Array.from({ length: 6 }, () =>
      postPayment(app, firmA.token, {
        clientId: other.id, amount: 100000, trustAccount: true,
      }),
    );
    const results = await Promise.all([...deposits, ...others]);
    expect(results.every((r) => r.statusCode === 201)).toBe(true);

    const ledger = await getLedger(app, firmA.token);
    expect(ledger).toHaveLength(18);

    // The client's chain: every balanceAfter is the exact running Σ of the
    // amounts appended so far — regardless of the order the racing payments
    // landed in — ending at Σ 1..12 = 78.
    const mine = ledger.filter((t) => t.clientId === client.id);
    expect(mine).toHaveLength(12);
    const balances = assertContinuousChain(ledger as never);
    expect(balances.get(client.id)).toBe(78); // Σ 1..12
    expect(balances.get(other.id)).toBe(600000);

    // And reconcile agrees: a full walk finds no discontinuity.
    const report = await trust.reconcile(firmA.firmId);
    expect(report.ok).toBe(true);
    expect(report.entries).toBe(18);
    await app.close();
  });

  it("reconcile detects a tampered ledger: one corrupted balanceAfter is reported exactly, computed from the history alone", async () => {
    await setup();
    const client = await createClient(app, firmA.token, "Tampered Client");
    await trust.append(firmA.firmId, { clientId: client.id, amount: 500000 });
    await trust.append(firmA.firmId, { clientId: client.id, amount: -200000 });
    const last = await trust.append(firmA.firmId, { clientId: client.id, amount: 100000 });

    // Tamper: manually corrupt one stored balanceAfter in the in-memory store
    // (what a buggy writer or a stray UPDATE would do).
    const rows = (repos.trust as InMemoryTrustRepository).entries as TrustTransactionRow[];
    const tampered = rows.find((t) => t.amount === -200000)!;
    tampered.balanceAfter = 999999;

    const report = await trust.reconcile(firmA.firmId);
    expect(report.ok).toBe(false);
    expect(report.entries).toBe(3);
    // Exactly the tampered entry, with the recomputed value the history
    // implies — and the untampered neighbors (whose stored balances still
    // agree with the recomputed chain) report nothing.
    expect(report.mismatches).toEqual([
      { id: tampered.id, clientId: client.id, date: tampered.date, seq: tampered.seq, stored: 999999, computed: 300000 },
    ]);
    expect(tampered.id).not.toBe(last.id);
    await app.close();
  });

  it("cross-firm isolation: another firm's client writes nothing anywhere, lists never leak, reconcile sees only its own ledger", async () => {
    await setup();
    const clientA = await createClient(app, firmA.token, "Firm A Client");
    await postPayment(app, firmA.token, { clientId: clientA.id, amount: 500000, trustAccount: true });

    // Firm B cannot append to a foreign client's ledger: well-formed but
    // foreign (or unknown) → 400 before anything is written — no entry in
    // either firm.
    for (const clientId of [clientA.id, "00000000-0000-4000-8000-00000000dead"]) {
      await expect(trust.append(firmB.firmId, { clientId, amount: 250000 })).rejects.toMatchObject({
        statusCode: 400, message: TRUST_CLIENT_MISSING_MESSAGE,
      });
    }
    // A foreign client id is equally rejected through the payments hook.
    const viaHook = await postPayment(app, firmB.token, {
      clientId: clientA.id, amount: 250000, trustAccount: true,
    });
    expect(viaHook.statusCode).toBe(400);
    expect(viaHook.body).toEqual({ error: TRUST_CLIENT_MISSING_MESSAGE });

    expect(await getLedger(app, firmB.token)).toEqual([]);
    expect(await trust.reconcile(firmB.firmId)).toEqual({
      ok: true, entries: 0, clients: 0, mismatches: [],
    });

    // Firm A is untouched by B's failed attempts and still reconciles clean.
    const ledgerA = await getLedger(app, firmA.token);
    expect(ledgerA).toHaveLength(1);
    expect((await trust.reconcile(firmA.firmId)).ok).toBe(true);
    await app.close();
  });

  it("a soft-deleted client: no new entries (400 Client not found) but the money history survives — the ledger never rewrites", async () => {
    await setup();
    const client = await createClient(app, firmA.token, "Departing Client");
    await postPayment(app, firmA.token, { clientId: client.id, amount: 750000, trustAccount: true });

    const deleted = await app.inject({
      method: "DELETE", url: `/api/v1/contacts/${client.id}`, headers: bearer(firmA.token),
    });
    expect(deleted.statusCode).toBe(204);

    // No NEW money may move for a deleted client — through the hook…
    const viaHook = await postPayment(app, firmA.token, {
      clientId: client.id, amount: 250000, trustAccount: true,
    });
    expect(viaHook.statusCode).toBe(400);
    expect(viaHook.body).toEqual({ error: "Client not found" });
    // …or the service seam.
    await expect(
      trust.append(firmA.firmId, { clientId: client.id, amount: -250000 }),
    ).rejects.toMatchObject({ statusCode: 400, message: TRUST_CLIENT_MISSING_MESSAGE });

    // The historical entries are NOT rewritten or hidden by the deletion:
    // the ledger still lists them (contract: the list is the firm's ledger),
    // the chain still reconciles, and the balance still stands.
    const ledger = await getLedger(app, firmA.token);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ clientId: client.id, amount: 750000, balanceAfter: 750000 });
    expect((await trust.reconcile(firmA.firmId)).ok).toBe(true);
    await app.close();
  });

  it("service-seam validation: amount/date/clientId 400s before anything is written", async () => {
    await setup();
    const client = await createClient(app, firmA.token, "Valid Client");
    for (const [input, message] of [
      [{ clientId: client.id, amount: 0 }, TRUST_AMOUNT_MESSAGE],
      [{ clientId: client.id, amount: 10.5 }, TRUST_AMOUNT_MESSAGE],
      [{ clientId: client.id, amount: 1_000_000_001 }, TRUST_AMOUNT_MESSAGE],
      [{ clientId: client.id, amount: -1_000_000_001 }, TRUST_AMOUNT_MESSAGE],
      [{ clientId: client.id, amount: 100, date: "01-02-2026" }, TRUST_DATE_MESSAGE],
      [{ clientId: client.id, amount: 100, date: "2026-13-01" }, TRUST_DATE_MESSAGE],
      [{ clientId: "c1", amount: 100 }, TRUST_CLIENT_MESSAGE],
    ] as [TrustEntryInput, string][]) {
      await expect(trust.append(firmA.firmId, input)).rejects.toMatchObject({
        statusCode: 400, message,
      });
    }

    // Zero entries were written by any failed append.
    expect(await getLedger(app, firmA.token)).toEqual([]);
    await app.close();
  });

  it("the ledger needs a session: anonymous reads are 401; without a database the surface answers the 503 envelope", async () => {
    await setup();
    const res = await app.inject({ method: "GET", url: "/api/v1/trust/transactions" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Not signed in" });
    await app.close();

    app = await buildApp(testConfig);
    const res2 = await app.inject({ method: "GET", url: "/api/v1/trust/transactions" });
    expect(res2.statusCode).toBe(503);
    expect(res2.json().error).toMatch(/DATABASE_URL/);
    await app.close();
  });
});
