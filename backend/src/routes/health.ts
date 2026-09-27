import type { FastifyInstance } from "fastify";

export const SERVICE_NAME = "lawleit-api";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({
    ok: true,
    service: SERVICE_NAME,
    now: new Date().toISOString(),
  }));
}
