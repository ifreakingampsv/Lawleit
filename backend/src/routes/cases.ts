import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CasesService } from "../services/cases/service.js";
import { requireAuth } from "./requestAuth.js";

export type CaseRoutesOptions = {
  casesService: CasesService | null;
};

/**
 * Free-form field schemas: the strings' shape (no format, no trim) matches
 * what the reference backend stores, the vocabulary/length/rate rules live in
 * the service as 400s, and unknown keys are stripped — so whole-entity saves
 * from the UI keep working while the server-managed fields (`number`,
 * `trustBalance`, `id`, `firmId`, `openDate` on create) stay put. `openDate`
 * is patch-only, exactly like the reference (create always stamps today).
 */
const caseCreateSchema = z.object({
  title: z.string().optional(),
  clientId: z.string().nullable().optional(),
  practiceArea: z.string().optional(),
  stage: z.string().optional(),
  status: z.string().optional(),
  courtDate: z.string().nullable().optional(),
  statute: z.string().nullable().optional(),
  leadAttorneyId: z.string().optional(),
  description: z.string().optional(),
  billableRate: z.number().optional(),
});

const casePatchSchema = caseCreateSchema.extend({
  openDate: z.string().optional(),
});

const caseIdParams = z.object({ id: z.string().uuid("Invalid case id") });

const caseListQuery = z.object({
  // No vocabulary check here: the reference filters by exact equality, so an
  // unknown status is an empty list, not an error.
  status: z.string().optional(),
  q: z.string().optional(),
});

/**
 * Cases routes (ticket 10, docs/API_CONTRACT.md). Every firm member manages
 * cases — practice data, no owner gate (unlike /users). Registered inside
 * protectedRoutes, so the session guard's 401/503 envelopes apply to the
 * whole surface; a missing/foreign/soft-deleted id is uniformly
 * 404 "Case not found".
 */
export async function caseRoutes(
  app: FastifyInstance,
  options: CaseRoutesOptions,
): Promise<void> {
  // The guard guarantees the service exists whenever a handler runs; the
  // helper narrows the types without assertions (protected.ts pattern).
  const service = () => {
    if (!options.casesService) throw new Error("service missing while session guard passed");
    return options.casesService;
  };

  app.get("/cases", async (request) => {
    const query = caseListQuery.parse(request.query ?? {});
    return service().list(requireAuth(request).firm.id, query);
  });

  // The reference defaults an absent body ({}) into a bare "New matter" with
  // a server-assigned number.
  app.post("/cases", async (request, reply) => {
    const input = caseCreateSchema.parse(request.body ?? {});
    const kase = await service().create(requireAuth(request).firm.id, input);
    return reply.status(201).send(kase);
  });

  app.get("/cases/:id", async (request) => {
    const { id } = caseIdParams.parse(request.params);
    return service().get(requireAuth(request).firm.id, id);
  });

  app.patch("/cases/:id", async (request) => {
    const { id } = caseIdParams.parse(request.params);
    const patch = casePatchSchema.parse(request.body ?? {});
    return service().update(requireAuth(request).firm.id, id, patch);
  });

  app.delete("/cases/:id", async (request, reply) => {
    const { id } = caseIdParams.parse(request.params);
    await service().delete(requireAuth(request).firm.id, id);
    return reply.status(204).send();
  });
}
