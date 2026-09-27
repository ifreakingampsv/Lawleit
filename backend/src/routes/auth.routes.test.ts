import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb } from "../db/client.js";
import type { AppConfig } from "../config.js";
import { CapturingMailer, inMemoryAuthRepositories } from "../services/auth/testing.js";

const testConfig: AppConfig = {
  port: 0,
  corsOrigins: ["http://localhost:5173"],
  sessionSecret: "test-secret",
  databaseUrl: null,
  cookieSameSite: "lax",
  cookieSecure: false,
};

const signupBody = {
  firstName: "Arjun",
  lastName: "Kaul",
  email: "arjun@kaulbhatnagar.example",
  firmName: "Kaul & Bhatnagar Associates",
  zip: "110001",
  employees: 12,
  phone: "+91 11 4355 6210",
};

function cookiesOf(headers: Record<string, unknown>): string[] {
  const raw = headers["set-cookie"];
  if (!raw) return [];
  return Array.isArray(raw) ? raw.map(String) : [String(raw)];
}

async function signupAndLogin() {
  const mailer = new CapturingMailer();
  const app = await buildApp(testConfig, {
    repositories: inMemoryAuthRepositories(),
    mailer,
  });
  const signup = await app.inject({ method: "POST", url: "/api/v1/auth/signup", payload: signupBody });
  expect(signup.statusCode).toBe(201);
  // The signup payload has no password: set one through the reset flow.
  await app.inject({ method: "POST", url: "/api/v1/auth/password-reset", payload: { email: signupBody.email } });
  const consume = await app.inject({
    method: "POST",
    url: "/api/v1/auth/password-reset/consume",
    payload: { token: mailer.sends[0]!.token, password: "initial-password" },
  });
  expect(consume.statusCode).toBe(204);
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: signupBody.email, password: "initial-password" },
  });
  expect(login.statusCode).toBe(200);
  return { app, mailer, token: (login.json() as { token: string }).token };
}

afterEach(async () => {
  await closeDb();
});

afterAll(async () => {
  await closeDb();
});

