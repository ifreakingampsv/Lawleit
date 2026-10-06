import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PaymentLinkService } from "../services/gateway/links.js";
import { requireAuth } from "./requestAuth.js";

export type PaymentLinkRoutesOptions = {
  paymentLinkService: PaymentLinkService | null;
};

const invoiceIdParams = z.object({ id: z.string().uuid("Invalid invoice id") });
const linkIdParams = z.object({ id: z.string().uuid("Invalid payment link id") });

/**
 * Collect routes (V2 slice 1, ticket 03, docs/API_CONTRACT.md): create a
 * payment link for one invoice and list an invoice's link history. Every
 * firm member collects — practice data, no owner gate (the owner gate is on
 * connecting the gateway, routes/gateway.ts). Registered inside
 * protectedRoutes, so the session guard's 401/503 envelopes apply; a
 * missing/foreign/soft-deleted invoice is uniformly 404 "Invoice not found".
 * The sync route (ticket 05) joins here. Bodies carry no secrets and no
 * client-writable fields — the server owns the amount (the outstanding
 * total), the provider ids and the status.
 */
export async function paymentLinkRoutes(
  app: FastifyInstance,
  options: PaymentLinkRoutesOptions,
): Promise<void> {
  // The guard guarantees the service exists whenever a handler runs; the
  // helper narrows the types without assertions (protected.ts pattern).
  const service = () => {
    if (!options.paymentLinkService) throw new Error("service missing while session guard passed");
    return options.paymentLinkService;
  };

  app.post("/invoices/:id/payment-link", async (request, reply) => {
    const { id } = invoiceIdParams.parse(request.params);
    const link = await service().create(requireAuth(request).firm.id, id);
    return reply.status(201).send(link);
  });

  app.get("/invoices/:id/payment-links", async (request) => {
    const { id } = invoiceIdParams.parse(request.params);
    return service().list(requireAuth(request).firm.id, id);
  });

  // Ticket 05: the reconciliation self-heal (docs/API_CONTRACT.md) — the
  // server re-fetches the link from the firm's gateway and records the
  // payment if the provider says paid and no webhook got here first.
  app.post("/payment-links/:id/sync", async (request) => {
    const { id } = linkIdParams.parse(request.params);
    return service().sync(requireAuth(request).firm.id, id);
  });
}
