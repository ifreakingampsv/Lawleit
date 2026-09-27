import { describe, expect, it } from "vitest";
import { digestsMatch, generateSessionToken, hashToken } from "./tokens.js";

describe("generateSessionToken", () => {
  it("encodes 32 bytes of entropy as base64url", () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("does not repeat (sampled)", () => {
    const seen = new Set(Array.from({ length: 1_000 }, generateSessionToken));
    expect(seen.size).toBe(1_000);
  });
});

describe("hashToken", () => {
  it("is deterministic and input-sensitive", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("digestsMatch", () => {
  it("compares equal digests, rejects unequal ones", () => {
    expect(digestsMatch(hashToken("x"), hashToken("x"))).toBe(true);
    expect(digestsMatch(hashToken("x"), hashToken("y"))).toBe(false);
  });

  it("rejects mismatched lengths without throwing", () => {
    expect(digestsMatch("aa", "aaaa")).toBe(false);
  });
});
