import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, migrationsFolder, requireDb, type DbHandle } from "../../db/client.js";
import { createDrizzleRepositories } from "../auth/drizzle-repository.js";
import { AuthService } from "../auth/service.js";
import { CapturingMailer } from "../auth/testing.js";
import { ContactsService } from "../contacts/service.js";
import { CasesService } from "../cases/service.js";
import {
  LEAD_SOURCE_MESSAGE,
  LEAD_STAGE_MESSAGE,
  LEAD_VALUE_MESSAGE,
  LeadsService,
} from "./service.js";

/**
 * DB-backed twin of the leads suite (service.db.test.ts pattern): the same
 * flows as the in-memory route tests, run against real Postgres so the
 * Drizzle binding proves it implements the seam identically — the jsonb
 * activity log, the bigint paise value column, the conversion transaction
 * (contact + numbered case + converted lead + stage-history row committing
 * together), and the append-only lead_stage_history audit trail. Runs only
 * when DATABASE_URL is exported and skips silently otherwise; point it at a
 * scratch database (truncates).
 */
describe.skipIf(!process.env.DATABASE_URL)("leads against Postgres", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = requireDb();
    await migrate(handle.db, { migrationsFolder });
  });

  afterEach(async () => {
    await handle.sql.unsafe(
      "truncate table case_number_counters, cases, contacts, expenses, events, invoice_line_items, invoice_number_counters, invoices, lead_stage_history, leads, payments, tasks, time_entries, password_reset_tokens, sessions, trust_transactions, users, firms cascade",
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
      cases: new CasesService(repos),
      leads: new LeadsService(repos),
      repos,
    };
  }

  const year = () => new Date().toISOString().slice(0, 4);

  it("create → reference defaults; value (bigint paise), jsonb activity and the server-built log really persist", async () => {
    const mailer = new CapturingMailer();
    const { auth, leads } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    const created = await leads.create(firmId, {
      name: "Kavya Nair", email: "kavya@example.in", phone: "98765 43210",
      source: "referral", practiceArea: "Family Law", value: 500000,
      notes: "Referred by the Mehta retainer.",
    });
    expect(created).toMatchObject({
      name: "Kavya Nair", email: "kavya@example.in", phone: "98765 43210",
      source: "referral", stage: "new", practiceArea: "Family Law", value: 500000,
      createdAt: new Date().toISOString().slice(0, 10),
    });
    expect(created.activity).toEqual([{ at: expect.any(String), text: "Lead created" }]);
    expect(created).not.toHaveProperty("firmId");
    expect(created).not.toHaveProperty("convertedCaseId");

    // The bigint paise column, the jsonb log and the null links really persisted.
    const rows = await handle.sql`
      select value, activity, converted_case_id, converted_contact_id, deleted_at, notes
      from leads where id = ${created.id}`;
    const row = rows[0] as {
      value: string | number; activity: { at: string; text: string }[];
      converted_case_id: string | null; converted_contact_id: string | null;
      deleted_at: Date | null; notes: string | null;
    };
    expect(Number(row.value)).toBe(500000);
    expect(row.activity).toEqual([{ at: expect.any(String), text: "Lead created" }]);
    expect(row.converted_case_id).toBeNull();
    expect(row.converted_contact_id).toBeNull();
    expect(row.deleted_at).toBeNull();
    expect(row.notes).toBe("Referred by the Mehta retainer.");
  });

  it("stage moves append to activity and write lead_stage_history rows; re-sending the stage records nothing", async () => {
    const mailer = new CapturingMailer();
    const { auth, leads, repos } = build(mailer);
    const { registered, session } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    const lead = await leads.create(firmId, { name: "Kavya Nair" });
    const moved = await leads.update(firmId, session.user.id, lead.id, { stage: "contacted" });
    expect(moved.activity.map((e) => e.text)).toEqual(["Moved to contacted", "Lead created"]);

    const history = await repos.leadStageHistory.listByLead(firmId, lead.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      firmId, leadId: lead.id, fromStage: "new", toStage: "contacted",
      changedBy: session.user.id,
    });

    // Re-sending the current stage: no entry, no row.
    await leads.update(firmId, session.user.id, lead.id, { stage: "contacted" });
    expect(
      (await leads.list(firmId)).find((l) => l.id === lead.id)!.activity,
    ).toHaveLength(2);
    expect(await repos.leadStageHistory.listByLead(firmId, lead.id)).toHaveLength(1);

    // Two more free moves: newest-first rows with the real transitions.
    await leads.update(firmId, session.user.id, lead.id, { stage: "fee agreement" });
    await leads.update(firmId, session.user.id, lead.id, { stage: "lost" });
    const rows = await handle.sql`
      select from_stage, to_stage from lead_stage_history
      where lead_id = ${lead.id}
      order by at desc, id desc`;
    expect(rows.map((r) => [(r as { from_stage: string; to_stage: string }).from_stage,
      (r as { from_stage: string; to_stage: string }).to_stage])).toEqual([
      ["fee agreement", "lost"], ["contacted", "fee agreement"], ["new", "contacted"],
    ]);
  });

  it("conversion commits contact + numbered case + converted lead + history atomically; double conversion 409s; links are DB-only", async () => {
    const mailer = new CapturingMailer();
    const { auth, leads, contacts, cases, repos } = build(mailer);
    const { registered, session } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    const lead = await leads.create(firmId, {
      name: "Meera Kapoor", email: "meera@example.in", phone: "91234 56780",
      practiceArea: "Cheque Bounce (s.138)", value: 750000,
    });

    const result = await leads.convert(
      firmId, session.user.id, lead.id, { title: "Kapoor — s.138 complaint" },
    );
    expect(result.case.number).toBe(`${year()}-0001`);
    expect(result.case).toMatchObject({
      title: "Kapoor — s.138 complaint", practiceArea: "Cheque Bounce (s.138)",
      stage: "intake", status: "open", billableRate: 300000, trustBalance: 0,
      openDate: new Date().toISOString().slice(0, 10),
      leadAttorneyId: registered.user.id,
    });
    expect(result.contact).toMatchObject({
      type: "client", name: "Meera Kapoor", email: "meera@example.in",
      phone: "91234 56780", caseIds: [result.case.id],
    });
    expect(result.lead.stage).toBe("converted");
    expect(result.lead.activity[0]!.text).toBe(`Converted to case ${result.case.number}`);
    expect(result.lead).not.toHaveProperty("convertedCaseId");

    // The DB-only links really persisted, and the history row is there.
    const rows = await handle.sql`
      select l.converted_case_id, l.converted_contact_id, c.client_id
      from leads l join cases c on c.id = l.converted_case_id
      where l.id = ${lead.id}`;
    const row = rows[0] as {
      converted_case_id: string; converted_contact_id: string; client_id: string;
    };
    expect(row.converted_case_id).toBe(result.case.id);
    expect(row.converted_contact_id).toBe(result.contact.id);
    expect(row.client_id).toBe(result.contact.id);
    const history = await repos.leadStageHistory.listByLead(firmId, lead.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      fromStage: "new", toStage: "converted", changedBy: session.user.id,
    });

    // The parity fix: converting twice is a conflict, not a second case.
    await expect(leads.convert(firmId, session.user.id, lead.id, {})).rejects.toMatchObject({
      statusCode: 409, message: "Lead already converted",
    });
    expect(await cases.list(firmId)).toHaveLength(1);

    // The created entities are ordinary firm data: readable through their own services.
    expect((await contacts.get(firmId, result.contact.id)).caseIds).toEqual([result.case.id]);
    expect((await cases.get(firmId, result.case.id)).clientId).toBe(result.contact.id);
  });

  it("cross-firm isolation: other firm's lead 404s on update/delete/convert, lists never leak", async () => {
    const mailer = new CapturingMailer();
    const { auth, leads, repos } = build(mailer);
    const a = await firmWithOwner(auth, mailer, "owner@firm-a.example");
    const b = await firmWithOwner(auth, mailer, "owner@firm-b.example");
    const firmA = a.registered.firm.id;
    const firmB = b.registered.firm.id;

    const leadA = await leads.create(firmA, { name: "A's Prospect" });
    await leads.create(firmB, { name: "B's Prospect" });

    for (const op of [
      () => leads.update(firmB, b.session.user.id, leadA.id, { stage: "contacted" }),
      () => leads.delete(firmB, leadA.id),
      () => leads.convert(firmB, b.session.user.id, leadA.id, {}),
    ]) {
      await expect(op()).rejects.toMatchObject({
        statusCode: 404, message: "Lead not found",
      });
    }
    expect((await leads.list(firmA)).map((l) => l.id)).toEqual([leadA.id]);
    expect(await leads.list(firmB)).toHaveLength(1);
    // A cross-firm patch recorded no history either.
    expect(await repos.leadStageHistory.listByLead(firmB, leadA.id)).toEqual([]);
  });

  it("soft delete: the row stays with deleted_at stamped, reads drop it, and history outlives the delete", async () => {
    const mailer = new CapturingMailer();
    const { auth, leads, repos } = build(mailer);
    const { registered, session } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    const lead = await leads.create(firmId, { name: "Kavya Nair" });
    await leads.update(firmId, session.user.id, lead.id, { stage: "contacted" });
    await leads.delete(firmId, lead.id);

    await expect(leads.update(firmId, session.user.id, lead.id, { stage: "lost" }))
      .rejects.toMatchObject({ statusCode: 404, message: "Lead not found" });
    expect(await leads.list(firmId)).toEqual([]);

    const rows = await handle.sql`select deleted_at from leads where id = ${lead.id}`;
    expect((rows[0] as { deleted_at: Date | null }).deleted_at).not.toBeNull();
    expect(await repos.leadStageHistory.listByLead(firmId, lead.id)).toHaveLength(1);
  });

  it("validation is the service's: bad source/stage and non-integer value are 400s before anything is written", async () => {
    const mailer = new CapturingMailer();
    const { auth, leads } = build(mailer);
    const { registered } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    await expect(leads.create(firmId, { name: "Bad Stage", stage: "won" }))
      .rejects.toMatchObject({ statusCode: 400, message: LEAD_STAGE_MESSAGE });
    await expect(leads.create(firmId, { name: "Bad Source", source: "billboard" }))
      .rejects.toMatchObject({ statusCode: 400, message: LEAD_SOURCE_MESSAGE });
    await expect(leads.create(firmId, { name: "Bad Value", value: -1 }))
      .rejects.toMatchObject({ statusCode: 400, message: LEAD_VALUE_MESSAGE });
    await expect(leads.create(firmId, { name: "Fractional", value: 10.5 }))
      .rejects.toMatchObject({ statusCode: 400, message: LEAD_VALUE_MESSAGE });
    expect(await leads.list(firmId)).toEqual([]);
  });
});
