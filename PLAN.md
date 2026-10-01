# PLAN — Lawleit (MyCase clone)

**Goal:** Legal practice management SaaS for small to mid-tier Indian law firms
(MyCase-adapted). One codebase ships **two live versions** — a public Demo Version
(portfolio) and a Production Version on a real backend — selected by environment,
with the swappable data-layer seam that made that possible: mock mode still runs the
whole product in the browser, http mode against the REST API, no source edits either way.

**Status log:** see [CHANGELOG.md](./CHANGELOG.md) · design spec for the marketing site:
[out/plan.md](./out/plan.md) · verification ledger: [out/verify.jsonl](./out/verify.jsonl) ·
decisions: [docs/adr/](./docs/adr/) · API surface: [docs/API_CONTRACT.md](./docs/API_CONTRACT.md) ·
ticket ledger: [.scratch/v1/issues/](./.scratch/v1/issues/)

---

## Deliverables

| # | Deliverable | Description |
|---|---|---|
| 1 | **Marketing site** (pixel-faithful, rebranded Lawleit) | Home, Pricing, Features (9 product-area pages off one template), Login, Free Trial, Schedule Demo — built from recordings of the live site; "Explore demo" enters the Demo Version in one click |
| 2 | **Demo Version** (public portfolio) | Full product, zero friction: one-click entry into the seeded Demo Firm (Kaul & Bhatnagar Associates, Delhi — Indian courts, rupees, fictional throughout), edits private to the visitor's browser, "Reset demo data" action. **Live: https://lawleit-kappa.vercel.app** (mock adapter, `VITE_API_MODE=mock`) |
| 3 | **Production Version** | Real signup, real auth, real persistence for law firms. **Frontend: https://lawleit-smto.vercel.app · API: https://lawleit-api.onrender.com** (`VITE_API_MODE=http`) |
| 4 | **Production backend** (`backend/`) | TypeScript Fastify + Drizzle monolith implementing docs/API_CONTRACT.md — routes → services → db, a repository seam per module, firm-scoped tenancy, 10 versioned migrations, Postgres on Supabase Mumbai (database-only), Docker deploy on Render free tier |
| 5 | **Reference backend + smoke harness** (`backend/server.mjs`, `backend/smoke.mjs`) | Zero-dependency Node ≥ 24 server implementing the contract 1:1 over JSON files, plus a 55-assertion smoke suite — still the contract's executable reference, and the harness certifies any conforming server: it registers its own firm and must pass against the reference backend and production alike |
| 6 | **Docs** | PLAN.md (this file), CHANGELOG.md, docs/API_CONTRACT.md, docs/adr/0001–0005, docs/BACKEND.md, docs/BACKEND-PLAN.md, docs/DEPLOY-DEMO.md, docs/REBRAND.md |

## Architecture

**Frontend (`app/`)** — React 19 + TS + Vite + Tailwind v4 + shadcn/ui, react-router.
`src/sites/marketing/` — public pages. `src/sites/app/` — product shell.
`src/lib/data/` is **the backend seam**:

- `types.ts` — domain models (Firm, User, Case, Contact, CalendarEvent, Task,
  TimeEntry, Expense, Invoice, Payment, Document, Message, Lead…)
- `api.ts` — the `LawleitApi` interface the UI codes against (async, REST-shaped)
- `mockAdapter.ts` — seeded in-memory + localStorage persistence (the Demo Version)
- `httpAdapter.ts` — full REST client implementing the API contract (production)
- Adapter chosen by env (`VITE_API_MODE=mock|http`), never by source edits; both
  versions are the same built SPA, only environment differs.

