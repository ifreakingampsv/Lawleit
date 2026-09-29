import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import type { AppConfig } from "./config.js";
import { closeDb, getDb } from "./db/client.js";
import { apiRoutes } from "./routes/index.js";
import { healthRoutes } from "./routes/health.js";
import { HttpError } from "./services/httpError.js";
import type { AuthRepositories } from "./services/auth/repository.js";
import type { Mailer } from "./services/auth/mailer.js";
import { createS3Storage } from "./services/storage/s3.js";
import type { StorageService } from "./services/storage/service.js";

/** Test seams: bind fakes without a database. Production leaves them unset. */
export interface BuildAppDeps {
  repositories?: AuthRepositories | null;
  mailer?: Mailer;
  /** Ticket 17: bind a storage service (tests bind the in-memory fake).
   * Production derives the S3 binding from config.storage. */
  storage?: StorageService | null;
}

/**
 * buildApp — the deployable API without .listen(); tests drive it via .inject().
 *
 * Error envelope (docs/API_CONTRACT.md + app/src/lib/data/httpAdapter.ts):
 * every failure is JSON `{ error: <message> }`. The adapter surfaces that
 * string verbatim to the UI, so no other field and no stack internals may
 * appear in the body.
 */
export async function buildApp(
  config: AppConfig,
  deps: BuildAppDeps = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  // The pool is lazy (no TCP until the first query), so opening it here never
  // touches the network; with no DATABASE_URL the API simply runs stateless.
  const db = config.databaseUrl ? getDb(config.databaseUrl) : null;
  app.addHook("onClose", async () => {
    await closeDb();
  });

  // Object storage (ticket 17): the S3 binding when the S3_* env is set, null
  // otherwise — the upload/download routes answer 503 in that state (the
  // same optional-dependency pattern as the database above).
  const storage: StorageService | null =
    deps.storage !== undefined ? deps.storage : config.storage ? createS3Storage(config.storage) : null;

  // Browser origins must be on the allow-list; requests without an Origin
  // header (curl, the vite proxy, server-to-server) are not CORS-governed.
  await app.register(cors, {
    origin: (origin, cb) => {
      if (origin === undefined || config.corsOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
  });

  app.setErrorHandler((rawError, request, reply) => {
    // Route handlers throw ZodError on invalid client input (ticket 07+).
    if (rawError instanceof ZodError) {
      reply.status(400).send({ error: rawError.issues[0]?.message ?? "Invalid request body" });
      return;
    }
    // Typed HttpError carries an envelope-safe message on purpose (service
    // invariants, and ticket 17's operator-facing "Storage not configured —
    // set S3_* vars"), so it renders verbatim at any status. Unexpected
    // errors stay masked below.
    if (rawError instanceof HttpError) {
      reply.status(rawError.statusCode).send({ error: rawError.message });
      return;
    }
    const error = rawError as FastifyError;
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      request.log.error(error);
      reply.status(statusCode).send({ error: "Internal error" });
      return;
    }
    reply.status(statusCode).send({ error: error.message });
  });

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split("?")[0] ?? request.url;
    reply.status(404).send({ error: `No route: ${request.method} ${path}` });
  });

  await app.register(apiRoutes, {
    prefix: "/api/v1",
    db,
    repositories: deps.repositories,
    mailer: deps.mailer,
    cookie: { sameSite: config.cookieSameSite, secure: config.cookieSecure },
    storage,
    maxUploadBytes: config.storage?.maxUploadBytes,
  });
  // The reference backend also serves /health prefixless; the smoke suite and
  // the vite proxy rely on both forms.
  await app.register(healthRoutes, { db });

  return app;
}
