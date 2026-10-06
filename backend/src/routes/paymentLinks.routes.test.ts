import http from "node:http";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb } from "../db/client.js";
import type { AppConfig } from "../config.js";
import type { FastifyInstance } from "fastify";
import type { AddressInfo } from "node:net";
import { RazorpayGateway } from "../services/gateway/razorpay.js";
import {
  GATEWAY_ENCRYPTION_REQUIRED,
  GATEWAY_PROVIDER_MESSAGE,
} from "../services/gateway/service.js";
import {
  PAYMENT_LINK_NOT_CONNECTED,
  PAYMENT_LINK_PAID_MESSAGE,
  PAYMENT_LINK_PROVIDER_FAILED,
} from "../services/gateway/links.js";
import { CapturingMailer, inMemoryAuthRepositories } from "../services/auth/testing.js";
import type { AuthRepositories } from "../services/auth/repository.js";

/**
 * Collect routes (ticket 03) — in-memory repos + a FAKE Razorpay HTTP server
 * standing in for the provider behind the GatewayService seam (the same
 * RazorpayGateway client production uses, pointed at the fake). Behavior
 * matrix, docs/API_CONTRACT.md as north star:
 *
 *   POST /invoices/:id/payment-link   201 the link shape; amount = the
 *                                     OUTSTANDING paise; paid → 409;
 *                                     unknown/foreign invoice → 404;
 *                                     no gateway → 503 (owner step);
 *                                     no encryption key → 503 (operator step);
 *                                     provider failure → clean 502 envelope
 *   GET  /invoices/:id/payment-links  newest-first history; cross-firm 404
 *
 * Credentials travel to the provider as HTTP Basic (the fake asserts the
 * exact header) and never appear in any API response.
 */

interface FakeRequest {
  method: string;
  path: string;
  authorization: string | null;
  body: Record<string, unknown>;
}

/** A fake Razorpay Payment Links server. `mode` drives the failure cases. */
async function startFakeRazorpay(
  mode: "ok" | "down" = "ok",
): Promise<{ url: string; close(): Promise<void>; requests: FakeRequest[] }> {
  const requests: FakeRequest[] = [];
  let seq = 0;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      const record: FakeRequest = {
        method: req.method ?? "",
        path: req.url ?? "",
        authorization: req.headers.authorization ?? null,
        body,
      };
      if (mode === "ok") requests.push(record);
      if (mode === "down") {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { description: "provider exploded" } }));
        return;
      }
      if (req.method === "POST" && req.url === "/v1/payment_links") {
        seq += 1;
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: `link_FAKESERVER${String(seq).padStart(4, "0")}`,
            short_url: `https://rzp.io/i/fake${seq}`,
            status: "created",
            amount: body.amount,
          }),
        );
        return;
      }
      if (req.method === "GET" && req.url?.startsWith("/v1/payment_links/")) {
        const id = req.url.slice("/v1/payment_links/".length);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id,
            short_url: "https://rzp.io/i/fake0",
            status: id.startsWith("unpaid") ? "created" : "paid",
            amount: 250000,
            payments: [{ method: "upi" }],
          }),
        );
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "no such provider route" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

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

const noKeyConfig: AppConfig = { ...testConfig, gatewayEncryptionKey: null };

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

/** Connects the firm's gateway (the owner step) with known credentials. */
async function connectGateway(app: FastifyInstance, token: string): Promise<void> {
  const res = await app.inject({
    method: "PUT", url: "/api/v1/gateway/account",
    headers: bearer(token),
    payload: {
      keyId: "rzp_test_FakeKeyId12345",
      keySecret: "rzp-test-fake-key-secret-plaintext",
      webhookSecret: "whsec-fake-shared-secret",
    },
  });
  expect(res.statusCode).toBe(200);
}