**Backend (`backend/`)** — TypeScript Fastify, layered routes → services → db. Each
module follows the same five-piece pattern —
`services/<mod>/{repository,in-memory,drizzle,service}.ts` plus a
`service.db.test.ts` real-Postgres twin — so route tests bind in-memory repos and
the SQL binding stays one file. Tenants: every table carries `firm_id`; isolation is
enforced in the service layer and proven by per-module cross-firm tests (ADR-0003;
Postgres RLS deliberately deferred). Ten versioned Drizzle migrations (auth/sessions,
cases, events/tasks, time/expenses, leads, invoices, payments, trust, documents,
email outbox). Postgres is Supabase **as a database only**, Mumbai/ap-south-1 — no
Supabase-specific features, keeps the database portable (ADR-0002).

- **Auth:** argon2id password hashing; opaque server-side session tokens — revocable
  `sessions` rows, not JWTs — delivered both as `Authorization: Bearer` and the
  `lawleit_session` httpOnly cookie (ADR-0005). Signup creates the Firm + an
  unset-password owner; the first password is set through the single-use
  password-reset flow, and an invite is the same machinery. Reset tokens are stored
  only as SHA-256 hashes.
- **Money:** integer paise INR end to end, one shared ₹ formatter (Indian digit
  grouping). Invoice line amounts are computed server-side; payments are immutable
  records whose invoice roll-up commits in the same transaction (a partial payment
  keeps a draft a draft).
