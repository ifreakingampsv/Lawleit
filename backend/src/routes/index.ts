import type { FastifyInstance } from "fastify";
import { healthRoutes } from "./health.js";

/**
 * Mount point for every contract route (docs/API_CONTRACT.md). Registered
 * under the /api/v1 prefix; each ticket adds its route module here and its
 * logic under ../services.
 */
export async function apiRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
}
