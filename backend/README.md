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

## Auth (production backend, ticket 07)

Real authentication per [docs/API_CONTRACT.md](../docs/API_CONTRACT.md); the
token scheme decision is recorded in
[ADR-0005](../docs/adr/0005-auth-token-scheme.md):

- **Tokens** are opaque random 256-bit values stored server-side in
  `sessions` (revocable by logout, password reset, and deactivation) — not
  JWTs. Login/signup return `{ token, user, firm, users }` and set the
  `lawleit_session` HttpOnly cookie exactly as the reference backend does.
  Every other route requires the bearer token or the cookie; failures answer
  `401 { "error": "Not signed in" }`.
- **Cookies** are configurable for the production cross-site deploy
  (ticket 19): `COOKIE_SAMESITE=lax|none` (default `lax`) and
  `COOKIE_SECURE=true|false` (default `false`). SameSite=None must ship with
  `COOKIE_SECURE=true` or browsers ignore it.
- **Passwords** are argon2id hashes (`@node-rs/argon2`, OWASP parameters).
  The contract's signup payload has no password field, so a fresh account
  holds an unguessable unset password; the password-reset flow sets the first
  real one. Reset tokens are single-use, expire after one hour, and are stored
  only as SHA-256 hashes; delivery goes through the `Mailer` interface
  (`ConsoleMailer` stub logs the link — ticket 18 replaces it).
- **Routes** beyond the contract table: `POST /auth/password-reset` (request)
  and `POST /auth/password-reset/consume` (set new password + revoke all
  sessions) — ticket-07 additions used by the reset flow, not wired into the
  frontend adapter.

## Object storage (production backend, ticket 17)

Real file uploads go through object storage — Supabase Storage's S3-compatible
API per [ADR-0002](../docs/adr/0002-supabase-postgres-only.md), behind the
`StorageService` seam (`src/services/storage/service.ts`): `presignUpload(key,
contentType, size)`, `presignDownload(key)`, `deleteObject(key)`. The
production binding (`src/services/storage/s3.ts`, `@aws-sdk/client-s3` +
`@aws-sdk/s3-request-presigner`) works with any S3-compatible endpoint; tests
bind a deterministic in-memory fake.

- **Env** (all five together, optional — unset = no storage): `S3_ENDPOINT`
  (`https://<project-ref>.supabase.co/storage/v1/s3`), `S3_REGION`
  (`ap-south-1`), `S3_BUCKET` (a private bucket), `S3_ACCESS_KEY_ID` /
  `S3_SECRET_ACCESS_KEY` (Storage → S3 access keys). `S3_MAX_UPLOAD_MB` caps
  sign-upload (default 25). Full paste-in values: `backend/.env.example`.
- **Unset state:** the upload/download routes answer
  `503 {"error":"Storage not configured — set S3_* vars (see .env.example)"}`
  and the documents metadata surface keeps working (the contract's
  metadata-only mode).
- **Flow:** `POST /documents/sign-upload` validates (type allowlist, size cap,
  case link) and returns `{ storageKey, url, method: "PUT", expiresIn }`; the
  browser PUTs the bytes directly to storage; `POST /documents` records the
  metadata with that `storageKey` (additive fields, must sit under the firm's
  own `firms/<firmId>/` prefix); `GET /documents/:id/download` returns a
  short-lived signed GET after the permission check. Delete removes the
  metadata (soft) and drops the object best-effort.

## Tests

`npm test` runs two kinds of suites:

- **Unit/HTTP suites** always run: services and routes are tested against
  in-memory repositories (`src/services/auth/testing.ts`) bound through the
  repository seam, so no database is needed.
- **DB-backed suites** (`describe.skipIf(!process.env.DATABASE_URL)`) run
  against real Postgres once `DATABASE_URL` is in the environment
  (`backend/.env` works — migrate.ts and drizzle-kit load it; export it in
  CI). They migrate from `drizzle/` and truncate the auth tables between
  tests — point them at a scratch database:

  ```bash
  cd backend
  cp .env.example .env       # set DATABASE_URL (and SESSION_SECRET)
  npm test
  # expected: the drizzle-repository suite runs (not skipped) and passes
  ```

Honest status: the app-level contract suite (`cd app && npm run test`) and the
smoke suite (`npm run smoke:api`) currently exercise the reference backend and
stay green and untouched; full contract-suite acceptance of THIS backend runs
the same way once `DATABASE_URL` exists and migrations are applied
(`VITE_API_BASE_URL=http://127.0.0.1:3001/api/v1 npm run test`).

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
   (Migration 0000 creates firms/users/sessions/password_reset_tokens.
   Re-run the command after every `db:generate`.)
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