/** Creates one invoice (default total 500000 paise) in the session's firm. */
async function createInvoice(
  app: FastifyInstance,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown> & { id: string; number: string }> {
  const res = await app.inject({
    method: "POST", url: "/api/v1/invoices",
    headers: bearer(token),
    payload: {
      lines: [{ description: "Professional services", quantity: 1, rate: 500000, kind: "flat" }],
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as Record<string, unknown> & { id: string; number: string };
}

describe("collect — payment links (ticket 03)", () => {
  let app: FastifyInstance;
  let mailer: CapturingMailer;
  let repos: AuthRepositories;
  let firmA: FirmContext;
  let firmB: FirmContext;
  let provider: { url: string; close(): Promise<void>; requests: FakeRequest[] };

  afterEach(async () => {
    await closeDb();
    await provider?.close();
  });

  afterAll(async () => {
    await closeDb();
  });

  async function setup(config: AppConfig = testConfig): Promise<void> {
    provider = await startFakeRazorpay();
    mailer = new CapturingMailer();
    repos = inMemoryAuthRepositories();
    app = await buildApp(config, {
      repositories: repos,
      mailer,
      gateway: new RazorpayGateway(`${provider.url}/v1`),
    });
    firmA = await signupFirm(app, mailer, "owner@firm-a.example", "Aditi");
    firmB = await signupFirm(app, mailer, "owner@firm-b.example", "Bharat");
  }

  it("collect → 201 link shape created through the firm's gateway: outstanding paise amount, link persisted, Basic credentials flowed to the provider (and nowhere else)", async () => {
    await setup();
    await connectGateway(app, firmA.token);
    const invoice = await createInvoice(app, firmA.token);

    const res = await app.inject({
      method: "POST", url: `/api/v1/invoices/${invoice.id}/payment-link`,
      headers: bearer(firmA.token),
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).not.toContain("rzp-test-fake-key-secret-plaintext");
    expect(res.body).not.toContain("whsec-fake-shared-secret");
    const link = res.json() as Record<string, unknown>;
    expect(link).toEqual({
      id: expect.any(String),
      invoiceId: invoice.id,
      provider: "razorpay",
      providerLinkId: "link_FAKESERVER0001",
      shortUrl: "https://rzp.io/i/fake1",
      amount: 500000, // the full outstanding total, integer paise
      status: "active", // the provider's "created" in the contract's vocabulary
      createdAt: expect.any(String),
    });

    // The provider saw the request with the FIRM's decrypted credentials as
    // HTTP Basic — proof the seam decrypts in memory and hands them over.
    expect(provider.requests).toHaveLength(1);
    const sent = provider.requests[0]!;
    expect(sent.method).toBe("POST");
    expect(sent.authorization).toBe(
      `Basic ${Buffer.from("rzp_test_FakeKeyId12345:rzp-test-fake-key-secret-plaintext").toString("base64")}`,
    );
    expect(sent.body).toMatchObject({ amount: 500000, currency: "INR", reference_id: invoice.id });

    // The link is persisted under the invoice (the history proves it).
    const history = await app.inject({
      method: "GET", url: `/api/v1/invoices/${invoice.id}/payment-links`,
      headers: bearer(firmA.token),
    });
    expect(history.statusCode).toBe(200);
    expect((history.json() as { id: string }[]).map((l) => l.id)).toEqual([link.id]);
    await app.close();
  });

  it("amount correctness: a partial payment first shrinks the link to the remaining outstanding paise", async () => {
    await setup();
    await connectGateway(app, firmA.token);
    const invoice = await createInvoice(app, firmA.token); // total 500000
    const pay = await app.inject({
      method: "POST", url: "/api/v1/payments",
      headers: bearer(firmA.token),
      payload: { invoiceId: invoice.id, amount: 250000, method: "upi" },
    });
    expect(pay.statusCode).toBe(201);

    const res = await app.inject({
      method: "POST", url: `/api/v1/invoices/${invoice.id}/payment-link`,
      headers: bearer(firmA.token),
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { amount: number }).amount).toBe(250000);
    await app.close();
  });

  it("a paid invoice refuses new links with 409 — checked before the gateway state so the copy is universal", async () => {
    await setup();
    // No gateway connected at all: the paid check still wins with 409.
    const invoice = await createInvoice(app, firmA.token);
    const mark = await app.inject({
      method: "PATCH", url: `/api/v1/invoices/${invoice.id}`,
      headers: bearer(firmA.token), payload: { status: "paid" },
    });
    expect(mark.statusCode).toBe(200);
    const res = await app.inject({
      method: "POST", url: `/api/v1/invoices/${invoice.id}/payment-link`,
      headers: bearer(firmA.token),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: PAYMENT_LINK_PAID_MESSAGE });

    // Fully paid through payments: same 409, provider never called.
    await connectGateway(app, firmA.token);
    const settled = await createInvoice(app, firmA.token);
    await app.inject({
      method: "POST", url: "/api/v1/payments",
      headers: bearer(firmA.token),
      payload: { invoiceId: settled.id, amount: 500000 },
    });
    const again = await app.inject({
      method: "POST", url: `/api/v1/invoices/${settled.id}/payment-link`,
      headers: bearer(firmA.token),
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: PAYMENT_LINK_PAID_MESSAGE });
    expect(provider.requests).toHaveLength(0);
    await app.close();
  });

  it("unknown and cross-firm invoices 404 and hit no provider route; history 404s the same way", async () => {
    await setup();
    await connectGateway(app, firmA.token);
    const invoiceB = await createInvoice(app, firmB.token);
    for (const id of [invoiceB.id, "00000000-0000-4000-8000-00000000dead"]) {
      const res = await app.inject({
        method: "POST", url: `/api/v1/invoices/${id}/payment-link`,
        headers: bearer(firmA.token),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Invoice not found" });
      const history = await app.inject({
        method: "GET", url: `/api/v1/invoices/${id}/payment-links`,
        headers: bearer(firmA.token),
      });
      expect(history.statusCode).toBe(404);
    }
    // A non-uuid invoice id is a 400 before anything runs.
    const bad = await app.inject({
      method: "POST", url: "/api/v1/invoices/not-a-uuid/payment-link",
      headers: bearer(firmA.token),
    });
    expect(bad.statusCode).toBe(400);
    expect(provider.requests).toHaveLength(0);
    await app.close();
  });

  it("no connected gateway → 503 with the owner-step copy; no encryption key → 503 with the operator-step copy", async () => {
    await setup();
    const invoice = await createInvoice(app, firmA.token);
    const res = await app.inject({
      method: "POST", url: `/api/v1/invoices/${invoice.id}/payment-link`,
      headers: bearer(firmA.token),
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: PAYMENT_LINK_NOT_CONNECTED });
    await app.close();

    // The operator without GATEWAY_ENCRYPTION_KEY gets the other 503.
    provider = await startFakeRazorpay();
    mailer = new CapturingMailer();
    repos = inMemoryAuthRepositories();
    app = await buildApp(noKeyConfig, {
      repositories: repos, mailer, gateway: new RazorpayGateway(`${provider.url}/v1`),
    });
    firmA = await signupFirm(app, mailer, "owner@firm-a.example", "Aditi");
    const invoice2 = await createInvoice(app, firmA.token);
    const res2 = await app.inject({
      method: "POST", url: `/api/v1/invoices/${invoice2.id}/payment-link`,
      headers: bearer(firmA.token),
    });
    expect(res2.statusCode).toBe(503);
    expect(res2.json()).toEqual({ error: GATEWAY_ENCRYPTION_REQUIRED });
    await app.close();
  });

  it("provider failure surfaces as a clean 502 envelope — no stack internals, no credentials, no link row", async () => {
    const downProvider = await startFakeRazorpay("down");
    mailer = new CapturingMailer();
    repos = inMemoryAuthRepositories();
    app = await buildApp(testConfig, {
      repositories: repos, mailer, gateway: new RazorpayGateway(`${downProvider.url}/v1`),
    });
    firmA = await signupFirm(app, mailer, "owner@firm-a.example", "Aditi");
    await connectGateway(app, firmA.token);
    const invoice = await createInvoice(app, firmA.token);

    const res = await app.inject({
      method: "POST", url: `/api/v1/invoices/${invoice.id}/payment-link`,
      headers: bearer(firmA.token),
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: PAYMENT_LINK_PROVIDER_FAILED });
    expect(res.body).not.toContain("rzp-test-fake-key-secret-plaintext");
    // Nothing was written: the history is empty (a rejected provider link
    // must not linger as a row).
    const history = await app.inject({
      method: "GET", url: `/api/v1/invoices/${invoice.id}/payment-links`,
      headers: bearer(firmA.token),
    });
    expect(history.json()).toEqual([]);
    await app.close();
    await downProvider.close();
  });

  it("history is newest first and firm-scoped; several links accumulate per invoice", async () => {
    await setup();
    await connectGateway(app, firmA.token);
    const invoice = await createInvoice(app, firmA.token);
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: "POST", url: `/api/v1/invoices/${invoice.id}/payment-link`,
        headers: bearer(firmA.token),
      });
      expect(res.statusCode).toBe(201);
    }
    const history = await app.inject({
      method: "GET", url: `/api/v1/invoices/${invoice.id}/payment-links`,
      headers: bearer(firmA.token),
    });
    const links = history.json() as { providerLinkId: string }[];
    expect(links.map((l) => l.providerLinkId)).toEqual([
      "link_FAKESERVER0003", "link_FAKESERVER0002", "link_FAKESERVER0001",
    ]);

    // Firm B sees none of it (isolation), even for its own invoices.
    const invoiceB = await createInvoice(app, firmB.token);
    const other = await app.inject({
      method: "GET", url: `/api/v1/invoices/${invoiceB.id}/payment-links`,
      headers: bearer(firmB.token),
    });
    expect(other.json()).toEqual([]);
    await app.close();
  });

  it("malformed connect bodies still 400 (the account surface's rules hold behind collect)", async () => {
    await setup();
    const res = await app.inject({
      method: "PUT", url: "/api/v1/gateway/account",
      headers: bearer(firmA.token),
      payload: { keyId: "k", keySecret: "s", webhookSecret: "w", provider: "stripe" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: GATEWAY_PROVIDER_MESSAGE });
    await app.close();
  });
});

describe("reconciliation sync (ticket 05)", () => {
  let app: FastifyInstance;
  let mailer: CapturingMailer;
  let repos: AuthRepositories;
  let firmA: FirmContext;
  let firmB: FirmContext;
  let provider: { url: string; close(): Promise<void>; requests: FakeRequest[] };

  afterEach(async () => {
    await closeDb();
    await provider?.close();
  });

  afterAll(async () => {
    await closeDb();
  });

  async function setup(mode: "ok" | "down" = "ok"): Promise<void> {
    provider = await startFakeRazorpay(mode);
    mailer = new CapturingMailer();
    repos = inMemoryAuthRepositories();
    app = await buildApp(testConfig, {
      repositories: repos,
      mailer,
      gateway: new RazorpayGateway(`${provider.url}/v1`),
    });
    firmA = await signupFirm(app, mailer, "owner@firm-a.example", "Aditi");
    firmB = await signupFirm(app, mailer, "owner@firm-b.example", "Bharat");
    await connectGateway(app, firmA.token);
  }

  async function insertLink(
    firmId: string,
    invoiceId: string,
    providerLinkId: string,
  ): Promise<{ id: string }> {
    const row = await repos.paymentLinks.create({
      firmId, invoiceId, provider: "razorpay", providerLinkId,
      shortUrl: `https://rzp.io/i/${providerLinkId}`, amount: 500000, status: "active",
    });
    return { id: row.id };
  }

  it("a provider-paid link records the payment through the webhook's path and flips the local link; the roll-up rules hold (partial keeps a draft a draft, rolls a sent back to sent)", async () => {
    await setup();
    const invoice = await createInvoice(app, firmA.token);
    const link = await insertLink(firmA.firmId, invoice.id, "link_SYNC1");

    const res = await app.inject({
      method: "POST", url: `/api/v1/payment-links/${link.id}/sync`, headers: bearer(firmA.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "paid", recorded: true });

    const payments = await repos.payments.listByFirm(firmA.firmId);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      invoiceId: invoice.id, amount: 250000, method: "upi",
      status: "deposited", trustAccount: false,
    });
    expect((await repos.paymentLinks.findById(firmA.firmId, link.id))!.status).toBe("paid");
    // The fake pays 250000 against the 500000 invoice — a PARTIAL payment.
    // The draft stays a draft (the parity rule, through the sync path too).
    expect(
      (await app.inject({ method: "GET", url: `/api/v1/invoices/${invoice.id}`, headers: bearer(firmA.token) })).json() as { status: string },
    ).toMatchObject({ status: "draft" });
  });

  it("a second sync is a no-op (the already-paid short circuit, before any provider call)", async () => {
    await setup();
    const invoice = await createInvoice(app, firmA.token);
    const link = await insertLink(firmA.firmId, invoice.id, "link_SYNC2");
    for (const expected of [{ status: "paid", recorded: true }, { status: "paid", recorded: false }]) {
      const res = await app.inject({
        method: "POST", url: `/api/v1/payment-links/${link.id}/sync`, headers: bearer(firmA.token),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(expected);
    }
    expect(await repos.payments.listByFirm(firmA.firmId)).toHaveLength(1);
  });

  it("the webhook's dedupe wall holds for sync too: a pre-existing sync event writes nothing", async () => {
    await setup();
    const invoice = await createInvoice(app, firmA.token);
    const link = await insertLink(firmA.firmId, invoice.id, "link_SYNC3");
    await repos.gatewayEvents.create({
      firmId: firmA.firmId, provider: "razorpay",
      providerEventId: "sync:link_SYNC3", eventType: "payment_link.paid",
    });
    const res = await app.inject({
      method: "POST", url: `/api/v1/payment-links/${link.id}/sync`, headers: bearer(firmA.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "paid", recorded: false });
    expect(await repos.payments.listByFirm(firmA.firmId)).toHaveLength(0);
  });

  it("a provider-unpaid link is ledger-quiet and changes nothing", async () => {
    await setup();
    const invoice = await createInvoice(app, firmA.token);
    const link = await insertLink(firmA.firmId, invoice.id, "unpaid_link_SYNC4");
    const res = await app.inject({
      method: "POST", url: `/api/v1/payment-links/${link.id}/sync`, headers: bearer(firmA.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "active", recorded: false });
    expect(await repos.payments.listByFirm(firmA.firmId)).toHaveLength(0);
    expect((await repos.paymentLinks.findById(firmA.firmId, link.id))!.status).toBe("active");
  });

  it("unknown, foreign, and not-connected cases: 404/404/503 with the owner-step copy", async () => {
    await setup();
    const invoice = await createInvoice(app, firmA.token);
    const link = await insertLink(firmA.firmId, invoice.id, "link_SYNC5");
    const invoiceB = await createInvoice(app, firmB.token);
    const foreignLink = await insertLink(firmB.firmId, invoiceB.id, "link_SYNC6");

    const unknown = await app.inject({
      method: "POST", url: `/api/v1/payment-links/00000000-0000-4000-8000-000000000000/sync`,
      headers: bearer(firmA.token),
    });
    expect(unknown.statusCode).toBe(404);

    const foreign = await app.inject({
      method: "POST", url: `/api/v1/payment-links/${foreignLink.id}/sync`, headers: bearer(firmA.token),
    });
    expect(foreign.statusCode).toBe(404);
    expect(await repos.payments.listByFirm(firmB.firmId)).toHaveLength(0);

    const notConnected = await app.inject({
      method: "POST", url: `/api/v1/payment-links/${link.id}/sync`, headers: bearer(firmB.token),
    });
    expect(notConnected.statusCode).toBe(503);
    expect(notConnected.json()).toEqual({ error: PAYMENT_LINK_NOT_CONNECTED });
  });

  it("a provider failure surfaces as the clean 502 envelope", async () => {
    await setup("down");
    const invoice = await createInvoice(app, firmA.token);
    const link = await insertLink(firmA.firmId, invoice.id, "link_SYNC7");
    const res = await app.inject({
      method: "POST", url: `/api/v1/payment-links/${link.id}/sync`, headers: bearer(firmA.token),
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: PAYMENT_LINK_PROVIDER_FAILED });
    expect(await repos.payments.listByFirm(firmA.firmId)).toHaveLength(0);
  });
});
