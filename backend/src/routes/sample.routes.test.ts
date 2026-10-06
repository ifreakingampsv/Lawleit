import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb } from "../db/client.js";
import type { AppConfig } from "../config.js";
import type { FastifyInstance } from "fastify";
import { CapturingMailer, inMemoryAuthRepositories } from "../services/auth/testing.js";
import type { AuthRepositories } from "../services/auth/repository.js";
import { SAMPLE_NOTHING_TO_REMOVE } from "../services/sample/service.js";

/**
 * The sample workspace (ticket 09) — signup seeds a labeled sample set, the
 * firm shape carries hasSampleData, removal soft-deletes everything and
 * appends the trust REVERSAL (the ledger stays append-only, the balance
 * returns to ₹0), the flag is server-managed (PATCH /firm cannot touch it),
 * and a removed firm is never re-seeded (double remove 409).
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

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("the sample workspace (ticket 09)", () => {
  let app: FastifyInstance;
  let mailer: CapturingMailer;
  let repos: AuthRepositories;

  afterEach(async () => {
    await closeDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  /** Signs one firm up through the real route; returns session + firm shape. */
  async function signup(): Promise<{ token: string; firmId: string; firm: Record<string, unknown> }> {
    const signup = await app.inject({
      method: "POST", url: "/api/v1/auth/signup",
      payload: {
        firstName: "Owner", lastName: "Of Firm", email: `owner-${Date.now()}-${Math.random()}@firm.example`,
        firmName: "Firm of Samples", zip: "110001", employees: 3, phone: "",
      },
    });
    expect(signup.statusCode).toBe(201);
    const body = signup.json() as {
      token: string; firm: { id: string } & Record<string, unknown>;
    };
    return { token: body.token, firmId: body.firm.id, firm: body.firm };
  }

  it("signup seeds the labeled sample workspace and the firm reports hasSampleData", async () => {
    mailer = new CapturingMailer();
    repos = inMemoryAuthRepositories();
    app = await buildApp(testConfig, { repositories: repos, mailer });
    const { token, firm } = await signup();

    // The 201's firm shape already carries the post-seed flag.
    expect(firm.hasSampleData).toBe(true);

    // Every seeded entity is labeled "Sample".
    const contacts = (await app.inject({
      method: "GET", url: "/api/v1/contacts", headers: bearer(token),
    })).json() as { id: string; name: string; type: string }[];
    expect(contacts).toHaveLength(3);
    expect(contacts.every((c) => c.name.includes("Sample"))).toBe(true);

    const cases = (await app.inject({
      method: "GET", url: "/api/v1/cases", headers: bearer(token),
    })).json() as { id: string; title: string; clientId: string }[];
    expect(cases).toHaveLength(1);
    expect(cases[0]!.title).toContain("Sample");

    const invoices = (await app.inject({
      method: "GET", url: "/api/v1/invoices", headers: bearer(token),
    })).json() as { notes: string }[];
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.notes).toContain("Sample");

    // The trust deposit rode the manual record path: one ledger entry with
    // its running balance.
    const trust = (await app.inject({
      method: "GET", url: "/api/v1/trust/transactions", headers: bearer(token),
    })).json() as { clientId: string; amount: number; balanceAfter: number }[];
    expect(trust).toHaveLength(1);
    expect(trust[0]!.amount).toBe(5000000);
    expect(trust[0]!.balanceAfter).toBe(5000000);

    // Idempotent: re-seeding the same firm is a no-op (the flag is set).
    const before = (await app.inject({
      method: "GET", url: "/api/v1/contacts", headers: bearer(token),
    })).json() as unknown[];
    expect(before).toHaveLength(3);
  });

  it("remove clears the sample rows, appends the trust reversal, flips the flag; double remove 409; PATCH cannot write the flag", async () => {
    mailer = new CapturingMailer();
    repos = inMemoryAuthRepositories();
    app = await buildApp(testConfig, { repositories: repos, mailer });
    const { token, firmId, firm } = await signup();

    // PATCH /firm cannot touch the server-managed flag (zod strips it) —
    // the shape stays hasSampleData: true after a patch that tries.
    const patched = await app.inject({
      method: "PATCH", url: "/api/v1/firm", headers: bearer(token),
      payload: { name: "Renamed Firm", sampleData: { removed: true } },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { hasSampleData: boolean }).hasSampleData).toBe(true);

    const remove = await app.inject({
      method: "POST", url: "/api/v1/firm/sample-data/remove", headers: bearer(token),
    });
    expect(remove.statusCode).toBe(200);
    expect(remove.json()).toMatchObject({
      removed: true, contacts: 3, case: 1, event: 1, task: 1,
      timeEntry: 1, invoice: 1, payment: 1, trustReversal: 1,
    });

    // The lists are empty of sample rows; the ledger keeps BOTH entries and
    // the client balance lands back on ₹0.
    const contacts = (await app.inject({
      method: "GET", url: "/api/v1/contacts", headers: bearer(token),
    })).json() as unknown[];
    expect(contacts).toHaveLength(0);
    const cases = (await app.inject({
      method: "GET", url: "/api/v1/cases", headers: bearer(token),
    })).json() as unknown[];
    expect(cases).toHaveLength(0);
    const trust = (await app.inject({
      method: "GET", url: "/api/v1/trust/transactions", headers: bearer(token),
    })).json() as { amount: number; balanceAfter: number }[];
    expect(trust).toHaveLength(2);
    expect(trust[1]!.amount).toBe(-5000000);
    expect(trust[1]!.balanceAfter).toBe(0);

    // The session's firm no longer reports the flag.
    const session = await app.inject({
      method: "GET", url: "/api/v1/session", headers: bearer(token),
    });
    expect((session.json() as { firm: { hasSampleData: boolean } }).firm.hasSampleData).toBe(false);
    void firmId;
    void firm;

    const again = await app.inject({
      method: "POST", url: "/api/v1/firm/sample-data/remove", headers: bearer(token),
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: SAMPLE_NOTHING_TO_REMOVE });
  });

  it("an anonymous remove is 401 like every guarded route", async () => {
    mailer = new CapturingMailer();
    repos = inMemoryAuthRepositories();
    app = await buildApp(testConfig, { repositories: repos, mailer });
    const res = await app.inject({
      method: "POST", url: "/api/v1/firm/sample-data/remove",
    });
    expect(res.statusCode).toBe(401);
  });
});
