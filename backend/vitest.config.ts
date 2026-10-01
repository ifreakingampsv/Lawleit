import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Vitest doesn't read .env itself; load it (if present) so the skipIf(!DATABASE_URL)
// DB-backed suites run when a database is configured.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  test: {
    // argon2id hashing is intentionally expensive (OWASP params); under parallel
    // suite load a single hash can exceed vitest's 5s default and flake.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // The DB-backed suites share ONE real database and each truncates its tables
    // in beforeEach — parallel files would destroy each other's data. Serialize.
    fileParallelism: false,
  },
});
