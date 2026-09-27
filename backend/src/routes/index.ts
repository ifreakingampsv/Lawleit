import type { FastifyInstance } from "fastify";
import type { DbHandle } from "../db/client.js";
import { createDrizzleRepositories } from "../services/auth/drizzle-repository.js";
import type { AuthRepositories } from "../services/auth/repository.js";
import { AuthService } from "../services/auth/service.js";
import type { Mailer } from "../services/auth/mailer.js";
import { authRoutes } from "./auth.js";
import { protectedRoutes } from "./protected.js";
import { healthRoutes } from "./health.js";
import type { CookieAttrs } from "./sessionCookie.js";

export type ApiRoutesOptions = {
  db?: DbHandle | null;
  /** Test seam: bind in-memory repositories without a database. */
  repositories?: AuthRepositories | null;
  mailer?: Mailer;
  cookie?: CookieAttrs;
};

/**
 * Mount point for every contract route (docs/API_CONTRACT.md). Registered
 * under the /api/v1 prefix: the auth surface is public, everything else sits
 * behind the session guard in protectedRoutes. Each ticket adds its route
 * module here and its logic under ../services.
 */
export async function apiRoutes(
  app: FastifyInstance,
  options: ApiRoutesOptions = {},
): Promise<void> {
  const repos =
    options.repositories !== undefined
      ? options.repositories
      : options.db
        ? createDrizzleRepositories(options.db)
        : null;
  const authService = repos ? new AuthService(repos, options.mailer) : null;
  const cookie: CookieAttrs = options.cookie ?? { sameSite: "lax", secure: false };

  await app.register(authRoutes, { authService, cookie });
  await app.register(protectedRoutes, { authService, repos, mailer: options.mailer });
  await app.register(healthRoutes, { db: options.db ?? null });
}
