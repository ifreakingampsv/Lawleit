import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb } from "../db/client.js";
import type { AppConfig } from "../config.js";
import type { FastifyInstance } from "fastify";
import {
  LEAD_SOURCE_MESSAGE,
  LEAD_STAGE_MESSAGE,
  LEAD_VALUE_MESSAGE,
} from "../services/leads/service.js";
import { CapturingMailer, inMemoryAuthRepositories } from "../services/auth/testing.js";
import type { AuthRepositories } from "../services/auth/repository.js";

/**
 * Leads routes (ticket 16) — in-memory repos, cases.routes.test.ts shape.
 * Behavior matrix, contract + reference backend (server.mjs) as north stars:
 *
 *   GET    /leads              200 array, newest first (no GET /leads/:id —
 *                                  the contract mounts none)
 *   POST   /leads              201 entity; reference defaults ("New lead",
 *                                  website, new, "General", value 0); the
 *                                  activity log is server-built
 *   PATCH  /leads/:id          200 entity, only sent fields move / 404; an
 *                                  actual stage move appends to `activity`
 *                                  (contract note) and records one
 *                                  lead_stage_history row; free transitions
 *   DELETE /leads/:id          204 / 404 — nothing blocks a delete
 *   POST   /leads/:id/convert  201 { lead, contact, case } — one transaction
 *                                  creates the client contact + the numbered
 *                                  case (the same YYYY-NNNN counter as
 *                                  POST /cases) + converts the lead;
 *                                  double conversion → 409 "Lead already
 *                                  converted" (the mock parity fix)
 *
 * Permissions: every firm member manages leads (practice data — no owner
 * gate). `activity` and the conversion links are server-managed and cannot be
 * forced by create, patch, or convert payloads. Cross-firm ids are 404s that
 * leak nothing.
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

/** The UTC day the service stamps into createdAt / openDate / case numbers. */
const today = () => new Date().toISOString().slice(0, 10);
const currentYear = () => new Date().toISOString().slice(0, 4);

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

