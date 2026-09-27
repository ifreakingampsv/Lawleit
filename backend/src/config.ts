import { z } from "zod";

/** Thrown when the environment cannot produce a runnable configuration. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  SESSION_SECRET: z
    .string({ error: "SESSION_SECRET is required" })
    .min(1, "SESSION_SECRET cannot be empty"),
  DATABASE_URL: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z
      .string()
      .regex(
        /^postgres(?:ql)?:\/\//,
        "DATABASE_URL must be a postgres:// URL (ADR-0002 — Supabase Postgres only)",
      )
      .optional(),
  ),
  // Session cookie (ticket 07): lax matches the reference backend and the
  // same-origin/proxied deploys. The production cross-site deploy (ticket 19,
  // Vercel frontend + Fly API) must set COOKIE_SAMESITE=none — which browsers
  // only honor with Secure — so set COOKIE_SECURE=true with it.
  COOKIE_SAMESITE: z.enum(["lax", "none"]).default("lax"),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export interface AppConfig {
  port: number;
  corsOrigins: string[];
  sessionSecret: string;
  databaseUrl: string | null;
  cookieSameSite: "lax" | "none";
  cookieSecure: boolean;
}

/**
 * Parses and validates the process environment. Boot must fail fast here —
 * the error message names every offending variable so the operator can fix
 * the deployment in one round trip.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      const path = issue.path.join(".");
      if (!path || issue.message.startsWith(path)) return issue.message;
      return `${path}: ${issue.message}`;
    });
    throw new ConfigError(`${problems.join("; ")} — see backend/.env.example`);
  }
  const { PORT, CORS_ORIGINS, SESSION_SECRET, DATABASE_URL, COOKIE_SAMESITE, COOKIE_SECURE } =
    parsed.data;
  return {
    port: PORT,
    corsOrigins: CORS_ORIGINS,
    sessionSecret: SESSION_SECRET,
    databaseUrl: DATABASE_URL ?? null,
    cookieSameSite: COOKIE_SAMESITE,
    cookieSecure: COOKIE_SECURE,
  };
}
