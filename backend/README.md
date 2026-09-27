# Lawleit reference backend

A dependency-free Node (≥ 24) HTTP server that implements
[docs/API_CONTRACT.md](../docs/API_CONTRACT.md) 1:1, so the whole product works
over real HTTP today — before the owner's production backend exists.

- `server.mjs` — the API (58 routes, JSON-file storage, demo auth)
- `smoke.mjs` — 55-assertion smoke suite covering every endpoint group
- `data/db.json` — runtime state (gitignored; delete or `--reset` to reseed)

## Run

```bash
node backend/server.mjs                 # :8787, seeds on first boot
node backend/server.mjs --reset         # wipe + reseed
# or from app/: npm run dev:api / npm run dev:http (backend + front-end)
```

Front-end in http mode: `cd app && npm run dev:http` (sets `VITE_API_MODE=http`
and proxies `/api/*` to this server), or any static deployment with
`VITE_API_BASE_URL` pointed here (CORS + credentials are enabled).

Test it: `npm run smoke:api` (from `app/`), or
`SMOKE_BASE=http://127.0.0.1:8791/api/v1 node backend/smoke.mjs` against a
scratch server (`LAWLEIT_DB=/tmp/x.json PORT=8791 node backend/server.mjs`).

## Characteristics (read before relying on it)

- **Demo auth:** any non-empty password logs in; an unknown email resolves to the
  first seeded user (same behavior as the mock adapter). Tokens are UUIDs stored
  in the DB file, returned as `{ token, user, firm, users }` and set as an
  httpOnly cookie; every non-auth route requires the cookie or
  `Authorization: Bearer`.
- **Storage:** single JSON file, written atomically (tmp + rename) on every
  mutation. Fine for dev/demo; not a production database.
- **Seed data:** imported directly from `app/src/lib/data/seed.ts` — the same
  source the mock adapter uses, so both backends demo identically.
- **Server-side responsibilities** (from the contract): case/invoice number
  assignment, invoice status roll-up on payments, trust-ledger running balances,
  lead-conversion transaction, trial-end stamping on signup.
- **Paths:** serves under `/api/v1/…` (prefix stripped) and prefixless, proxied
  or direct.
- **Env:** `PORT` (8787), `HOST` (127.0.0.1), `LAWLEIT_DB` (backend/data/db.json).
  Every request is logged to stdout.

## Database (production backend, `src/`)

The production backend (`src/`, Fastify — the reference server above is a
separate stopgap) talks to plain Postgres hosted on Supabase Mumbai through
Drizzle: pool in `src/db/client.ts`, tables in `src/db/schema.ts`, versioned
SQL migrations in `drizzle/` (conventions: [`drizzle/README.md`](drizzle/README.md)).

Commands: `npm run db:generate` (schema → SQL), `npm run db:migrate` (apply),
`npm run db:studio` (browse). With no `DATABASE_URL` the API boots stateless
and `/health` reports `"db":"unconfigured"`; with one set it reports `"db":"ok"`
after a live `SELECT 1` (`"db":"unreachable"` if the database is down — the
endpoint never fails).

### Owner steps (once the Supabase project exists)

1. Create the Supabase project in **Mumbai (ap-south-1)** per ADR-0002. Use it
   as a database host only — no Supabase auth, APIs, or RLS policies.
2. Copy a connection string (Project Settings → Database). Recommended for
   this backend, the direct connection:
   ```
   postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require
   ```
   (Pooler variants and a local `?sslmode=disable` URL are documented in
   `backend/.env.example`.)
3. Put it in the environment:
   ```bash
   cd backend
   cp .env.example .env
   # edit .env: set DATABASE_URL (and keep SESSION_SECRET set)
   ```
4. Apply migrations:
   ```bash
   npm run db:migrate
   # expected: "[lawleit-db] migrations applied from .../backend/drizzle"
   ```
   (Until ticket 07 there are no tables yet; the command succeeds with an
   empty journal. Re-run it after every `db:generate`.)
5. Verify:
   ```bash
   npm run dev        # or: npm run build && node dist/server.js
   curl -s http://localhost:3001/health
   # expected: {"ok":true,"service":"lawleit-api","db":"ok",...}
   ```

### Baseline table conventions (from the first migration onward)

Recorded in full in [`drizzle/README.md`](drizzle/README.md); in short: every
tenant table carries `firm_id uuid not null` (+ index, ADR-0003), money is
`bigint` integer paise (never float), `created_at`/`updated_at` are
`timestamptz not null default now()` (app-maintained `updated_at`), soft
deletes via nullable `deleted_at`, and primary keys are
`id uuid default gen_random_uuid()` — DB-side because it is built into
Postgres ≥ 13, no extension, keeping the database portable per ADR-0002.

## What still needs the owner (going live)

See [docs/BACKEND.md § What still needs the owner](../docs/BACKEND.md).
