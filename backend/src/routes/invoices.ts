import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { InvoicesService } from "../services/invoices/service.js";
import { requireAuth } from "./requestAuth.js";

export type InvoiceRoutesOptions = {
  invoicesService: InvoicesService | null;
};

/**
 * Free-form field schemas: the strings' shape (no format, no trim) matches
 * what the reference backend stores, the vocabulary/length/value/uuid rules
 * live in the service as 400s, and unknown keys are stripped — so
 * whole-entity saves from the UI keep working while the server-managed
 * fields (`number`, `id`, `firmId`, the stamps, and any client-sent
 * total/amountPaid the contract never defined) stay put, and line `amount`s
 * are recomputed server-side no matter what arrives. `issued`/`due` ride
 * along for PATCH (the reference's Object.assign moves them); the create
 * path ignores them (it stamps today / today+30).
 */
const invoiceLineSchema = z.object({
  description: z.string().optional(),
  quantity: z.number().optional(),
  rate: z.number().optional(),
  kind: z.string().optional(),
});

const invoiceSchema = z.object({
  clientId: z.string().nullable().optional(),
  caseId: z.string().nullable().optional(),
  status: z.string().optional(),
  notes: z.string().nullable().optional(),
  issued: z.string().optional(),
  due: z.string().optional(),
  lines: z.array(invoiceLineSchema).optional(),
});

const invoiceIdParams = z.object({ id: z.string().uuid("Invalid invoice id") });

/**
 * Invoices routes (ticket 13, docs/API_CONTRACT.md). Every firm member
 * manages invoices — practice data, no owner gate (unlike /users).
 * Registered inside protectedRoutes, so the session guard's 401/503
 * envelopes apply to the whole surface; a missing/foreign/soft-deleted id is
 * uniformly 404 "Invoice not found".
 */
export async function invoiceRoutes(
  app: FastifyInstance,
  options: InvoiceRoutesOptions,
): Promise<void> {
  // The guard guarantees the service exists whenever a handler runs; the
  // helper narrows the types without assertions (protected.ts pattern).
  const service = () => {
    if (!options.invoicesService) throw new Error("service missing while session guard passed");
    return options.invoicesService;
  };

  app.get("/invoices", async (request) => {
    return service().list(requireAuth(request).firm.id);
  });

  app.get("/invoices/:id", async (request) => {
    const { id } = invoiceIdParams.parse(request.params);
    return service().get(requireAuth(request).firm.id, id);
  });

  app.post("/invoices", async (request, reply) => {
    const input = invoiceSchema.parse(request.body ?? {});
    const invoice = await service().create(requireAuth(request).firm.id, input);
    return reply.status(201).send(invoice);
  });

  app.patch("/invoices/:id", async (request) => {
    const { id } = invoiceIdParams.parse(request.params);
    const patch = invoiceSchema.parse(request.body ?? {});
    return service().update(requireAuth(request).firm.id, id, patch);
  });

  app.delete("/invoices/:id", async (request, reply) => {
    const { id } = invoiceIdParams.parse(request.params);
    await service().delete(requireAuth(request).firm.id, id);
    return reply.status(204).send();
  });
}
