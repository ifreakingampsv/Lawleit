# Backend Plan — from reference server to production

**Status:** proposal for the owner's build. Nothing here is implemented yet beyond
what already exists; this doc is the starting skeleton to refine (grill away at it).

## What already exists (do not rebuild)

- **The contract:** `docs/API_CONTRACT.md` maps every method of `LawleitApi`
  (`app/src/lib/data/api.ts`) to REST 1:1. The contract is the spec.
- **The reference backend:** `backend/server.mjs` — zero-dependency Node, JSON-file
  DB, demo auth. It implements the contract *including the server-side
  responsibilities* (case/invoice number assignment, invoice payment roll-up,
  trust-ledger running balance, lead conversion transaction, double-conversion 409).
  Port its handlers, or keep it behind a reverse proxy.
- **The seam:** the app never talks storage directly. `mockAdapter` (localStorage,
  default) and `httpAdapter` (REST) both implement `LawleitApi`; switching is
  `VITE_API_MODE=http` (+ `VITE_API_BASE_URL`). The UI is untouched by any of this.
- **The acceptance harnesses:**
  - `npm run smoke:api` — 55 assertions against the running API (self-spawns a
    scratch-DB server if none is listening).
  - `npm run test` — vitest: mock-adapter unit tests + a contract suite that drives
    the *real* `httpAdapter` against a spawned reference backend. **Point
    `VITE_API_BASE_URL` at any server claiming the contract and the same suite
    certifies it** — this is the acceptance test for the real backend.

## Guiding principles

1. The contract is the spec; the smoke + contract tests are the definition of done.
2. Single repo, monolith first: `/backend` alongside `app/`, one language (TypeScript
   recommended — reuse `app/src/lib/data/types.ts` so contract types can't diverge).
3. `firm_id` on every table from day one (multi-tenancy retrofit is the most expensive
   refactor in backend work).
4. Money as integer cents. Floats corrupt billing math.
5. Soft deletes (legal data), created/updated timestamps everywhere.

## Phase 1 — Decisions (~1 day)

| Decision | Suggestion | Notes |
|---|---|---|
| Framework | Fastify (or Express/Hono) | Any; Fastify's schema validation pairs well with the zod shapes the app already uses |
| Database | Postgres (managed: Neon/Supabase/RDS) | Relational fits invoices/line-items/trust; JSONB for flexible bits |
| Migrations | Drizzle or Prisma Migrate | Versioned, applied on deploy |
| Auth | httpOnly cookie sessions, argon2/bcrypt hashes | Revocable, portal-reusable; defer JWT until a second service exists |
| Layout | routes → services → db | Services reusable by the client portal later |

## Phase 2 — Schema (~3–5 days)

Tables: `firms, users, contacts, cases, leads (+stage_history), events, tasks,
time_entries, expenses, invoices + invoice_line_items, payments,
trust_accounts, trust_transactions, documents + folders, threads + messages,
notifications, audit_log`.

Rules carried over from the reference implementation: running `balanceAfter` per
client on the trust ledger; invoice status roll-up after every payment; sequence-based
case/invoice numbers (the `2026-XXXX` / `INV-XXXX` formats are cosmetic — keep the
assignment server-side).

## Phase 3 — Implement the contract in dependency order (~2–3 weeks)

1. Server skeleton: config, error handling, validation, health.
2. Auth: register firm, login, logout, `me`, password reset.
3. Contacts → Cases.
4. Tasks + Events.
5. Time entries + Expenses (timer = create/stop pair).
6. Invoices + line items → Payments (totals computed server-side).
7. Trust ledger (append-only, reconciling balance check — assert it in tests).
8. Leads + conversion (one transaction: contact + case + lead state).
9. Documents (metadata) + Threads/messages.
10. Reports (SQL aggregations: revenue, hours, cases-by-stage, AR aging).
11. Users + firm settings.

## Phase 4 — Frontend cutover (~3–5 days)

1. Point `httpAdapter` at the real API (`VITE_API_BASE_URL`).
2. Run the contract suite against it — must be green.
3. Manual parity pass module by module vs the mock mode (checklist in the test file).
4. Seed script for demo installs.

## Phase 5 — Production hardening (~1–2 weeks, parallelizable)

1. File uploads: signed-URL S3-compatible storage (contract reserves multipart).
2. Email/SMS: SES/Twilio + retry queue (invoices, reminders, portal invites).
3. Payments: Stripe/LawPay — charges, idempotent webhooks, refunds, receipts.
4. Security: rate limiting, CORS allow-list, audit log, backups, dependency scans.
5. Deploy: containerize, migrate-on-deploy, domain + TLS, staging env, Sentry + uptime.

## Explicitly deferred

- Client portal (separate small frontend on the same API).
- AI endpoints (summaries/drafts) — separate service behind a queue.
- Caching/CDN tuning — when evidence demands it.
- Integrations marketplace (Google/Outlook calendar sync, QuickBooks, two-way SMS).

## Rough total

Core (schema → cutover) ≈ 4–5 focused weeks; hardening ≈ +2. The risk concentrates
in trust reconciliation and payment webhooks — budget extra there.
