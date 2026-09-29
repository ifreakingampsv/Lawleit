import type { PresignedUpload, StorageService } from "./service.js";

/**
 * In-memory StorageService for tests — the storage twin of the in-memory
 * repository fakes. Presigns are DETERMINISTIC (no timestamps, no
 * signatures): the same key always yields the same URL, the key and the
 * pinned content type are visible in it, so tests assert on plain string
 * containment. Presigning never touches the object set (a real S3 presign
 * succeeds for nonexistent keys too — the failure would surface at fetch
 * time, outside this seam); deleteObject records what it was asked to
 * remove so the best-effort delete path is observable.
 */
export class InMemoryStorageService implements StorageService {
  /** Objects this fake has presigned an upload for, by key. */
  readonly uploads = new Map<string, { contentType: string; size: number }>();
  /** Keys handed to deleteObject, in order. */
  readonly deleted: string[] = [];

  async presignUpload(key: string, contentType: string, size: number): Promise<PresignedUpload> {
    this.uploads.set(key, { contentType, size });
    return {
      url: `http://storage.test/${key}?X-Lawleit-Upload=${encodeURIComponent(contentType)}`,
      method: "PUT",
    };
  }

  async presignDownload(key: string): Promise<{ url: string }> {
    return { url: `http://storage.test/${key}?X-Lawleit-Download=1` };
  }

  async deleteObject(key: string): Promise<void> {
    this.deleted.push(key);
    this.uploads.delete(key);
  }
}
