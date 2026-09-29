import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthRepositories } from "../services/auth/repository.js";
import type { AuthService } from "../services/auth/service.js";
import type { Mailer } from "../services/auth/mailer.js";
import { FirmService } from "../services/firm/service.js";
import { USER_ROLES, UserService } from "../services/users/service.js";
import { CasesService } from "../services/cases/service.js";
import { caseRoutes } from "./cases.js";
import { ContactsService } from "../services/contacts/service.js";
import { contactRoutes } from "./contacts.js";
import { EventsService } from "../services/events/service.js";
import { eventRoutes } from "./events.js";
import { TasksService } from "../services/tasks/service.js";
import { taskRoutes } from "./tasks.js";
import { TimeEntriesService } from "../services/time/service.js";
import { timeRoutes } from "./time.js";
import { ExpensesService } from "../services/expenses/service.js";
import { expenseRoutes } from "./expenses.js";
import { InvoicesService } from "../services/invoices/service.js";
import { invoiceRoutes } from "./invoices.js";
import { LeadsService } from "../services/leads/service.js";
import { leadRoutes } from "./leads.js";
import { DB_REQUIRED, extractToken, requireAuth } from "./requestAuth.js";

export type ProtectedRoutesOptions = {
  authService: AuthService | null;
  repos: AuthRepositories | null;
  /** Ticket 08: invite emails; defaults to the console stub. */
  mailer?: Mailer;
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

const userCreateSchema = z.object({
  // The string-level message covers a missing/undefined field, the min(1)
  // one a whitespace-only value: both render "Name is required".
  name: z.string("Name is required").trim().min(1, "Name is required").max(200),
  email: z
    .string("A valid email is required")
    .trim()
    .toLowerCase()
    .max(320, "Email is too long")
    .pipe(z.email("A valid email is required")),
  role: z.enum(USER_ROLES, "Role must be owner, attorney, paralegal, or staff"),
  hourlyRate: z.number().int().min(0).max(1_000_000_000).optional(),
  avatarColor: z.string().max(20).optional(),
});

const userPatchSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty").max(200).optional(),
  role: z.enum(USER_ROLES).optional(),
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
  const userService = repos ? new UserService(repos, options.mailer) : null;
  const contactsService = repos ? new ContactsService(repos) : null;
  const casesService = repos ? new CasesService(repos) : null;
  const eventsService = repos ? new EventsService(repos) : null;
  const tasksService = repos ? new TasksService(repos) : null;
  const timeEntriesService = repos ? new TimeEntriesService(repos) : null;
  const expensesService = repos ? new ExpensesService(repos) : null;
  const invoicesService = repos ? new InvoicesService(repos) : null;
  const leadsService = repos ? new LeadsService(repos) : null;

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

  // Ticket 08: invite. Owner-only (403 for members is the service's call);
  // 201 with the created user per the contract's POST convention.
  app.post("/users", async (request, reply) => {
    const input = userCreateSchema.parse(request.body);
    const user = await service(userService).create(requireAuth(request).user, input);
    return reply.status(201).send(user);
  });

  app.patch("/users/:id", async (request, reply) => {
    const patch = userPatchSchema.parse(request.body);
    const { id } = userIdParams.parse(request.params);
    const auth = requireAuth(request);
    return reply.send(await service(userService).update(auth.user, auth.firm.id, id, patch));
  });

  // Ticket 09: the contacts surface (routes/contacts.ts) inherits this
  // plugin's session guard and every member manages it — practice data.
  await app.register(contactRoutes, { contactsService });

  // Ticket 10: the cases surface (routes/cases.ts), same guard, same
  // every-member-manages rule.
  await app.register(caseRoutes, { casesService });

  // Ticket 11: the calendar + tasks surfaces (routes/events.ts,
  // routes/tasks.ts), same guard, same every-member-manages rule.
  await app.register(eventRoutes, { eventsService });
  await app.register(taskRoutes, { tasksService });

  // Ticket 12: the time-entries + expenses surfaces (routes/time.ts,
  // routes/expenses.ts), same guard, same every-member-manages rule.
  await app.register(timeRoutes, { timeEntriesService });
  await app.register(expenseRoutes, { expensesService });

  // Ticket 13: the invoices surface (routes/invoices.ts) — the money chain's
  // head: server-assigned INV-XXXX numbers and server-computed line math —
  // same guard, same every-member-manages rule.
  await app.register(invoiceRoutes, { invoicesService });

  // Ticket 16: the leads surface (routes/leads.ts) — CRUD + the conversion
  // transaction — same guard, same every-member-manages rule.
  await app.register(leadRoutes, { leadsService });
}
