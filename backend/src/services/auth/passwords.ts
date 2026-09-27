import { randomBytes } from "node:crypto";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";

/**
 * Argon2id password hashing (@node-rs/argon2 — prebuilt native binaries, no
 * node-gyp on the build box). Parameters follow the OWASP password-storage
 * recommendation (19 MiB, t=2, p=1); one hash/verify costs tens of
 * milliseconds, which is the intended cost.
 */
const ARGON2_PARAMS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2_PARAMS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify(passwordHash, password);
  } catch {
    // A malformed stored hash must read as "wrong password", never crash login.
    return false;
  }
}

/**
 * A fixed hash of an unguessable value. Login verifies against it when the
 * email is unknown so the response time cannot reveal whether an account
 * exists (the empty-password contract case is handled before hashing).
 */
export const DUMMY_PASSWORD_HASH = await hashPassword(
  `lawleit-dummy-${randomBytes(16).toString("hex")}`,
);
