import { defineConfig } from "drizzle-kit";

// npm scripts run from backend/; load .env so drizzle-kit commands see
// DATABASE_URL without extra node flags. A missing file is fine — db:generate
// does not touch the database.
try {
  process.loadEnvFile();
} catch {
  // No .env — commands that need a database will fail on the empty URL below.
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
