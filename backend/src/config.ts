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
  // Ticket 17 — object storage (Supabase Storage's S3-compatible API, same
  // project as the database). All five connection variables are OPTIONAL as a
  // group: unset = the API runs without storage and the upload/download
  // routes answer 503 (the same pattern as DATABASE_URL). A PARTIAL set is a
  // misconfiguration, not a mode — loadConfig fails boot naming what is
  // missing. S3_MAX_UPLOAD_MB sizes the sign-upload cap (default 25).
  S3_ENDPOINT: z.string().trim().optional(),
  S3_REGION: z.string().trim().optional(),
  S3_BUCKET: z.string().trim().optional(),
  S3_ACCESS_KEY_ID: z.string().trim().optional(),
  S3_SECRET_ACCESS_KEY: z.string().trim().optional(),
  S3_MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(1024).default(25),
  // Ticket 18 — transactional email. All three variables are OPTIONAL: with
  // RESEND_API_KEY unset the delivery sender is a console logger (the link is
  // printed — dev handoff) and with no DATABASE_URL there is no outbox at all
  // (plain ConsoleMailer). The outbox + worker activate with the database;
  // Resend activates purely by setting the key — no code path changes.
  RESEND_API_KEY: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().optional(),
  ),
  // From envelope for Resend. The default is Resend's test sender, which works
  // for development (delivers to the account owner's own address); production
  // must set a verified domain, e.g. "Lawleit <notifications@lawleit.in>".
  EMAIL_FROM: z.string().trim().min(1).default("Lawleit <onboarding@resend.dev>"),
  // Base URL for the links inside email bodies (reset/invite). Frontend base,
  // not the API base — links open the app's /reset-password route.
  APP_BASE_URL: z.string().trim().min(1).default("http://localhost:5173"),
});

/** Object-storage connection (ticket 17) — see config.ts S3_* notes. */
export interface StorageConfig {
  /** S3-compatible endpoint, e.g. https://<project-ref>.supabase.co/storage/v1/s3 */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Sign-upload size cap in bytes. */
  maxUploadBytes: number;
}

/** Email delivery (ticket 18) — see config.ts RESEND_API_KEY notes. */
export interface EmailConfig {
  /** From envelope, e.g. "Lawleit <onboarding@resend.dev>". */
  from: string;
  /** Null when RESEND_API_KEY is unset — the console sender is used instead. */
  resendApiKey: string | null;
  /** Base URL for links inside email bodies. */
  baseUrl: string;
}

export interface AppConfig {
  port: number;
  corsOrigins: string[];
  sessionSecret: string;
  databaseUrl: string | null;
  cookieSameSite: "lax" | "none";
  cookieSecure: boolean;
  /** Null when the S3_* variables are unset — storage routes answer 503. */
  storage?: StorageConfig | null;
  /** Ticket 18: email delivery knobs (from/sender key/link base URL). */
  email: EmailConfig;
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
  const email: EmailConfig = {
    from: parsed.data.EMAIL_FROM,
    resendApiKey: parsed.data.RESEND_API_KEY ?? null,
    baseUrl: parsed.data.APP_BASE_URL,
  };

  // Object storage: all five variables or none (a partial set fails boot
  // naming the missing ones — the operator fixes the deployment in one read).
  const S3 = {
    S3_ENDPOINT: parsed.data.S3_ENDPOINT,
    S3_REGION: parsed.data.S3_REGION,
    S3_BUCKET: parsed.data.S3_BUCKET,
    S3_ACCESS_KEY_ID: parsed.data.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: parsed.data.S3_SECRET_ACCESS_KEY,
  } as const;
  const setCount = Object.values(S3).filter((v) => v !== undefined).length;
  let storage: StorageConfig | null = null;
  if (setCount > 0) {
    const missing = Object.entries(S3)
      .filter(([, v]) => v === undefined)
      .map(([k]) => k);
    if (missing.length > 0) {
      throw new ConfigError(
        `${missing.join(", ")} must be set together (or all S3_* left unset to run without storage) — see backend/.env.example`,
      );
    }
    storage = {
      endpoint: S3.S3_ENDPOINT!,
      region: S3.S3_REGION!,
      bucket: S3.S3_BUCKET!,
      accessKeyId: S3.S3_ACCESS_KEY_ID!,
      secretAccessKey: S3.S3_SECRET_ACCESS_KEY!,
      maxUploadBytes: parsed.data.S3_MAX_UPLOAD_MB * 1024 * 1024,
    };
  }

  return {
    port: PORT,
    corsOrigins: CORS_ORIGINS,
    sessionSecret: SESSION_SECRET,
    databaseUrl: DATABASE_URL ?? null,
    cookieSameSite: COOKIE_SAMESITE,
    cookieSecure: COOKIE_SECURE,
    storage,
    email,
  };
}
