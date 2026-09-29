import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb } from "../db/client.js";
import type { AppConfig } from "../config.js";
import type { FastifyInstance } from "fastify";
import {
  INVOICE_CASE_MISSING_MESSAGE,
  INVOICE_CLIENT_MISSING_MESSAGE,
  INVOICE_KIND_MESSAGE,
  INVOICE_LINES_MESSAGE,
  INVOICE_QUANTITY_MESSAGE,
  INVOICE_RATE_MESSAGE,
  INVOICE_STATUS_MESSAGE,
} from "../services/invoices/service.js";
import { CapturingMailer, inMemoryAuthRepositories } from "../services/auth/testing.js";
import type { AuthRepositories } from "../services/auth/repository.js";

/**
 * Invoices routes (ticket 13) — in-memory repos, leads.routes.test.ts shape.
 * Behavior matrix, contract + reference backend (server.mjs) as north stars:
 *
 *   GET    /invoices         200 array, newest first, lines embedded
 *   GET    /invoices/:id     200 entity / 404
 *   POST   /invoices         201 entity; server assigns INV-XXXX (counter),
 *                            issued=today, due=today+30, status draft default;
 *                            line amounts computed server-side — client-sent
 *                            totals/amounts/ids have no path in
 *   PATCH  /invoices/:id     200 entity, only sent fields move / 404; status
 *                            moves freely within draft/sent/overdue/paid; a
 *                            lines array replaces the set (amounts recomputed)
 *   DELETE /invoices/:id     204 / 404 — nothing blocks a delete (any status)
 *
 * Permissions: every firm member manages invoices (practice data — no owner
 * gate). The number is server-managed and cannot be forced. Cross-firm ids
 * are 404s that leak nothing.
 */

const testConfig: AppConfig = {
  port: 0,
  corsOrigins: ["http://localhost:5173"],
  sessionSecret: "test-secret",
  databaseUrl: null,
  cookieSameSite: "lax",
  cookieSecure: false,
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

/** The UTC days the service stamps into issued / due (+30). */
const today = () => new Date().toISOString().slice(0, 10);
const dueIn30 = () => new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);

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

type InvoicePayload = Record<string, unknown>;

