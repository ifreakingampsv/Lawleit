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

## What still needs the owner (going live)

See [docs/BACKEND.md § What still needs the owner](../docs/BACKEND.md).
