import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LeadsService } from "../services/leads/service.js";
import { requireAuth } from "./requestAuth.js";

export type LeadRoutesOptions = {
  leadsService: LeadsService | null;
};

/**
 * Free-form field schemas: the strings' shape (no format, no trim) matches
 * what the reference backend stores, the vocabulary/length/value rules live
 * in the service as 400s, and unknown keys are stripped — so whole-entity
 * saves from the UI keep working while the server-managed fields (`activity`,
 * the conversion links, `id`, `firmId`, `createdAt`) stay put. The convert
 * schema mirrors the reference's read surface: only `title` and `description`
 * are taken off the case input.
 */
const leadSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  source: z.string().optional(),
  stage: z.string().optional(),
  practiceArea: z.string().optional(),
  value: z.number().optional(),
  notes: z.string().nullable().optional(),
});

const leadConvertSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
});

const leadIdParams = z.object({ id: z.string().uuid("Invalid lead id") });

/**
 * Leads routes (ticket 16, docs/API_CONTRACT.md). Every firm member manages
 * leads — practice data, no owner gate (unlike /users). Registered inside
 * protectedRoutes, so the session guard's 401/503 envelopes apply to the
 * whole surface; a missing/foreign/soft-deleted id is uniformly
 * 404 "Lead not found". The contract has no GET /leads/:id — the pipeline
 * board reads the list — so none is mounted.
 */
export async function leadRoutes(
  app: FastifyInstance,
  options: LeadRoutesOptions,
): Promise<void> {
  // The guard guarantees the service exists whenever a handler runs; the
  // helper narrows the types without assertions (protected.ts pattern).
  const service = () => {
    if (!options.leadsService) throw new Error("service missing while session guard passed");
    return options.leadsService;
  };

  app.get("/leads", async (request) => {
    return service().list(requireAuth(request).firm.id);
  });

  // The reference defaults an absent body ({}) into a bare "New lead".
  app.post("/leads", async (request, reply) => {
    const input = leadSchema.parse(request.body ?? {});
    const lead = await service().create(requireAuth(request).firm.id, input);
    return reply.status(201).send(lead);
  });

  app.patch("/leads/:id", async (request) => {
    const { id } = leadIdParams.parse(request.params);
    const patch = leadSchema.parse(request.body ?? {});
    const auth = requireAuth(request);
    return service().update(auth.firm.id, auth.user.id, id, patch);
  });

  app.delete("/leads/:id", async (request, reply) => {
    const { id } = leadIdParams.parse(request.params);
    await service().delete(requireAuth(request).firm.id, id);
    return reply.status(204).send();
  });

  app.post("/leads/:id/convert", async (request, reply) => {
    const { id } = leadIdParams.parse(request.params);
    const input = leadConvertSchema.parse(request.body ?? {});
    const auth = requireAuth(request);
    const result = await service().convert(auth.firm.id, auth.user.id, id, input);
    return reply.status(201).send(result);
  });
}