/** Creates one invoice in the given firm; returns it. */
async function createInvoice(
  app: FastifyInstance,
  token: string,
  overrides: InvoicePayload = {},
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

describe("invoices (ticket 13)", () => {
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

  it("create → 201 contract shape with reference defaults; the number is the counter's INV-0001 and the list is newest first", async () => {
    await setup();
    const res = await app.inject({
      method: "POST", url: "/api/v1/invoices", headers: bearer(firmA.token), payload: {},
    });
    expect(res.statusCode).toBe(201);
    const bare = res.json() as Record<string, unknown>;
    expect(bare).toMatchObject({
      number: "INV-0001",
      clientId: "",
      caseId: "",
      issued: today(),
      due: dueIn30(),
      status: "draft",
      lines: [],
    });
    // Contract shape only — bookkeeping and DB-only fields stay absent.
    for (const key of ["firmId", "createdAt", "updatedAt", "deletedAt", "notes", "total", "amountPaid"]) {
      expect(bare).not.toHaveProperty(key);
    }

    // A full payload echoes through, with server-assigned line ids in send order.
    const contact = await app.inject({
      method: "POST", url: "/api/v1/contacts", headers: bearer(firmA.token),
      payload: { name: "Invoice Client" },
    });
    const clientId = (contact.json() as { id: string }).id;
    const created = await createInvoice(app, firmA.token, {
      clientId,
      notes: "Net 30.",
      lines: [
        { id: "l1", description: "Consult (1.5 hrs)", quantity: 1.5, rate: 300000, kind: "time" },
        { id: "l2", description: "Court filing fee", quantity: 1, rate: 20000, kind: "expense" },
      ],
    });
    expect(created).toMatchObject({
      number: "INV-0002",
      clientId,
      caseId: "",
      issued: today(),
      due: dueIn30(),
      status: "draft",
      notes: "Net 30.",
    });
    expect(created.lines).toEqual([
      { id: expect.not.stringMatching(/^l\d$/), description: "Consult (1.5 hrs)", quantity: 1.5, rate: 300000, kind: "time" },
      { id: expect.not.stringMatching(/^l\d$/), description: "Court filing fee", quantity: 1, rate: 20000, kind: "expense" },
    ]);

    const list = await app.inject({ method: "GET", url: "/api/v1/invoices", headers: bearer(firmA.token) });
    expect(list.statusCode).toBe(200);
    const invoices = list.json() as { id: string; number: string; lines: unknown[] }[];
    // Newest first (the mock/reference unshift): INV-0001 was created first.
    expect(invoices.map((i) => i.number)).toEqual(["INV-0002", "INV-0001"]);
    expect(invoices[0]!.lines).toHaveLength(2);
    await app.close();
  });

  it("create-from-entries: the line math is server-side exact paise — quantity×rate computed and stored, never client-sent", async () => {
    await setup();
    // The client assembles lines from a case's unbilled time (hours = minutes/60)
    // and posts them; the response carries quantity/rate only — the total is
    // derived — but the server must store exact paise amounts per line.
    const created = await createInvoice(app, firmA.token, {
      lines: [
        // 90 minutes of ₹3,000/hr work → 1.5 hrs → 450000 paise exactly.
        { description: "Consult (1.5 hrs)", quantity: 90 / 60, rate: 300000, kind: "time" },
        // 10 minutes → 10/60 hrs → 50000 paise exactly (real math; float lands within half a paise).
        { description: "Drafting (10 min)", quantity: 10 / 60, rate: 300000, kind: "time" },
        // 1 minute → 5000 paise exactly.
        { description: "Review (1 min)", quantity: 1 / 60, rate: 300000, kind: "time" },
        // An expense line and a flat line, plain paise.
        { description: "Filing fee", quantity: 1, rate: 20000, kind: "expense" },
        { description: "Retainer top-up", quantity: 2, rate: 500000, kind: "flat" },
      ],
    });
    expect(created.number).toBe("INV-0001");

    // The client-derived total (what the UI prints) is exact paise.
    const lines = created.lines as { quantity: number; rate: number }[];
    const clientTotal = lines.reduce((s, l) => s + l.quantity * l.rate, 0);
    expect(Math.round(clientTotal)).toBe(450000 + 50000 + 5000 + 20000 + 1000000);

    // The server-stored amounts match to the paise, line by line.
    const stored = await repos.invoiceLines.listByInvoice(firmA.firmId, created.id);
    expect(stored.map((l) => l.amount)).toEqual([450000, 50000, 5000, 20000, 1000000]);
    expect(stored.map((l) => l.position)).toEqual([0, 1, 2, 3, 4]);
    await app.close();
  });

  it("client-sent totals, ids, numbers and stamps are stripped or ignored; the server owns them", async () => {
    await setup();
    const sneaky = await app.inject({
      method: "POST", url: "/api/v1/invoices", headers: bearer(firmA.token),
      payload: {
        number: "INV-9999",
        id: "00000000-0000-4000-8000-000000000000",
        firmId: firmB.firmId,
        issued: "1999-01-01",
        due: "1999-01-31",
        createdAt: "1999-01-01T00:00:00.000Z",
        status: "sent",
        // The contract's Invoice has no totals — whole-entity saves that carry
        // derived fields must not corrupt anything.
        total: 999999, amountPaid: 42, totalAmount: 999999, balance: 1,
        lines: [{ id: "l1", description: "Work", quantity: 2, rate: 100000, kind: "flat", amount: 1 }],
      },
    });
    expect(sneaky.statusCode).toBe(201);
    const created = sneaky.json() as Record<string, unknown> & { id: string };
    expect(created.number).toBe("INV-0001"); // counter, not the client's INV-9999
    expect(created.id).not.toBe("00000000-0000-4000-8000-000000000000");
    expect(created.issued).toBe(today()); // server-stamped, not 1999
    expect(created.due).toBe(dueIn30());
    expect(created.status).toBe("sent"); // the reference honors b.status at create
    expect(created).not.toHaveProperty("total");
    expect(created).not.toHaveProperty("amountPaid");
    expect(created).not.toHaveProperty("firmId");

    // The client-sent line id/amount are gone; the amount is recomputed.
    const line = (created.lines as { id: string }[])[0]!;
    expect(line.id).not.toBe("l1");
    const stored = await repos.invoiceLines.listByInvoice(firmA.firmId, created.id);
    expect(stored[0]!.amount).toBe(200000); // 2 × 100000, not the client's 1

    // The number cannot be forged by patch either.
    const patched = await app.inject({
      method: "PATCH", url: `/api/v1/invoices/${created.id}`,
      headers: bearer(firmA.token),
      payload: { number: "INV-0001", id: "00000000-0000-4000-8000-000000000000" },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { number: string }).number).toBe("INV-0001"); // unchanged (already 0001)

    const second = await createInvoice(app, firmA.token, { number: "INV-0001" });
    expect(second.number).toBe("INV-0002"); // the counter moved on regardless
    await app.close();
  });

  it("status moves freely within the contract vocabulary (draft → sent → paid, and back); outside it is a 400", async () => {
    await setup();
    const invoice = await createInvoice(app, firmA.token);
    const invoiceId = invoice.id;

    for (const status of ["sent", "overdue", "paid", "draft", "sent"]) {
      const res = await app.inject({
        method: "PATCH", url: `/api/v1/invoices/${invoiceId}`,
        headers: bearer(firmA.token), payload: { status },
      });
      expect(res.statusCode, status).toBe(200);
      expect((res.json() as { status: string }).status).toBe(status);
    }

    const bad = await app.inject({
      method: "PATCH", url: `/api/v1/invoices/${invoiceId}`,
      headers: bearer(firmA.token), payload: { status: "archived" },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: INVOICE_STATUS_MESSAGE });

    const badCreate = await app.inject({
      method: "POST", url: "/api/v1/invoices",
      headers: bearer(firmA.token), payload: { status: "settled" },
    });
    expect(badCreate.statusCode).toBe(400);
    expect(badCreate.json()).toEqual({ error: INVOICE_STATUS_MESSAGE });

    // Only the sent fields move.
    const untouched = await app.inject({
      method: "GET", url: `/api/v1/invoices/${invoiceId}`, headers: bearer(firmA.token),
    });
    expect(untouched.statusCode).toBe(200);
    const body = untouched.json() as { lines: unknown[]; number: string; issued: string };
    expect(body.lines).toHaveLength(1);
    expect(body.number).toBe("INV-0001");
    expect(body.issued).toBe(today());
    await app.close();
  });

  it("patch moves notes/issued/due and replaces the whole line set with recomputed amounts", async () => {
    await setup();
    const invoice = await createInvoice(app, firmA.token, {
      notes: "Net 30.",
      lines: [{ description: "Old line", quantity: 1, rate: 100000, kind: "flat" }],
    });
    const invoiceId = invoice.id;

    const patched = await app.inject({
      method: "PATCH", url: `/api/v1/invoices/${invoiceId}`,
      headers: bearer(firmA.token),
      payload: {
        notes: null,
        issued: "2026-09-01",
        due: "2026-10-01",
        lines: [
          { description: "New work (6 hrs)", quantity: 6, rate: 300000, kind: "time" },
          { description: "Copies", quantity: 3, rate: 2500, kind: "expense" },
        ],
      },
    });
    expect(patched.statusCode).toBe(200);
    const body = patched.json() as { notes?: string; issued: string; due: string; lines: { id: string }[] };
    expect(body).not.toHaveProperty("notes"); // notes: null clears the optional key
    expect(body.issued).toBe("2026-09-01");
    expect(body.due).toBe("2026-10-01");
    expect(body.lines).toHaveLength(2);

    // The old line rows are gone (value-set replacement), amounts recomputed.
    const stored = await repos.invoiceLines.listByInvoice(firmA.firmId, invoiceId);
    expect(stored.map((l) => [l.description, l.amount, l.position])).toEqual([
      ["New work (6 hrs)", 1800000, 0],
      ["Copies", 7500, 1],
    ]);

    // A bad date patch is a 400 before anything moves.
    const badDate = await app.inject({
      method: "PATCH", url: `/api/v1/invoices/${invoiceId}`,
      headers: bearer(firmA.token), payload: { issued: "01-09-2026" },
    });
    expect(badDate.statusCode).toBe(400);
    expect((badDate.json() as { error: string }).error).toMatch(/YYYY-MM-DD/);
    await app.close();
  });

  it("numbering: per-firm independence, and a deleted invoice's number is never reused", async () => {
    await setup();
    const first = await createInvoice(app, firmA.token);
    const second = await createInvoice(app, firmA.token);
    expect([first.number, second.number]).toEqual(["INV-0001", "INV-0002"]);

    const bFirst = await createInvoice(app, firmB.token);
    expect(bFirst.number).toBe("INV-0001"); // firm B's sequence is its own

    const deleted = await app.inject({
      method: "DELETE", url: `/api/v1/invoices/${second.id}`, headers: bearer(firmA.token),
    });
    expect(deleted.statusCode).toBe(204);
    const third = await createInvoice(app, firmA.token);
    expect(third.number).toBe("INV-0003"); // the counter never walks back
    await app.close();
  });

  it("client/case links: existence-checked, cross-firm links rejected, absent links render as empty strings", async () => {
    await setup();
    const caseA = await app.inject({
      method: "POST", url: "/api/v1/cases", headers: bearer(firmA.token), payload: { title: "A's Matter" },
    });
    const caseAId = (caseA.json() as { id: string }).id;
    const caseB = await app.inject({
      method: "POST", url: "/api/v1/cases", headers: bearer(firmB.token), payload: { title: "B's Matter" },
    });
    const caseBId = (caseB.json() as { id: string }).id;

    const linked = await createInvoice(app, firmA.token, { caseId: caseAId });
    expect(linked.caseId).toBe(caseAId);

    for (const [payload, message] of [
      [{ caseId: "00000000-0000-4000-8000-00000000dead" }, INVOICE_CASE_MISSING_MESSAGE],
      [{ caseId: caseBId }, INVOICE_CASE_MISSING_MESSAGE], // another firm's case
      [{ caseId: "k1" }, "Invalid case id"],
      [{ clientId: "00000000-0000-4000-8000-00000000dead" }, INVOICE_CLIENT_MISSING_MESSAGE],
      [{ clientId: "c1" }, "Invalid client id"],
    ] as [InvoicePayload, string][]) {
      const res = await app.inject({
        method: "POST", url: "/api/v1/invoices", headers: bearer(firmA.token), payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ error: message });
    }
    expect(await repos.invoices.listByFirm(firmA.firmId)).toHaveLength(1); // only `linked`
    await app.close();
  });

  it("validation: line quantity/rate/kind and line-set size are 400s before anything is written", async () => {
    await setup();
    for (const [payload, message] of [
      [{ lines: [{ description: "x", quantity: -1, rate: 100 }] }, INVOICE_QUANTITY_MESSAGE],
      [{ lines: [{ description: "x", quantity: 1, rate: -5 }] }, INVOICE_RATE_MESSAGE],
      [{ lines: [{ description: "x", quantity: 1, rate: 10.5 }] }, INVOICE_RATE_MESSAGE],
      [{ lines: [{ description: "x".repeat(4001), quantity: 1, rate: 100 }] }, "Line description is too long"],
      [{ lines: [{ description: "x", quantity: 1, rate: 100, kind: "misc" }] }, INVOICE_KIND_MESSAGE],
      [{ lines: Array.from({ length: 201 }, () => ({ quantity: 1, rate: 100 })) }, INVOICE_LINES_MESSAGE],
    ] as [InvoicePayload, string][]) {
      const res = await app.inject({
        method: "POST", url: "/api/v1/invoices", headers: bearer(firmA.token), payload,
      });
      expect(res.statusCode, JSON.stringify(payload).slice(0, 80)).toBe(400);
      expect(res.json()).toEqual({ error: message });
    }

    // Route-level shape rejects: a NaN/string quantity never reaches the service.
    for (const quantity of [Number.NaN, "1.5"]) {
      const res = await app.inject({
        method: "POST", url: "/api/v1/invoices", headers: bearer(firmA.token),
        payload: { lines: [{ quantity, rate: 100 }] },
      });
      expect(res.statusCode, String(quantity)).toBe(400);
    }

    // Nothing was written by any failed create.
    expect(await repos.invoices.listByFirm(firmA.firmId)).toEqual([]);
    await app.close();
  });

  it("cross-firm isolation: firm B cannot get, patch, or delete firm A's invoice; lists never leak", async () => {
    await setup();
    const invoiceA = await createInvoice(app, firmA.token);
    const invoiceB = await createInvoice(app, firmB.token);

    const attempts: ["PATCH" | "DELETE", string, InvoicePayload | undefined][] = [
      ["PATCH", `/api/v1/invoices/${invoiceA.id}`, { status: "paid" }],
      ["DELETE", `/api/v1/invoices/${invoiceA.id}`, undefined],
    ];
    for (const [method, url, payload] of attempts) {
      const res = await app.inject({
        method, url, headers: bearer(firmB.token), ...(payload ? { payload } : {}),
      });
      expect(res.statusCode, method).toBe(404);
      expect(res.json()).toEqual({ error: "Invoice not found" });
    }

    const getB = await app.inject({
      method: "GET", url: `/api/v1/invoices/${invoiceA.id}`, headers: bearer(firmB.token),
    });
    expect(getB.statusCode).toBe(404);

    // A patch carrying lines against a foreign id must not touch A's lines:
    // the 404 is decided before any write.
    const hijack = await app.inject({
      method: "PATCH", url: `/api/v1/invoices/${invoiceA.id}`,
      headers: bearer(firmB.token),
      payload: { lines: [{ description: "Hijacked", quantity: 9, rate: 9, kind: "flat" }] },
    });
    expect(hijack.statusCode).toBe(404);

    const listA = await app.inject({ method: "GET", url: "/api/v1/invoices", headers: bearer(firmA.token) });
    expect((listA.json() as { id: string }[]).map((i) => i.id)).toEqual([invoiceA.id]);
    const listB = await app.inject({ method: "GET", url: "/api/v1/invoices", headers: bearer(firmB.token) });
    expect((listB.json() as { id: string }[]).map((i) => i.id)).toEqual([invoiceB.id]);
    const linesA = await repos.invoiceLines.listByInvoice(firmA.firmId, invoiceA.id);
    expect(linesA).toHaveLength(1);
    expect(linesA[0]!.description).not.toBe("Hijacked");
    await app.close();
  });

  it("delete → 204 for a paid invoice too (the reference gates nothing); the invoice then 404s everywhere and a repeat delete 404s", async () => {
    await setup();
    const invoice = await createInvoice(app, firmA.token);
    await app.inject({
      method: "PATCH", url: `/api/v1/invoices/${invoice.id}`,
      headers: bearer(firmA.token), payload: { status: "paid" },
    });

    const deleted = await app.inject({
      method: "DELETE", url: `/api/v1/invoices/${invoice.id}`, headers: bearer(firmA.token),
    });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe("");

    const get = await app.inject({
      method: "GET", url: `/api/v1/invoices/${invoice.id}`, headers: bearer(firmA.token),
    });
    expect(get.statusCode).toBe(404);

    const list = await app.inject({ method: "GET", url: "/api/v1/invoices", headers: bearer(firmA.token) });
    expect(list.json()).toEqual([]);

    const repeat = await app.inject({
      method: "DELETE", url: `/api/v1/invoices/${invoice.id}`, headers: bearer(firmA.token),
    });
    expect(repeat.statusCode).toBe(404);
    expect(repeat.json()).toEqual({ error: "Invoice not found" });
    await app.close();
  });

  it("malformed ids are 400s (uuid params), and invoices need a session: anonymous reads and writes are 401", async () => {
    await setup();
    for (const [method, url] of [
      ["GET", "/api/v1/invoices/k1"],
      ["PATCH", "/api/v1/invoices/k1"],
      ["DELETE", "/api/v1/invoices/k1"],
    ] as ["GET" | "PATCH" | "DELETE", string][]) {
      const res = await app.inject({
        method, url, headers: bearer(firmA.token),
        ...(method === "PATCH" ? { payload: { status: "draft" } } : {}),
      });
      expect(res.statusCode, method).toBe(400);
    }

    const probes: ["GET" | "POST", string][] = [
      ["GET", "/api/v1/invoices"],
      ["POST", "/api/v1/invoices"],
    ];
    for (const [method, url] of probes) {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Not signed in" });
    }
    await app.close();
  });

  it("member-writable: an invited paralegal creates, sends, and deletes invoices", async () => {
    await setup();
    const member = await inviteAndOnboard(
      app, firmA, mailer, "Sahil Bose", "sahil@firm-a.example", "paralegal",
    );

    const created = await createInvoice(app, member.token, { notes: "Member's invoice" });
    expect(created.number).toBe("INV-0001");

    const sent = await app.inject({
      method: "PATCH", url: `/api/v1/invoices/${created.id}`,
      headers: bearer(member.token), payload: { status: "sent" },
    });
    expect(sent.statusCode).toBe(200);
    expect((sent.json() as { status: string }).status).toBe("sent");

    const deleted = await app.inject({
      method: "DELETE", url: `/api/v1/invoices/${created.id}`, headers: bearer(member.token),
    });
    expect(deleted.statusCode).toBe(204);
    await app.close();
  });

  it("without a database the invoices surface answers the 503 envelope", async () => {
    app = await buildApp(testConfig);
    const res = await app.inject({ method: "GET", url: "/api/v1/invoices" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/DATABASE_URL/);
    await app.close();
  });
});
