import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb } from "../db/client.js";
import type { AppConfig } from "../config.js";
import type { FastifyInstance } from "fastify";
import { CapturingMailer, inMemoryAuthRepositories } from "../services/auth/testing.js";

/**
 * Cross-firm isolation — THE TEMPLATE (ADR-0003): sign in two different firms,
 * then assert that entity access across the firm boundary 404s and lists never
 * leak the other firm's rows. Every later module copies this file's shape for
 * its own resources (cases, contacts, invoices, …) and adds a DB-backed twin
 * (drizzle-repository.test.ts pattern) that runs when DATABASE_URL exists.
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

const bearer = (firm: FirmContext) => ({ authorization: `Bearer ${firm.token}` });

describe("cross-firm isolation (template)", () => {
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

  it("GET /users never lists another firm's users", async () => {
    await setup();
    const res = await app.inject({ method: "GET", url: "/api/v1/users", headers: bearer(firmA) });
    expect(res.statusCode).toBe(200);
    const users = res.json() as { id: string; email: string }[];
    expect(users).toHaveLength(1);
    expect(users[0]!.email).toBe(firmA.email);
    expect(users.map((u) => u.email)).not.toContain(firmB.email);
    await app.close();
  });

  it("another firm's user id is a 404, never a leak", async () => {
    await setup();
    const res = await app.inject({
      method: "PATCH", url: `/api/v1/users/${firmA.userId}`,
      headers: bearer(firmB),
      payload: { name: "Hijacked", active: false },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "User not found" });

    // The cross-firm write did not happen: firm A's owner is intact and signed in.
    const session = await app.inject({ method: "GET", url: "/api/v1/session", headers: bearer(firmA) });
    expect(session.statusCode).toBe(200);
    expect((session.json() as { user: { name: string } }).user.name).toBe("Aditi & Partners");
    await app.close();
  });

  it("PATCH /firm only ever touches the session's own firm", async () => {
    await setup();
    // Whole-entity save from the UI: unknown/server-managed keys are stripped.
    const res = await app.inject({
      method: "PATCH", url: "/api/v1/firm",
      headers: bearer(firmB),
      payload: { id: firmB.firmId, name: "Renamed & Co", trialEndsAt: "2000-01-01", plan: "pro" },
    });
    expect(res.statusCode).toBe(200);
    const patched = res.json() as { id: string; name: string; plan: string; trialEndsAt: string };
    expect(patched.id).toBe(firmB.firmId);
    expect(patched.name).toBe("Renamed & Co");
    expect(patched.plan).toBe("pro");
    expect(patched.trialEndsAt).not.toBe("2000-01-01");

    const sessionA = await app.inject({ method: "GET", url: "/api/v1/session", headers: bearer(firmA) });
    expect((sessionA.json() as { firm: { name: string } }).firm.name).toBe("Firm of Aditi");
    await app.close();
  });

  it("a firm's session cannot be used to see another firm's session payload", async () => {
    await setup();
    const res = await app.inject({ method: "GET", url: "/api/v1/session", headers: bearer(firmA) });
    const body = res.json() as { user: { firmId: string }; firm: { id: string }; users: { firmId: string }[] };
    expect(body.firm.id).toBe(firmA.firmId);
    expect(body.user.firmId).toBe(firmA.firmId);
    expect(body.users.every((u) => u.firmId === firmA.firmId)).toBe(true);
    await app.close();
  });
});
