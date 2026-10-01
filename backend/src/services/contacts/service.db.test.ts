import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, migrationsFolder, requireDb, type DbHandle } from "../../db/client.js";
import { createDrizzleRepositories } from "../auth/drizzle-repository.js";
import { AuthService } from "../auth/service.js";
import { CapturingMailer } from "../auth/testing.js";
import { CONTACT_CASE_ID_MESSAGE, CONTACT_TYPE_MESSAGE, ContactsService } from "./service.js";

/**
 * DB-backed twin of the contacts suite (service.db.test.ts pattern): the same
 * flows as the in-memory route tests, run against real Postgres so the
 * Drizzle binding proves it implements the seam identically — newest-first
 * listing, firm scoping, the soft delete behind 404s, and the uuid[] case_ids
 * column. Runs only when DATABASE_URL is exported and skips silently
 * otherwise; point it at a scratch database (truncates).
 */
describe.skipIf(!process.env.DATABASE_URL)("contacts against Postgres", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = requireDb();
    await migrate(handle.db, { migrationsFolder });
  });

  afterEach(async () => {
    await handle.sql.unsafe(
      // cases/case_number_counters reference contacts/firms (ticket 10);
      // events/tasks reference firms/cases (ticket 11) — cascade would take
      // them anyway; naming them keeps the wipe explicit.
      "truncate table case_number_counters, cases, contacts, documents, email_outbox, expenses, events, invoice_line_items, invoice_number_counters, invoices, lead_stage_history, leads, notifications, payments, tasks, thread_messages, threads, time_entries, password_reset_tokens, sessions, trust_transactions, users, firms cascade",
    );
  });

  afterAll(async () => {
    await closeDb();
  });

  /** A firm whose owner has a working password (signup leaves none). */
  async function firmWithOwner(
    auth: AuthService,
    mailer: CapturingMailer,
    email: string,
  ) {
    const registered = await auth.register({
      firstName: "Owner", lastName: "Of Firm", email,
      firmName: `Firm of ${email}`, zip: "", phone: "",
    });
    await auth.requestPasswordReset(email);
    await auth.consumePasswordReset(mailer.sends[mailer.sends.length - 1]!.token, "password-123");
    const session = await auth.login(email, "password-123");
    return { registered, session };
  }

  function build(mailer: CapturingMailer) {
    const repos = createDrizzleRepositories(handle);
    return {
      auth: new AuthService(repos, mailer),
      contacts: new ContactsService(repos),
    };
  }

  it("create → reference defaults, contract shape, newest-first list end to end on drizzle", async () => {
    const mailer = new CapturingMailer();
    const { auth, contacts } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    const first = await contacts.create(firmId, {
      name: "Harish Chadha", email: "harish.chadha@example.com",
    });
    expect(first).toMatchObject({
      type: "client", name: "Harish Chadha",
      email: "harish.chadha@example.com", phone: "", address: "", caseIds: [],
    });
    expect(first.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first).not.toHaveProperty("firmId");
    expect(first).not.toHaveProperty("notes");

    const second = await contacts.create(firmId, {
      name: "Meridian Logistics Pvt Ltd", type: "company", caseIds: [first.id],
    });
    expect(second.caseIds).toEqual([first.id]);

    const rows = await contacts.list(firmId);
    expect(rows.map((c) => c.id)).toEqual([second.id, first.id]);

    // The uuid[] column really persisted the array.
    const caseRows = await handle.sql`select case_ids from contacts where id = ${second.id}`;
    expect((caseRows[0] as { case_ids: string[] }).case_ids).toEqual([first.id]);
  });

  it("patch moves only sent fields; delete is a soft delete — row stays, reads drop it, email reusable", async () => {
    const mailer = new CapturingMailer();
    const { auth, contacts } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    const created = await contacts.create(firmId, {
      name: "Kavita Menon", email: "kavita.menon@example.com", phone: "+91 99537 78291",
    });
    const patched = await contacts.update(firmId, created.id, {
      phone: "555-1234", notes: "Prefers morning calls.", company: "Menon & Co",
    });
    expect(patched).toMatchObject({
      name: "Kavita Menon", phone: "555-1234",
      notes: "Prefers morning calls.", company: "Menon & Co",
      email: "kavita.menon@example.com",
    });

    await contacts.delete(firmId, created.id);
    await expect(contacts.get(firmId, created.id)).rejects.toMatchObject({
      statusCode: 404, message: "Contact not found",
    });
    expect(await contacts.list(firmId)).toEqual([]);

    // The row itself survives (ADR-0003 audit trail) with deleted_at stamped.
    const rows = await handle.sql`select deleted_at from contacts where id = ${created.id}`;
    expect((rows[0] as { deleted_at: Date | null }).deleted_at).not.toBeNull();

    // No unique-ish fields: the freed email works for a new contact.
    const recreated = await contacts.create(firmId, {
      name: "Kavita Menon", email: "kavita.menon@example.com",
    });
    expect(recreated.id).not.toBe(created.id);
    expect((await contacts.list(firmId)).map((c) => c.id)).toEqual([recreated.id]);
  });

  it("cross-firm get/update/delete are 404 and lists never leak the other firm's contacts", async () => {
    const mailer = new CapturingMailer();
    const { auth, contacts } = build(mailer);
    const a = await firmWithOwner(auth, mailer, "owner@firm-a.example");
    const b = await firmWithOwner(auth, mailer, "owner@firm-b.example");

    const contactA = await contacts.create(a.registered.firm.id, { name: "A's Client" });
    for (const op of [
      () => contacts.get(b.registered.firm.id, contactA.id),
      () => contacts.update(b.registered.firm.id, contactA.id, { name: "Hijacked" }),
      () => contacts.delete(b.registered.firm.id, contactA.id),
    ]) {
      await expect(op()).rejects.toMatchObject({
        statusCode: 404, message: "Contact not found",
      });
    }

    expect((await contacts.list(a.registered.firm.id)).map((c) => c.name)).toEqual(["A's Client"]);
    expect(await contacts.list(b.registered.firm.id)).toEqual([]);
  });

  it("validation is the service's: bad type and non-uuid caseIds are 400 before any insert", async () => {
    const mailer = new CapturingMailer();
    const { auth, contacts } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    await expect(contacts.create(firmId, { name: "Bad Type", type: "vendor" })).rejects.toMatchObject({
      statusCode: 400, message: CONTACT_TYPE_MESSAGE,
    });
    await expect(contacts.create(firmId, { name: "Bad Case", caseIds: ["k1"] })).rejects.toMatchObject({
      statusCode: 400, message: CONTACT_CASE_ID_MESSAGE,
    });
    await expect(contacts.update(firmId, "00000000-0000-4000-8000-000000000000", { type: "vendor" }))
      .rejects.toMatchObject({ statusCode: 400, message: CONTACT_TYPE_MESSAGE });
    expect(await contacts.list(firmId)).toEqual([]);
  });
});
