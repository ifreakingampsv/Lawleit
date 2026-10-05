import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Secret-at-rest encryption for the gateway module (ticket 02, ADR-0006):
 * `gateway_accounts.key_secret` and `webhook_secret` are AES-256-GCM
 * ciphertexts, never plaintext, and the API never returns them (write-only).
 *
 * Format: base64(iv ‖ authTag ‖ ciphertext) — a random 12-byte IV per
 * encryption (equal plaintexts never produce equal ciphertexts, asserted by
 * test) and the 16-byte GCM auth tag riding in front of the text so a single
 * string column round-trips without sidecar storage.
 *
 * The AES-256 key is SHA-256 of GATEWAY_ENCRYPTION_KEY (any charset works —
 * length is the entropy floor, enforced by config at ≥ 32 characters).
 * Wrong keys / tampered ciphertexts throw (GCM authentication) — callers
 * treat that as "cannot use this account", never as a message to surface.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;

export function deriveAesKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptSecret(plaintext: string, aesKey: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decryptSecret(payload: string, aesKey: Buffer): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", aesKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
