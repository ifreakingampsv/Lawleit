import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb } from "../db/client.js";
import type { AppConfig } from "../config.js";
import type { FastifyInstance } from "fastify";
import { CapturingMailer, inMemoryAuthRepositories } from "../services/auth/testing.js";
import { CONTACT_CASE_ID_MESSAGE, CONTACT_TYPE_MESSAGE } from "../services/contacts/service.js";

/**
 * Contacts routes (ticket 09) — in-memory repos, isolation.test.ts shape.
 * Behavior matrix, contract + reference backend (server.mjs) as north stars:
 *
 *   GET    /contacts       200 array, newest first (the reference unshifts)
 *   POST   /contacts       201 entity; reference defaults (type "client",
 *                          name "New contact", empty strings, empty caseIds);
 *                          `company` is patch-only there too
 *   GET    /contacts/:id   200 / 404 "Contact not found"
 *   PATCH  /contacts/:id   200 entity, only sent fields move / 404
 *   DELETE /contacts/:id   204 / 404
 *
 * Permissions: every firm member manages contacts (practice data — no owner
 * gate, unlike /users; the contract and the reference gate nothing). Cross-firm
 * ids are 404s that leak nothing. Deleted contacts vanish from reads; there
 * are no unique-ish contact fields, so nothing blocks a same-email recreate.
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

interface MemberContext {
  token: string;
  userId: string;
  email: string;
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

/** Creates one contact in the given firm with a full payload; returns it. */
async function createContact(
  app: FastifyInstance,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: "POST", url: "/api/v1/contacts",
    headers: bearer(token),
    payload: {
      name: "Harish Chadha", type: "client",
      email: "harish.chadha@example.com", phone: "+91 98110 23456",
      address: "C-6/12, Safdarjung Development Area, New Delhi 110016",
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as Record<string, unknown>;
}

describe("contacts (ticket 09)", () => {
  let app: FastifyInstance;
  let mailer: CapturingMailer;
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
    app = await buildApp(testConfig, {
      repositories: inMemoryAuthRepositories(),
      mailer,
    });
    firmA = await signupFirm(app, mailer, "owner@firm-a.example", "Aditi");
    firmB = await signupFirm(app, mailer, "owner@firm-b.example", "Bharat");
  }

  it("create → 201 contract shape, appears first in the firm's list (newest first, like the reference unshift)", async () => {
    await setup();
    const first = await createContact(app, firmA.token, { name: "Harish Chadha" });
    const second = await createContact(app, firmA.token, {
      name: "Meridian Logistics Pvt Ltd", type: "company",
    });

    // Contract shape: Contact fields only — firmId and bookkeeping stay put.
    expect(first).toMatchObject({
      type: "client",
      name: "Harish Chadha",
      email: "harish.chadha@example.com",
      phone: "+91 98110 23456",
      address: "C-6/12, Safdarjung Development Area, New Delhi 110016",
      caseIds: [],
    });
    expect(first.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const key of ["firmId", "updatedAt", "deletedAt", "notes", "company"]) {
      expect(first).not.toHaveProperty(key);
    }
    expect(second).toMatchObject({ type: "company", name: "Meridian Logistics Pvt Ltd" });

    const list = await app.inject({ method: "GET", url: "/api/v1/contacts", headers: bearer(firmA.token) });
    expect(list.statusCode).toBe(200);
    const contacts = list.json() as { id: string; name: string }[];
    expect(contacts.map((c) => c.name)).toEqual(["Meridian Logistics Pvt Ltd", "Harish Chadha"]);
    expect(contacts.every((c) => typeof c.id === "string" && c.id.length > 0)).toBe(true);
    await app.close();
  });

  it("create with an empty body lands on the reference defaults: New contact / client / empty strings", async () => {
    await setup();
    const res = await app.inject({
      method: "POST", url: "/api/v1/contacts", headers: bearer(firmA.token), payload: {},
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      type: "client", name: "New contact", email: "", phone: "", address: "", caseIds: [],
    });

    // Whole-entity save hardening: server-managed fields sent back by a UI
    // are stripped, and a patch-only field (`company`) is not create-able —
    // both exactly what the reference does.
    const sneaky = await app.inject({
      method: "POST", url: "/api/v1/contacts", headers: bearer(firmA.token),
      payload: { name: "Sneaky", id: "00000000-0000-4000-8000-000000000000", firmId: firmB.firmId, company: "Ghost Ltd" },
    });
    expect(sneaky.statusCode).toBe(201);
    const created = sneaky.json() as Record<string, unknown>;
    expect(created.id).not.toBe("00000000-0000-4000-8000-000000000000");
    expect(created).not.toHaveProperty("firmId");
    expect(created).not.toHaveProperty("company");
    expect((created.name as string)).toBe("Sneaky");
    await app.close();
  });

  it("get by id returns the entity; unknown, malformed, and foreign ids are not leaks", async () => {
    await setup();
    const contact = await createContact(app, firmA.token);

    const got = await app.inject({
      method: "GET", url: `/api/v1/contacts/${contact.id}`, headers: bearer(firmA.token),
    });
    expect(got.statusCode).toBe(200);
    expect((got.json() as { id: string }).id).toBe(contact.id);

    const missing = await app.inject({
      method: "GET", url: "/api/v1/contacts/00000000-0000-4000-8000-000000000000",
      headers: bearer(firmA.token),
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "Contact not found" });

    const malformed = await app.inject({
      method: "GET", url: "/api/v1/contacts/not-a-uuid", headers: bearer(firmA.token),
    });
    expect(malformed.statusCode).toBe(400);
    await app.close();
  });

  it("patch updates only the sent fields and echoes the whole entity", async () => {
    await setup();
    const contact = await createContact(app, firmA.token);
    const caseId = "00000000-0000-4000-8000-000000000042";

    const patched = await app.inject({
      method: "PATCH", url: `/api/v1/contacts/${contact.id}`,
      headers: bearer(firmA.token),
      payload: { phone: "555-1234", notes: "Prefers morning calls.", company: "Chadha & Sons", caseIds: [caseId] },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      id: contact.id, name: "Harish Chadha", type: "client",
      email: "harish.chadha@example.com", phone: "555-1234",
      notes: "Prefers morning calls.", company: "Chadha & Sons", caseIds: [caseId],
    });

    // The server-managed fields cannot be moved by a patch either.
    const sneaky = await app.inject({
      method: "PATCH", url: `/api/v1/contacts/${contact.id}`,
      headers: bearer(firmA.token),
      payload: { name: "Renamed", id: "00000000-0000-4000-8000-000000000000", createdAt: "1999-01-01" },
    });
    expect(sneaky.statusCode).toBe(200);
    expect(sneaky.json()).toMatchObject({ id: contact.id, name: "Renamed", createdAt: contact.createdAt });
    await app.close();
  });

  it("delete → 204; the contact then 404s, leaves the list, and a repeat delete 404s", async () => {
    await setup();
    const contact = await createContact(app, firmA.token);

    const deleted = await app.inject({
      method: "DELETE", url: `/api/v1/contacts/${contact.id}`, headers: bearer(firmA.token),
    });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe("");

    const gone = await app.inject({
      method: "GET", url: `/api/v1/contacts/${contact.id}`, headers: bearer(firmA.token),
    });
    expect(gone.statusCode).toBe(404);

    const list = await app.inject({ method: "GET", url: "/api/v1/contacts", headers: bearer(firmA.token) });
    expect(list.json()).toEqual([]);

    const repeat = await app.inject({
      method: "DELETE", url: `/api/v1/contacts/${contact.id}`, headers: bearer(firmA.token),
    });
    expect(repeat.statusCode).toBe(404);
    expect(repeat.json()).toEqual({ error: "Contact not found" });
    await app.close();
  });

  it("validation 400s carry the contract-style messages (type vocabulary, case id shape, lengths)", async () => {
    await setup();
    for (const [payload, message] of [
      [{ name: "Bad Type", type: "vendor" }, CONTACT_TYPE_MESSAGE],
      [{ name: "Bad Case", caseIds: ["k1"] }, CONTACT_CASE_ID_MESSAGE],
      [{ name: "x".repeat(201) }, "Name is too long"],
      [{ name: "Long Email", email: "x".repeat(321) }, "Email is too long"],
      [{ name: "Long Notes", notes: "x".repeat(4001) }, "Notes are too long"],
      [{ name: "Many Cases", caseIds: Array(101).fill("00000000-0000-4000-8000-000000000000") }, "Too many cases linked"],
    ] as [Record<string, unknown>, string][]) {
      const res = await app.inject({
        method: "POST", url: "/api/v1/contacts", headers: bearer(firmA.token), payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ error: message });
    }
    expect((await app.inject({ method: "GET", url: "/api/v1/contacts", headers: bearer(firmA.token) })).json()).toEqual([]);
    await app.close();
  });

  it("every firm member manages contacts — invited attorney creates, patches, and deletes (unlike /users)", async () => {
    await setup();
    const member = await inviteAndOnboard(
      app, firmA, mailer, "Meera Iyer", "meera@firm-a.example", "attorney",
    );

    const created = await createContact(app, member.token, { name: "Member's Contact" });
    expect((created.name as string)).toBe("Member's Contact");

    const patched = await app.inject({
      method: "PATCH", url: `/api/v1/contacts/${created.id}`,
      headers: bearer(member.token), payload: { phone: "555" },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { phone: string }).phone).toBe("555");

    const deleted = await app.inject({
      method: "DELETE", url: `/api/v1/contacts/${created.id}`, headers: bearer(member.token),
    });
    expect(deleted.statusCode).toBe(204);
    await app.close();
  });

  it("cross-firm isolation: firm B's session cannot see, patch, or delete firm A's contacts; lists never leak", async () => {
    await setup();
    const contactA = await createContact(app, firmA.token);
    await createContact(app, firmB.token, { name: "B's Own" });

    const attempts: ["GET" | "PATCH" | "DELETE", Record<string, unknown> | undefined][] = [
      ["GET", undefined],
      ["PATCH", { name: "Hijacked" }],
      ["DELETE", undefined],
    ];
    for (const [method, payload] of attempts) {
      const res = await app.inject({
        method, url: `/api/v1/contacts/${contactA.id}`,
        headers: bearer(firmB.token), ...(payload ? { payload } : {}),
      });
      expect(res.statusCode, method).toBe(404);
      expect(res.json()).toEqual({ error: "Contact not found" });
    }

    const listB = await app.inject({ method: "GET", url: "/api/v1/contacts", headers: bearer(firmB.token) });
    const namesB = (listB.json() as { name: string }[]).map((c) => c.name);
    expect(namesB).toEqual(["B's Own"]);
    expect(namesB).not.toContain("Harish Chadha");

    // A's list is untouched by all of it.
    const listA = await app.inject({ method: "GET", url: "/api/v1/contacts", headers: bearer(firmA.token) });
    expect((listA.json() as { id: string }[]).map((c) => c.id)).toEqual([contactA.id]);
    await app.close();
  });

  it("a firm's contact ids are created inside the session's firm, never another firm's", async () => {
    await setup();
    const created = await createContact(app, firmA.token);
    // No firmId in the response (contract shape) — the list is the proof.
    const listA = await app.inject({ method: "GET", url: "/api/v1/contacts", headers: bearer(firmA.token) });
    expect((listA.json() as { id: string }[]).map((c) => c.id)).toContain(created.id);
    const listB = await app.inject({ method: "GET", url: "/api/v1/contacts", headers: bearer(firmB.token) });
    expect(listB.json()).toEqual([]);
    await app.close();
  });

  it("no unique-ish fields: a deleted contact's email and name can be reused immediately", async () => {
    await setup();
    const first = await createContact(app, firmA.token, {
      name: "Kavita Menon", email: "kavita.menon@example.com",
    });
    await app.inject({
      method: "DELETE", url: `/api/v1/contacts/${first.id}`, headers: bearer(firmA.token),
    });

    const second = await createContact(app, firmA.token, {
      name: "Kavita Menon", email: "kavita.menon@example.com",
    });
    expect(second.id).not.toBe(first.id);
    const list = await app.inject({ method: "GET", url: "/api/v1/contacts", headers: bearer(firmA.token) });
    expect((list.json() as { id: string }[]).map((c) => c.id)).toEqual([second.id]);
    await app.close();
  });

  it("contacts need a session: anonymous reads and writes are 401", async () => {
    await setup();
    const probes: ["GET" | "POST", string][] = [
      ["GET", "/api/v1/contacts"],
      ["POST", "/api/v1/contacts"],
      ["GET", "/api/v1/contacts/00000000-0000-4000-8000-000000000000"],
    ];
    for (const [method, url] of probes) {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Not signed in" });
    }
    await app.close();
  });

  it("without a database the contacts surface answers the 503 envelope", async () => {
    app = await buildApp(testConfig);
    const signup = await app.inject({
      method: "POST", url: "/api/v1/auth/signup",
      payload: { firstName: "A", lastName: "B", email: "a@b.co", firmName: "F", zip: "", phone: "" },
    });
    expect(signup.statusCode).toBe(503);

    const res = await app.inject({ method: "GET", url: "/api/v1/contacts" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/DATABASE_URL/);
    await app.close();
  });
});
