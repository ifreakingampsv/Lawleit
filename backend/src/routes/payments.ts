import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PaymentsService } from "../services/payments/service.js";
import { requireAuth } from "./requestAuth.js";

export type PaymentRoutesOptions = {
  paymentsService: PaymentsService | null;
};

/**
 * Free-form field schema: the strings' shape (no format, no trim) matches
 * what the reference backend stores, the vocabulary/uuid/amount rules live
 * in the service as 400s/404s, and unknown keys are stripped — so a
 * client-sent `id`/`date`/`status`/`firmId` (or any whole-entity extra the
 * contract never defined) cannot reach the service: the server owns the id,
 * stamps `date` with today, and always lands the payment "deposited".
 * `amount` is z.number() so strings/NaN never reach the money math.
 */
const paymentSchema = z.object({
  invoiceId: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  amount: z.number().optional(),
  method: z.string().optional(),
  trustAccount: z.boolean().optional(),
});

/**
 * Payments routes (ticket 14, docs/API_CONTRACT.md). Manual record-only: no
 * gateway, no real money ever moves. Every firm member records payments —
 * practice data, no owner gate (unlike /users). Registered inside
 * protectedRoutes, so the session guard's 401/503 envelopes apply to the
 * whole surface; a missing/foreign/soft-deleted invoiceId is uniformly 404
 * "Invoice not found".
 *
 * Per the contract there is NO PATCH/DELETE /payments/:id — recorded
 * payments are immutable in V1 (the reference defines no edit surface
 * either), so the roll-up needs no delete-path re-run.
 */
export async function paymentRoutes(
  app: FastifyInstance,
  options: PaymentRoutesOptions,
): Promise<void> {
  // The guard guarantees the service exists whenever a handler runs; the
  // helper narrows the types without assertions (protected.ts pattern).
  const service = () => {
    if (!options.paymentsService) throw new Error("service missing while session guard passed");
    return options.paymentsService;
  };

  app.get("/payments", async (request) => {
    return service().list(requireAuth(request).firm.id);
  });

  app.post("/payments", async (request, reply) => {
    const input = paymentSchema.parse(request.body ?? {});
    const payment = await service().record(requireAuth(request).firm.id, input);
    return reply.status(201).send(payment);
  });
}
