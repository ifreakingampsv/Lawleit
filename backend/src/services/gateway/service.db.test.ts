import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, migrationsFolder, requireDb, type DbHandle } from "../../db/client.js";
import { createDrizzleRepositories } from "../auth/drizzle-repository.js";
import { AuthService } from "../auth/service.js";
import { CapturingMailer } from "../auth/testing.js";
import { createHmac } from "node:crypto";
import { ContactsService } from "../contacts/service.js";
import { InvoicesService } from "../invoices/service.js";
import { deriveAesKey, decryptSecret } from "./encryption.js";
import { GatewayAccountService } from "./service.js";
import type { GatewayService, ProviderLink, ProviderLinkInput } from "./provider.js";
import type { GatewayCredentials } from "./service.js";
import { PaymentLinkService } from "./links.js";
import { PaymentsService } from "../payments/service.js";
import { GatewayWebhookService, WEBHOOK_FIRM_UNKNOWN } from "./webhooks.js";

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
      "truncate table case_number_counters, cases, contacts, documents, email_outbox, expenses, events, gateway_accounts, gateway_events, invoice_line_items, invoice_number_counters, invoices, lead_stage_history, leads, notifications, payment_links, payments, tasks, thread_messages, threads, time_entries, password_reset_tokens, sessions, trust_transactions, users, firms cascade",
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
    const rows = (await handle.sql`
      select firm_id, key_secret from gateway_accounts order by firm_id`) as unknown as {
      firm_id: string; key_secret: string;
    }[];
    expect(rows).toHaveLength(2);
    const rowA = rows[0]!;
    const rowB = rows[1]!;
    expect(rowA.key_secret).not.toBe(rowB.key_secret);
    const aesKey = deriveAesKey(KEY);
    expect(decryptSecret(rowA.key_secret, aesKey)).toBe(CONNECT.keySecret);
    expect(decryptSecret(rowB.key_secret, aesKey)).toBe(CONNECT.keySecret);
    expect(a.firm.id).not.toBe(b.firm.id);
  });
});

/**
 * Ticket 03's twin: the payment_links flow against real Postgres — the
 * invoice FK + firm scoping, the bigint paise amount readback, and the
 * provider-seam contract (a fake GatewayService, since the DB twin must not
 * touch the network). The link row the service writes must round-trip the
 * exact outstanding amount and the contract's status vocabulary.
 */
