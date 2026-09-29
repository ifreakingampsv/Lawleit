import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb } from "../db/client.js";
import type { AppConfig } from "../config.js";
import type { FastifyInstance } from "fastify";
import {
  PAYMENT_AMOUNT_MESSAGE,
  PAYMENT_CLIENT_MESSAGE,
  PAYMENT_CLIENT_MISSING_MESSAGE,
  PAYMENT_INVOICE_MESSAGE,
  PAYMENT_METHOD_MESSAGE,
} from "../services/payments/service.js";
import { CapturingMailer, inMemoryAuthRepositories } from "../services/auth/testing.js";
import type { AuthRepositories } from "../services/auth/repository.js";

/**
 * Payments routes (ticket 14) — in-memory repos, invoices.routes.test.ts
 * shape. Behavior matrix, contract + reference backend (server.mjs) as north
 * stars:
 *
 *   GET  /payments   200 array, newest first, firm-scoped
 *   POST /payments   201 entity; server stamps date=today, lands status
 *                    "deposited", defaults method "card"; validates amount
 *                    (> 0 integer) and method vocabulary (400s the reference
 *                    never had); a foreign/unknown invoice is a 404 that
 *                    writes nothing (cross-firm isolation); an absent/""
 *                    invoiceId is a valid unlinked payment (the trust-deposit
 *                    seam); the roll-up (Σ payments ≥ total → paid, partial
 *                    draft stays draft) commits in the same transaction
 *
 * Permissions: every firm member records payments (practice data — no owner
 * gate). No PATCH/DELETE exists — the contract and the reference define no
 * payment-edit surface, so none is invented. Client-sent id/date/status have
 * no path in.
 */

