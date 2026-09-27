import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/**
 * Session and reset-token primitives (ADR-0005). Tokens are opaque random
 * values generated server-side — nothing about them is signed or decodable.
 */
const SESSION_TOKEN_BYTES = 32;

/** 256 bits of entropy, base64url — cookie- and header-safe (43 chars). */
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

/**
 * Reset tokens follow the same scheme; only their SHA-256 digest is stored,
 * so looking a presented token up by hash is the timing-safe comparison —
 * no secret-dependent branch on attacker-controlled input survives.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time equality for two same-length hex digests. */
export function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
