import type { FastifyInstance } from "fastify";
import { ReportsService } from "../services/reports/service.js";

export type ReportsRoutesOptions = {
  reportsService: ReportsService | null;
};

/**
 * Reports routes (ticket 20, docs/API_CONTRACT.md) — GET /reports, the
 * predefined report catalog (see services/reports/service.ts for the shape
 * decision: static descriptors, exactly the reference's seedReports — the
 * analytics compute client-side from the live module lists). Registered
 * inside protectedRoutes, so the session guard's 401/503 envelopes apply.
 */
export async function reportsRoutes(
  app: FastifyInstance,
  options: ReportsRoutesOptions,
): Promise<void> {
  const service = () => {
    if (!options.reportsService) throw new Error("service missing while session guard passed");
    return options.reportsService;
  };

  app.get("/reports", async () => {
    return service().list();
  });
}
