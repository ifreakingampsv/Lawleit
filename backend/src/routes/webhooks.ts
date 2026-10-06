import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../services/httpError.js";
import { DB_REQUIRED } from "./requestAuth.js";
import type { GatewayWebhookService } from "../services/gateway/webhooks.js";

export type WebhookRoutesOptions = {
  webhookService: GatewayWebhookService | null;
};

const firmIdParams = z.object({ firmId: z.string().uuid("Invalid firm id") });

/**
 * The Razorpay webhook surface (V2 slice 1, ticket 04) — PUBLIC: Razorpay's
 * servers carry no Lawleit session, so this module mounts OUTSIDE
 * protectedRoutes and authenticates by HMAC instead (the service verifies the
 * X-Razorpay-Signature of the RAW body against the URL-named firm's webhook
 * secret; an unknown firm is 404, a bad signature 400).
 *
 * The raw-body capture lives in an ENCAPSULATED sub-plugin: addContentTypeParser
 * in a scope applies only to this scope's routes, so the rest of the API keeps
 * Fastify's default JSON parsing untouched. The parser stashes the exact bytes
 * the signature must be computed over (re-serializing parsed JSON would not be
 * byte-identical) and still hands the route a parsed body.
 */
export async function webhookRoutes(
  app: FastifyInstance,
  options: WebhookRoutesOptions,
): Promise<void> {
  await app.register(async (scope) => {
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
      (req as unknown as { rawBody?: string }).rawBody = body as string;
      try {
        done(null, JSON.parse(body as string));
      } catch (error) {
        (error as { statusCode?: number }).statusCode = 400;
        done(error as Error, undefined);
      }
    });

    scope.post("/webhooks/razorpay/:firmId", async (request, reply) => {
      if (!options.webhookService) throw new HttpError(503, DB_REQUIRED);
      const { firmId } = firmIdParams.parse(request.params);
      const rawBody =
        (request as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(request.body ?? {});
      const signature = request.headers["x-razorpay-signature"] as string | undefined;
      const eventId = request.headers["x-razorpay-event-id"] as string | undefined;
      const outcome = await options.webhookService.handle(firmId, rawBody, signature, eventId);
      return reply.send(outcome);
    });
  });
}