describe("auth routes without a database", () => {
  it("auth surface answers the 503 envelope instead of crashing", async () => {
    const app = await buildApp(testConfig);
    for (const call of [
      { method: "POST", url: "/api/v1/auth/login", payload: { email: "a@b.co", password: "x" } },
      { method: "POST", url: "/api/v1/auth/signup", payload: signupBody },
      { method: "GET", url: "/api/v1/session" },
      { method: "POST", url: "/api/v1/auth/logout" },
      { method: "POST", url: "/api/v1/auth/password-reset", payload: { email: "a@b.co" } },
    ] as const) {
      const res = await app.inject(call);
      expect(res.statusCode, call.url).toBe(503);
      expect(res.json().error).toMatch(/DATABASE_URL/);
    }
    await app.close();
  });

  it("protected routes answer the same 503 via the session guard", async () => {
    const app = await buildApp(testConfig);
    const res = await app.inject({ method: "GET", url: "/api/v1/users" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/DATABASE_URL/);
    await app.close();
  });
});

describe("auth routes (contract surface)", () => {
  it("signup → 201 { token, user, firm, users } and sets the reference cookie", async () => {
    const app = await buildApp(testConfig, { repositories: inMemoryAuthRepositories() });
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/signup", payload: signupBody });

    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      token: string; user: Record<string, unknown>; firm: Record<string, unknown>; users: unknown[];
    };
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.user).toMatchObject({
      email: "arjun@kaulbhatnagar.example",
      name: "Arjun Kaul",
      role: "owner",
      active: true,
      hourlyRate: 300000,
    });
    expect(body.user).not.toHaveProperty("passwordHash");
    expect(body.firm).toMatchObject({
      name: "Kaul & Bhatnagar Associates",
      plan: "basic",
      practiceAreas: [],
    });
    expect(body.firm.trialEndsAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.users).toHaveLength(1);
    expect(body.users[0]).not.toHaveProperty("passwordHash");

    const [cookie] = cookiesOf(res.headers);
    expect(cookie).toContain("lawleit_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=604800");
    await app.close();
  });

  it("cookie knobs follow config (SameSite=None + Secure for the cross-site deploy)", async () => {
    const app = await buildApp(
      { ...testConfig, cookieSameSite: "none", cookieSecure: true },
      { repositories: inMemoryAuthRepositories() },
    );
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/signup", payload: signupBody });
    const [cookie] = cookiesOf(res.headers);
    expect(cookie).toContain("SameSite=None");
    expect(cookie).toContain("Secure");
    await app.close();
  });

  it("signup validation → 400 with a human message", async () => {
    const app = await buildApp(testConfig, { repositories: inMemoryAuthRepositories() });
    const noFirm = await app.inject({
      method: "POST", url: "/api/v1/auth/signup",
      payload: { ...signupBody, firmName: "" },
    });
    expect(noFirm.statusCode).toBe(400);
    expect(noFirm.json().error).toBe("Firm name is required");

    const badEmail = await app.inject({
      method: "POST", url: "/api/v1/auth/signup",
      payload: { ...signupBody, email: "not-an-email" },
    });
    expect(badEmail.statusCode).toBe(400);
    expect(badEmail.json().error).toBe("A valid email is required");
    await app.close();
  });

  it("login: empty → 401 contract message; wrong password → 401; correct → 200 session", async () => {
    const { app, token } = await signupAndLogin();

    const empty = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "", password: "" } });
    expect(empty.statusCode).toBe(401);
    expect(empty.json()).toEqual({ error: "Email and password required" });

    const wrong = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { email: signupBody.email, password: "wrong" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error).toBe("Invalid email or password");

    const ok = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { email: signupBody.email, password: "initial-password" },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as { token: string; user: { email: string }; firm: unknown; users: unknown[] };
    expect(body.token).toBeTruthy();
    expect(body.user.email).toBe("arjun@kaulbhatnagar.example");
    expect(body.firm).toBeTruthy();
    expect(Array.isArray(body.users)).toBe(true);
    expect(body.token).not.toBe(token); // each login issues its own session
    await app.close();
  });

  it("GET /session: 200 payload with bearer, 401 'Not signed in' without or with garbage", async () => {
    const { app, token } = await signupAndLogin();

    const ok = await app.inject({ method: "GET", url: "/api/v1/session", headers: { authorization: `Bearer ${token}` } });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as { user: { email: string }; firm: { name: string }; users: unknown[] };
    expect(body.user.email).toBe(signupBody.email);
    expect(body.firm.name).toBe(signupBody.firmName);
    expect(Array.isArray(body.users)).toBe(true);
    expect(body).not.toHaveProperty("token");

    const anon = await app.inject({ method: "GET", url: "/api/v1/session" });
    expect(anon.statusCode).toBe(401);
    expect(anon.json()).toEqual({ error: "Not signed in" });

    const garbage = await app.inject({
      method: "GET", url: "/api/v1/session",
      headers: { authorization: "Bearer not-a-token" },
    });
    expect(garbage.statusCode).toBe(401);
    await app.close();
  });

  it("GET /session works with the cookie alone (no bearer header)", async () => {
    const { app, token } = await signupAndLogin();
    const res = await app.inject({
      method: "GET", url: "/api/v1/session",
      headers: { cookie: `lawleit_session=${token}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("logout → 204, clears the cookie, and kills the session server-side", async () => {
    const { app, token } = await signupAndLogin();

    const out = await app.inject({
      method: "POST", url: "/api/v1/auth/logout",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(out.statusCode).toBe(204);
    const [cookie] = cookiesOf(out.headers);
    expect(cookie).toContain("Max-Age=0");

    const after = await app.inject({
      method: "GET", url: "/api/v1/session",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);

    const anon = await app.inject({ method: "POST", url: "/api/v1/auth/logout" });
    expect(anon.statusCode).toBe(401);
    await app.close();
  });

  it("password reset: silent-success request, 400 on bad token, 204 on consume", async () => {
    const { app, mailer } = await signupAndLogin();
    const sendsBefore = mailer.sends.length;

    const unknown = await app.inject({
      method: "POST", url: "/api/v1/auth/password-reset",
      payload: { email: "nobody@example.com" },
    });
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json()).toEqual({ ok: true });
    expect(mailer.sends.length).toBe(sendsBefore); // no mail for unknown emails

    const bad = await app.inject({
      method: "POST", url: "/api/v1/auth/password-reset/consume",
      payload: { token: "bogus", password: "long-enough" },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("Invalid or expired reset token");

    await app.inject({ method: "POST", url: "/api/v1/auth/password-reset", payload: { email: signupBody.email } });
    expect(mailer.sends.length).toBe(sendsBefore + 1);
    const consume = await app.inject({
      method: "POST", url: "/api/v1/auth/password-reset/consume",
      payload: { token: mailer.sends[mailer.sends.length - 1]!.token, password: "new-password-9" },
    });
    expect(consume.statusCode).toBe(204);

    const relogin = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { email: signupBody.email, password: "new-password-9" },
    });
    expect(relogin.statusCode).toBe(200);
    await app.close();
  });

  it("short new password → 400", async () => {
    const { app, mailer } = await signupAndLogin();
    await app.inject({ method: "POST", url: "/api/v1/auth/password-reset", payload: { email: signupBody.email } });
    const res = await app.inject({
      method: "POST", url: "/api/v1/auth/password-reset/consume",
      payload: { token: mailer.sends[mailer.sends.length - 1]!.token, password: "short" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Password must be at least 8 characters");
    await app.close();
  });
});
