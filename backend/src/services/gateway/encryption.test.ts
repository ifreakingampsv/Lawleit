import { describe, expect, it } from "vitest";
import { decryptSecret, deriveAesKey, encryptSecret } from "./encryption.js";

/**
 * Secret-at-rest encryption (ticket 02): round trips, per-encryption randomness
 * (the random IV — equal plaintexts never encrypt alike), key sensitivity, and
 * tamper rejection (GCM authentication). No plaintext ever survives in a
 * ciphertext string — the round trip below asserts the exact plaintext comes
 * back only through decryptSecret with the derived key.
 */
describe("gateway secret encryption", () => {
  const key = deriveAesKey("operator-key-with-at-least-32-chars");
  const secret = "rzp_test_Th1sIsAFakeKeySecret123456";

  it("round trips a secret through the derived key", () => {
    const payload = encryptSecret(secret, key);
    expect(payload).not.toContain(secret);
    expect(decryptSecret(payload, key)).toBe(secret);
  });

  it("never repeats a ciphertext for equal plaintexts (random IV)", () => {
    const a = encryptSecret(secret, key);
    const b = encryptSecret(secret, key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe(decryptSecret(b, key));
  });

  it("rejects a different key (GCM authentication) — a wrong GATEWAY_ENCRYPTION_KEY cannot read secrets", () => {
    const payload = encryptSecret(secret, key);
    const other = deriveAesKey("another-operator-key-at-least-32-chars!");
    expect(() => decryptSecret(payload, other)).toThrow();
  });

  it("rejects tampered ciphertext", () => {
    const payload = Buffer.from(encryptSecret(secret, key), "base64");
    payload[payload.length - 1] = payload[payload.length - 1]! ^ 0x01;
    expect(() => decryptSecret(payload.toString("base64"), key)).toThrow();
  });});
