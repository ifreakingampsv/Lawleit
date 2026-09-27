import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthRepositories } from "../services/auth/repository.js";
import type { AuthService } from "../services/auth/service.js";
import { FirmService } from "../services/firm/service.js";
import { UserService } from "../services/users/service.js";
import { DB_REQUIRED, extractToken, requireAuth } from "./requestAuth.js";

export type ProtectedRoutesOptions = {
  authService: AuthService | null;
  repos: AuthRepositories | null;
};

// zod strips unknown keys, so whole-entity saves from the UI (which send id
// and trialEndsAt along) keep working while server-managed fields stay put.
const firmPatchSchema = z.object({
  name: z.string().trim().min(1, "Firm name cannot be empty").max(200).optional(),
  practiceAreas: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().max(320).optional(),
  address: z.string().max(500).optional(),
  plan: z.enum(["basic", "pro", "advanced"]).optional(),
});

const userPatchSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty").max(200).optional(),
  role: z.enum(["owner", "attorney", "paralegal", "staff"]).optional(),
  avatarColor: z.string().max(20).optional(),
  hourlyRate: z.number().int().min(0).max(1_000_000_000).optional(),
  active: z.boolean().optional(),
});

const userIdParams = z.object({ id: z.string().uuid("Invalid user id") });

/**
 * Everything beyond the auth surface lives behind the session guard: every
 * request must present a live session (bearer or cookie) or answer
 * 401 "Not signed in"; expired, revoked, and unknown tokens are all 401.
 * New route modules register inside this plugin and inherit the guard.
 */
export async function protectedRoutes(
  app: FastifyInstance,
  options: ProtectedRoutesOptions,
): Promise<void> {
  const { authService, repos } = options;

  app.addHook("preHandler", async (request, reply) => {
    if (!authService) return reply.status(503).send({ error: DB_REQUIRED });
    const auth = await authService.authenticate(extractToken(request));
    if (!auth) return reply.status(401).send({ error: "Not signed in" });
    request.auth = auth;
  });

  const firmService = repos ? new FirmService(repos) : null;
  const userService = repos ? new UserService(repos) : null;

  // The guard guarantees services exist whenever a handler runs; the helper
  // narrows the types without assertions.
  const service = <T>(value: T | null): T => {
    if (!value) throw new Error("service missing while session guard passed");
    return value;
  };

  app.patch("/firm", async (request, reply) => {
    const patch = firmPatchSchema.parse(request.body);
    return reply.send(await service(firmService).update(requireAuth(request).firm.id, patch));
  });

  app.get("/users", async (request, reply) => {
    return reply.send(await service(userService).listByFirm(requireAuth(request).firm.id));
  });

  app.patch("/users/:id", async (request, reply) => {
    const patch = userPatchSchema.parse(request.body);
    const { id } = userIdParams.parse(request.params);
    return reply.send(
      await service(userService).update(requireAuth(request).firm.id, id, patch),
    );
  });
}
