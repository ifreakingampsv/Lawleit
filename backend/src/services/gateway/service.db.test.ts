import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, migrationsFolder, requireDb, type DbHandle } from "../../db/client.js";
import { createDrizzleRepositories } from "../auth/drizzle-repository.js";
import { AuthService } from "../auth/service.js";
import { CapturingMailer } from "../auth/testing.js";
import { deriveAesKey, decryptSecret } from "./encryption.js";
import { GatewayAccountService } from "./service.js";

/**
 * DB-backed twin of the gateway account suite (service.db.test.ts pattern):
 * the connect/replace/disconnect flows run against real Postgres so the
 * Drizzle binding proves the seam's invariants on the real table — the
 * partial unique index (one live account per firm; a disconnect frees the
 * slot for a fresh connect), the soft-delete stamps, and the
 * encrypted-at-rest round trip (the stored columns are ciphertext; the
 * service's credentials() decrypts them back exactly). Runs only when
 * DATABASE_URL is exported and skips silently otherwise; point it at a
 * scratch database (truncates).
 */
describe.skipIf(!process.env.DATABASE_URL)("gateway accounts against Postgres", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = requireDb();
    await migrate(handle.db, { migrationsFolder });
  });

  afterEach(async () => {
    await handle.sql.unsafe(
      "truncate table case_number_counters, cases, contacts, documents, email_outbox, expenses, events, gateway_accounts, invoice_line_items, invoice_number_counters, invoices, lead_stage_history, leads, notifications, payments, tasks, thread_messages, threads, time_entries, password_reset_tokens, sessions, trust_transactions, users, firms cascade",
    );
  });

  afterAll(async () => {
    await closeDb();
  });

  const KEY = "test-encryption-key-with-at-least-32-chars";

  /** A firm whose owner has a working password (signup leaves none). */
  async function firmWithOwner(auth: AuthService, mailer: CapturingMailer, email: string) {
    const registered = await auth.register({
      firstName: "Owner", lastName: "Of Firm", email,
      firmName: `Firm of ${email}`, zip: "", phone: "",
    });
    await auth.requestPasswordReset(email);
    await auth.consumePasswordReset(mailer.sends[mailer.sends.length - 1]!.token, "password-123");
    return registered;
  }

  function build(mailer: CapturingMailer) {
    const repos = createDrizzleRepositories(handle);
    return {
      auth: new AuthService(repos, mailer),
      gateway: new GatewayAccountService(repos, KEY),
    };
  }

  const CONNECT = {
    keyId: "rzp_test_DbTwin12345678",
    keySecret: "rzp-test-db-twin-secret-plaintext",
    webhookSecret: "whsec-db-twin-shared-plaintext",
  };

  it("connect → the columns really persisted: ciphertext at rest, credentials() decrypts back exactly", async () => {
    const mailer = new CapturingMailer();
    const { auth, gateway } = build(mailer);
    const { firm } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = firm.id;

    // Login returns the actor shape the routes pass in (ApiUser).
    const actor = (await auth.login("owner@firm.example", "password-123")).user;

    const status = await gateway.connect(actor, CONNECT);
    expect(status).toMatchObject({
      connected: true, provider: "razorpay", keyId: CONNECT.keyId, enabled: true,
    });
    expect(status.connectedAt).toEqual(expect.any(String));

    // At rest: the columns are AES-256-GCM ciphertext, never the plaintexts.
    const rows = await handle.sql`
      select key_id, key_secret, webhook_secret, enabled, provider, deleted_at
      from gateway_accounts where firm_id = ${firmId}`;
    const row = rows[0] as {
      key_id: string; key_secret: string; webhook_secret: string;
      enabled: boolean; provider: string; deleted_at: Date | null;
    };
    expect(row.key_id).toBe(CONNECT.keyId); // the key id is not a secret
    expect(row.key_secret).not.toBe(CONNECT.keySecret);
    expect(row.webhook_secret).not.toBe(CONNECT.webhookSecret);
    expect(row.enabled).toBe(true);
    expect(row.provider).toBe("razorpay");
    expect(row.deleted_at).toBeNull();

    // The exact round trip: the service's decryption of the stored ciphertext
    // hands back the plaintexts for the outgoing gateway calls (in memory only).
    const creds = await gateway.credentials(firmId);
    expect(creds).toEqual({
      provider: "razorpay",
      keyId: CONNECT.keyId,
      keySecret: CONNECT.keySecret,
      webhookSecret: CONNECT.webhookSecret,
    });

    // Independent proof: decrypt the stored payload with the derived key.
    const aesKey = deriveAesKey(KEY);
    expect(decryptSecret(row.key_secret, aesKey)).toBe(CONNECT.keySecret);
    expect(decryptSecret(row.webhook_secret, aesKey)).toBe(CONNECT.webhookSecret);

    // Status reads agree and never carry secret material.
    const read = await gateway.status(firmId);
    expect(JSON.stringify(read)).not.toContain(CONNECT.keySecret);
    expect(JSON.stringify(read)).not.toContain(CONNECT.webhookSecret);
  });

  it("one live account per firm (partial unique index): replace updates, disconnect frees, reconnect re-creates", async () => {
    const mailer = new CapturingMailer();
    const { auth, gateway } = build(mailer);
    const { firm } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = firm.id;
    const actor = (await auth.login("owner@firm.example", "password-123")).user;

    await gateway.connect(actor, CONNECT);
    const rotated = await gateway.connect(actor, { ...CONNECT, keyId: "rzp_test_Rotated" });
    expect(rotated.keyId).toBe("rzp_test_Rotated");
    const live = await handle.sql`
      select count(*)::int as n from gateway_accounts
      where firm_id = ${firmId} and deleted_at is null`;
    expect((live[0] as { n: number }).n).toBe(1);

    await gateway.disconnect(actor);
    const afterDelete = await handle.sql`
      select deleted_at from gateway_accounts where firm_id = ${firmId}`;
    // Soft delete: the audit row stays with deleted_at stamped (2 rows total
    // — the replace did not resurrect a second live row).
    expect(afterDelete).toHaveLength(2);
    expect((afterDelete[0] as { deleted_at: Date | null }).deleted_at).not.toBeNull();

    await gateway.connect(actor, CONNECT);
    const reconnected = await gateway.status(firmId);
    expect(reconnected.connected).toBe(true);
  });

  it("encryption round trip through the DB binding: equal plaintexts encrypt differently, both decrypt right", async () => {
    const mailer = new CapturingMailer();
    const { auth, gateway } = build(mailer);
    const a = await firmWithOwner(auth, mailer, "owner@firm-a.example");
    const b = await firmWithOwner(auth, mailer, "owner@firm-b.example");
    const actorA = (await auth.login("owner@firm-a.example", "password-123")).user;
    const actorB = (await auth.login("owner@firm-b.example", "password-123")).user;

    // Two firms, identical plaintext secrets: the stored ciphertexts differ
    // (random IV) and each decrypts to the same plaintext.
    await gateway.connect(actorA, CONNECT);
    await gateway.connect(actorB, CONNECT);
    const rows = await handle.sql`
      select firm_id, key_secret from gateway_accounts order by firm_id`;
    expect(rows).toHaveLength(2);
    const [rowA, rowB] = rows as { firm_id: string; key_secret: string }[];
    expect(rowA.key_secret).not.toBe(rowB.key_secret);
    const aesKey = deriveAesKey(KEY);
    expect(decryptSecret(rowA.key_secret, aesKey)).toBe(CONNECT.keySecret);
    expect(decryptSecret(rowB.key_secret, aesKey)).toBe(CONNECT.keySecret);
    expect(a.firm.id).not.toBe(b.firm.id);
  });
});
