import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageConfig } from "../../config.js";
import { PRESIGN_TTL_SECONDS } from "./service.js";
import type { PresignedUpload, StorageService } from "./service.js";

/**
 * The production StorageService binding (ticket 17): any S3-compatible
 * endpoint, pointed at Supabase Storage's S3 layer per ADR-0002
 * (https://<project-ref>.supabase.co/storage/v1/s3). Path-style addressing
 * is required there (the bucket lives in the URL path, not the host).
 *
 * The presigner signs Content-Length, so the browser must PUT exactly the
 * declared byte count — a real backstop behind the sign-upload size cap. The
 * content type is enforced at sign time (the allowlist runs before any URL
 * exists) and the adapter PUTs with the type it declared; the signature
 * itself pins only length + host (the SDK's presign default).
 */
export class S3StorageService implements StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async presignUpload(key: string, contentType: string, size: number): Promise<PresignedUpload> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: size,
      }),
      { expiresIn: PRESIGN_TTL_SECONDS },
    );
    return { url, method: "PUT" };
  }

  async presignDownload(key: string): Promise<{ url: string }> {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: PRESIGN_TTL_SECONDS },
    );
    return { url };
  }

  /** Best-effort per the interface contract — callers decide whether a
   * failure is fatal; this only performs the request. */
  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/** Production binding factory — the only place the S3 SDK is constructed. */
export function createS3Storage(config: StorageConfig): StorageService {
  return new S3StorageService(config);
}
