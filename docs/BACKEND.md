# Lawleit backend — data layer & reference server

How the front-end talks to a backend, what ships working today, and exactly what
remains for the owner before production.

## The seam

The UI never touches storage directly. It imports `api` from `src/lib/data` and
codes against one TypeScript interface: `LawleitApi` (`src/lib/data/api.ts`).
Domain shapes live in `src/lib/data/types.ts` — the single source of truth for
both sides.

```
UI components ──▶ api (LawleitApi interface, src/lib/data/index.ts)
                     ├─ VITE_API_MODE=mock  → mockAdapter   (localStorage, zero setup)
                     └─ VITE_API_MODE=http  → httpAdapter   (REST, docs/API_CONTRACT.md)
```

Two adapters implement the interface today:

| Adapter | File | Storage | Status |
|---|---|---|---|
| `mockAdapter` | `app/src/lib/data/mockAdapter.ts` | seeded in-memory DB → localStorage | ships working (default) |
| `httpAdapter` | `app/src/lib/data/httpAdapter.ts` | REST over `VITE_API_BASE_URL` | ships working (was a stub) |

The adapter is picked at build/dev time from `VITE_API_MODE` — no source edits.
`.env` options are documented in `app/.env.example`.

## The reference backend (`backend/server.mjs`)

A runnable implementation of the whole contract so `http` mode works before the
owner's production backend exists: Node ≥ 24, zero npm dependencies, ~58 routes,
JSON-file persistence (`backend/data/db.json`, atomic writes, `--reset` to
reseed), demo auth (cookie + Bearer token), CORS, per-request logging. Seed data
is imported from `app/src/lib/data/seed.ts` — identical demo in both modes.

```bash
node backend/server.mjs            # :8787
cd app && npm run dev:http         # vite + backend together (http mode)
cd app && npm run smoke:api        # 55-assertion suite → must print SMOKE OK
```

Endpoint mapping, request/response shapes, and the server-side responsibilities
(case/invoice numbering, invoice roll-up on payment, trust ledger running
balances, lead-conversion transaction) are specified in
[API_CONTRACT.md](./API_CONTRACT.md) — the reference backend follows it exactly.

Auth today is **demo-grade**: any non-empty password, unknown emails fall back to
the first seeded user. Session tokens are UUIDs stored server-side in the DB
file; the client sends them as `Authorization: Bearer` and receives an httpOnly
cookie; `getSession()` returns null on 401 so the app gates to login cleanly.

Verification trail (this repo): `docs/logs/backend-smoke-2026-09-20.txt`
(55/55 pass) and `docs/logs/e2e-http-session-2026-09-20.txt` (request log from a
real browser session: login → dashboard → cases over HTTP).

## What still needs the owner

The reference backend is a dev/demo stand-in, deliberately not production.
Going live means replacing its internals — the front-end contract does not
change:

1. **Real persistence** — a proper database (Postgres/MySQL/…) instead of
   `db.json`. The shapes are plain JSON; the seed file doubles as a schema
   reference.
2. **Real auth** — credential checks (hashed passwords), signup email
   verification, JWT or server-side session store, refresh/expiry policy. The
   httpAdapter already speaks Bearer + cookie; nothing in the UI changes.
3. **Payments** — the mock records payments and rolls invoice status up; real
   money movement needs a processor (e.g. LawPay/Stripe) and webhooks.
4. **File uploads** — documents are metadata-only by contract ("multipart when
   real uploads land"); add object storage + a multipart endpoint.
5. **Email/SMS delivery** — communications are in-app threads only.
6. **Multi-tenancy & authorization** — firm scoping per request (the reference
   server has a single demo firm), role checks on writes.
7. **Deployment** — host the API, set `VITE_API_BASE_URL`, CORS allow-list, TLS.
8. **Trial enforcement** — `firm.trialEndsAt` is stamped on signup but not
   enforced anywhere; decide the gating behavior.

Step-by-step of how this layer was built and verified this session:
[SESSION-2026-09-20.md](./SESSION-2026-09-20.md).

## Build plan & test harness (added 2026-09-25)

- [`docs/BACKEND-PLAN.md`](./BACKEND-PLAN.md) — phased plan from reference server to
  production (decisions → schema → contract implementation → cutover → hardening),
  written as the skeleton to refine with the owner's architecture requirements.
- `app/tests/httpAdapter.contract.test.ts` — the acceptance harness for ANY backend
  claiming the contract: point `VITE_API_BASE_URL` at your server and run
  `npm run test` (a bundled-server spawn is skipped when that env var is set).
- `npm run smoke:api` now self-spawns a scratch-DB reference server when none is
  listening — zero-setup verification.
