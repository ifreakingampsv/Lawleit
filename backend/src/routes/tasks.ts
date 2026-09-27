import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TasksService } from "../services/tasks/service.js";
import { requireAuth } from "./requestAuth.js";

export type TaskRoutesOptions = {
  tasksService: TasksService | null;
};

/**
 * Free-form field schemas: the strings' shape (no format, no trim) matches
 * what the reference backend stores, the vocabulary/shape/length rules live
 * in the service as 400s, and unknown keys are stripped — so whole-entity
 * saves from the UI keep working while the server-managed fields (`id`,
 * `firmId`, `createdAt` and bookkeeping) stay put. The contract has no
 * GET /tasks/:id (the plain list is the read surface). Completion is a
 * plain `PATCH /tasks/:id { status: "done" }` — the contract's Task has no
 * completedAt field.
 */
const taskCreateSchema = z.object({
  title: z.string().optional(),
  dueDate: z.string().optional(),
  priority: z.string().optional(),
  status: z.string().optional(),
  caseId: z.string().nullable().optional(),
  assigneeId: z.string().optional(),
  description: z.string().nullable().optional(),
});

const taskPatchSchema = taskCreateSchema;

const taskIdParams = z.object({ id: z.string().uuid("Invalid task id") });

/**
 * Tasks routes (ticket 11, docs/API_CONTRACT.md). Every firm member manages
 * tasks — practice data, no owner gate (unlike /users). Registered inside
 * protectedRoutes, so the session guard's 401/503 envelopes apply to the
 * whole surface; a missing/foreign/soft-deleted id is uniformly
 * 404 "Task not found".
 */
export async function taskRoutes(
  app: FastifyInstance,
  options: TaskRoutesOptions,
): Promise<void> {
  // The guard guarantees the service exists whenever a handler runs; the
  // helper narrows the types without assertions (protected.ts pattern).
  const service = () => {
    if (!options.tasksService) throw new Error("service missing while session guard passed");
    return options.tasksService;
  };

  app.get("/tasks", async (request) => {
    return service().list(requireAuth(request).firm.id);
  });

  // The reference defaults an absent body ({}) into a bare "New task" due
  // today, assigned to the firm's first user.
  app.post("/tasks", async (request, reply) => {
    const input = taskCreateSchema.parse(request.body ?? {});
    const task = await service().create(requireAuth(request).firm.id, input);
    return reply.status(201).send(task);
  });

  app.patch("/tasks/:id", async (request) => {
    const { id } = taskIdParams.parse(request.params);
    const patch = taskPatchSchema.parse(request.body ?? {});
    return service().update(requireAuth(request).firm.id, id, patch);
  });

  app.delete("/tasks/:id", async (request, reply) => {
    const { id } = taskIdParams.parse(request.params);
    await service().delete(requireAuth(request).firm.id, id);
    return reply.status(204).send();
  });
}
