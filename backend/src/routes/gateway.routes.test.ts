import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb } from "../db/client.js";
import type { AppConfig } from "../config.js";
import type { FastifyInstance } from "fastify";
import {
  GATEWAY_ENCRYPTION_REQUIRED,
  GATEWAY_FIELD_MESSAGE,
  GATEWAY_FORBIDDEN,
  GATEWAY_PROVIDER_MESSAGE,
} from "../services/gateway/service.js";
import { CapturingMailer, inMemoryAuthRepositories } from "../services/auth/testing.js";
import type { AuthRepositories } from "../services/auth/repository.js";

/**
 * Gateway account routes (ticket 02) — in-memory repos, payments.routes.test.ts
 * shape. Behavior matrix, docs/API_CONTRACT.md as north star:
 *
 *   GET    /gateway/account   status shape only — { connected, provider, keyId,
 *                             enabled, connectedAt }; NEVER a secret field
 *   PUT    /gateway/account   owner-only connect/replace (upsert); 503 without
 *                             GATEWAY_ENCRYPTION_KEY (the operator step)
 *   DELETE /gateway/account   owner-only disconnect → 204; soft delete
 *
 * The encryption key is a test-seam value (the config owns the real one) — the
 * service never learns where it came from.
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

const noKeyConfig: AppConfig = { ...testConfig, gatewayEncryptionKey: null };

interface FirmContext {
  token: string;
  userId: string;
  firmId: string;
  email: string;
}

interface MemberContext {
  token: string;
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
  return { token: (login.json() as { token: string }).token, email };
}

const CONNECT_BODY = {
  keyId: "rzp_test_AbCdEfGh123456",
  keySecret: "rzp-test-secret-never-returned",
  webhookSecret: "whsec-test-shared-secret",
};

describe("gateway accounts (ticket 02)", () => {
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
  async function setup(config: AppConfig = testConfig): Promise<void> {
    mailer = new CapturingMailer();
    repos = inMemoryAuthRepositories();
    app = await buildApp(config, { repositories: repos, mailer });
    firmA = await signupFirm(app, mailer, "owner@firm-a.example", "Aditi");
    firmB = await signupFirm(app, mailer, "owner@firm-b.example", "Bharat");
  }

  it("owner connects → status shape with no secret fields, ever; the stored row carries only ciphertext", async () => {
    await setup();
    const put = await app.inject({
      method: "PUT", url: "/api/v1/gateway/account",
      headers: bearer(firmA.token), payload: CONNECT_BODY,
    });
    expect(put.statusCode).toBe(200);
    expect(put.body).not.toContain("rzp-test-secret-never-returned");
    expect(put.body).not.toContain("whsec-test-shared-secret");
    const status = put.json() as Record<string, unknown>;
    expect(status).toEqual({
      connected: true,
      provider: "razorpay",
      keyId: "rzp_test_AbCdEfGh123456",
      enabled: true,
      connectedAt: expect.any(String),
    });

    // GET agrees with the PUT body — and still carries no secret material.
    const get = await app.inject({
      method: "GET", url: "/api/v1/gateway/account", headers: bearer(firmA.token),
    });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual(status);
    expect(get.body).not.toContain("rzp-test-secret-never-returned");
    expect(get.body).not.toContain("whsec-test-shared-secret");

    // At rest the repository holds AES-256-GCM ciphertext, not the plaintexts.
    const row = await repos.gatewayAccounts.findByFirm(firmA.firmId);
    expect(row).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain("rzp-test-secret-never-returned");
    expect(JSON.stringify(row)).not.toContain("whsec-test-shared-secret");
    await app.close();
  });

  it("status before connecting reads the not-connected shape; firms are isolated", async () => {
    await setup();
    const get = await app.inject({
      method: "GET", url: "/api/v1/gateway/account", headers: bearer(firmB.token),
    });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual({
      connected: false, provider: null, keyId: null, enabled: false, connectedAt: null,
    });

    // A's connection does not leak into B's status (cross-firm isolation).
    await app.inject({
      method: "PUT", url: "/api/v1/gateway/account",
      headers: bearer(firmA.token), payload: CONNECT_BODY,
    });
    const again = await app.inject({
      method: "GET", url: "/api/v1/gateway/account", headers: bearer(firmB.token),
    });
    expect((again.json() as { connected: boolean }).connected).toBe(false);
    await app.close();
  });

  it("replace (rotate keys) updates the same one-per-firm account; provider vocabulary is enforced", async () => {
    await setup();
    await app.inject({
      method: "PUT", url: "/api/v1/gateway/account",
      headers: bearer(firmA.token), payload: CONNECT_BODY,
    });
    const rotated = await app.inject({
      method: "PUT", url: "/api/v1/gateway/account",
      headers: bearer(firmA.token),
      payload: { ...CONNECT_BODY, keyId: "rzp_test_Rotated999999", keySecret: "rzp-test-rotated-secret" },
    });
    expect(rotated.statusCode).toBe(200);
    expect((rotated.json() as { keyId: string }).keyId).toBe("rzp_test_Rotated999999");

    // Still exactly one live row for the firm (the upsert, not a second row).
    const status = await app.inject({
      method: "GET", url: "/api/v1/gateway/account", headers: bearer(firmA.token),
    });
    expect((status.json() as { keyId: string }).keyId).toBe("rzp_test_Rotated999999");

    // An unknown provider is a 400 (the contract's one-word vocabulary).
    for (const [payload, message] of [
      [{ ...CONNECT_BODY, provider: "stripe" }, GATEWAY_PROVIDER_MESSAGE],
      [{ ...CONNECT_BODY, keyId: " " }, GATEWAY_FIELD_MESSAGE],
      [{ ...CONNECT_BODY, keySecret: "" }, GATEWAY_FIELD_MESSAGE],
      [{ ...CONNECT_BODY, webhookSecret: undefined }, GATEWAY_FIELD_MESSAGE],
    ] as [Record<string, unknown>, string][]) {
      const res = await app.inject({
        method: "PUT", url: "/api/v1/gateway/account",
        headers: bearer(firmA.token), payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: message });
    }
    await app.close();
  });

  it("disconnect is owner-only, 204, and the status flips to not-connected; reconnect works after", async () => {
    await setup();
    await app.inject({
      method: "PUT", url: "/api/v1/gateway/account",
      headers: bearer(firmA.token), payload: CONNECT_BODY,
    });
    const del = await app.inject({
      method: "DELETE", url: "/api/v1/gateway/account", headers: bearer(firmA.token),
    });
    expect(del.statusCode).toBe(204);
    const status = await app.inject({
      method: "GET", url: "/api/v1/gateway/account", headers: bearer(firmA.token),
    });
    expect((status.json() as { connected: boolean }).connected).toBe(false);

    // The soft-deleted row stays (the audit) but a fresh connect succeeds —
    // the partial unique index only covers live rows.
    const reconnect = await app.inject({
      method: "PUT", url: "/api/v1/gateway/account",
      headers: bearer(firmA.token), payload: CONNECT_BODY,
    });
    expect(reconnect.statusCode).toBe(200);
    expect((reconnect.json() as { connected: boolean }).connected).toBe(true);
    await app.close();
  });

  it("non-owners are 403 on connect and disconnect (the invite-form rule); status stays readable", async () => {
    await setup();
    const member = await inviteAndOnboard(
      app, firmA, mailer, "Sahil Bose", "sahil@firm-a.example", "paralegal",
    );
    for (const [method, payload] of [
      ["PUT", CONNECT_BODY],
      ["DELETE", undefined],
    ] as ["PUT" | "DELETE", typeof CONNECT_BODY | undefined][]) {
      const res = await app.inject({
        method, url: "/api/v1/gateway/account", headers: bearer(member.token),
        ...(payload ? { payload } : {}),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: GATEWAY_FORBIDDEN });
    }
    const status = await app.inject({
      method: "GET", url: "/api/v1/gateway/account", headers: bearer(member.token),
    });
    expect(status.statusCode).toBe(200);
    await app.close();
  });

  it("503 without GATEWAY_ENCRYPTION_KEY on the writes; boot succeeds and the status read keeps working", async () => {
    await setup(noKeyConfig);
    for (const [method, payload] of [
      ["PUT", CONNECT_BODY],
      ["DELETE", undefined],
    ] as ["PUT" | "DELETE", typeof CONNECT_BODY | undefined][]) {
      const res = await app.inject({
        method, url: "/api/v1/gateway/account", headers: bearer(firmA.token),
        ...(payload ? { payload } : {}),
      });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: GATEWAY_ENCRYPTION_REQUIRED });
    }
    const status = await app.inject({
      method: "GET", url: "/api/v1/gateway/account", headers: bearer(firmA.token),
    });
    expect(status.statusCode).toBe(200);
    expect((status.json() as { connected: boolean }).connected).toBe(false);
    await app.close();
  });

  it("the surface needs a session: anonymous reads and writes are 401", async () => {
    await setup();
    for (const [method, payload] of [
      ["GET", undefined],
      ["PUT", CONNECT_BODY],
      ["DELETE", undefined],
    ] as ["GET" | "PUT" | "DELETE", typeof CONNECT_BODY | undefined][]) {
      const res = await app.inject({
        method, url: "/api/v1/gateway/account",
        ...(payload ? { payload } : {}),
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Not signed in" });
    }
    await app.close();
  });
});
