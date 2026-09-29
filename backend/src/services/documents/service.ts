import { randomUUID } from "node:crypto";
import type { AuthRepositories } from "../auth/repository.js";
import { HttpError } from "../httpError.js";
import { PRESIGN_TTL_SECONDS } from "../storage/service.js";
import type { StorageService } from "../storage/service.js";
import type { ApiDocument, DocumentPatch } from "./repository.js";
import { toApiDocument } from "./repository.js";

/** Shown (as a 503) when the API runs without the S3_* storage variables. */
export const STORAGE_REQUIRED =
  "Storage not configured — set S3_* vars (see .env.example)";
/** Shown (as a 400) when a sign-upload's content type is not on the allowlist. */
export const DOCUMENT_TYPE_MESSAGE =
  "File type not allowed — upload a PDF, Office document, image, or text file";
/** Shown (as a 400) when a well-formed caseId is not a live case of the firm. */
export const DOCUMENT_CASE_MISSING_MESSAGE = "Case not found";
/** Shown (as a 400) when a caseId is not a uuid — the column is a uuid FK. */
export const DOCUMENT_CASE_MESSAGE = "Invalid case id";
/** Shown (as a 400) when a create names a storage key outside the firm's prefix. */
export const DOCUMENT_STORAGE_KEY_MESSAGE = "Invalid storage key";
/** Shown (as a 404) when a live document has no bytes (metadata-only row). */
export const DOCUMENT_FILE_MISSING_MESSAGE = "Document file not found";

/** The upload size cap when S3_MAX_UPLOAD_MB is unset (the ticket's default). */
export const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** The size-cap 400 message — names the configured limit in MB. */
export function documentSizeMessage(maxUploadBytes: number): string {
  return `File is too large — the limit is ${Math.round(maxUploadBytes / (1024 * 1024))} MB`;
}

/**
 * The type allowlist (the ticket's list: PDFs, images, Office documents,
 * text). Enforced server-side at sign-upload — no signed URL is minted for a
 * disallowed declaration. SVG is deliberately absent: browsers execute it,
 * and a storage-backed download would serve it with image semantics.
 */
export const ALLOWED_MIME_TYPES = new Set([
  // pdf
  "application/pdf",
  // images
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  // office documents
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // text
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/rtf",
]);

/**
 * Extension fallback: browsers report an empty (or generic octet-stream)
 * content type for some real-world files (e.g. .heic on Windows, legacy
 * .doc). The allowlist decision may fall back to the extension, but the
 * presign and the browser PUT both use the DECLARED content type, so the
 * signature always matches what the adapter sends.
 */
const ALLOWED_EXTENSIONS = new Set([
  "pdf", "png", "jpg", "jpeg", "gif", "webp", "heic", "heif",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "txt", "csv", "md", "rtf",
]);

export function isAllowedUploadType(contentType: string, name: string): boolean {
  if (ALLOWED_MIME_TYPES.has(contentType)) return true;
  if (contentType !== "" && contentType !== "application/octet-stream") return false;
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return extension !== "" && ALLOWED_EXTENSIONS.has(extension);
}

/** UUID shape of every production id (same rule as the :id params). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every storage key lives under the firm's prefix — the namespace rule that
 * makes a document row unable to point at another tenant's object. Layout:
 * `firms/<firmId>/cases/<caseId>/<uuid>/<file>` for case files (the ticket's
 * per-case folder organization) and `firms/<firmId>/documents/<uuid>/<file>`
 * for firm-wide ones. The display `folder` is contract metadata; the key's
 * structure is the server's.
 */
export function buildDocumentKey(firmId: string, caseId: string | null, name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const safeName = base.replace(/[^\w.() -]/g, "_").slice(0, 120) || "file";
  const scope = caseId ? `cases/${caseId}` : "documents";
  return `firms/${firmId}/${scope}/${randomUUID()}/${safeName}`;
}

/** A create's storageKey is only honored inside the firm's own prefix. */
function isOwnStorageKey(firmId: string, storageKey: string): boolean {
  return storageKey.startsWith(`firms/${firmId}/`) && storageKey.length > `firms/${firmId}/`.length;
}

/** "" and null both mean "no link" (the mock/reference store "" there). */
function normalizeLink(value: string | null | undefined): string | null {
  return value === "" || value === null || value === undefined ? null : value;
}

function checkUuid(value: string, message: string): void {
  if (!UUID_PATTERN.test(value)) throw new HttpError(400, message);
}

