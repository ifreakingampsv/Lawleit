import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, migrationsFolder, requireDb, type DbHandle } from "../../db/client.js";
import { createDrizzleRepositories } from "../auth/drizzle-repository.js";
import { AuthService } from "../auth/service.js";
import { CapturingMailer } from "../auth/testing.js";
import { CasesService } from "../cases/service.js";
import {
  DOCUMENT_CASE_MISSING_MESSAGE,
  DOCUMENT_FILE_MISSING_MESSAGE,
  DOCUMENT_STORAGE_KEY_MESSAGE,
  DocumentsService,
} from "./service.js";
import { InMemoryStorageService } from "../storage/in-memory.js";

/**
 * DB-backed twin of the documents suite (service.db.test.ts pattern): the
 * same flows as the in-memory route tests, run against real Postgres so the
 * Drizzle binding proves it implements the seam identically — the bigint
 * size_bytes column, the nullable storage_key/mime_type upload bindings, the
 * uploaded_by soft link, and the soft-delete stamps. The storage seam binds
 * the deterministic in-memory fake (presigning is pure crypto — no network).
 * Runs only when DATABASE_URL is exported and skips silently otherwise;
 * point it at a scratch database (truncates).
 */
describe.skipIf(!process.env.DATABASE_URL)("documents against Postgres", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = requireDb();
    await migrate(handle.db, { migrationsFolder });
  });

  afterEach(async () => {
    await handle.sql.unsafe(
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
    const storage = new InMemoryStorageService();
    return {
      auth: new AuthService(repos, mailer),
      cases: new CasesService(repos),
      documents: new DocumentsService(repos, storage),
      storage,
      repos,
    };
  }

  it("create → reference defaults; size_bytes, the null upload bindings and uploaded_by really persist", async () => {
    const mailer = new CapturingMailer();
    const { auth, documents } = build(mailer);
    const { registered, session } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;

    const created = await documents.create(firmId, session.user.id, {
      name: "Retainer Agreement.docx", folder: "Engagement", sizeKb: 84,
    });
    expect(created).toMatchObject({
      name: "Retainer Agreement.docx", folder: "Engagement", kind: "doc",
      sizeKb: 84, hasFile: false, updatedAt: new Date().toISOString().slice(0, 10),
    });
    expect(created).not.toHaveProperty("firmId");
    expect(created).not.toHaveProperty("storageKey");

    const rows = await handle.sql`
      select size_bytes, storage_key, mime_type, uploaded_by, deleted_at, case_id
      from documents where id = ${created.id}`;
    const row = rows[0] as {
      size_bytes: string | number; storage_key: string | null; mime_type: string | null;
      uploaded_by: string; deleted_at: Date | null; case_id: string | null;
    };
    expect(Number(row.size_bytes)).toBe(84 * 1024);
    expect(row.storage_key).toBeNull();
    expect(row.mime_type).toBeNull();
    expect(row.uploaded_by).toBe(session.user.id);
    expect(row.deleted_at).toBeNull();
    expect(row.case_id).toBeNull();
  });

  it("upload flow end to end: sign → create with the key → download → delete (metadata + best-effort object)", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases, documents, storage } = build(mailer);
    const { registered, session } = await firmWithOwner(auth, mailer, "owner@firm.example");
    const firmId = registered.firm.id;
    const kase = await cases.create(firmId, { title: "Chadha v. Khanna" });

    const signed = await documents.signUpload(firmId, {
      caseId: kase.id, name: "Plaint.pdf", contentType: "application/pdf", sizeBytes: 2048,
    });
    expect(signed.method).toBe("PUT");
    expect(signed.storageKey).toContain(`firms/${firmId}/cases/${kase.id}/`);

    const created = await documents.create(firmId, session.user.id, {
      name: "Plaint.pdf", folder: "Pleadings", kind: "pdf", caseId: kase.id,
      sizeBytes: 2048, storageKey: signed.storageKey, mimeType: "application/pdf",
    });
    expect(created.hasFile).toBe(true);
    expect(created.sizeKb).toBe(2);

    const rows = await handle.sql`
      select storage_key, mime_type, case_id from documents where id = ${created.id}`;
    const row = rows[0] as { storage_key: string; mime_type: string; case_id: string };
    expect(row.storage_key).toBe(signed.storageKey);
    expect(row.mime_type).toBe("application/pdf");
    expect(row.case_id).toBe(kase.id);

    const download = await documents.downloadUrl(firmId, created.id);
    expect(download.url).toContain(signed.storageKey);
    expect(download.expiresIn).toBe(900);

    await documents.delete(firmId, created.id);
    expect(await documents.list(firmId)).toEqual([]);
    const after = await handle.sql`
      select deleted_at from documents where id = ${created.id}`;
    expect((after[0] as { deleted_at: Date | null }).deleted_at).not.toBeNull();
    // The object delete is best-effort but observable through the fake.
    expect(storage.deleted).toEqual([signed.storageKey]);
  });

  it("validation is the service's: foreign storage keys and case links are 400s before any row", async () => {
    const mailer = new CapturingMailer();
    const { auth, cases, documents } = build(mailer);
    const a = await firmWithOwner(auth, mailer, "owner@firm-a.example");
    const b = await firmWithOwner(auth, mailer, "owner@firm-b.example");
    const firmA = a.registered.firm.id;
    const firmB = b.registered.firm.id;
    const firmACase = await cases.create(firmA, { title: "A's matter" });

    await expect(
      documents.create(firmA, a.session.user.id, { storageKey: `firms/${firmB}/documents/x.pdf` }),
    ).rejects.toMatchObject({ statusCode: 400, message: DOCUMENT_STORAGE_KEY_MESSAGE });

    await expect(
      documents.create(firmB, b.session.user.id, { caseId: firmACase.id }),
    ).rejects.toMatchObject({ statusCode: 400, message: DOCUMENT_CASE_MISSING_MESSAGE });

    await expect(
      documents.signUpload(firmB, { caseId: firmACase.id, name: "x.pdf", contentType: "application/pdf", sizeBytes: 10 }),
    ).rejects.toMatchObject({ statusCode: 400, message: DOCUMENT_CASE_MISSING_MESSAGE });

    expect(await documents.list(firmA)).toEqual([]);
    expect(await documents.list(firmB)).toEqual([]);
  });

  it("cross-firm isolation: another firm's document 404s on download/delete; a metadata-only row has no file", async () => {
    const mailer = new CapturingMailer();
    const { auth, documents, storage } = build(mailer);
    const a = await firmWithOwner(auth, mailer, "owner@firm-a.example");
    const b = await firmWithOwner(auth, mailer, "owner@firm-b.example");
    const firmA = a.registered.firm.id;
    const firmB = b.registered.firm.id;

    const signed = await documents.signUpload(firmA, { name: "a.pdf", contentType: "application/pdf", sizeBytes: 10 });
    const docA = await documents.create(firmA, a.session.user.id, { name: "a.pdf", storageKey: signed.storageKey, sizeBytes: 10 });
    const metadataOnly = await documents.create(firmB, b.session.user.id, { name: "b.docx" });

    await expect(documents.downloadUrl(firmB, docA.id))
      .rejects.toMatchObject({ statusCode: 404, message: "Document not found" });
    await expect(documents.delete(firmB, docA.id))
      .rejects.toMatchObject({ statusCode: 404, message: "Document not found" });
    await expect(documents.downloadUrl(firmB, metadataOnly.id))
      .rejects.toMatchObject({ statusCode: 404, message: DOCUMENT_FILE_MISSING_MESSAGE });
    expect(storage.deleted).toEqual([]);

    // Firm A's file still downloads after B's probes.
    expect((await documents.downloadUrl(firmA, docA.id)).url).toContain(signed.storageKey);
  });
});
