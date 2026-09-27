import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ExpensesService } from "../services/expenses/service.js";
import { requireAuth } from "./requestAuth.js";

export type ExpenseRoutesOptions = {
  expensesService: ExpensesService | null;
};

/**
 * Free-form field schemas: the numbers/strings' shape (no format, no trim)
 * matches what the reference backend stores, the vocabulary/shape/range/
 * length rules live in the service as 400s, and unknown keys are stripped —
 * so whole-entity saves from the UI keep working while the server-managed
 * fields (`id`, `firmId`, `invoiced` — the invoice flow's seam — and
 * bookkeeping) stay put. The contract has no GET /expenses/:id (the plain
 * list is the read surface).
 */
const expenseCreateSchema = z.object({
  caseId: z.string().nullable().optional(),
  date: z.string().optional(),
  description: z.string().optional(),
  amount: z.number().optional(),
  billable: z.boolean().optional(),
  category: z.string().optional(),
});

const expensePatchSchema = expenseCreateSchema;

const expenseIdParams = z.object({ id: z.string().uuid("Invalid expense id") });

/**
 * Expenses routes (ticket 12, docs/API_CONTRACT.md). Every firm member
 * manages expenses — practice data, no owner gate (unlike /users).
 * Registered inside protectedRoutes, so the session guard's 401/503
 * envelopes apply to the whole surface; a missing/foreign/soft-deleted id is
 * uniformly 404 "Expense not found".
 */
export async function expenseRoutes(
  app: FastifyInstance,
  options: ExpenseRoutesOptions,
): Promise<void> {
  // The guard guarantees the service exists whenever a handler runs; the
  // helper narrows the types without assertions (protected.ts pattern).
  const service = () => {
    if (!options.expensesService) throw new Error("service missing while session guard passed");
    return options.expensesService;
  };

  app.get("/expenses", async (request) => {
    return service().list(requireAuth(request).firm.id);
  });

  // The reference defaults an absent body ({}) into a ₹0 "other" expense on
  // today's date against the firm's newest case.
  app.post("/expenses", async (request, reply) => {
    const input = expenseCreateSchema.parse(request.body ?? {});
    const expense = await service().create(requireAuth(request).firm.id, input);
    return reply.status(201).send(expense);
  });

  app.patch("/expenses/:id", async (request) => {
    const { id } = expenseIdParams.parse(request.params);
    const patch = expensePatchSchema.parse(request.body ?? {});
    return service().update(requireAuth(request).firm.id, id, patch);
  });

  app.delete("/expenses/:id", async (request, reply) => {
    const { id } = expenseIdParams.parse(request.params);
    await service().delete(requireAuth(request).firm.id, id);
    return reply.status(204).send();
  });
}