describe.skipIf(!process.env.DATABASE_URL)("payment links against Postgres", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = requireDb();
    await migrate(handle.db, { migrationsFolder });
  });

  afterEach(async () => {
    await handle.sql.unsafe(
      "truncate table case_number_counters, cases, contacts, documents, email_outbox, expenses, events, gateway_accounts, gateway_events, invoice_line_items, invoice_number_counters, invoices, lead_stage_history, leads, notifications, payment_links, payments, tasks, thread_messages, threads, time_entries, password_reset_tokens, sessions, trust_transactions, users, firms cascade",
    );
  });

  afterAll(async () => {
    await closeDb();
  });

  const KEY = "test-encryption-key-with-at-least-32-chars";

  /** The provider fake the seam binds in place of Razorpay. */
  function fakeGateway(): GatewayService & { calls: number } {
    let seq = 0;
    const service = {
      calls: 0,
      async createLink(_credentials: GatewayCredentials, input: ProviderLinkInput): Promise<ProviderLink> {
        service.calls += 1;
        return {
          id: `link_FAKE${String(++seq).padStart(4, "0")}`,
          shortUrl: `https://rzp.io/i/fake${seq}`,
          status: "created",
          amount: input.amount,
        };
      },
      async fetchLink(): Promise<ProviderLink> {
        service.calls += 1;
        return { id: "link_FAKE0001", shortUrl: "https://rzp.io/i/fake1", status: "paid", amount: 250000 };
      },
    };
    return service;
  }

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
    const accounts = new GatewayAccountService(repos, KEY);
    const gateway = fakeGateway();
    return {
      auth: new AuthService(repos, mailer),
      accounts,
      gateway,
      contacts: new ContactsService(repos),
      invoices: new InvoicesService(repos),
      links: new PaymentLinkService(repos, accounts, gateway),
    };
  }

  it("collect → the columns really persisted: firm/invoice FKs, bigint paise outstanding amount, contract status; cross-firm reads 404", async () => {
    const mailer = new CapturingMailer();
    const { auth, accounts, contacts, invoices, links } = build(mailer);
    const { firm } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = firm.id;
    const actor = (await auth.login("owner@firm.example", "password-123")).user;

    await accounts.connect(actor, {
      keyId: "rzp_test_FakeKeyId12345",
      keySecret: "rzp-test-fake-key-secret-plaintext",
      webhookSecret: "whsec-fake-shared-secret",
    });
    const client = await contacts.create(firmId, { name: "Client" });
    const invoice = await invoices.create(firmId, {
      clientId: client.id,
      lines: [{ description: "Work", quantity: 1, rate: 500000, kind: "flat" }],
    });

    const link = await links.create(firmId, invoice.id);
    expect(link).toMatchObject({
      invoiceId: invoice.id,
      provider: "razorpay",
      providerLinkId: "link_FAKE0001",
      shortUrl: "https://rzp.io/i/fake1",
      amount: 500000,
      status: "active",
    });

    const rows = (await handle.sql`
      select firm_id, invoice_id, provider, provider_link_id, short_url, amount,
             status, deleted_at
      from payment_links where id = ${link.id}`) as unknown as {
      firm_id: string; invoice_id: string; provider: string; provider_link_id: string;
      short_url: string; amount: string; status: string; deleted_at: Date | null;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      firm_id: firmId,
      invoice_id: invoice.id,
      provider: "razorpay",
      provider_link_id: "link_FAKE0001",
      short_url: "https://rzp.io/i/fake1",
      amount: "500000", // bigint reads back as a string here; exact paise
      status: "active",
      deleted_at: null,
    });

    // Cross-firm: another firm's invoice is 404 for collect AND for history.
    const other = await firmWithOwner(auth, mailer, "owner@firm-b.example");
    const otherId = other.firm.id;
    const otherInvoice = await invoices.create(otherId, {});
    await expect(links.create(otherId, invoice.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(links.list(otherId, invoice.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(otherInvoice.id).toEqual(expect.any(String));
  });
});

describe.skipIf(!process.env.DATABASE_URL)("webhook ledger against Postgres", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = requireDb();
    await migrate(handle.db, { migrationsFolder });
  });

  afterEach(async () => {
    await handle.sql.unsafe(
      "truncate table case_number_counters, cases, contacts, documents, email_outbox, expenses, events, gateway_accounts, gateway_events, invoice_line_items, invoice_number_counters, invoices, lead_stage_history, leads, notifications, payment_links, payments, tasks, thread_messages, threads, time_entries, password_reset_tokens, sessions, trust_transactions, users, firms cascade",
    );
  });

  afterAll(async () => {
    await closeDb();
  });

  const KEY = "test-encryption-key-with-at-least-32-chars";
  const SECRET = "whsec-db-webhook-shared-plaintext";
  const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("hex");

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
    const accounts = new GatewayAccountService(repos, KEY);
    return {
      repos,
      auth: new AuthService(repos, mailer),
      accounts,
      invoices: new InvoicesService(repos),
      webhooks: new GatewayWebhookService(repos, accounts, new PaymentsService(repos)),
    };
  }

  it("the unique (provider, provider_event_id) index really fires: a duplicate insert dies with 23505 inside the transaction", async () => {
    const mailer = new CapturingMailer();
    const { repos, auth } = build(mailer);
    const { firm } = await firmWithOwner(auth, mailer, "owner@ledger.example");
    await repos.gatewayEvents.create({
      firmId: firm.id, provider: "razorpay", providerEventId: "evt_DB1", eventType: "payment_link.paid",
    });
    let code: unknown;
    try {
      await repos.gatewayEvents.create({
        firmId: firm.id, provider: "razorpay", providerEventId: "evt_DB1", eventType: "payment_link.paid",
      });
    } catch (error) {
      code = (error as { code?: unknown }).code;
    }
    expect(code).toBe("23505");
  });

  it("the webhook records payment + event + link flip atomically on real Postgres; the replay writes nothing", async () => {
    const mailer = new CapturingMailer();
    const { repos, auth, accounts, invoices, webhooks } = build(mailer);
    const { firm } = await firmWithOwner(auth, mailer, "owner@webhook.example");
    const firmId = firm.id;
    const actor = (await auth.login("owner@webhook.example", "password-123")).user;
    await accounts.connect(actor, {
      keyId: "rzp_test_WebhookDb12345", keySecret: "rzp-test-webhook-db-secret", webhookSecret: SECRET,
    });
    const invoice = await invoices.create(firmId, {
      lines: [{ description: "Professional services", quantity: 1, rate: 500000, kind: "flat" }],
    });
    await repos.paymentLinks.create({
      firmId, invoiceId: invoice.id, provider: "razorpay",
      providerLinkId: "link_DBWH1", shortUrl: "https://rzp.io/i/dbwh1", amount: 500000, status: "active",
    });

    const body = JSON.stringify({
      event: "payment_link.paid",
      payload: {
        payment_link: { entity: { id: "link_DBWH1" } },
        payment: { entity: { id: "pay_DBWH1", method: "upi" } },
      },
    });
    const first = await webhooks.handle(firmId, body, sign(body), "evt_DBWH1");
    expect(first).toEqual({ recorded: true, duplicate: false });
    const payments = await repos.payments.listByFirm(firmId);
    expect(payments).toHaveLength(1);
    expect(payments[0]!.method).toBe("upi");
    expect((await repos.paymentLinks.listByInvoice(firmId, invoice.id))[0]!.status).toBe("paid");
    expect((await repos.invoices.findById(firmId, invoice.id))!.status).toBe("paid");

    const replay = await webhooks.handle(firmId, body, sign(body), "evt_DBWH1");
    expect(replay).toEqual({ recorded: false, duplicate: true });
    expect(await repos.payments.listByFirm(firmId)).toHaveLength(1);

    await expect(
      webhooks.handle("00000000-0000-4000-8000-000000000000", body, sign(body)),
    ).rejects.toMatchObject({ statusCode: 404, message: WEBHOOK_FIRM_UNKNOWN });
  });
});
