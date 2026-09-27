# Database access

Plain Postgres (Supabase-hosted, ADR-0002) through Drizzle:

- `client.ts` — the pool. `createDb(url)` builds a lazy handle (no TCP until
  the first query); `getDb(url)` returns the process-wide pool for that URL;
  `requireDb()` reads `DATABASE_URL` and throws a fix-oriented error when it
  is unset; `closeDb()` tears pools down (app shutdown, tests). TLS defaults
  to required for managed Postgres unless the URL carries its own `sslmode`,
  and `?pgbouncer=true` URLs get prepared statements disabled.
- `schema.ts` — Drizzle table definitions. Empty until ticket 07; new tables
  must follow the baseline conventions in `drizzle/README.md`.
- `migrate.ts` — `npm run db:migrate`: applies everything in `drizzle/` and
  exits nonzero on failure. Generate SQL with `npm run db:generate`,
  browse with `npm run db:studio`.

Owner setup (connection string, first migrate) lives in `backend/README.md`
under "Database".
