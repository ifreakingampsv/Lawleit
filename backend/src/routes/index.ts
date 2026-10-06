import type { FastifyInstance } from "fastify";
import type { DbHandle } from "../db/client.js";
import { createDrizzleRepositories } from "../services/auth/drizzle-repository.js";
import type { AuthRepositories } from "../services/auth/repository.js";
import { AuthService } from "../services/auth/service.js";
import type { StorageService } from "../services/storage/service.js";
import type { GatewayService } from "../services/gateway/provider.js";
import type { Mailer } from "../services/auth/mailer.js";
import { authRoutes } from "./auth.js";
import { protectedRoutes } from "./protected.js";
import { healthRoutes } from "./health.js";
import { webhookRoutes } from "./webhooks.js";
import { PaymentsService } from "../services/payments/service.js";
import { GatewayAccountService } from "../services/gateway/service.js";
import { GatewayWebhookService } from "../services/gateway/webhooks.js";
import { SampleDataService } from "../services/sample/service.js";
import type { CookieAttrs } from "./sessionCookie.js";

export type ApiRoutesOptions = {
  db?: DbHandle | null;
  /** Test seam: bind in-memory repositories without a database. */
  repositories?: AuthRepositories | null;
  mailer?: Mailer;
  cookie?: CookieAttrs;
  /** Ticket 17: the storage binding behind the documents upload/download
   * routes; null/absent = storage unconfigured (those routes answer 503). */
  storage?: StorageService | null;
  /** Ticket 17: the sign-upload size cap in bytes (default 25 MB). */
  maxUploadBytes?: number;
  /** V2 slice 1 (ticket 02): the gateway-secrets encryption key; null/absent
   * = GATEWAY_ENCRYPTION_KEY is unset and the gateway writes answer 503. */
  gatewayEncryptionKey?: string | null;
  /** V2 slice 1 (ticket 03): the GatewayService provider seam (tests bind a
   * fake-provider client); production derives the Razorpay binding. */
  gateway?: GatewayService;
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
  // V2 ticket 09: the sample-workspace seeder/remover (stateless over repos).
  const sampleService = repos ? new SampleDataService(repos) : null;

  await app.register(authRoutes, { authService, cookie, sampleService });
  // The Razorpay webhook surface (ticket 04) is PUBLIC — no session; it
  // authenticates by HMAC against the URL-named firm's webhook secret, so it
  // mounts outside protectedRoutes with its own service instances (stateless —
  // sharing the same repositories as the guarded surface's services).
  const webhookAccountService = repos
    ? new GatewayAccountService(repos, options.gatewayEncryptionKey ?? null)
    : null;
  const webhookService =
    repos && webhookAccountService
      ? new GatewayWebhookService(
          repos,
          webhookAccountService,
          new PaymentsService(repos),
        )
      : null;
  await app.register(webhookRoutes, { webhookService });
  await app.register(protectedRoutes, {
    authService,
    repos,
    mailer: options.mailer,
    storage: options.storage,
    maxUploadBytes: options.maxUploadBytes,
    gatewayEncryptionKey: options.gatewayEncryptionKey,
    gateway: options.gateway,
    sampleService,
  });
  await app.register(healthRoutes, { db: options.db ?? null });
}