- **Trust:** client money is an append-only ledger (`trust_transactions` — no
  update/delete paths anywhere), running `balanceAfter` per client, per-client
  advisory-lock serialization so concurrent appends cannot fork the chain;
  a service-level three-way reconciliation recomputes history and detects
  tampering (the trust page's ✓ Balanced check).
- **Uploads:** `POST /documents/sign-upload` validates permission, type allowlist
  and the 25 MB cap *before* minting a 15-minute signed PUT against Supabase
  Storage (S3-compatible); keys are namespaced `firms/<firmId>/…`; downloads go
  through signed GETs. The provider sits behind a thin `StorageService` seam,
  swappable by config.
- **Email:** database outbox + retry worker (exponential backoff, poison messages
  surfaced loudly); Resend sender, env-gated by `RESEND_API_KEY` — unset, a console
  sender logs the link so dev still works.
- **Hosting:** both frontends are static builds on Vercel free tier; the API is the
  `backend/Dockerfile` container on Render free tier, Singapore (ADR-0004, updated
  2026-10-01 after the Fly pivot — same image, hosts are config). The CORS
  allow-list covers the Vercel origins and advertises PATCH/DELETE for browser
  preflights (the default method list silently blocked every edit). SPA deep
  links are guaranteed by `app/vercel.json` filesystem-first rewrites on both
  projects. Free-tier trade-offs accepted in V1: API cold starts, Singapore→Mumbai
  DB latency.

## Milestones — the V1 ticket ledger

Tracer-bullet build, one ticket per slice; specs and post-build notes live in
`.scratch/v1/issues/`. 19 of 20 resolved; ticket 20 in flight.

- [x] **01** Backend skeleton + test harness — Fastify boot, contract error envelope, CORS allow-list, typed env (`01-backend-skeleton.md`)
- [x] **02** INR money plumbing — integer-paise types, shared ₹ formatter, rupee seed (`02-inr-money.md`)
- [x] **03** Demo Firm seed — Kaul & Bhatnagar Associates (Delhi; district courts/HC/NCLT), believable and fictional (`03-demo-firm-seed.md`)
- [x] **04** One-click demo entry + reset — marketing CTA lands in the Demo Firm, browser-local edits, reset action (`04-demo-entry-reset.md`)
- [x] **05** Demo live on Vercel — https://lawleit-kappa.vercel.app, acceptance verified on the live URL (`05-demo-vercel-deploy.md`)
- [x] **06** Postgres wiring — Drizzle + versioned migrations, pooled SSL client, db-aware health (`06-postgres-wiring.md`)
- [x] **07** Auth — argon2 + opaque revocable sessions (ADR-0005), password-reset flow, the isolation-test template (`07-auth-sessions.md`)
- [x] **08** User management — owner-only invite/patch, last-active-owner invariant, additive `POST /users` (`08-user-management.md`)
- [x] **09** Contacts on the real backend — firm-scoped CRUD, soft deletes, cross-firm tests (`09-contacts.md`)
- [x] **10** Cases + detail — per-firm-year server-assigned numbers (atomic counters), filters, concurrency tests (`10-cases-detail.md`)
- [x] **11** Calendar + tasks — ISO-day semantics, event-source V2 seam (`11-calendar-tasks.md`)
- [x] **12** Time + expenses — paise amounts, server-managed `invoiced` flag, required case links (`12-time-expenses.md`)
- [x] **13** Invoices — INV counter, server-computed line amounts, GST seam columns (`13-invoices.md`)
- [x] **14** Payments — same-transaction roll-up, immutable records, trust hook point (`14-payments.md`)
- [x] **15** Trust ledger — append-only, advisory-lock-serialized balances, reconcile + tamper detection (`15-trust-accounts.md`)
- [x] **16** Leads + conversion — stage history, one-transaction conversion sharing the case counter, 409 double-convert (`16-leads-conversion.md`)
- [x] **17** Real file uploads — signed-URL flow, type/size guards, per-firm keys; demo mode does 1 MB data-URL uploads (`17-uploads.md`)
- [x] **18** Transactional email — outbox + retry worker + Resend (env-gated), branded reset/invite templates (`18-email.md`)
- [x] **19** Production cutover + deploy — API live on Render, production frontend on Vercel, module-by-module parity walkthrough on the live system (`19-cutover-deploy.md`)
- [ ] **20** Docs + final verification — PLAN rewrite, API-contract additions, smoke portability, mode-aware login copy + signup fetch-error handling, the Settings invite form (owner reversed the descope), handoff doc (in flight) (`20-docs-verification.md`)

Test posture at the cutover: backend 304 vitest tests (incl. 77 real-DB twins against
the Supabase database), the app vitest suite (mock flows, demo entry, and an
httpAdapter contract test), and the smoke suite — which certifies any conforming
server, not just the reference.

## ACCESS — what needs the owner

MyCase's product UI is still inaccessible: the self-serve trial remains geo-blocked
(the 2026-09-20 test signup drew an explicit rejection email; no owner signup has
happened since). The product UI therefore remains **interpreted, not pixel-cloned** —
built from product screenshots embedded in their marketing pages, the demo dashboard
visible behind the trial modal, and public knowledge of the feature set. To upgrade
it to pixel-faithful, the owner would still need to:

1. Sign up at mycase.com/free-trial with real firm details (10-day trial, no card).
2. Log in once in the ZCode in-app browser and leave the session — recordings of
   every product screen could then drive the upgrade.

Everything else — demo, production backend, deploys, docs — no longer waits on access.

## Risks / notes

- The **swappable-seam story held and is now load-bearing in three places**: the
  data-layer seam switches Demo ↔ Production without source edits; ADR-0002's
  vanilla-Postgres rule keeps the database movable; the host-agnostic Dockerfile
  moved the API from Fly to Render as a config change (ADR-0004).
- Marketing recordings capture MyCase's own screenshots/videos; those are replaced
  in the clone with Lawleit-styled equivalents so no copyrighted imagery ships.
  Copy is paraphrased-not-verbatim; real customer names/figures were scrubbed at the
  owner's request (CHANGELOG Session 2). No MyCase/8am copy, logos or assets ship.
- Deferred after V1 — the V2 India-localization scope is unchanged (GST/TDS
  invoicing, Indian payment rails, stage billing, retainer trust, WhatsApp,
  cause-list calendars; CONTEXT.md), alongside the other planning deferrals
  (client portal, the AI decision). The one mid-build descope was reversed by the
  owner: the Settings **invite form is IN for V1** (ticket 20) — `POST /users`
  ships contract-documented and the owner-visible UI ships with it; invite links
  land in the server logs until a Resend key is configured on Render. First
  post-V1 items: the Resend key + the fresh-install seed-script decision (fresh
  installs verify via the portable smoke suite meanwhile).
