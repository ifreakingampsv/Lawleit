/**
 * Repository seam for documents (ticket 17) — the leads seam's twin
 * (services/leads/repository.ts): services depend only on these interfaces;
 * the Drizzle binding (`drizzle.ts`) is the production implementation and
 * tests bind the in-memory fake (`in-memory.ts`), which is also what keeps
 * the suite green with no database present.
 *
 * Tenancy (ADR-0003): every method takes the caller's firm id and filters by
 * it; a cross-firm id must look up as "not found", never as an error that
 * leaks existence. The documents tests assert that.
 */

/** The kind vocabulary of the API contract (app/src/lib/data/types.ts DocumentFile["kind"]). */
export const DOCUMENT_KINDS = ["doc", "pdf", "sheet", "image", "template", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export interface DocumentRow {
  id: string;
  firmId: string;
  /** Null = firm-wide document (the seed's Templates folder rows). */
  caseId: string | null;
  name: string;
  folder: string;
  kind: string;
  /** Exact byte count; the API shape renders KB (see schema.ts). */
  sizeBytes: number;
  /** DB-only (the mapper whitelists it out) — what the upload declared. */
  mimeType: string | null;
  /** Object-storage key; null = metadata-only document. */
  storageKey: string | null;
  /** The session user that signed the upload / created the row (soft link). */
  uploadedBy: string;
  starred: boolean | null;
  templateFields: string[] | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** The document shape the API contract exposes (types.ts DocumentFile). */
export type ApiDocument = {
  id: string;
  name: string;
  folder: string;
  kind: string;
  /** Contract shape is KB-granular: round(sizeBytes / 1024). */
  sizeKb: number;
  /** Contract shape is an ISO date (YYYY-MM-DD), not a timestamp. */
  updatedAt: string;
  /** Ticket 17, additive: whether real bytes back this row (a storage key exists). */
  hasFile: boolean;
} & {
  caseId?: string;
  starred?: boolean;
  templateFields?: string[];
};

/**
 * Destructuring is the whitelist — firm_id, mime_type, storage_key,
 * uploaded_by and bookkeeping cannot leak. `updatedAt` collapses to its UTC
 * date part and null optionals vanish, so responses are byte-shape
 * compatible with the mock adapter's documents (plus the additive `hasFile`).
 */
export function toApiDocument(row: DocumentRow): ApiDocument {
  const api: ApiDocument = {
    id: row.id,
    name: row.name,
    folder: row.folder,
    kind: row.kind,
    sizeKb: Math.round(row.sizeBytes / 1024),
    updatedAt: row.updatedAt.toISOString().slice(0, 10),
    hasFile: row.storageKey !== null,
  };
  if (row.caseId !== null) api.caseId = row.caseId;
  if (row.starred !== null) api.starred = row.starred;
  if (row.templateFields !== null) api.templateFields = [...row.templateFields];
  return api;
}

export interface NewDocument {
  firmId: string;
  caseId: string | null;
  name: string;
  folder: string;
  kind: string;
  sizeBytes: number;
  mimeType: string | null;
  storageKey: string | null;
  uploadedBy: string;
  starred: boolean | null;
  templateFields: string[] | null;
}

/**
 * Writable document columns for a live-row update. `storageKey` and
 * `mimeType` are SERVER-MANAGED and absent here on purpose: a patch that
 * could re-point a row's bytes at an arbitrary key would be a cross-tenant
 * object-read hole — bytes are bound at create (from the firm's own
 * sign-upload) and die with the row.
 */
export interface DocumentPatch {
  name?: string;
  folder?: string;
  caseId?: string | null;
  kind?: string;
  sizeBytes?: number;
  starred?: boolean | null;
  templateFields?: string[] | null;
}

export interface DocumentRepository {
  create(input: NewDocument): Promise<DocumentRow>;
  /** Live (non-deleted) document in the given firm; null otherwise. */
  findById(firmId: string, id: string): Promise<DocumentRow | null>;
  /** The firm's live documents, newest first (the mock/reference unshift). */
  listByFirm(firmId: string): Promise<DocumentRow[]>;
  /** Live-row update; null when the row is missing, deleted, or another firm's. */
  update(firmId: string, id: string, patch: DocumentPatch): Promise<DocumentRow | null>;
  /** Soft delete: stamps deleted_at, the row itself stays (ADR-0003 audit). */
  delete(firmId: string, id: string): Promise<boolean>;
}
