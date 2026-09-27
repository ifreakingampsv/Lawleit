import type { FastifyInstance } from "fastify";
import type { DbHandle } from "../db/client.js";
import { healthRoutes } from "./health.js";

export type ApiRoutesOptions = { db?: DbHandle | null };

/**
 * Mount point for every contract route (docs/API_CONTRACT.md). Registered
 * under the /api/v1 prefix; each ticket adds its route module here and its
 * logic under ../services.
 */
export async function apiRoutes(
  app: FastifyInstance,
  options: ApiRoutesOptions = {},
): Promise<void> {
  await app.register(healthRoutes, { db: options.db ?? null });
}
