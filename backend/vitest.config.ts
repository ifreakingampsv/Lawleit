import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // argon2id hashing is intentionally expensive (OWASP params); under parallel
    // suite load a single hash can exceed vitest's 5s default and flake.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