/** Creates one lead in the given firm; returns it. */
async function createLead(
  app: FastifyInstance,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: "POST", url: "/api/v1/leads",
    headers: bearer(token),
    payload: {
      name: "Kavya Nair", email: "kavya@example.in", phone: "98765 43210",
      source: "referral", practiceArea: "Family Law", value: 500000,
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as Record<string, unknown>;
}

describe("leads (ticket 16)", () => {
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

  it("create → 201 contract shape with reference defaults; the activity log is server-built and the list is newest first", async () => {
    await setup();
    const res = await app.inject({
      method: "POST", url: "/api/v1/leads", headers: bearer(firmA.token), payload: {},
    });
    expect(res.statusCode).toBe(201);
    const bare = res.json() as Record<string, unknown>;
    expect(bare).toMatchObject({
      name: "New lead", email: "", phone: "",
      source: "website", stage: "new", practiceArea: "General", value: 0,
      createdAt: today(),
    });
    // The server-built log — a client-sent `activity` never gets in.
    expect(bare.activity).toEqual([
      { at: expect.any(String), text: "Lead created" },
    ]);
    // Contract shape only — bookkeeping and the DB-only conversion links stay absent.
    for (const key of [
      "firmId", "updatedAt", "deletedAt",
      "convertedCaseId", "convertedContactId", "notes",
    ]) {
      expect(bare).not.toHaveProperty(key);
    }

    const created = await createLead(app, firmA.token, {
      notes: "Referred by the Mehta retainer.",
    });
    expect(created).toMatchObject({
      name: "Kavya Nair", email: "kavya@example.in", phone: "98765 43210",
      source: "referral", stage: "new", practiceArea: "Family Law", value: 500000,
      notes: "Referred by the Mehta retainer.", createdAt: today(),
    });

    const list = await app.inject({ method: "GET", url: "/api/v1/leads", headers: bearer(firmA.token) });
    expect(list.statusCode).toBe(200);
    const leads = list.json() as { id: string; name: string }[];
    // Newest first (the mock/reference unshift): "New lead" was created first.
    expect(leads.map((l) => l.name)).toEqual(["Kavya Nair", "New lead"]);
    await app.close();
  });

  it("server-managed fields cannot be forced by create or patch; value validation is the service's", async () => {
    await setup();
    const sneaky = await app.inject({
      method: "POST", url: "/api/v1/leads", headers: bearer(firmA.token),
      payload: {
        name: "Sneaky", id: "00000000-0000-4000-8000-000000000000",
        firmId: firmB.firmId, stage: "fee agreement", value: 250000,
        activity: [{ at: "1999-01-01T00:00:00.000Z", text: "Forged" }],
        convertedCaseId: "00000000-0000-4000-8000-00000000dead",
        convertedContactId: "00000000-0000-4000-8000-00000000beef",
        createdAt: "1999-01-01",
      },
    });
    expect(sneaky.statusCode).toBe(201);
    const created = sneaky.json() as Record<string, unknown> & {
      id: string; activity: { text: string }[];
    };
    expect(created.id).not.toBe("00000000-0000-4000-8000-000000000000");
    expect(created.activity).toEqual([{ at: expect.any(String), text: "Lead created" }]);
    expect(created).not.toHaveProperty("firmId");
    expect(created).not.toHaveProperty("convertedCaseId");

    // The client cannot forge history or links by patching either.
    const patched = await app.inject({
      method: "PATCH", url: `/api/v1/leads/${created.id}`,
      headers: bearer(firmA.token),
      payload: {
        activity: [{ at: "1999-01-01T00:00:00.000Z", text: "Forged" }],
        convertedCaseId: "00000000-0000-4000-8000-00000000dead",
        convertedContactId: "00000000-0000-4000-8000-00000000beef",
      },
    });
    expect(patched.statusCode).toBe(200);
    const after = patched.json() as { activity: { text: string }[] };
    expect(after.activity.map((e) => e.text)).toEqual(["Lead created"]);
    expect(after).not.toHaveProperty("convertedCaseId");

    for (const [payload, message] of [
      [{ name: "Bad Stage", stage: "won" }, LEAD_STAGE_MESSAGE],
      [{ name: "Bad Source", source: "billboard" }, LEAD_SOURCE_MESSAGE],
      [{ name: "Negative Value", value: -1 }, LEAD_VALUE_MESSAGE],
      [{ name: "Fractional Value", value: 10.5 }, LEAD_VALUE_MESSAGE],
      [{ name: "x".repeat(201) }, "Name is too long"],
      [{ name: "Long Notes", notes: "x".repeat(4001) }, "Notes are too long"],
    ] as [Record<string, unknown>, string][]) {
      const res = await app.inject({
        method: "POST", url: "/api/v1/leads", headers: bearer(firmA.token), payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ error: message });
    }

    // Patch-side validation is the service's too.
    const lead = await createLead(app, firmA.token);
    const badPatch = await app.inject({
      method: "PATCH", url: `/api/v1/leads/${lead.id}`,
      headers: bearer(firmA.token), payload: { source: "billboard" },
    });
    expect(badPatch.statusCode).toBe(400);
    expect(badPatch.json()).toEqual({ error: LEAD_SOURCE_MESSAGE });
    await app.close();
  });

  it("patch moves stages freely; an actual move appends to activity and records history — re-sending the stage records nothing", async () => {
    await setup();
    const lead = await createLead(app, firmA.token);
    const leadId = lead.id as string;

    const moved = await app.inject({
      method: "PATCH", url: `/api/v1/leads/${leadId}`,
      headers: bearer(firmA.token), payload: { stage: "contacted" },
    });
    expect(moved.statusCode).toBe(200);
    const afterMove = moved.json() as {
      stage: string; activity: { at: string; text: string }[]; value: number; name: string;
    };
    expect(afterMove.stage).toBe("contacted");
    // Newest-first log, per the contract's "stage moves append to activity"
    // (the reference's conversion entry sits in the same position).
    expect(afterMove.activity.map((e) => e.text)).toEqual(["Moved to contacted", "Lead created"]);
    expect(afterMove.activity[1]!.at).toEqual((lead.activity as { at: string }[])[0]!.at);
    // Only the sent field moved.
    expect(afterMove.value).toBe(500000);

    let history = await repos.leadStageHistory.listByLead(firmA.firmId, leadId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      firmId: firmA.firmId, leadId, fromStage: "new", toStage: "contacted",
      changedBy: firmA.userId,
    });

    // Re-sending the current stage: no entry, no history row.
    const again = await app.inject({
      method: "PATCH", url: `/api/v1/leads/${leadId}`,
      headers: bearer(firmA.token), payload: { stage: "contacted" },
    });
    expect(again.statusCode).toBe(200);
    expect((again.json() as { activity: unknown[] }).activity).toHaveLength(2);
    history = await repos.leadStageHistory.listByLead(firmA.firmId, leadId);
    expect(history).toHaveLength(1);

    // A non-stage patch leaves the log untouched; notes: null clears.
    const renamed = await app.inject({
      method: "PATCH", url: `/api/v1/leads/${leadId}`,
      headers: bearer(firmA.token), payload: { name: "Kavya Nair-Sethi", notes: null },
    });
    expect(renamed.statusCode).toBe(200);
    const renamedBody = renamed.json() as { name: string; notes?: string; activity: unknown[] };
    expect(renamedBody.name).toBe("Kavya Nair-Sethi");
    expect(renamedBody).not.toHaveProperty("notes");
    expect(renamedBody.activity).toHaveLength(2);
    expect(await repos.leadStageHistory.listByLead(firmA.firmId, leadId)).toHaveLength(1);

    // Free transitions (no transition table in the contract): onward, then back.
    for (const stage of ["fee agreement", "lost", "new"]) {
      const res = await app.inject({
        method: "PATCH", url: `/api/v1/leads/${leadId}`,
        headers: bearer(firmA.token), payload: { stage },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { stage: string }).stage).toBe(stage);
    }
    history = await repos.leadStageHistory.listByLead(firmA.firmId, leadId);
    expect(history.map((h) => [h.fromStage, h.toStage])).toEqual([
      ["lost", "new"], ["fee agreement", "lost"], ["contacted", "fee agreement"], ["new", "contacted"],
    ]);
    await app.close();
  });

  it("conversion happy path: one POST creates the client contact + numbered case and converts the lead; the case counter is shared with POST /cases", async () => {
    await setup();
    const lead = await createLead(app, firmA.token);
    const leadId = lead.id as string;

    // A case created the ordinary way consumed -0001: conversion continues the
    // same per-firm-year sequence (the reference's assignCaseNumber()).
    const ordinary = await app.inject({
      method: "POST", url: "/api/v1/cases", headers: bearer(firmA.token),
      payload: { title: "Ordinary Matter" },
    });
    expect(ordinary.statusCode).toBe(201);

    const res = await app.inject({
      method: "POST", url: `/api/v1/leads/${leadId}/convert`,
      headers: bearer(firmA.token),
      payload: { title: "Nair — Family Law (converted)" },
    });
    expect(res.statusCode).toBe(201);
    const { lead: converted, contact, case: kase } = res.json() as {
      lead: Record<string, unknown>; contact: Record<string, unknown>; case: Record<string, unknown>;
    };
    expect(converted).toMatchObject({ id: leadId, stage: "converted" });
    expect((converted.activity as { text: string }[])[0]!.text).toBe(
      `Converted to case ${currentYear()}-0002`,
    );
    expect(contact).toMatchObject({
      type: "client", name: "Kavya Nair", email: "kavya@example.in",
      phone: "98765 43210", address: "", caseIds: [kase.id], createdAt: today(),
    });
    expect(kase).toMatchObject({
      number: `${currentYear()}-0002`,
      title: "Nair — Family Law (converted)",
      clientId: contact.id,
      practiceArea: "Family Law", stage: "intake", status: "open",
      openDate: today(), leadAttorneyId: firmA.userId,
      description: "", billableRate: 300000, trustBalance: 0,
    });

    // The conversion links are DB-only (not in the API shape) but really set.
    const row = await repos.leads.findById(firmA.firmId, leadId);
    expect(row!.convertedCaseId).toBe(kase.id);
    expect(row!.convertedContactId).toBe(contact.id);

    const history = await repos.leadStageHistory.listByLead(firmA.firmId, leadId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      fromStage: "new", toStage: "converted", changedBy: firmA.userId,
    });

    // Only title/description are read: everything else stays server-decided.
    const second = await createLead(app, firmA.token, { name: "Rohit Verma", practiceArea: "Property" });
    const sneaky = await app.inject({
      method: "POST", url: `/api/v1/leads/${second.id}/convert`,
      headers: bearer(firmA.token),
      payload: {
        title: "Verma conversion", description: "From the Verma lead.",
        stage: "resolved", status: "closed", number: "9999-9999",
        billableRate: 1, trustBalance: 999, openDate: "1999-01-01",
      },
    });
    expect(sneaky.statusCode).toBe(201);
    const sneakyCase = (sneaky.json() as { case: Record<string, unknown> }).case;
    expect(sneakyCase).toMatchObject({
      number: `${currentYear()}-0003`,
      title: "Verma conversion",
      description: "From the Verma lead.",
      stage: "intake", status: "open", openDate: today(),
      billableRate: 300000, trustBalance: 0,
    });
    await app.close();
  });

  it("conversion without a payload lands on the reference defaults; double conversion is the parity conflict", async () => {
    await setup();
    const lead = await createLead(app, firmA.token, {
      name: "Meera Kapoor", practiceArea: "Cheque Bounce (s.138)", email: "", phone: "",
    });

    const first = await app.inject({
      method: "POST", url: `/api/v1/leads/${lead.id}/convert`,
      headers: bearer(firmA.token), payload: {},
    });
    expect(first.statusCode).toBe(201);
    const body = first.json() as { case: Record<string, unknown>; contact: Record<string, unknown> };
    expect(body.case).toMatchObject({
      number: `${currentYear()}-0001`,
      title: "Meera Kapoor — Cheque Bounce (s.138)",
      clientId: body.contact.id,
    });

    // The mock parity fix (docs/API_CONTRACT.md "Lead conversion" +
    // mockAdapter.convertLead): converting twice is a conflict, not a second case.
    const again = await app.inject({
      method: "POST", url: `/api/v1/leads/${lead.id}/convert`,
      headers: bearer(firmA.token), payload: {},
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: "Lead already converted" });

    const cases = await app.inject({ method: "GET", url: "/api/v1/cases", headers: bearer(firmA.token) });
    expect((cases.json() as unknown[]).length).toBe(1);
    await app.close();
  });

  it("cross-firm isolation: firm B cannot see, patch, delete, or convert firm A's lead; lists never leak", async () => {
    await setup();
    const leadA = await createLead(app, firmA.token, { name: "A's Prospect" });
    const leadB = await createLead(app, firmB.token, { name: "B's Prospect" });

    const attempts: ["PATCH" | "DELETE" | "POST", string, Record<string, unknown> | undefined][] = [
      ["PATCH", `/api/v1/leads/${leadA.id}`, { name: "Hijacked" }],
      ["DELETE", `/api/v1/leads/${leadA.id}`, undefined],
      ["POST", `/api/v1/leads/${leadA.id}/convert`, {}],
    ];
    for (const [method, url, payload] of attempts) {
      const res = await app.inject({
        method, url, headers: bearer(firmB.token), ...(payload ? { payload } : {}),
      });
      expect(res.statusCode, method).toBe(404);
      expect(res.json()).toEqual({ error: "Lead not found" });
    }

    const listA = await app.inject({ method: "GET", url: "/api/v1/leads", headers: bearer(firmA.token) });
    expect((listA.json() as { name: string }[]).map((l) => l.name)).toEqual(["A's Prospect"]);
    const listB = await app.inject({ method: "GET", url: "/api/v1/leads", headers: bearer(firmB.token) });
    expect((listB.json() as { name: string }[]).map((l) => l.name)).toEqual(["B's Prospect"]);

    // B's conversion creates B's contact + B's case, never A's.
    const converted = await app.inject({
      method: "POST", url: `/api/v1/leads/${leadB.id}/convert`,
      headers: bearer(firmB.token), payload: {},
    });
    expect(converted.statusCode).toBe(201);
    const contact = (converted.json() as { contact: { id: string } }).contact;
    const listContactsB = await app.inject({
      method: "GET", url: "/api/v1/contacts", headers: bearer(firmB.token),
    });
    expect((listContactsB.json() as { id: string }[]).map((c) => c.id)).toEqual([contact.id]);
    const listContactsA = await app.inject({
      method: "GET", url: "/api/v1/contacts", headers: bearer(firmA.token),
    });
    expect(listContactsA.json()).toEqual([]);
    await app.close();
  });

  it("delete → 204; the lead then 404s everywhere (convert included), leaves the list, and a repeat delete 404s; history outlives the delete", async () => {
    await setup();
    const lead = await createLead(app, firmA.token);
    const leadId = lead.id as string;

    await app.inject({
      method: "PATCH", url: `/api/v1/leads/${leadId}`,
      headers: bearer(firmA.token), payload: { stage: "contacted" },
    });

    const deleted = await app.inject({
      method: "DELETE", url: `/api/v1/leads/${leadId}`, headers: bearer(firmA.token),
    });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe("");

    const convert = await app.inject({
      method: "POST", url: `/api/v1/leads/${leadId}/convert`,
      headers: bearer(firmA.token), payload: {},
    });
    expect(convert.statusCode).toBe(404);
    expect(convert.json()).toEqual({ error: "Lead not found" });

    const list = await app.inject({ method: "GET", url: "/api/v1/leads", headers: bearer(firmA.token) });
    expect(list.json()).toEqual([]);

    const repeat = await app.inject({
      method: "DELETE", url: `/api/v1/leads/${leadId}`, headers: bearer(firmA.token),
    });
    expect(repeat.statusCode).toBe(404);
    expect(repeat.json()).toEqual({ error: "Lead not found" });

    // The audit trail outlives the (soft-deleted) lead — it is history, not a live view.
    const history = await repos.leadStageHistory.listByLead(firmA.firmId, leadId);
    expect(history.map((h) => [h.fromStage, h.toStage])).toEqual([["new", "contacted"]]);
    await app.close();
  });

  it("malformed ids are 400s (uuid params), and leads need a session: anonymous reads and writes are 401", async () => {
    await setup();
    for (const [method, url] of [
      ["PATCH", "/api/v1/leads/k1"],
      ["DELETE", "/api/v1/leads/k1"],
      ["POST", "/api/v1/leads/k1/convert"],
    ] as ["PATCH" | "DELETE" | "POST", string][]) {
      const res = await app.inject({
        method, url, headers: bearer(firmA.token),
        ...(method === "PATCH" ? { payload: { stage: "new" } } : {}),
      });
      expect(res.statusCode, method).toBe(400);
    }

    const probes: ["GET" | "POST", string][] = [
      ["GET", "/api/v1/leads"],
      ["POST", "/api/v1/leads"],
      ["POST", "/api/v1/leads/00000000-0000-4000-8000-000000000000/convert"],
    ];
    for (const [method, url] of probes) {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Not signed in" });
    }
    await app.close();
  });

  it("member-writable: an invited paralegal creates, moves, converts, and deletes leads (unlike /users)", async () => {
    await setup();
    const member = await inviteAndOnboard(
      app, firmA, mailer, "Sahil Bose", "sahil@firm-a.example", "paralegal",
    );

    const created = await createLead(app, member.token, { name: "Member's Prospect" });
    expect(created.name).toBe("Member's Prospect");

    const moved = await app.inject({
      method: "PATCH", url: `/api/v1/leads/${created.id}`,
      headers: bearer(member.token), payload: { stage: "consult scheduled" },
    });
    expect(moved.statusCode).toBe(200);
    expect((moved.json() as { stage: string }).stage).toBe("consult scheduled");

    const converted = await app.inject({
      method: "POST", url: `/api/v1/leads/${created.id}/convert`,
      headers: bearer(member.token), payload: {},
    });
    expect(converted.statusCode).toBe(201);
    const { lead, case: kase } = converted.json() as {
      lead: { stage: string }; case: { number: string };
    };
    expect(lead.stage).toBe("converted");
    expect(kase.number).toBe(`${currentYear()}-0001`);
    // Both moves happened, newest first: the conversion moves from the lead's
    // current stage (consult scheduled), the earlier move from new.
    const history = await repos.leadStageHistory.listByLead(firmA.firmId, created.id as string);
    expect(history.map((h) => [h.fromStage, h.toStage])).toEqual([
      ["consult scheduled", "converted"], ["new", "consult scheduled"],
    ]);

    const deleted = await app.inject({
      method: "DELETE", url: `/api/v1/leads/${created.id}`,
      headers: bearer(member.token),
    });
    expect(deleted.statusCode).toBe(204);
    await app.close();
  });

  it("without a database the leads surface answers the 503 envelope", async () => {
    app = await buildApp(testConfig);
    const res = await app.inject({ method: "GET", url: "/api/v1/leads" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/DATABASE_URL/);
    await app.close();
  });
});
