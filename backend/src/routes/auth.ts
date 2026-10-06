import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../services/auth/service.js";
import type { SampleDataService } from "../services/sample/service.js";
import { clearSessionCookie, sessionCookie, type CookieAttrs } from "./sessionCookie.js";
import { DB_REQUIRED, extractToken } from "./requestAuth.js";

export type AuthRoutesOptions = {
  authService: AuthService | null;
  cookie: CookieAttrs;
  /** V2 ticket 09: seeds the labeled sample workspace after signup (best-
   * effort — a seed failure never fails the signup; the mock/demo has none). */
  sampleService?: SampleDataService | null;
};

/** The contract's signup payload (app signup form: no password field). */
const signupSchema = z.object({
  firstName: z.string().max(100).default(""),
  lastName: z.string().max(100).default(""),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(320, "Email is too long")
    .pipe(z.email("A valid email is required")),
  firmName: z.string().trim().min(1, "Firm name is required").max(200),
  zip: z.string().max(20).default(""),
  employees: z.coerce.number().int().min(0).max(10_000).optional(),
  phone: z.string().max(40).default(""),
});

const resetRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(320)
    .pipe(z.email("A valid email is required")),
});

const resetConsumeSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

/**
 * Public auth surface (docs/API_CONTRACT.md) plus the password-reset flow
 * (ticket 07; delivery is the ticket-18 mailer). Without a database every
 * route answers the 503 envelope instead of crashing.
 */
export async function authRoutes(app: FastifyInstance, options: AuthRoutesOptions): Promise<void> {
  const { authService, cookie } = options;

  app.post("/auth/signup", async (request, reply) => {
    if (!authService) return reply.status(503).send({ error: DB_REQUIRED });
    const input = signupSchema.parse(request.body);
    const result = await authService.register(input);
    // V2 ticket 09: the labeled sample workspace, best-effort (the signup's
    // own transaction already committed; a seed failure logs and moves on).
    if (options.sampleService) {
      const seeded = await options.sampleService
        .seedIfNewFirm(result.firm.id)
        .catch((error: unknown) => {
          request.log.error(error, "sample seeding failed");
          return false;
        });
      if (seeded) {
        // The 201 must report the flag the seed just set (register built its
        // SessionView before the seed ran).
        result.firm = (await options.sampleService.refreshedFirm(result.firm.id)) ?? result.firm;
      } else {
        request.log.info(`firm ${result.firm.id}: sample seeding skipped`);
      }
    }
    reply.header("set-cookie", sessionCookie(result.token, cookie));
    return reply.status(201).send(result);
  });

  // Presence of email/password is answered 401 (not zod's 400) to match the
  // reference backend's canonical "Email and password required" message.
  app.post("/auth/login", async (request, reply) => {
    if (!authService) return reply.status(503).send({ error: DB_REQUIRED });
    const body = (request.body ?? {}) as Record<string, unknown>;
    const result = await authService.login(body.email, body.password);
    reply.header("set-cookie", sessionCookie(result.token, cookie));
    return reply.send(result);
  });

  app.post("/auth/logout", async (request, reply) => {
    if (!authService) return reply.status(503).send({ error: DB_REQUIRED });
    const auth = await authService.authenticate(extractToken(request));
    if (!auth) return reply.status(401).send({ error: "Not signed in" });
    await authService.logout(auth.token);
    reply.header("set-cookie", clearSessionCookie(cookie));
    return reply.status(204).send();
  });

  app.get("/session", async (request, reply) => {
    if (!authService) return reply.status(503).send({ error: DB_REQUIRED });
    const auth = await authService.authenticate(extractToken(request));
    if (!auth) return reply.status(401).send({ error: "Not signed in" });
    return reply.send(await authService.sessionView(auth));
  });

  app.post("/auth/password-reset", async (request, reply) => {
    if (!authService) return reply.status(503).send({ error: DB_REQUIRED });
    const { email } = resetRequestSchema.parse(request.body);
    await authService.requestPasswordReset(email);
    // Same response for known and unknown emails — no account enumeration.
    return reply.send({ ok: true });
  });

  app.post("/auth/password-reset/consume", async (request, reply) => {
    if (!authService) return reply.status(503).send({ error: DB_REQUIRED });
    const { token, password } = resetConsumeSchema.parse(request.body);
    await authService.consumePasswordReset(token, password);
    return reply.status(204).send();
  });
}
