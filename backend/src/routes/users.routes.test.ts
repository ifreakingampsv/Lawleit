import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb } from "../db/client.js";
import type { AppConfig } from "../config.js";
import type { FastifyInstance } from "fastify";
import { CapturingMailer, inMemoryAuthRepositories } from "../services/auth/testing.js";

/**
 * User management routes (ticket 08) — in-memory repos, isolation.test.ts
 * shape. Permission matrix enforced here:
 *
 *   POST /users        owner → 201, member → 403, anonymous → 401
 *   GET  /users        owner and member → 200 (the contract's session payload
 *                      already exposes `users` to every signed-in member),
 *                      anonymous → 401
 *   PATCH /users/:id   owner → 200/409, member → 403 (checked before
 *                      existence, so probing leaks nothing), anonymous → 401
 *   cross-firm ids     404 for owners of other firms, never a leak
 *
 * A deactivated user's session dies at the guard (401), which is what keeps
 * them from managing anyone.
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

describe("user management (ticket 08)", () => {
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

  it("owner invites a user: 201 contract shape, appears in the firm's list, invite handed to the mailer", async () => {
    await setup();
    const res = await app.inject({
      method: "POST", url: "/api/v1/users",
      headers: bearer(firmA.token),
      payload: { name: "Meera Iyer", email: "Meera@Firm-A.example", role: "attorney" },
    });
    expect(res.statusCode).toBe(201);
    const user = res.json() as Record<string, unknown>;
    expect(user).toMatchObject({
      firmId: firmA.firmId,
      name: "Meera Iyer",
      email: "meera@firm-a.example",
      role: "attorney",
      active: true,
    });
    expect(user).not.toHaveProperty("passwordHash");

    // The invite rides the password-reset machinery: single-use token to the
    // mailer, none of it in the response.
    expect(mailer.invites).toHaveLength(1);
    expect(mailer.invites[0]!.to).toBe("meera@firm-a.example");
    expect(mailer.invites[0]!.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mailer.invites[0]!.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(user)).not.toContain(mailer.invites[0]!.token);

    const list = await app.inject({ method: "GET", url: "/api/v1/users", headers: bearer(firmA.token) });
    expect(list.statusCode).toBe(200);
    const users = list.json() as { email: string; active: boolean }[];
    expect(users.map((u) => u.email)).toEqual(["owner@firm-a.example", "meera@firm-a.example"]);
    await app.close();
  });

  it("an invited user cannot log in until the invite link sets a password", async () => {
    await setup();
    await app.inject({
      method: "POST", url: "/api/v1/users",
      headers: bearer(firmA.token),
      payload: { name: "Meera Iyer", email: "meera@firm-a.example", role: "attorney" },
    });
    const early = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { email: "meera@firm-a.example", password: "guess" },
    });
    // One identical 401 for wrong password and never-onboarded — no
    // enumeration oracle (deviation from the task's suggested wording; the
    // reference is demo-mode and cannot arbitrate).
    expect(early.statusCode).toBe(401);
    expect(early.json()).toEqual({ error: "Invalid email or password" });

    const onboarded = await inviteAndOnboard(
      app, firmA, mailer, "Meera Iyer", "meera2@firm-a.example", "paralegal",
    );
    const session = await app.inject({
      method: "GET", url: "/api/v1/session", headers: bearer(onboarded.token),
    });
    expect(session.statusCode).toBe(200);
    expect((session.json() as { users: unknown[] }).users).toHaveLength(3);
    await app.close();
  });

  it("invite validation: missing name, bad email, and unknown role are 400 contract messages", async () => {
    await setup();
    for (const payload of [
      { email: "x@firm-a.example", role: "attorney" },
      { name: "No Email", email: "not-an-email", role: "attorney" },
      { name: "Bad Role", email: "bad@firm-a.example", role: "admin" },
    ]) {
      const res = await app.inject({
        method: "POST", url: "/api/v1/users", headers: bearer(firmA.token), payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/required|valid email|Role must be/);
    }
    expect(mailer.invites).toHaveLength(0);
    await app.close();
  });

  it("duplicate email is 409 'Email already registered' — within the firm and across firms, naming no firm", async () => {
    await setup();
    const within = await app.inject({
      method: "POST", url: "/api/v1/users",
      headers: bearer(firmA.token),
      payload: { name: "Dup", email: "owner@firm-a.example", role: "staff" },
    });
    expect(within.statusCode).toBe(409);
    expect(within.json()).toEqual({ error: "Email already registered" });

    const cross = await app.inject({
      method: "POST", url: "/api/v1/users",
      headers: bearer(firmA.token),
      payload: { name: "Dup", email: "owner@firm-b.example", role: "staff" },
    });
    expect(cross.statusCode).toBe(409);
    expect(cross.json()).toEqual({ error: "Email already registered" });
    await app.close();
  });

  it("members cannot manage users: 403 before existence (even for unknown or foreign ids), but can read the list", async () => {
    await setup();
    const member = await inviteAndOnboard(
      app, firmA, mailer, "Meera Iyer", "meera@firm-a.example", "attorney",
    );

    const inviteAttempt = await app.inject({
      method: "POST", url: "/api/v1/users",
      headers: bearer(member.token),
      payload: { name: "Sneaky", email: "sneaky@firm-a.example", role: "owner" },
    });
    expect(inviteAttempt.statusCode).toBe(403);
    expect(inviteAttempt.json()).toEqual({ error: "Only the firm owner can manage users" });

    for (const target of [firmA.userId, "00000000-0000-4000-8000-000000000000", firmB.userId]) {
      const patchAttempt = await app.inject({
        method: "PATCH", url: `/api/v1/users/${target}`,
        headers: bearer(member.token),
        payload: { name: "Self-Promoted", role: "owner" },
      });
      expect(patchAttempt.statusCode).toBe(403);
      expect(patchAttempt.json()).toEqual({ error: "Only the firm owner can manage users" });
    }

    const list = await app.inject({ method: "GET", url: "/api/v1/users", headers: bearer(member.token) });
    expect(list.statusCode).toBe(200);
    expect((list.json() as unknown[]).length).toBe(2);
    await app.close();
  });

  it("cross-firm isolation: firm B's owner cannot see or patch firm A's users; invites land in B", async () => {
    await setup();
    const member = await inviteAndOnboard(
      app, firmA, mailer, "Meera Iyer", "meera@firm-a.example", "attorney",
    );

    const patchAttempt = await app.inject({
      method: "PATCH", url: `/api/v1/users/${member.userId}`,
      headers: bearer(firmB.token),
      payload: { name: "Hijacked", active: false },
    });
    expect(patchAttempt.statusCode).toBe(404);
    expect(patchAttempt.json()).toEqual({ error: "User not found" });

    const listB = await app.inject({ method: "GET", url: "/api/v1/users", headers: bearer(firmB.token) });
    const usersB = listB.json() as { email: string }[];
    expect(usersB.map((u) => u.email)).toEqual(["owner@firm-b.example"]);

    // Email uniqueness is global, so B's invite needs a fresh address — and
    // lands in B's firm, never A's.
    const invitedToB = await app.inject({
      method: "POST", url: "/api/v1/users",
      headers: bearer(firmB.token),
      payload: { name: "B Member", email: "member@firm-b.example", role: "staff" },
    });
    expect(invitedToB.statusCode).toBe(201);
    expect((invitedToB.json() as { firmId: string }).firmId).toBe(firmB.firmId);

    // A's member was untouched by all of it.
    const session = await app.inject({ method: "GET", url: "/api/v1/session", headers: bearer(member.token) });
    expect(session.statusCode).toBe(200);
    await app.close();
  });

  it("owner patches role and name; deactivation revokes sessions, blocks login, and keeps the record listed", async () => {
    await setup();
    const member = await inviteAndOnboard(
      app, firmA, mailer, "Meera Iyer", "meera@firm-a.example", "attorney",
    );

    const promoted = await app.inject({
      method: "PATCH", url: `/api/v1/users/${member.userId}`,
      headers: bearer(firmA.token),
      payload: { name: "Meera Iyer Rao", role: "paralegal", hourlyRate: 150000 },
    });
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json()).toMatchObject({ role: "paralegal", name: "Meera Iyer Rao", hourlyRate: 150000 });

    const deactivate = await app.inject({
      method: "PATCH", url: `/api/v1/users/${member.userId}`,
      headers: bearer(firmA.token),
      payload: { active: false },
    });
    expect(deactivate.statusCode).toBe(200);
    expect((deactivate.json() as { active: boolean }).active).toBe(false);

    // Sessions revoked immediately; login blocked with the ticket-07 message.
    const stale = await app.inject({ method: "GET", url: "/api/v1/session", headers: bearer(member.token) });
    expect(stale.statusCode).toBe(401);
    expect(stale.json()).toEqual({ error: "Not signed in" });
    const relaunch = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { email: member.email, password: "member-pass-123" },
    });
    expect(relaunch.statusCode).toBe(403);
    expect(relaunch.json()).toEqual({ error: "Account is deactivated" });

    // A deactivated user cannot manage anyone — the dead session answers 401.
    const fromTheDead = await app.inject({
      method: "POST", url: "/api/v1/users",
      headers: bearer(member.token),
      payload: { name: "Ghost", email: "ghost@firm-a.example", role: "staff" },
    });
    expect(fromTheDead.statusCode).toBe(401);

    // Audit trail preserved: still listed, still attributed.
    const list = await app.inject({ method: "GET", url: "/api/v1/users", headers: bearer(firmA.token) });
    const users = list.json() as { email: string; active: boolean; name: string }[];
    const record = users.find((u) => u.email === member.email)!;
    expect(record.active).toBe(false);
    expect(record.name).toBe("Meera Iyer Rao");
    await app.close();
  });

  it("the last active owner cannot be deactivated or demoted (self-deactivation included)", async () => {
    await setup();
    for (const patch of [{ active: false }, { role: "attorney" }]) {
      const res = await app.inject({
        method: "PATCH", url: `/api/v1/users/${firmA.userId}`,
        headers: bearer(firmA.token),
        payload: patch,
      });
      expect(res.statusCode, JSON.stringify(patch)).toBe(409);
      expect(res.json()).toEqual({ error: "A firm must keep at least one active owner" });
    }
    // The firm was never leaderless: the owner's session still works.
    const session = await app.inject({ method: "GET", url: "/api/v1/session", headers: bearer(firmA.token) });
    expect(session.statusCode).toBe(200);
    await app.close();
  });

  it("an owner with a co-owner may step down: inviting an owner works, deactivating self succeeds", async () => {
    await setup();
    const coOwner = await inviteAndOnboard(
      app, firmA, mailer, "Arjun Rao", "co-owner@firm-a.example", "owner",
    );

    const stepDown = await app.inject({
      method: "PATCH", url: `/api/v1/users/${firmA.userId}`,
      headers: bearer(firmA.token),
      payload: { active: false },
    });
    expect(stepDown.statusCode).toBe(200);
    expect((stepDown.json() as { active: boolean }).active).toBe(false);

    const stale = await app.inject({ method: "GET", url: "/api/v1/session", headers: bearer(firmA.token) });
    expect(stale.statusCode).toBe(401);
    const remaining = await app.inject({ method: "GET", url: "/api/v1/users", headers: bearer(coOwner.token) });
    expect(remaining.statusCode).toBe(200);
    const users = remaining.json() as { email: string; active: boolean; role: string }[];
    expect(users.find((u) => u.email === coOwner.email)).toMatchObject({ role: "owner", active: true });
    await app.close();
  });

  it("unknown user id is 404 for the firm's owner; malformed id is 400", async () => {
    await setup();
    const missing = await app.inject({
      method: "PATCH", url: "/api/v1/users/00000000-0000-4000-8000-000000000000",
      headers: bearer(firmA.token),
      payload: { name: "Nobody" },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "User not found" });

    const malformed = await app.inject({
      method: "PATCH", url: "/api/v1/users/not-a-uuid",
      headers: bearer(firmA.token),
      payload: { name: "Nobody" },
    });
    expect(malformed.statusCode).toBe(400);
    await app.close();
  });

  it("without a database the user surface answers the 503 envelope", async () => {
    app = await buildApp(testConfig);
    await app.inject({
      method: "POST", url: "/api/v1/auth/signup",
      payload: { firstName: "A", lastName: "B", email: "a@b.co", firmName: "F", zip: "", phone: "" },
    });
    const res = await app.inject({
      method: "POST", url: "/api/v1/users",
      payload: { name: "X", email: "x@b.co", role: "staff" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/DATABASE_URL/);
    await app.close();
  });
});
