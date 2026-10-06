import { createHmac } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb } from "../db/client.js";
import type { AppConfig } from "../config.js";
import type { FastifyInstance } from "fastify";
import {
  WEBHOOK_FIRM_UNKNOWN,
  WEBHOOK_SIGNATURE_INVALID,
} from "../services/gateway/webhooks.js";
import { CapturingMailer, inMemoryAuthRepositories } from "../services/auth/testing.js";
import type { AuthRepositories } from "../services/auth/repository.js";

/**
 * The Razorpay webhook surface (ticket 04) — in-memory repos, no provider
 * needed (the webhook records from the payload, never by calling out).
 * Behavior matrix, docs/API_CONTRACT.md as north star:
 *
 *   valid payment_link.paid   200 { recorded: true, duplicate: false } — the
 *                             payment rides the SAME transactional path as
 *                             the manual route (roll-up included) and the
 *                             link flips to paid
 *   replayed event id         200 { recorded: false, duplicate: true } — the
 *                             unique index fired inside the transaction, so
 *                             nothing was written (exactly one payment)
 *   missing/bad signature     400 before any processing; nothing written
 *   unknown firm              404
 *   other firm's secret       400 (the check secret is the URL firm's)
 *   other events              ledger-only — no payment, no invoice change
 *   already-paid link         ledger row, no second payment
 */

const testConfig: AppConfig = {
  port: 0,
  corsOrigins: ["http://localhost:5173"],
  sessionSecret: "test-secret",
  databaseUrl: null,
  cookieSameSite: "lax",
  cookieSecure: false,
  email: { from: "Lawleit <test@lawleit.example>", resendApiKey: null, baseUrl: "http://localhost:5173" },
  gatewayEncryptionKey: "test-encryption-key-with-at-least-32-chars",
};

interface FirmContext {
  token: string;
  firmId: string;
}

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
  const created = signup.json() as { firm: { id: string } };

  await app.inject({ method: "POST", url: "/api/v1/auth/password-reset", payload: { email } });
  await app.inject({
    method: "POST", url: "/api/v1/auth/password-reset/consume",
    payload: { token: mailer.sends[mailer.sends.length - 1]!.token, password: "password-123" },
  });
  const login = await app.inject({
    method: "POST", url: "/api/v1/auth/login", payload: { email, password: "password-123" },
  });
  expect(login.statusCode).toBe(200);
  return { token: (login.json() as { token: string }).token, firmId: created.firm.id };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const WEBHOOK_SECRET_A = "whsec-firm-a-shared-secret";
const WEBHOOK_SECRET_B = "whsec-firm-b-shared-secret";

/** Connects the firm's gateway (the owner step) with a known webhook secret. */
async function connectGateway(
  app: FastifyInstance,
  token: string,
  webhookSecret: string,
): Promise<void> {
  const res = await app.inject({
    method: "PUT", url: "/api/v1/gateway/account",
    headers: bearer(token),
    payload: {
      keyId: "rzp_test_FakeKeyId12345",
      keySecret: "rzp-test-fake-key-secret-plaintext",
      webhookSecret,
    },
  });
  expect(res.statusCode).toBe(200);
}

