import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { EventsService } from "../services/events/service.js";
import { requireAuth } from "./requestAuth.js";

export type EventRoutesOptions = {
  eventsService: EventsService | null;
};

/**
 * Free-form field schemas: the strings' shape (no format, no trim) matches
 * what the reference backend stores, the vocabulary/shape/length rules live
 * in the service as 400s, and unknown keys are stripped — so whole-entity
 * saves from the UI keep working while the server-managed fields (`id`,
 * `firmId`, `source` — the V2 cause-list seam — and bookkeeping) stay put.
 * The contract has no GET /events/:id (list-by-range is the read surface).
 */
const eventCreateSchema = z.object({
  title: z.string().optional(),
  date: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  allDay: z.boolean().nullable().optional(),
  location: z.string().nullable().optional(),
  caseId: z.string().nullable().optional(),
  attendeeIds: z.array(z.string()).optional(),
  type: z.string().optional(),
  color: z.string().optional(),
  reminders: z.array(z.string()).nullable().optional(),
});

const eventPatchSchema = eventCreateSchema;

const eventIdParams = z.object({ id: z.string().uuid("Invalid event id") });

const eventListQuery = z.object({
  // ISO-day shape is the service's 400; here they are just optional strings.
  from: z.string().optional(),
  to: z.string().optional(),
});

/**
 * Events routes (ticket 11, docs/API_CONTRACT.md). Every firm member manages
 * the calendar — practice data, no owner gate (unlike /users). Registered
 * inside protectedRoutes, so the session guard's 401/503 envelopes apply to
 * the whole surface; a missing/foreign/soft-deleted id is uniformly
 * 404 "Event not found".
 */
export async function eventRoutes(
  app: FastifyInstance,
  options: EventRoutesOptions,
): Promise<void> {
  // The guard guarantees the service exists whenever a handler runs; the
  // helper narrows the types without assertions (protected.ts pattern).
  const service = () => {
    if (!options.eventsService) throw new Error("service missing while session guard passed");
    return options.eventsService;
  };

  app.get("/events", async (request) => {
    const query = eventListQuery.parse(request.query ?? {});
    return service().list(requireAuth(request).firm.id, query);
  });

  // The reference defaults an absent body ({}) into a bare "New event" today
  // 09:00–10:00.
  app.post("/events", async (request, reply) => {
    const input = eventCreateSchema.parse(request.body ?? {});
    const event = await service().create(requireAuth(request).firm.id, input);
    return reply.status(201).send(event);
  });

  app.patch("/events/:id", async (request) => {
    const { id } = eventIdParams.parse(request.params);
    const patch = eventPatchSchema.parse(request.body ?? {});
    return service().update(requireAuth(request).firm.id, id, patch);
  });

  app.delete("/events/:id", async (request, reply) => {
    const { id } = eventIdParams.parse(request.params);
    await service().delete(requireAuth(request).firm.id, id);
    return reply.status(204).send();
  });
}
