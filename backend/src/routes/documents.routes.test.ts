import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { closeDb } from "../db/client.js";
import type { AppConfig } from "../config.js";
import type { FastifyInstance } from "fastify";
import {
  DOCUMENT_CASE_MISSING_MESSAGE,
  DOCUMENT_FILE_MISSING_MESSAGE,
  DOCUMENT_STORAGE_KEY_MESSAGE,
  DOCUMENT_TYPE_MESSAGE,
  STORAGE_REQUIRED,
  documentSizeMessage,
} from "../services/documents/service.js";
import { CapturingMailer, inMemoryAuthRepositories } from "../services/auth/testing.js";
import type { AuthRepositories } from "../services/auth/repository.js";
import { InMemoryStorageService } from "../services/storage/in-memory.js";

/**
 * Documents routes (ticket 17) — in-memory repos + in-memory storage,
 * leads.routes.test.ts shape. Behavior matrix, contract + reference backend
 * (server.mjs) as north stars for the metadata surface:
 *
 *   GET    /documents                200 array, newest first
 *   POST   /documents                201 entity; reference defaults
 *                                    ("Untitled.docx", General, doc, 42 KB);
 *                                    ADDITIVE create fields bind bytes
 *                                    (storageKey must be the firm's own)
 *   PATCH  /documents/:id            200 entity, only sent fields move / 404;
 *                                    storageKey/mimeType are server-managed
 *   DELETE /documents/:id            204 / 404; object delete is best-effort
 *   POST   /documents/sign-upload    201 { storageKey, url, method, expiresIn }
 *                                    — 503 without storage, then validation
 *                                    (type allowlist → size cap → case link)
 *                                    BEFORE any URL exists
 *   GET    /documents/:id/download   200 { url, expiresIn } / 404 (missing or
 *                                    metadata-only) / 503 without storage
 *
 * Permissions: every firm member manages documents (practice data — no owner
 * gate). Cross-firm ids are 404s that leak nothing; a foreign storage key or
 * case id is rejected before bytes or URLs move.
 */

const testConfig: AppConfig = {
  port: 0,
  corsOrigins: ["http://localhost:5173"],
  sessionSecret: "test-secret",
  databaseUrl: null,
  cookieSameSite: "lax",
  cookieSecure: false,
  email: { from: "Lawleit <test@lawleit.example>", resendApiKey: null, baseUrl: "http://localhost:5173" },
  gatewayEncryptionKey: null,
};

interface FirmContext {
  token: string;
  userId: string;
  firmId: string;
  email: string;
}

/** The UTC day the service stamps into updatedAt. */
const today = () => new Date().toISOString().slice(0, 10);

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

