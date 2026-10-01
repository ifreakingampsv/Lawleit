import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CommsService } from "../services/comms/service.js";
import { requireAuth } from "./requestAuth.js";

export type CommsRoutesOptions = {
  commsService: CommsService | null;
};

/**
 * Free-form field schemas: the strings' shape (no format, no trim) matches
 * what the reference backend stores, the length/vocabulary rules live in the
 * service as 400s, and unknown keys (id, firmId, unread, createdAt, …) are
 * stripped — so whole-entity saves from the UI keep working while
 * server-managed fields stay put (`unread` is created false and moved only
 * by the read-marking route). `messages` is the reference's create-time
 * import surface; the UI composes with an empty array.
 */
const threadCreateSchema = z.object({
  subject: z.string().optional(),
  clientId: z.string().nullable().optional(),
  caseId: z.string().nullable().optional(),
  channel: z.string().optional(),
  messages: z
    .array(
      z.object({
        from: z.string().optional(),
        authorName: z.string().optional(),
        body: z.string().optional(),
        at: z.string().optional(),
      }),
    )
    .optional(),
});

const threadMessageSchema = z.object({
  // The contract's sendMessage(threadId, { body }) — an absent body is the
  // reference's `ctx.body?.body ?? ""` (an empty entry still appends).
  body: z.string().optional(),
});

const threadIdParams = z.object({ id: z.string().uuid("Invalid thread id") });

/**
 * Communications routes (ticket 20, docs/API_CONTRACT.md) — the threads/
 * messages surface plus the notification bell. Every firm member manages
 * them (practice data — no owner gate, unlike /users; the contract and the
 * reference gate nothing). Registered inside protectedRoutes, so the session
 * guard's 401/503 envelopes apply to the whole surface; a missing/foreign/
 * deleted thread is uniformly 404 "Thread not found". Status codes are the
 * contract's: 201 on create, 200 (the whole thread) on append, 204 on both
 * read-marking routes.
 */
export async function commsRoutes(
  app: FastifyInstance,
  options: CommsRoutesOptions,
): Promise<void> {
  // The guard guarantees the service exists whenever a handler runs; the
  // helper narrows the types without assertions (protected.ts pattern).
  const service = () => {
    if (!options.commsService) throw new Error("service missing while session guard passed");
    return options.commsService;
  };

  app.get("/threads", async (request) => {
    return service().list(requireAuth(request).firm.id);
  });

  app.post("/threads", async (request, reply) => {
    const input = threadCreateSchema.parse(request.body ?? {});
    const thread = await service().create(requireAuth(request).firm.id, input);
    return reply.status(201).send(thread);
  });

  app.post("/threads/:id/messages", async (request) => {
    const { id } = threadIdParams.parse(request.params);
    const { body } = threadMessageSchema.parse(request.body ?? {});
    const auth = requireAuth(request);
    // The author is the session user (the reference's ctx.session.user.name).
    return service().sendMessage(auth.firm.id, auth.user.name, id, body ?? "");
  });

  app.post("/threads/:id/read", async (request, reply) => {
    const { id } = threadIdParams.parse(request.params);
    await service().markRead(requireAuth(request).firm.id, id);
    return reply.status(204).send();
  });

  app.get("/notifications", async (request) => {
    return service().listNotifications(requireAuth(request).firm.id);
  });

  app.post("/notifications/read", async (request, reply) => {
    await service().markNotificationsRead(requireAuth(request).firm.id);
    return reply.status(204).send();
  });
}
