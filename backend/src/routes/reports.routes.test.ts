import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb } from "../db/client.js";
import type { AppConfig } from "../config.js";
import type { FastifyInstance } from "fastify";
import { CapturingMailer, inMemoryAuthRepositories } from "../services/auth/testing.js";

/**
 * Reports routes (ticket 20) — GET /reports, in-memory repos,
 * isolation.test.ts shape. The contract's row is one line — "predefined
 * report descriptors" — and the reference backend's handler serves its
 * static seedReports list, so the assertions pin the exact catalog: the six
 * descriptors with the seed's ids (r1–r6 are load-bearing — the ReportsPage
 * keys its panels and its default selection on them), titles, kinds, and
 * descriptions, with no extra fields. The analytics themselves compute
 * client-side from the live module lists; see services/reports/service.ts
 * for the shape decision.
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

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("reports (ticket 20)", () => {
  let app: FastifyInstance;
  let mailer: CapturingMailer;
  let ownerToken: string;
  let memberToken: string;

  afterEach(async () => {
    await closeDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  async function setup(): Promise<void> {
    mailer = new CapturingMailer();
    app = await buildApp(testConfig, { repositories: inMemoryAuthRepositories(), mailer });
    const signup = await app.inject({
      method: "POST", url: "/api/v1/auth/signup",
      payload: {
        firstName: "Aditi", lastName: "& Partners", email: "owner@firm-a.example",
        firmName: "Firm of Aditi", zip: "110001", employees: 3, phone: "",
      },
    });
    expect(signup.statusCode).toBe(201);
    await app.inject({ method: "POST", url: "/api/v1/auth/password-reset", payload: { email: "owner@firm-a.example" } });
    await app.inject({
      method: "POST", url: "/api/v1/auth/password-reset/consume",
      payload: { token: mailer.sends[mailer.sends.length - 1]!.token, password: "password-123" },
    });
    const login = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { email: "owner@firm-a.example", password: "password-123" },
    });
    ownerToken = (login.json() as { token: string }).token;

    const created = await app.inject({
      method: "POST", url: "/api/v1/users", headers: bearer(ownerToken),
      payload: { name: "Meera Iyer", email: "meera@firm-a.example", role: "attorney" },
    });
    expect(created.statusCode).toBe(201);
    const invite = mailer.invites[mailer.invites.length - 1]!;
    await app.inject({
      method: "POST", url: "/api/v1/auth/password-reset/consume",
      payload: { token: invite.token, password: "member-pass-123" },
    });
    const memberLogin = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { email: "meera@firm-a.example", password: "member-pass-123" },
    });
    memberToken = (memberLogin.json() as { token: string }).token;
  }

  it("GET /reports serves the predefined catalog: the six descriptors, byte-shape compatible with the reference", async () => {
    await setup();
    const res = await app.inject({ method: "GET", url: "/api/v1/reports", headers: bearer(ownerToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: "r1", title: "Revenue by month", kind: "revenue", description: "Collected and planned revenue across the firm" },
      { id: "r2", title: "Hours by timekeeper", kind: "hours", description: "Billable vs non-billable hours per user" },
      { id: "r3", title: "Cases by stage", kind: "cases-by-stage", description: "Open matters across pipeline stages" },
      { id: "r4", title: "AR aging", kind: "ar-aging", description: "Outstanding client balances by age" },
      { id: "r5", title: "Leads by source", kind: "lead-source", description: "Where new business comes from" },
      { id: "r6", title: "Expenses by case", kind: "expenses", description: "Advanced costs per matter" },
    ]);
    await app.close();
  });

  it("the catalog is stable across calls (a caller mutating one response cannot reach the module's list)", async () => {
    await setup();
    const first = await app.inject({ method: "GET", url: "/api/v1/reports", headers: bearer(ownerToken) });
    (first.json() as { title: string }[])[0]!.title = "Mutated";
    const second = await app.inject({ method: "GET", url: "/api/v1/reports", headers: bearer(ownerToken) });
    expect((second.json() as { title: string }[])[0]!.title).toBe("Revenue by month");
    await app.close();
  });

  it("every firm member reads the catalog; anonymous callers are 401", async () => {
    await setup();
    const member = await app.inject({ method: "GET", url: "/api/v1/reports", headers: bearer(memberToken) });
    expect(member.statusCode).toBe(200);
    expect((member.json() as unknown[]).length).toBe(6);

    const anonymous = await app.inject({ method: "GET", url: "/api/v1/reports" });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({ error: "Not signed in" });
    await app.close();
  });

  it("without a database the reports surface answers the 503 envelope", async () => {
    app = await buildApp(testConfig);
    const res = await app.inject({ method: "GET", url: "/api/v1/reports" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/DATABASE_URL/);
    await app.close();
  });
});
