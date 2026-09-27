import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./passwords.js";

describe("password hashing", () => {
  it("produces an argon2id hash with the configured OWASP parameters", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("s3cret-value");
    await expect(verifyPassword(hash, "s3cret-value")).resolves.toBe(true);
    await expect(verifyPassword(hash, "s3cret-wrong")).resolves.toBe(false);
  });

  it("salts: identical passwords hash differently", async () => {
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(a).not.toBe(b);
  });

  it("reads a malformed stored hash as a failed verify, not a crash", async () => {
    await expect(verifyPassword("$argon2id$garbage", "x")).resolves.toBe(false);
  });
});
