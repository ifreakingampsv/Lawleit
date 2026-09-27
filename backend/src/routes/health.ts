import type { FastifyInstance } from "fastify";
import type { DbHandle } from "../db/client.js";

export const SERVICE_NAME = "lawleit-api";

export type HealthRoutesOptions = { db?: DbHandle | null };

/** Health of the database as reported by GET /health. */
export type DbHealth = "ok" | "unconfigured" | "unreachable";

export async function healthRoutes(
  app: FastifyInstance,
  options: HealthRoutesOptions = {},
): Promise<void> {
  const { db = null } = options;

  app.get("/health", async () => {
    let database: DbHealth = "unconfigured";
    if (db) {
      try {
        await db.ping();
        database = "ok";
      } catch {
        // A down database must not take the health endpoint (or the process) down.
        database = "unreachable";
      }
    }
    return {
      ok: true,
      service: SERVICE_NAME,
      db: database,
      now: new Date().toISOString(),
    };
  });
}
