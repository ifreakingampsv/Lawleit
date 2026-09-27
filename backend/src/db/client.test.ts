import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeDb,
  createDb,
  databaseUrlFromEnv,
  DbNotConfiguredError,
  getDb,
  migrationsFolder,
  requireDb,
} from "./client.js";

afterEach(async () => {
  await closeDb();
});

describe("db client without DATABASE_URL", () => {
  it("treats unset and blank DATABASE_URL as unconfigured", () => {
    expect(databaseUrlFromEnv({})).toBeNull();
    expect(databaseUrlFromEnv({ DATABASE_URL: "   " })).toBeNull();
  });

  it("requireDb throws an owner-actionable error", () => {
    expect(() => requireDb({})).toThrow(DbNotConfiguredError);
    expect(() => requireDb({})).toThrow(/DATABASE_URL.*\.env/s);
    expect(() => requireDb({ DATABASE_URL: "" })).toThrow(DbNotConfiguredError);
  });

  it("createDb rejects non-postgres URLs before any connection is attempted", () => {
    expect(() => createDb("mysql://user:pass@localhost:3306/db")).toThrow(/postgres/i);
    expect(() => createDb("https://example.com/db")).toThrow(/postgres/i);
    expect(() => createDb("not a url")).toThrow(/DATABASE_URL/);
  });

  it("getDb memoizes one pool per URL", () => {
    const url = "postgresql://user:pass@127.0.0.1:5432/lawleit";
    const first = getDb(url);
    expect(getDb(url)).toBe(first);
  });
});

// Real-database tests: run when DATABASE_URL is exported (e.g. the owner's
// Supabase project), skip silently otherwise.
describe.skipIf(!process.env.DATABASE_URL)("db client with DATABASE_URL set", () => {
  it("ping completes a SELECT 1", async () => {
    const handle = requireDb();
    await expect(handle.ping()).resolves.toBeUndefined();
  });

  it("migrate applies the drizzle journal cleanly", async () => {
    const handle = requireDb();
    await migrate(handle.db, { migrationsFolder });
    await expect(handle.ping()).resolves.toBeUndefined();
  });
});
