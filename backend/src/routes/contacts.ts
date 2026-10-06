import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ContactsService } from "../services/contacts/service.js";
import { requireAuth } from "./requestAuth.js";

export type ContactRoutesOptions = {
  contactsService: ContactsService | null;
};

/**
 * Free-form field schemas: the strings' shape (no format, no trim) matches
 * what the reference backend stores, the length/format rules live in the
 * service as 400s, and unknown keys (id, firmId, createdAt, …) are stripped —
 * so whole-entity saves from the UI keep working while server-managed fields
 * stay put. `company` is patch-only, exactly like the reference's create.
 */
const contactCreateSchema = z.object({
  type: z.string().optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  caseIds: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
});

const contactPatchSchema = contactCreateSchema.extend({
  company: z.string().nullable().optional(),
});

const contactIdParams = z.object({ id: z.string().uuid("Invalid contact id") });

/**
 * Contacts routes (ticket 09, docs/API_CONTRACT.md). Every firm member
 * manages contacts — practice data, no owner gate (unlike /users). Registered
 * inside protectedRoutes, so the session guard's 401/503 envelopes apply to
 * the whole surface; a missing/foreign/soft-deleted id is uniformly
 * 404 "Contact not found".
 */
export async function contactRoutes(
  app: FastifyInstance,
  options: ContactRoutesOptions,
): Promise<void> {
  // The guard guarantees the service exists whenever a handler runs; the
  // helper narrows the types without assertions (protected.ts pattern).
  const service = () => {
    if (!options.contactsService) throw new Error("service missing while session guard passed");
    return options.contactsService;
  };

  app.get("/contacts", async (request) => {
    return service().list(requireAuth(request).firm.id);
  });

  // V2 ticket 10: the conflict screen (docs/API_CONTRACT.md) — read-only,
  // non-blocking; find-my-way gives the static segment priority over
  // /contacts/:id regardless of registration order.
  app.get("/contacts/conflict-check", async (request) => {
    const { name } = z
      .object({ name: z.string().min(1, "Name is required") })
      .parse(request.query ?? {});
    return service().conflictCheck(requireAuth(request).firm.id, name);
  });

  // The reference defaults an absent body ({}) into a bare "New contact".
  app.post("/contacts", async (request, reply) => {
    const input = contactCreateSchema.parse(request.body ?? {});
    const contact = await service().create(requireAuth(request).firm.id, input);
    return reply.status(201).send(contact);
  });

  app.get("/contacts/:id", async (request) => {
    const { id } = contactIdParams.parse(request.params);
    return service().get(requireAuth(request).firm.id, id);
  });

  app.patch("/contacts/:id", async (request) => {
    const { id } = contactIdParams.parse(request.params);
    const patch = contactPatchSchema.parse(request.body ?? {});
    return service().update(requireAuth(request).firm.id, id, patch);
  });

  app.delete("/contacts/:id", async (request, reply) => {
    const { id } = contactIdParams.parse(request.params);
    await service().delete(requireAuth(request).firm.id, id);
    return reply.status(204).send();
  });
}