/** Creates one invoice (default total 500000 paise) in the session's firm. */
async function createInvoice(
  app: FastifyInstance,
  token: string,
): Promise<{ id: string; number: string }> {
  const res = await app.inject({
    method: "POST", url: "/api/v1/invoices",
    headers: bearer(token),
    payload: {
      lines: [{ description: "Professional services", quantity: 1, rate: 500000, kind: "flat" }],
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; number: string };
}

/** Inserts one live active link row for the invoice, bypassing the provider. */
async function insertLink(
  repos: AuthRepositories,
  firmId: string,
  invoiceId: string,
  providerLinkId: string,
): Promise<void> {
  await repos.paymentLinks.create({
    firmId,
    invoiceId,
    provider: "razorpay",
    providerLinkId,
    shortUrl: `https://rzp.io/i/${providerLinkId}`,
    amount: 500000,
    status: "active",
  });
}

/** A Razorpay-shaped payment_link.paid body, serialized exactly once. */
function paidBody(providerLinkId: string, method = "upi"): string {
  return JSON.stringify({
    event: "payment_link.paid",
    payload: {
      payment_link: { entity: { id: providerLinkId } },
      payment: { entity: { id: `pay_${providerLinkId}`, method } },
    },
  });
}

const sign = (body: string, secret = WEBHOOK_SECRET_A) =>
  createHmac("sha256", secret).update(body).digest("hex");

describe("razorpay webhook (ticket 04)", () => {
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

  async function setup(): Promise<void> {
    mailer = new CapturingMailer();
    repos = inMemoryAuthRepositories();
    app = await buildApp(testConfig, { repositories: repos, mailer });
    firmA = await signupFirm(app, mailer, "owner@firm-a.example", "Aditi");
    firmB = await signupFirm(app, mailer, "owner@firm-b.example", "Bharat");
    await connectGateway(app, firmA.token, WEBHOOK_SECRET_A);
    await connectGateway(app, firmB.token, WEBHOOK_SECRET_B);
  }

  /** The invoice's status as the client sees it. */
  async function invoiceStatus(token: string, invoiceId: string): Promise<string> {
    const res = await app.inject({
      method: "GET", url: `/api/v1/invoices/${invoiceId}`, headers: bearer(token),
    });
    return (res.json() as { status: string }).status;
  }

  it("a validly-signed payment_link.paid records the payment through the roll-up, flips the link, and appends the event", async () => {
    await setup();
    const invoice = await createInvoice(app, firmA.token);
    await insertLink(repos, firmA.firmId, invoice.id, "link_WH1");

    const body = paidBody("link_WH1");
    const res = await app.inject({
      method: "POST", url: `/api/v1/webhooks/razorpay/${firmA.firmId}`,
      headers: { "content-type": "application/json", "x-razorpay-signature": sign(body) },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ recorded: true, duplicate: false });

    const payments = await repos.payments.listByFirm(firmA.firmId);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      invoiceId: invoice.id, amount: 500000, method: "upi",
      status: "deposited", trustAccount: false,
    });
    expect(await invoiceStatus(firmA.token, invoice.id)).toBe("paid");
    expect((await repos.paymentLinks.listByInvoice(firmA.firmId, invoice.id))[0]!.status).toBe("paid");
    expect(await repos.gatewayEvents.listByFirm(firmA.firmId)).toHaveLength(1);
  });

  it("a replayed event id is a no-op 200 — exactly one payment row exists", async () => {
    await setup();
    const invoice = await createInvoice(app, firmA.token);
    await insertLink(repos, firmA.firmId, invoice.id, "link_WH2");

    const body = paidBody("link_WH2");
    const headers = {
      "content-type": "application/json",
      "x-razorpay-signature": sign(body),
      "x-razorpay-event-id": "evt_WH2_0001",
    };
    const first = await app.inject({
      method: "POST", url: `/api/v1/webhooks/razorpay/${firmA.firmId}`, headers, payload: body,
    });
    expect(first.json()).toEqual({ recorded: true, duplicate: false });

    const replay = await app.inject({
      method: "POST", url: `/api/v1/webhooks/razorpay/${firmA.firmId}`, headers, payload: body,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ recorded: false, duplicate: true });
    expect(await repos.payments.listByFirm(firmA.firmId)).toHaveLength(1);
    expect(await repos.gatewayEvents.listByFirm(firmA.firmId)).toHaveLength(1);
  });

  it("without an event-id header, identical bytes still dedupe (the body hash is the id)", async () => {
    await setup();
    const invoice = await createInvoice(app, firmA.token);
    await insertLink(repos, firmA.firmId, invoice.id, "link_WH3");

    const body = paidBody("link_WH3", "netbanking");
    const headers = { "content-type": "application/json", "x-razorpay-signature": sign(body) };
    for (const expected of [{ recorded: true, duplicate: false }, { recorded: false, duplicate: true }]) {
      const res = await app.inject({
        method: "POST", url: `/api/v1/webhooks/razorpay/${firmA.firmId}`, headers, payload: body,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(expected);
    }
    const payments = await repos.payments.listByFirm(firmA.firmId);
    expect(payments).toHaveLength(1);
    expect(payments[0]!.method).toBe("netbanking");
  });

  it("a missing or bad signature is a 400 before any processing; a foreign firm's secret never verifies", async () => {
    await setup();
    const invoice = await createInvoice(app, firmA.token);
    await insertLink(repos, firmA.firmId, invoice.id, "link_WH4");
    const body = paidBody("link_WH4");

    for (const headers of [
      { "content-type": "application/json" },
      { "content-type": "application/json", "x-razorpay-signature": sign(body, "wrong-secret") },
      { "content-type": "application/json", "x-razorpay-signature": sign(`${body} `) }, // tampered bytes
    ]) {
      const res = await app.inject({
        method: "POST", url: `/api/v1/webhooks/razorpay/${firmA.firmId}`, headers, payload: body,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: WEBHOOK_SIGNATURE_INVALID });
    }

    // Firm B's OWN valid signature does not authorize firm A's webhook URL —
    // the check secret is the URL firm's, so this is a 400, and nothing is
    // written to either firm's books.
    const res = await app.inject({
      method: "POST", url: `/api/v1/webhooks/razorpay/${firmA.firmId}`,
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": sign(body, WEBHOOK_SECRET_B),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect((await repos.payments.listByFirm(firmA.firmId)).length).toBe(0);
    expect((await repos.payments.listByFirm(firmB.firmId)).length).toBe(0);

    // ...and the payment the failed attempts should have produced: recorded
    // properly once a VALID delivery arrives.
    const good = await app.inject({
      method: "POST", url: `/api/v1/webhooks/razorpay/${firmA.firmId}`,
      headers: { "content-type": "application/json", "x-razorpay-signature": sign(body) },
      payload: body,
    });
    expect(good.json()).toEqual({ recorded: true, duplicate: false });
    expect((await repos.payments.listByFirm(firmA.firmId)).length).toBe(1);
  });

  it("an unknown (or disconnected) firm is uniformly 404", async () => {
    await setup();
    const res = await app.inject({
      method: "POST", url: `/api/v1/webhooks/razorpay/00000000-0000-4000-8000-000000000000`,
      headers: { "content-type": "application/json", "x-razorpay-signature": sign(paidBody("link_X")) },
      payload: paidBody("link_X"),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: WEBHOOK_FIRM_UNKNOWN });
  });

  it("non-money events append to the ledger only; a paid event for a foreign or unknown link records nothing", async () => {
    await setup();
    const invoice = await createInvoice(app, firmA.token);
    await insertLink(repos, firmA.firmId, invoice.id, "link_WH5");

    const failed = JSON.stringify({
      event: "payment.failed",
      payload: { payment: { entity: { id: "pay_fail", method: "upi" } } },
    });
    const res = await app.inject({
      method: "POST", url: `/api/v1/webhooks/razorpay/${firmA.firmId}`,
      headers: { "content-type": "application/json", "x-razorpay-signature": sign(failed) },
      payload: failed,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ recorded: false, duplicate: false });
    expect(await repos.payments.listByFirm(firmA.firmId)).toHaveLength(0);
    expect(await invoiceStatus(firmA.token, invoice.id)).toBe("draft");

    // Firm B's link, announced on firm A's endpoint: the link lookup is
    // firm-scoped, so it is ledger-only — firm B's books are untouched.
    const invoiceB = await createInvoice(app, firmB.token);
    await insertLink(repos, firmB.firmId, invoiceB.id, "link_WH6");
    const foreign = paidBody("link_WH6");
    const foreignRes = await app.inject({
      method: "POST", url: `/api/v1/webhooks/razorpay/${firmA.firmId}`,
      headers: { "content-type": "application/json", "x-razorpay-signature": sign(foreign) },
      payload: foreign,
    });
    expect(foreignRes.json()).toEqual({ recorded: false, duplicate: false });
    expect(await repos.payments.listByFirm(firmB.firmId)).toHaveLength(0);
    expect(await invoiceStatus(firmB.token, invoiceB.id)).toBe("draft");
  });

  it("a second paid event for an already-paid link is ledger-only — no double payment", async () => {
    await setup();
    const invoice = await createInvoice(app, firmA.token);
    await insertLink(repos, firmA.firmId, invoice.id, "link_WH7");

    for (const linkId of ["link_WH7", "link_WH7"]) {
      const body = paidBody(linkId);
      const res = await app.inject({
        method: "POST", url: `/api/v1/webhooks/razorpay/${firmA.firmId}`,
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": sign(body),
          "x-razorpay-event-id": `evt_${Math.random().toString(36).slice(2)}`,
        },
        payload: body,
      });
      expect(res.statusCode).toBe(200);
    }
    const payments = await repos.payments.listByFirm(firmA.firmId);
    expect(payments).toHaveLength(1);
    expect(await repos.gatewayEvents.listByFirm(firmA.firmId)).toHaveLength(2);
  });
});
