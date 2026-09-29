import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DocumentsService } from "../services/documents/service.js";
import { requireAuth } from "./requestAuth.js";

export type DocumentRoutesOptions = {
  documentsService: DocumentsService | null;
};

/**
 * Free-form field schemas: the strings' shape (no format, no trim) matches
 * what the reference backend stores, the value rules live in the service as
 * 400s, and unknown keys are stripped — so whole-entity saves from the UI
 * keep working while the server-managed fields (`id`, `firmId`,
 * `uploadedBy`, `updatedAt`, and the upload bindings `storageKey`/`mimeType`
 * on PATCH) stay put. `sizeBytes`/`storageKey`/`mimeType` on create are the
 * ticket-17 additive fields (they ride the contract's POST per the
 * metadata-POST completion flow); `kind` stays free-form like the reference.
 */
const documentSchema = z.object({
  name: z.string().optional(),
  folder: z.string().optional(),
  caseId: z.string().nullable().optional(),
  kind: z.string().optional(),
  sizeKb: z.number().optional(),
  sizeBytes: z.number().optional(),
  starred: z.boolean().nullable().optional(),
  templateFields: z.array(z.string()).nullable().optional(),
  storageKey: z.string().optional(),
  mimeType: z.string().optional(),
});

const documentPatchSchema = documentSchema.omit({ storageKey: true, mimeType: true });

const signUploadSchema = z.object({
  caseId: z.string().nullable().optional(),
  name: z
    .string("File name is required")
    .trim()
    .min(1, "File name is required")
    .max(255, "File name is too long"),
  contentType: z
    .string("File type is required")
    .min(1, "File type is required")
    .max(100, "File type is too long"),
  sizeBytes: z
    .number("File size is required")
    .int("File size must be a whole number of bytes")
    .min(1, "File size must be a positive number of bytes")
    // Generous transport ceiling; the service enforces the configured cap.
    .max(10 * 1024 * 1024 * 1024),
});

const documentIdParams = z.object({ id: z.string().uuid("Invalid document id") });

/**
 * Documents routes (ticket 17, docs/API_CONTRACT.md). Metadata CRUD is the
 * contract surface 1:1; the upload/download pair is ADDITIVE (ticket 20
 * documents it in the contract). Every firm member manages documents —
 * practice data, no owner gate. Registered inside protectedRoutes, so the
 * session guard's 401/503 envelopes apply to the whole surface; a
 * missing/foreign/soft-deleted id is uniformly 404 "Document not found".
 */
export async function documentRoutes(
  app: FastifyInstance,
  options: DocumentRoutesOptions,
): Promise<void> {
  // The guard guarantees the service exists whenever a handler runs; the
  // helper narrows the types without assertions (protected.ts pattern).
  const service = () => {
    if (!options.documentsService) throw new Error("service missing while session guard passed");
    return options.documentsService;
  };

  app.get("/documents", async (request) => {
    return service().list(requireAuth(request).firm.id);
  });

  // The reference defaults an absent body ({}) into a bare "Untitled.docx".
  app.post("/documents", async (request, reply) => {
    const input = documentSchema.parse(request.body ?? {});
    const auth = requireAuth(request);
    const document = await service().create(auth.firm.id, auth.user.id, input);
    return reply.status(201).send(document);
  });

  app.patch("/documents/:id", async (request) => {
    const { id } = documentIdParams.parse(request.params);
    const patch = documentPatchSchema.parse(request.body ?? {});
    return service().update(requireAuth(request).firm.id, id, patch);
  });

  app.delete("/documents/:id", async (request, reply) => {
    const { id } = documentIdParams.parse(request.params);
    await service().delete(requireAuth(request).firm.id, id);
    return reply.status(204).send();
  });

  // Ticket 17, additive: mint a short-lived signed PUT after validation —
  // the browser uploads the bytes directly to object storage.
  app.post("/documents/sign-upload", async (request, reply) => {
    const input = signUploadSchema.parse(request.body ?? {});
    const signed = await service().signUpload(requireAuth(request).firm.id, input);
    return reply.status(201).send(signed);
  });

  // Ticket 17, additive: a short-lived signed GET after the permission check.
  app.get("/documents/:id/download", async (request) => {
    const { id } = documentIdParams.parse(request.params);
    return service().downloadUrl(requireAuth(request).firm.id, id);
  });
}
