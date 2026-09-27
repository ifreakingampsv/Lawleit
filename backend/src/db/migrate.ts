import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, DbNotConfiguredError, migrationsFolder, requireDb } from "./client.js";

// npm scripts run from backend/, but load .env here as well so the script
// works from any cwd; a missing file is fine when DATABASE_URL is already in
// the environment.
try {
  process.loadEnvFile();
} catch {
  // No .env — requireDb() below reports the missing DATABASE_URL clearly.
}

try {
  const handle = requireDb();
  try {
    await migrate(handle.db, { migrationsFolder });
    console.log(`[lawleit-db] migrations applied from ${migrationsFolder}`);
  } finally {
    await closeDb();
  }
} catch (error) {
  if (error instanceof DbNotConfiguredError) {
    console.error(`[lawleit-db] ${error.message}`);
  } else {
    console.error(`[lawleit-db] migration failed: ${error instanceof Error ? error.message : error}`);
  }
  process.exitCode = 1;
}
