import { fileURLToPath } from "node:url";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/** Thrown when a code path needs the database but DATABASE_URL is not configured. */
export class DbNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbNotConfiguredError";
  }
}

/** Where drizzle-kit writes migrations and migrate() applies them from. */
export const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export interface DbHandle {
  sql: postgres.Sql;
  db: PostgresJsDatabase;
  /** Runs `SELECT 1` under a wall-clock timeout so callers cannot hang. */
  ping(timeoutMs?: number): Promise<void>;
  /** Ends every pooled connection. Safe to call once. */
  close(): Promise<void>;
}

/**
 * createDb — one lazy pool per call. postgres.js opens TCP connections on the
 * first query, never at construction, so creating a handle is free and boot
 * stays network-free.
 */
export function createDb(databaseUrl: string): DbHandle {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL — see backend/.env.example");
  }
  if (!/^postgres(?:ql)?:$/.test(url.protocol)) {
    throw new Error(
      `DATABASE_URL must be a postgres:// URL (got ${url.protocol}) — ADR-0002: plain Postgres only`,
    );
  }

  const options: postgres.Options<Record<string, postgres.PostgresType>> = {
    // Managed Postgres (Supabase per ADR-0002) requires TLS but its console
    // strings for direct connections often omit sslmode; default it on. A URL
    // that carries its own sslmode wins — our option would override it.
    ...(url.searchParams.has("sslmode") ? {} : { ssl: "require" }),
    // Fail /health and startup pings fast instead of the 30s default.
    connect_timeout: 5,
    // PgBouncer transaction pooling (Supabase pooler on :6543, signalled by
    // the ?pgbouncer=true convention) cannot replay prepared statements.
    ...(url.searchParams.get("pgbouncer") === "true" ? { prepare: false } : {}),
  };

  const sql = postgres(databaseUrl, options);
  return {
    sql,
    db: drizzle(sql),
    ping(timeoutMs = 3_000) {
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`SELECT 1 did not return within ${timeoutMs}ms`)),
          timeoutMs,
        );
        timer.unref();
        sql`select 1`.then(
          () => {
            clearTimeout(timer);
            resolve();
          },
          (error: unknown) => {
            clearTimeout(timer);
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      });
    },
    close() {
      return sql.end({ timeout: 5 });
    },
  };
}

// One pool per DATABASE_URL, created on first use. The map (not a bare
// variable) keeps tests that build apps against different URLs from fighting
// over a single global.
const pools = new Map<string, DbHandle>();

/**
 * getDb — the process-wide pool for this URL. One backend serves one database;
 * repeated calls with the same string share the pool.
 */
export function getDb(databaseUrl: string): DbHandle {
  let handle = pools.get(databaseUrl);
  if (!handle) {
    handle = createDb(databaseUrl);
    pools.set(databaseUrl, handle);
  }
  return handle;
}

/** Closes every cached pool (app shutdown, test teardown). No-op when none. */
export async function closeDb(): Promise<void> {
  const open = [...pools.values()];
  pools.clear();
  await Promise.all(open.map((handle) => handle.close()));
}

/** DATABASE_URL from the given env, with blank strings treated as unset. */
export function databaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.DATABASE_URL?.trim();
  return raw ? raw : null;
}

/**
 * requireDb — for entry points that cannot do their job without a database
 * (migrations, ticket-07 services). Fails with the fix in the message.
 */
export function requireDb(env: NodeJS.ProcessEnv = process.env): DbHandle {
  const url = databaseUrlFromEnv(env);
  if (!url) {
    throw new DbNotConfiguredError(
      "DATABASE_URL is not set — copy backend/.env.example to backend/.env and fill in the Postgres connection string (ADR-0002)",
    );
  }
  return getDb(url);
}