describe("documents (ticket 17)", () => {
  let app: FastifyInstance;
  let mailer: CapturingMailer;
  let repos: AuthRepositories;
  let storage: InMemoryStorageService;
  let firmA: FirmContext;
  let firmB: FirmContext;

  afterEach(async () => {
    await closeDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  // Two firms share one repo set and one storage fake on one app — same as
  // two tenants on one API.
  async function setup(): Promise<void> {
    mailer = new CapturingMailer();
    repos = inMemoryAuthRepositories();
    storage = new InMemoryStorageService();
    app = await buildApp(testConfig, { repositories: repos, mailer, storage });
    firmA = await signupFirm(app, mailer, "owner@firm-a.example", "Aditi");
    firmB = await signupFirm(app, mailer, "owner@firm-b.example", "Bharat");
  }

  /** Creates one metadata document in the given firm; returns the response. */
  async function createDocumentRaw(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<ReturnType<FastifyInstance["inject"]>> {
    return app.inject({
      method: "POST", url: "/api/v1/documents",
      headers: bearer(token),
      payload: { name: "Motion to Compel.docx", folder: "Drafts", kind: "doc", ...overrides },
    });
  }

  /** Creates one metadata document, asserting the 201. */
  async function createDocument(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const res = await createDocumentRaw(token, overrides);
    expect(res.statusCode).toBe(201);
    return res.json() as Record<string, unknown>;
  }

  /** Signs an upload request; returns the 201 body. */
  async function signUpload(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<{ statusCode: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: "POST", url: "/api/v1/documents/sign-upload",
      headers: bearer(token),
      payload: {
        name: "Affidavit.pdf", contentType: "application/pdf", sizeBytes: 2048,
        ...overrides,
      },
    });
    return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  it("metadata create → 201 contract shape with reference defaults; the list is newest first", async () => {
    await setup();
    // A truly absent body ({}): the reference's bare "Untitled.docx" default.
    const bareRes = await app.inject({
      method: "POST", url: "/api/v1/documents", headers: bearer(firmA.token), payload: {},
    });
    expect(bareRes.statusCode).toBe(201);
    const bare = bareRes.json() as Record<string, unknown>;
    expect(bare).toMatchObject({
      name: "Untitled.docx", folder: "General", kind: "doc",
      sizeKb: 42, updatedAt: today(), hasFile: false,
    });
    // Contract shape only — bookkeeping and the upload bindings stay absent.
    for (const key of [
      "firmId", "createdAt", "deletedAt", "uploadedBy",
      "mimeType", "storageKey", "caseId", "starred", "templateFields",
    ]) {
      expect(bare).not.toHaveProperty(key);
    }

    const named = await createDocument(firmA.token, { sizeKb: 84, caseId: null });
    expect(named.sizeKb).toBe(84);

    const list = await app.inject({
      method: "GET", url: "/api/v1/documents", headers: bearer(firmA.token),
    });
    expect(list.statusCode).toBe(200);
    const documents = list.json() as { id: string; name: string }[];
    expect(documents.map((d) => d.id)).toEqual([named.id, bare.id]);
    await app.close();
  });

  it("PATCH moves only sent fields; unknown and malformed ids are 404/400; DELETE is 204 then gone", async () => {
    await setup();
    const created = await createDocument(firmA.token);

    const patched = await app.inject({
      method: "PATCH", url: `/api/v1/documents/${created.id}`,
      headers: bearer(firmA.token),
      payload: { starred: true, folder: "Pleadings" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ starred: true, folder: "Pleadings", name: "Motion to Compel.docx" });

    const missing = await app.inject({
      method: "PATCH", url: `/api/v1/documents/${crypto.randomUUID()}`,
      headers: bearer(firmA.token), payload: { name: "x" },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "Document not found" });

    const malformed = await app.inject({
      method: "PATCH", url: "/api/v1/documents/not-a-uuid",
      headers: bearer(firmA.token), payload: { name: "x" },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error).toBe("Invalid document id");

    const deleted = await app.inject({
      method: "DELETE", url: `/api/v1/documents/${created.id}`,
      headers: bearer(firmA.token),
    });
    expect(deleted.statusCode).toBe(204);
    const list = await app.inject({
      method: "GET", url: "/api/v1/documents", headers: bearer(firmA.token),
    });
    expect((list.json() as { id: string }[]).map((d) => d.id)).not.toContain(created.id);

    const again = await app.inject({
      method: "DELETE", url: `/api/v1/documents/${created.id}`,
      headers: bearer(firmA.token),
    });
    expect(again.statusCode).toBe(404);
    await app.close();
  });

  it("sign-upload mints a PUT in the firm's own namespace; with a case the key is per-case", async () => {
    await setup();
    const caseRes = await app.inject({
      method: "POST", url: "/api/v1/cases", headers: bearer(firmA.token),
      payload: { title: "Chadha v. Khanna" },
    });
    const caseId = (caseRes.json() as { id: string }).id;

    const signed = await signUpload(firmA.token);
    expect(signed.statusCode).toBe(201);
    expect(signed.body).toEqual({
      storageKey: expect.stringMatching(new RegExp(`^firms/${firmA.firmId}/documents/[0-9a-f-]+/Affidavit\\.pdf$`)),
      url: expect.stringContaining("firms/"),
      method: "PUT",
      expiresIn: 900,
    });
    // The deterministic fake embeds the key in the URL.
    expect(signed.body.url).toContain(signed.body.storageKey as string);

    const perCase = await signUpload(firmA.token, { caseId });
    expect(perCase.statusCode).toBe(201);
    expect(perCase.body.storageKey).toContain(`firms/${firmA.firmId}/cases/${caseId}/`);

    // The fake saw the pinned content type and size (the presign's inputs).
    expect(storage.uploads.get(signed.body.storageKey as string)).toEqual({
      contentType: "application/pdf", size: 2048,
    });
    await app.close();
  });

  it("sign-upload validation: disallowed types, oversized and malformed payloads are 400s before any URL", async () => {
    await setup();
    const disallowed = await signUpload(firmA.token, { contentType: "application/x-msdownload" });
    expect(disallowed.statusCode).toBe(400);
    expect(disallowed.body).toEqual({ error: DOCUMENT_TYPE_MESSAGE });

    const oversized = await signUpload(firmA.token, { sizeBytes: 26 * 1024 * 1024 });
    expect(oversized.statusCode).toBe(400);
    expect(oversized.body).toEqual({ error: documentSizeMessage(25 * 1024 * 1024) });

    const zero = await signUpload(firmA.token, { sizeBytes: 0 });
    expect(zero.statusCode).toBe(400);
    const fractional = await signUpload(firmA.token, { sizeBytes: 10.5 });
    expect(fractional.statusCode).toBe(400);
    const nameless = await signUpload(firmA.token, { name: "   " });
    expect(nameless.statusCode).toBe(400);
    expect(nameless.body).toEqual({ error: "File name is required" });
    const typeless = await signUpload(firmA.token, { contentType: "" });
    expect(typeless.statusCode).toBe(400);
    expect(storage.uploads.size).toBe(0);
    await app.close();
  });

  it("the type allowlist admits pdf, images, office docs and text — with an extension fallback for empty/unknown MIME", async () => {
    await setup();
    for (const contentType of [
      "application/pdf",
      "image/png", "image/jpeg", "image/webp",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain", "text/csv",
    ]) {
      const ok = await signUpload(firmA.token, {
        name: `file.${contentType.split("/")[1]}`, contentType,
      });
      expect(ok.statusCode).toBe(201);
    }

    // Browsers report no/generic MIME for some real files — the extension decides.
    const heic = await signUpload(firmA.token, {
      name: "court-photo.heic", contentType: "application/octet-stream",
    });
    expect(heic.statusCode).toBe(201);
    const extensionless = await signUpload(firmA.token, {
      name: "payload.exe", contentType: "application/octet-stream",
    });
    expect(extensionless.statusCode).toBe(400);
    expect(extensionless.body).toEqual({ error: DOCUMENT_TYPE_MESSAGE });
    await app.close();
  });

  it("503 when storage is unconfigured — the metadata surface keeps working", async () => {
    mailer = new CapturingMailer();
    repos = inMemoryAuthRepositories();
    app = await buildApp(testConfig, { repositories: repos, mailer });
    firmA = await signupFirm(app, mailer, "owner@firm-a.example", "Aditi");

    const signed = await signUpload(firmA.token);
    expect(signed.statusCode).toBe(503);
    expect(signed.body).toEqual({ error: STORAGE_REQUIRED });

    const download = await app.inject({
      method: "GET", url: `/api/v1/documents/${crypto.randomUUID()}/download`,
      headers: bearer(firmA.token),
    });
    expect(download.statusCode).toBe(503);
    expect(download.json()).toEqual({ error: STORAGE_REQUIRED });

    // Contract metadata CRUD is unaffected by the missing storage binding.
    const created = await createDocument(firmA.token);
    expect(created.hasFile).toBe(false);
    const list = await app.inject({
      method: "GET", url: "/api/v1/documents", headers: bearer(firmA.token),
    });
    expect(list.statusCode).toBe(200);
    await app.close();
  });

  it("complete flow: sign → metadata POST with the key → hasFile; download returns a signed GET", async () => {
    await setup();
    const signed = await signUpload(firmA.token, { name: "Written Statement.pdf" });
    const { storageKey } = signed.body as { storageKey: string };

    const created = await createDocument(firmA.token, {
      name: "Written Statement.pdf", folder: "Pleadings", kind: "pdf",
      sizeBytes: 2048, storageKey, mimeType: "application/pdf",
    });
    expect(created.hasFile).toBe(true);

    const download = await app.inject({
      method: "GET", url: `/api/v1/documents/${created.id}/download`,
      headers: bearer(firmA.token),
    });
    expect(download.statusCode).toBe(200);
    expect(download.json()).toEqual({
      url: expect.stringContaining(storageKey),
      expiresIn: 900,
    });
    await app.close();
  });

  it("a create echoing a foreign-prefixed storageKey is a 400, never a stored pointer", async () => {
    await setup();
    const foreign = await createDocumentRaw(firmA.token, {
      storageKey: `firms/${firmB.firmId}/documents/steal.pdf`,
    });
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json()).toEqual({ error: DOCUMENT_STORAGE_KEY_MESSAGE });

    const bogus = await createDocumentRaw(firmA.token, { storageKey: "etc/passwd" });
    expect(bogus.statusCode).toBe(400);
    const list = await app.inject({
      method: "GET", url: "/api/v1/documents", headers: bearer(firmA.token),
    });
    expect(list.json()).toEqual([]); // nothing was created — no partial writes
    await app.close();
  });

  it("download rules: metadata-only rows and unknown ids are 404s", async () => {
    await setup();
    const metadataOnly = await createDocument(firmA.token);
    const download = await app.inject({
      method: "GET", url: `/api/v1/documents/${metadataOnly.id}/download`,
      headers: bearer(firmA.token),
    });
    expect(download.statusCode).toBe(404);
    expect(download.json()).toEqual({ error: DOCUMENT_FILE_MISSING_MESSAGE });

    const missing = await app.inject({
      method: "GET", url: `/api/v1/documents/${crypto.randomUUID()}/download`,
      headers: bearer(firmA.token),
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "Document not found" });
    await app.close();
  });

  it("delete is best-effort for the object: the stored key lands in the storage fake's deletes", async () => {
    await setup();
    const signed = await signUpload(firmA.token);
    const { storageKey } = signed.body as { storageKey: string };
    const created = await createDocument(firmA.token, { storageKey, sizeBytes: 2048 });

    await app.inject({
      method: "DELETE", url: `/api/v1/documents/${created.id}`,
      headers: bearer(firmA.token),
    });
    expect(storage.deleted).toEqual([storageKey]);
    await app.close();
  });

  it("case links are validated: a foreign or malformed caseId is a 400 on create, patch, and sign-upload", async () => {
    await setup();
    const caseRes = await app.inject({
      method: "POST", url: "/api/v1/cases", headers: bearer(firmA.token),
      payload: { title: "Firm A matter" },
    });
    const firmACase = (caseRes.json() as { id: string }).id;

    const foreignSign = await signUpload(firmB.token, { caseId: firmACase });
    expect(foreignSign.statusCode).toBe(400);
    expect(foreignSign.body).toEqual({ error: DOCUMENT_CASE_MISSING_MESSAGE });

    const malformed = await signUpload(firmB.token, { caseId: "not-a-uuid" });
    expect(malformed.statusCode).toBe(400);

    const foreignCreate = await createDocumentRaw(firmB.token, { caseId: firmACase });
    expect(foreignCreate.statusCode).toBe(400);
    expect(foreignCreate.json()).toEqual({ error: DOCUMENT_CASE_MISSING_MESSAGE });

    const own = await createDocument(firmA.token, { caseId: firmACase });
    expect(own.caseId).toBe(firmACase);
    await app.close();
  });

  it("cross-firm isolation: another firm's documents are 404s that leak nothing", async () => {
    await setup();
    const signed = await signUpload(firmA.token);
    const { storageKey } = signed.body as { storageKey: string };
    const created = await createDocument(firmA.token, { storageKey, sizeBytes: 2048 });

    for (const attempt of [
      () => app.inject({
        method: "GET", url: `/api/v1/documents/${created.id}/download`,
        headers: bearer(firmB.token),
      }),
      () => app.inject({
        method: "PATCH", url: `/api/v1/documents/${created.id}`,
        headers: bearer(firmB.token), payload: { name: "Hijacked" },
      }),
      () => app.inject({
        method: "DELETE", url: `/api/v1/documents/${created.id}`,
        headers: bearer(firmB.token),
      }),
    ]) {
      const res = await attempt();
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Document not found" });
    }

    const listB = await app.inject({
      method: "GET", url: "/api/v1/documents", headers: bearer(firmB.token),
    });
    expect(listB.json()).toEqual([]);

    // The cross-firm attempts moved nothing: firm A still downloads its file.
    const download = await app.inject({
      method: "GET", url: `/api/v1/documents/${created.id}/download`,
      headers: bearer(firmA.token),
    });
    expect(download.statusCode).toBe(200);
    expect(storage.deleted).toEqual([]);
    await app.close();
  });

  it("every firm member can upload — practice data, no owner gate", async () => {
    await setup();
    const invite = await app.inject({
      method: "POST", url: "/api/v1/users",
      headers: bearer(firmA.token),
      payload: { name: "Prem Lal", email: "prel@firm-a.example", role: "paralegal" },
    });
    expect(invite.statusCode).toBe(201);
    const consume = await app.inject({
      method: "POST", url: "/api/v1/auth/password-reset/consume",
      payload: { token: mailer.invites[mailer.invites.length - 1]!.token, password: "member-pass-123" },
    });
    expect(consume.statusCode).toBe(204);
    const login = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { email: "prel@firm-a.example", password: "member-pass-123" },
    });
    const memberToken = (login.json() as { token: string }).token;

    const signed = await signUpload(memberToken);
    expect(signed.statusCode).toBe(201);
    expect(signed.body.storageKey).toContain(`firms/${firmA.firmId}/`);
    await app.close();
  });
});