/** The writable metadata input of POST/PATCH /documents (server-managed fields absent). */
export interface DocumentInput {
  name?: string;
  folder?: string;
  caseId?: string | null;
  kind?: string;
  sizeKb?: number;
  /** Ticket 17, additive: exact byte count for uploaded files (wins over sizeKb). */
  sizeBytes?: number;
  starred?: boolean | null;
  templateFields?: string[] | null;
  /** Ticket 17, additive: a key minted by this firm's POST /documents/sign-upload. */
  storageKey?: string;
  /** Ticket 17, additive: the uploaded file's declared content type. */
  mimeType?: string;
}

/** The sign-upload request the service validates and the storage seam mints. */
export interface SignUploadInput {
  caseId?: string | null;
  name: string;
  contentType: string;
  sizeBytes: number;
}

export interface SignedUpload {
  storageKey: string;
  url: string;
  method: "PUT";
  expiresIn: number;
}

/**
 * Documents business logic (ticket 17). The metadata CRUD mirrors the
 * reference backend exactly (metadata-only POST/PATCH/DELETE, newest-first
 * list, free-form kind — the contract's DocumentFile has no vocabulary rule
 * the reference enforces); the upload flow is additive on top:
 *
 *   POST /documents/sign-upload → 201 { storageKey, url, method, expiresIn }
 *   (browser PUTs the bytes straight to object storage)
 *   POST /documents (metadata + storageKey) → 201 DocumentFile (hasFile: true)
 *   GET  /documents/:id/download → 200 { url, expiresIn }
 *
 * Validation happens BEFORE any URL is minted: type allowlist, size cap,
 * case-link existence. Without the S3_* env the flow routes answer 503 —
 * the metadata surface keeps working (the contract's metadata-only mode).
 * Object deletion on document delete is best-effort by design: the
 * metadata row is the source of truth, a failed object delete only logs.
 */
export class DocumentsService {
  constructor(
    private readonly repos: AuthRepositories,
    private readonly storage: StorageService | null,
    private readonly maxUploadBytes: number = DEFAULT_MAX_UPLOAD_BYTES,
  ) {}

  /** Newest first — the mock and the reference both unshift new documents. */
  async list(firmId: string): Promise<ApiDocument[]> {
    const rows = await this.repos.documents.listByFirm(firmId);
    return rows.map(toApiDocument);
  }

  /**
   * POST /documents → 201 with the created entity. Defaults mirror the
   * reference backend exactly: name "Untitled.docx", folder "General", kind
   * "doc", sizeKb 42 (→ 43008 bytes, so the shape round-trips), updatedAt
   * today (a stamp, not client data). The additive upload fields bind the
   * row to bytes: `storageKey` must be inside the firm's own prefix (a
   * foreign prefix is a 400, never a stored cross-tenant pointer).
   */
  async create(firmId: string, uploadedBy: string, input: DocumentInput): Promise<ApiDocument> {
    const caseId = normalizeLink(input.caseId);
    if (caseId) checkUuid(caseId, DOCUMENT_CASE_MESSAGE);
    if (input.storageKey !== undefined && !isOwnStorageKey(firmId, input.storageKey)) {
      throw new HttpError(400, DOCUMENT_STORAGE_KEY_MESSAGE);
    }
    const sizeBytes = this.sizeBytes(input);

    const row = await this.repos.transaction(async (tx) => {
      if (caseId) {
        const linked = await tx.cases.findById(firmId, caseId);
        if (!linked) throw new HttpError(400, DOCUMENT_CASE_MISSING_MESSAGE);
      }
      return tx.documents.create({
        firmId,
        caseId,
        name: input.name ?? "Untitled.docx",
        folder: input.folder ?? "General",
        kind: input.kind ?? "doc",
        sizeBytes,
        mimeType: input.mimeType ?? null,
        storageKey: input.storageKey ?? null,
        uploadedBy,
        starred: input.starred ?? null,
        templateFields: input.templateFields ?? null,
      });
    });
    return toApiDocument(row);
  }

