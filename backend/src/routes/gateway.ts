import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { GatewayAccountService } from "../services/gateway/service.js";
import { requireAuth } from "./requestAuth.js";

export type GatewayRoutesOptions = {
  gatewayAccountService: GatewayAccountService | null;
};

/**
 * Free-form field schema: unknown keys are stripped — whole-object saves from
 * the UI cannot inject server-managed state (there is none on connect), and
 * the field rules live in the service as 400s so the messages stay uniform.
 */
const connectSchema = z.object({
  provider: z.string().optional(),
  keyId: z.string().optional(),
  keySecret: z.string().optional(),
  webhookSecret: z.string().optional(),
});

/**
 * Gateway account routes (V2 slice 1, ticket 02, docs/API_CONTRACT.md):
 * connect/replace/status/disconnect of the firm's own Razorpay account.
 * Connect and disconnect are OWNER-only (the invite-form rule — the service
 * enforces it, 403 for members); the status read is every member's (the
 * settings card renders it). Registered inside protectedRoutes, so the
 * session guard's 401/503 envelopes apply to the whole surface.
 *
 * Secrets are write-only: no response here ever carries keySecret or
 * webhookSecret — the service's status shape is the only body shape.
 * Without GATEWAY_ENCRYPTION_KEY the writes answer 503 with the operator
 * step (the service's call); the status read keeps working so the UI can
 * render the not-connected state.
 */
export async function gatewayRoutes(
  app: FastifyInstance,
  options: GatewayRoutesOptions,
): Promise<void> {
  // The guard guarantees the service exists whenever a handler runs; the
  // helper narrows the types without assertions (protected.ts pattern).
  const service = () => {
    if (!options.gatewayAccountService) {
      throw new Error("service missing while session guard passed");
    }
    return options.gatewayAccountService;
  };

  app.get("/gateway/account", async (request) => {
    return service().status(requireAuth(request).firm.id);
  });

  app.put("/gateway/account", async (request) => {
    const input = connectSchema.parse(request.body ?? {});
    return service().connect(requireAuth(request).user, input);
  });

  app.delete("/gateway/account", async (request, reply) => {
    await service().disconnect(requireAuth(request).user);
    return reply.status(204).send();
  });
}
