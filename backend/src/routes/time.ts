import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TimeEntriesService } from "../services/time/service.js";
import { requireAuth } from "./requestAuth.js";

export type TimeRoutesOptions = {
  timeEntriesService: TimeEntriesService | null;
};

/**
 * Free-form field schemas: the numbers/strings' shape (no format, no trim)
 * matches what the reference backend stores, the shape/range/length rules
 * live in the service as 400s, and unknown keys are stripped — so
 * whole-entity saves from the UI keep working while the server-managed
 * fields (`id`, `firmId`, `invoiced` — the invoice flow's seam — and
 * bookkeeping) stay put. The contract has no GET /time-entries/:id (the
 * plain list is the read surface), and no timer route: stopping the UI's
 * run-timer IS one POST with the elapsed minutes (AppShell.toggleTimer).
 */
const timeEntryCreateSchema = z.object({
  caseId: z.string().nullable().optional(),
  userId: z.string().optional(),
  date: z.string().optional(),
  minutes: z.number().optional(),
  rate: z.number().optional(),
  description: z.string().optional(),
  billable: z.boolean().optional(),
});

const timeEntryPatchSchema = timeEntryCreateSchema;

const timeEntryIdParams = z.object({ id: z.string().uuid("Invalid time entry id") });

/**
 * Time-entries routes (ticket 12, docs/API_CONTRACT.md). Every firm member
 * logs time — practice data, no owner gate (unlike /users). Registered
 * inside protectedRoutes, so the session guard's 401/503 envelopes apply to
 * the whole surface; a missing/foreign/soft-deleted id is uniformly
 * 404 "Time entry not found".
 */
export async function timeRoutes(
  app: FastifyInstance,
  options: TimeRoutesOptions,
): Promise<void> {
  // The guard guarantees the service exists whenever a handler runs; the
  // helper narrows the types without assertions (protected.ts pattern).
  const service = () => {
    if (!options.timeEntriesService) throw new Error("service missing while session guard passed");
    return options.timeEntriesService;
  };

  app.get("/time-entries", async (request) => {
    return service().list(requireAuth(request).firm.id);
  });

  // The reference defaults an absent body ({}) into a zero-minute entry on
  // today's date for the firm's first user and newest case.
  app.post("/time-entries", async (request, reply) => {
    const input = timeEntryCreateSchema.parse(request.body ?? {});
    const entry = await service().create(requireAuth(request).firm.id, input);
    return reply.status(201).send(entry);
  });

  app.patch("/time-entries/:id", async (request) => {
    const { id } = timeEntryIdParams.parse(request.params);
    const patch = timeEntryPatchSchema.parse(request.body ?? {});
    return service().update(requireAuth(request).firm.id, id, patch);
  });

  app.delete("/time-entries/:id", async (request, reply) => {
    const { id } = timeEntryIdParams.parse(request.params);
    await service().delete(requireAuth(request).firm.id, id);
    return reply.status(204).send();
  });
}