  /**
   * PATCH /documents/:id — only the sent fields move (mock Object.assign);
   * missing/foreign/soft-deleted ids are uniformly 404. `storageKey`/
   * `mimeType` are not in the patch type (server-managed — see DocumentPatch).
   */
  async update(firmId: string, id: string, patch: DocumentInput): Promise<ApiDocument> {
    const normalized: DocumentPatch = {};
    if (patch.name !== undefined) normalized.name = patch.name;
    if (patch.folder !== undefined) normalized.folder = patch.folder;
    if (patch.kind !== undefined) normalized.kind = patch.kind;
    if (patch.starred !== undefined) normalized.starred = patch.starred;
    if (patch.templateFields !== undefined) normalized.templateFields = patch.templateFields;
    if (patch.sizeKb !== undefined || patch.sizeBytes !== undefined) {
      normalized.sizeBytes = this.sizeBytes(patch);
    }
    if (patch.caseId !== undefined) {
      const caseId = normalizeLink(patch.caseId);
      normalized.caseId = caseId;
      if (caseId) checkUuid(caseId, DOCUMENT_CASE_MESSAGE);
    }

    const row = await this.repos.transaction(async (tx) => {
      if (normalized.caseId) {
        const linked = await tx.cases.findById(firmId, normalized.caseId);
        if (!linked) throw new HttpError(400, DOCUMENT_CASE_MISSING_MESSAGE);
      }
      return tx.documents.update(firmId, id, normalized);
    });
    if (!row) throw new HttpError(404, "Document not found");
    return toApiDocument(row);
  }

  /**
   * DELETE /documents/:id → 204. Soft delete per the baseline convention;
   * the stored object's deletion is best-effort — attempted when storage is
   * configured, never fatal (a stranded object beats a failed delete of
   * correct metadata; orphaned objects are an ops concern, not a correctness
   * one).
   */
  async delete(firmId: string, id: string): Promise<void> {
    const row = await this.repos.documents.findById(firmId, id);
    if (!row) throw new HttpError(404, "Document not found");
    const deleted = await this.repos.documents.delete(firmId, id);
    if (deleted && row.storageKey && this.storage) {
      await this.storage.deleteObject(row.storageKey).catch(() => {
        // Best-effort: the metadata delete stands; the object may outlive it.
      });
    }
  }

  /**
   * POST /documents/sign-upload — the permission-checked gate before any
   * byte moves. 503 when storage is unconfigured (before everything: the
   * route cannot function), then type allowlist → size cap → case link —
   * every rejection happens BEFORE a URL exists. The response carries the
   * key the metadata POST must echo back.
   */
  async signUpload(firmId: string, input: SignUploadInput): Promise<SignedUpload> {
    if (!this.storage) throw new HttpError(503, STORAGE_REQUIRED);
    if (!isAllowedUploadType(input.contentType, input.name)) {
      throw new HttpError(400, DOCUMENT_TYPE_MESSAGE);
    }
    if (
      !Number.isInteger(input.sizeBytes) ||
      input.sizeBytes <= 0 ||
      input.sizeBytes > this.maxUploadBytes
    ) {
      throw new HttpError(400, documentSizeMessage(this.maxUploadBytes));
    }
    const caseId = normalizeLink(input.caseId);
    if (caseId) {
      checkUuid(caseId, DOCUMENT_CASE_MESSAGE);
      const linked = await this.repos.cases.findById(firmId, caseId);
      if (!linked) throw new HttpError(400, DOCUMENT_CASE_MISSING_MESSAGE);
    }
    const storageKey = buildDocumentKey(firmId, caseId, input.name);
    const presigned = await this.storage.presignUpload(storageKey, input.contentType, input.sizeBytes);
    return { storageKey, url: presigned.url, method: presigned.method, expiresIn: PRESIGN_TTL_SECONDS };
  }

  /**
   * GET /documents/:id/download — 200 { url, expiresIn } with a short-lived
   * signed GET. 404 for missing/foreign/soft-deleted rows AND for
   * metadata-only rows (nothing to download); 503 when storage is
   * unconfigured (the signed URL cannot be minted).
   */
  async downloadUrl(firmId: string, id: string): Promise<{ url: string; expiresIn: number }> {
    if (!this.storage) throw new HttpError(503, STORAGE_REQUIRED);
    const row = await this.repos.documents.findById(firmId, id);
    if (!row) throw new HttpError(404, "Document not found");
    if (!row.storageKey) throw new HttpError(404, DOCUMENT_FILE_MISSING_MESSAGE);
    const { url } = await this.storage.presignDownload(row.storageKey);
    return { url, expiresIn: PRESIGN_TTL_SECONDS };
  }

  /** sizeBytes wins (uploads); sizeKb × 1024 keeps the metadata shape round-trip-exact; the reference's 42 KB is the default. */
  private sizeBytes(input: DocumentInput): number {
    if (input.sizeBytes !== undefined) {
      if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 0) {
        throw new HttpError(400, "File size must be a non-negative integer of bytes");
      }
      return input.sizeBytes;
    }
    const sizeKb = input.sizeKb ?? 42;
    if (!Number.isInteger(sizeKb) || sizeKb < 0) {
      throw new HttpError(400, "File size must be a non-negative integer of kilobytes");
    }
    return sizeKb * 1024;
  }
}