const testConfig: AppConfig = {
  port: 0,
  corsOrigins: ["http://localhost:5173"],
  sessionSecret: "test-secret",
  databaseUrl: null,
  cookieSameSite: "lax",
  cookieSecure: false,
  email: { from: "Lawleit <test@lawleit.example>", resendApiKey: null, baseUrl: "http://localhost:5173" },
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

/** The UTC day the service stamps into `date`. */
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

type PaymentPayload = Record<string, unknown>;

/** Creates one invoice (default total 500000 paise) in the given firm. */
async function createInvoice(
  app: FastifyInstance,
  token: string,
  overrides: PaymentPayload = {},
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
  payload: PaymentPayload,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const res = await app.inject({
    method: "POST", url: "/api/v1/payments",
    headers: bearer(token),
    payload,
  });
  return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
}

/** The invoice's status as the client sees it (a repeated read must agree). */
async function invoiceStatus(
  app: FastifyInstance,
  token: string,
  invoiceId: string,
): Promise<string> {
  const res = await app.inject({
    method: "GET", url: `/api/v1/invoices/${invoiceId}`, headers: bearer(token),
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { status: string }).status;
}

describe("payments (ticket 14)", () => {
  let app: FastifyInstance;
  let mailer: CapturingMailer;
  let repos: AuthRepositories;
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
    app = await buildApp(testConfig, { repositories: repos, mailer });
    firmA = await signupFirm(app, mailer, "owner@firm-a.example", "Aditi");
    firmB = await signupFirm(app, mailer, "owner@firm-b.example", "Bharat");
  }

  it("record → 201 contract shape with reference defaults: date stamped today, status deposited, method default card; list is newest first", async () => {
    await setup();
    const contact = await app.inject({
      method: "POST", url: "/api/v1/contacts", headers: bearer(firmA.token),
      payload: { name: "Paying Client" },
    });
    const clientId = (contact.json() as { id: string }).id;
    const invoice = await createInvoice(app, firmA.token, { clientId });

    const res = await postPayment(app, firmA.token, {
      invoiceId: invoice.id, amount: 250000, method: "echeck",
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({
      invoiceId: invoice.id,
      clientId,
      date: today(),
      amount: 250000,
      method: "echeck",
      status: "deposited",
      trustAccount: false,
    });
    expect(res.body.id).toEqual(expect.any(String));
    // Contract shape only — bookkeeping and DB-only fields stay absent.
    for (const key of ["firmId", "createdAt", "updatedAt", "deletedAt"]) {
      expect(res.body).not.toHaveProperty(key);
    }

    // An absent method defaults to "card" (the reference's `b.method ?? "card"`).
    const second = await postPayment(app, firmA.token, { invoiceId: invoice.id, amount: 1 });
    expect(second.statusCode).toBe(201);
    expect(second.body.method).toBe("card");

    const list = await app.inject({ method: "GET", url: "/api/v1/payments", headers: bearer(firmA.token) });
    expect(list.statusCode).toBe(200);
    const payments = list.json() as { id: string; amount: number }[];
    // Newest first (the mock/reference unshift): 1-paise payment recorded last.
    expect(payments.map((p) => p.amount)).toEqual([1, 250000]);
    await app.close();
  });

  it("roll-up: a partial payment keeps a draft a draft (the parity fix), Σ ≥ total flips paid — and repeated reads agree", async () => {
    await setup();
    const invoice = await createInvoice(app, firmA.token); // total 500000
    const invoiceId = invoice.id;

    await postPayment(app, firmA.token, { invoiceId, amount: 250000, method: "card" });
    expect(await invoiceStatus(app, firmA.token, invoiceId)).toBe("draft");

    await postPayment(app, firmA.token, { invoiceId, amount: 250000, method: "echeck" });
    expect(await invoiceStatus(app, firmA.token, invoiceId)).toBe("paid");

    // The roll-up is the persisted state, not a view: the second read (and
    // the list endpoint) agree with the first.
    expect(await invoiceStatus(app, firmA.token, invoiceId)).toBe("paid");
    const listed = await app.inject({
      method: "GET", url: `/api/v1/invoices/${invoiceId}`, headers: bearer(firmA.token),
    });
    expect((listed.json() as { status: string }).status).toBe("paid");
    await app.close();
  });

  it("roll-up: a sent invoice stays sent on a partial payment (smoke parity), and a draft that is fully paid in one payment lands directly on paid — recording never auto-sends", async () => {
    await setup();
    const sent = await createInvoice(app, firmA.token);
    const marked = await app.inject({
      method: "PATCH", url: `/api/v1/invoices/${sent.id}`,
      headers: bearer(firmA.token), payload: { status: "sent" },
    });
    expect(marked.statusCode).toBe(200);
    await postPayment(app, firmA.token, { invoiceId: sent.id, amount: 100000 });
    expect(await invoiceStatus(app, firmA.token, sent.id)).toBe("sent");

    const draft = await createInvoice(app, firmA.token);
    await postPayment(app, firmA.token, { invoiceId: draft.id, amount: 500000 });
    expect(await invoiceStatus(app, firmA.token, draft.id)).toBe("paid");

    // An overdue invoice rolls back to sent on a partial payment, exactly
    // like the reference's non-draft branch.
    const overdue = await createInvoice(app, firmA.token);
    await app.inject({
      method: "PATCH", url: `/api/v1/invoices/${overdue.id}`,
      headers: bearer(firmA.token), payload: { status: "overdue" },
    });
    await postPayment(app, firmA.token, { invoiceId: overdue.id, amount: 250000 });
    expect(await invoiceStatus(app, firmA.token, overdue.id)).toBe("sent");
    await app.close();
  });

  it("overpayment is accepted and marks the invoice paid — the reference rejects and flags nothing", async () => {
    await setup();
    const invoice = await createInvoice(app, firmA.token); // total 500000
    const res = await postPayment(app, firmA.token, { invoiceId: invoice.id, amount: 900000 });
    expect(res.statusCode).toBe(201);
    expect((res.body as { amount: number }).amount).toBe(900000);
    expect(await invoiceStatus(app, firmA.token, invoice.id)).toBe("paid");
    await app.close();
  });

  it("unlinked payments (absent or empty invoiceId) record fine — the trust-deposit seam; no invoice is touched and the trust flag flows through", async () => {
    await setup();
    const contact = await app.inject({
      method: "POST", url: "/api/v1/contacts", headers: bearer(firmA.token),
      payload: { name: "Retainer Client" },
    });
    const clientId = (contact.json() as { id: string }).id;
    const invoice = await createInvoice(app, firmA.token);

    for (const invoiceId of ["", undefined]) {
      const res = await postPayment(app, firmA.token, {
        ...(invoiceId === "" ? { invoiceId } : {}),
        clientId,
        amount: 50000,
        trustAccount: true,
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.invoiceId).toBe("");
      expect(res.body.clientId).toBe(clientId);
      expect(res.body.trustAccount).toBe(true);
      expect(res.body.status).toBe("deposited");
    }

    // No roll-up ran (there is no invoice): the linked invoice is still draft.
    expect(await invoiceStatus(app, firmA.token, invoice.id)).toBe("draft");

    // The unlinked payments persist with the flag on — and ticket 15's hook
    // has appended each one to the trust ledger with a running balance
    // (same transaction as the payment: the ledger exists iff the payment does).
    const listed = await app.inject({ method: "GET", url: "/api/v1/payments", headers: bearer(firmA.token) });
    const payments = listed.json() as { invoiceId: string; trustAccount: boolean; amount: number }[];
    expect(payments).toHaveLength(2);
    expect(payments.every((p) => p.invoiceId === "" && p.trustAccount)).toBe(true);

    const ledger = await app.inject({
      method: "GET", url: "/api/v1/trust/transactions", headers: bearer(firmA.token),
    });
    expect(ledger.statusCode).toBe(200);
    const entries = ledger.json() as {
      clientId: string; amount: number; balanceAfter: number; description: string;
    }[];
    expect(entries).toHaveLength(2);
    expect(entries.map((t) => t.balanceAfter)).toEqual([50000, 100000]);
    expect(
      entries.every((t) => t.clientId === clientId && t.description.startsWith("Trust deposit — invoice")),
    ).toBe(true);
    await app.close();
  });

  it("cross-firm isolation: a foreign invoice 404s and writes nothing; unknown ids 404; lists never leak", async () => {
    await setup();
    const invoiceA = await createInvoice(app, firmA.token);
    await postPayment(app, firmA.token, { invoiceId: invoiceA.id, amount: 250000 }); // A: partial
    const invoiceB = await createInvoice(app, firmB.token);

    for (const invoiceId of [invoiceA.id, "00000000-0000-4000-8000-00000000dead"]) {
      const res = await postPayment(app, firmB.token, { invoiceId, amount: 250000 });
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: "Invoice not found" });
    }

    // Firm B's failed attempts wrote nothing and A's roll-up state is intact.
    expect(await repos.payments.listByFirm(firmB.firmId)).toEqual([]);
    expect(await invoiceStatus(app, firmA.token, invoiceA.id)).toBe("draft");

    const listA = await app.inject({ method: "GET", url: "/api/v1/payments", headers: bearer(firmA.token) });
    expect((listA.json() as { invoiceId: string }[]).map((p) => p.invoiceId)).toEqual([invoiceA.id]);
    const listB = await app.inject({ method: "GET", url: "/api/v1/payments", headers: bearer(firmB.token) });
    expect(listB.json()).toEqual([]);
    expect(invoiceB).toBeTruthy();
    await app.close();
  });

  it("validation: amount and method 400s before anything is written; the vocabulary is the contract's (card/echeck/wallet)", async () => {
    await setup();
    const invoice = await createInvoice(app, firmA.token);
    for (const [payload, message] of [
      [{ invoiceId: invoice.id, amount: 0 }, PAYMENT_AMOUNT_MESSAGE],
      [{ invoiceId: invoice.id, amount: -5 }, PAYMENT_AMOUNT_MESSAGE],
      [{ invoiceId: invoice.id, amount: 10.5 }, PAYMENT_AMOUNT_MESSAGE],
      [{ invoiceId: invoice.id }, PAYMENT_AMOUNT_MESSAGE], // absent amount
      [{ invoiceId: invoice.id, amount: 1_000_000_001 }, PAYMENT_AMOUNT_MESSAGE],
      [{ invoiceId: invoice.id, amount: 100, method: "upi" }, PAYMENT_METHOD_MESSAGE],
      [{ invoiceId: invoice.id, amount: 100, method: "bank transfer" }, PAYMENT_METHOD_MESSAGE],
      [{ invoiceId: invoice.id, amount: 100, clientId: "c1" }, PAYMENT_CLIENT_MESSAGE],
      [{ invoiceId: "k1", amount: 100 }, PAYMENT_INVOICE_MESSAGE],
    ] as [PaymentPayload, string][]) {
      const res = await postPayment(app, firmA.token, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.body).toEqual({ error: message });
    }

    // Route-level shape rejects: a NaN/string amount never reaches the service.
    for (const amount of [Number.NaN, "100"]) {
      const res = await postPayment(app, firmA.token, { invoiceId: invoice.id, amount });
      expect(res.statusCode, String(amount)).toBe(400);
    }

    // Nothing was written by any failed record.
    expect(await repos.payments.listByFirm(firmA.firmId)).toEqual([]);
    expect(await invoiceStatus(app, firmA.token, invoice.id)).toBe("draft");
    await app.close();
  });

  it("client-sent id/date/status have no path in: the server assigns the id, stamps today, lands deposited", async () => {
    await setup();
    const invoice = await createInvoice(app, firmA.token);
    const sneaky = await postPayment(app, firmA.token, {
      id: "00000000-0000-4000-8000-000000000000",
      invoiceId: invoice.id,
      amount: 500000, // the full total: the roll-up outcome proves the strip
      date: "1999-01-01",
      status: "failed", // a client must not poison the roll-up's filter
      firmId: firmB.firmId,
      createdAt: "1999-01-01T00:00:00.000Z",
    });
    expect(sneaky.statusCode).toBe(201);
    expect(sneaky.body.id).not.toBe("00000000-0000-4000-8000-000000000000");
    expect(sneaky.body.date).toBe(today());
    expect(sneaky.body.status).toBe("deposited");
    expect(sneaky.body).not.toHaveProperty("firmId");

    // "failed" was stripped (the row is deposited), so the payment counts
    // toward the roll-up: Σ = 500000 ≥ total → paid. Had the client-sent
    // status leaked in, the non-failed sum would be 0 and the draft would
    // have stayed draft.
    expect(await invoiceStatus(app, firmA.token, invoice.id)).toBe("paid");
    await app.close();
  });

  it("clientId: absent falls back to the invoice's client, an explicit empty string is no client, and unknown clients are 400s", async () => {
    await setup();
    const contact = await app.inject({
      method: "POST", url: "/api/v1/contacts", headers: bearer(firmA.token),
      payload: { name: "Invoice Client" },
    });
    const clientId = (contact.json() as { id: string }).id;
    const foreign = await app.inject({
      method: "POST", url: "/api/v1/contacts", headers: bearer(firmB.token),
      payload: { name: "Foreign Client" },
    });
    const foreignId = (foreign.json() as { id: string }).id;
    const invoice = await createInvoice(app, firmA.token, { clientId });

    // Absent → the invoice's client (the reference's `?? invoice?.clientId`).
    const fallback = await postPayment(app, firmA.token, { invoiceId: invoice.id, amount: 100 });
    expect(fallback.statusCode).toBe(201);
    expect(fallback.body.clientId).toBe(clientId);

    // Explicit "" → no client (renders "").
    const explicit = await postPayment(app, firmA.token, {
      invoiceId: invoice.id, amount: 100, clientId: "",
    });
    expect(explicit.statusCode).toBe(201);
    expect(explicit.body.clientId).toBe("");

    // Well-formed but foreign or unknown → 400 before anything is written.
    for (const bad of [foreignId, "00000000-0000-4000-8000-00000000dead"]) {
      const res = await postPayment(app, firmA.token, { invoiceId: invoice.id, amount: 100, clientId: bad });
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: PAYMENT_CLIENT_MISSING_MESSAGE });
    }
    expect(await repos.payments.listByFirm(firmA.firmId)).toHaveLength(2);
    await app.close();
  });

  it("member-writable: an invited paralegal records payments and drives the roll-up", async () => {
    await setup();
    const member = await inviteAndOnboard(
      app, firmA, mailer, "Sahil Bose", "sahil@firm-a.example", "paralegal",
    );
    const invoice = await createInvoice(app, firmA.token);
    const res = await postPayment(app, member.token, { invoiceId: invoice.id, amount: 500000 });
    expect(res.statusCode).toBe(201);
    expect(await invoiceStatus(app, firmA.token, invoice.id)).toBe("paid");
    await app.close();
  });

  it("payments need a session: anonymous reads and writes are 401; without a database the surface answers the 503 envelope", async () => {
    await setup();
    for (const [method, payload] of [
      ["GET", undefined],
      ["POST", { invoiceId: "00000000-0000-4000-8000-000000000001", amount: 100 }],
    ] as ["GET" | "POST", PaymentPayload | undefined][]) {
      const res = await app.inject({
        method, url: "/api/v1/payments",
        ...(payload ? { payload } : {}),
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Not signed in" });
    }
    await app.close();

    app = await buildApp(testConfig);
    const res = await app.inject({ method: "GET", url: "/api/v1/payments" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/DATABASE_URL/);
    await app.close();
  });
});
