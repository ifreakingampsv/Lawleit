/**
 * StorageService — the thin, swappable object-storage seam (ticket 17,
 * ADR-0002): the documents module depends only on this interface; the S3
 * binding (`s3.ts`) is the production implementation (Supabase Storage's
 * S3-compatible API) and tests bind `in-memory.ts`, which never touches the
 * network. Swapping providers (Supabase → R2 → MinIO) is a config change —
 * every S3-compatible endpoint honors the same three calls.
 *
 * Keys are opaque to callers: the documents service builds them
 * (`firms/<firmId>/…`), the storage implementation only signs and deletes.
 */

/**
 * How long a presigned URL stays usable. Uploads and downloads are
 * short-lived by design (the ticket's threat model: a leaked link expires);
 * 15 minutes comfortably covers a slow browser PUT of the 25 MB cap.
 * Reported to clients as `expiresIn` alongside every signed URL.
 */
export const PRESIGN_TTL_SECONDS = 900;

export interface PresignedUpload {
  /** The URL to PUT the bytes to (short-lived signed URL). */
  url: string;
  /** Always "PUT" — the one verb the flow needs. */
  method: "PUT";
}

export interface StorageService {
  /**
   * A short-lived signed PUT for `key` with the given content type and exact
   * size bound in. The S3 binding signature-pins the byte count (the browser
   * must PUT exactly `size` bytes); the content type is allowlist-validated
   * before this call and the uploading client PUTs with the declared value.
   */
  presignUpload(key: string, contentType: string, size: number): Promise<PresignedUpload>;
  /** A short-lived signed GET for `key`. */
  presignDownload(key: string): Promise<{ url: string }>;
  /**
   * Best-effort delete — the documents flow treats a failed object delete as
   * logged, not fatal (the metadata row is the source of truth).
   */
  deleteObject(key: string): Promise<void>;
}
