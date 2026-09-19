# PLAN — Lawleit (MyCase clone)

**Goal:** Clone https://www.mycase.com/ as **Lawleit** — legal practice management SaaS.
Pixel-faithful marketing site + fully functional product front-end, with a swappable
data layer so the owner can build the real backend later.

**Status log:** see [CHANGELOG.md](./CHANGELOG.md) · design spec for the marketing site:
[out/plan.md](./out/plan.md) · verification ledger: [out/verify.jsonl](./out/verify.jsonl)

---

## Deliverables

| # | Deliverable | Description |
|---|---|---|
| 1 | **Marketing site** (pixel-faithful, rebranded Lawleit) | Home, Pricing, Features (9 product-area pages off one template), Login, Free Trial, Schedule Demo — built from recordings of the live site |
| 2 | **Product app** (functional front-end) | Auth → onboarding → dashboard, cases, contacts, calendar, tasks, time tracking, billing/invoices, payments (mock), documents, communications, leads pipeline, reports, settings |
| 3 | **Mock backend + API contract** | Typed service layer with seeded in-memory/localStorage adapter; every endpoint documented so a real API can replace it without touching UI code |
| 4 | **Docs** | PLAN.md (this file), CHANGELOG.md, docs/API_CONTRACT.md, docs/REBRAND.md (MyCase → Lawleit mapping) |

## Approach

- **Marketing site:** video2code four-phase flow — record live site (recordings/*.mp4) →
  observe/clip → out/plan.md ([S#]/[D#] ids) → build → verify sweep (out/verify.jsonl).
- **Product app:** MyCase's real product is access-gated (self-serve trial rejected
  placeholder signups — see ACCESS below). App UI is built from (a) product screenshots
  embedded in their marketing pages, (b) the demo dashboard visible behind the trial
  modal, (c) public knowledge of the feature set. It is functional-but-interpreted, not
  pixel-cloned: the owner said they will redo the front-end anyway.
- **Rebrand:** MyCase orange (#F05C22-ish) → Lawleit palette built around **lawleit
  (iolitegem) blue-violet**; "8am MyCase" → "Lawleit"; "8am IQ" → "Lawleit AI";
  "LawPay" → "LawleitPay". No MyCase/8am copy, logos or assets ship in the clone —
  structure and interactions are replicated, brand identity is replaced.

## Architecture (app/)

- React 19 + TS + Vite + Tailwind v4 + shadcn/ui, react-router.
- `src/sites/marketing/` — public pages. `src/sites/app/` — product shell.
- `src/lib/data/` — **the backend seam**:
  - `types.ts` — domain models (Firm, User, Case, Contact, CalendarEvent, Task,
    TimeEntry, Expense, Invoice, Payment, Document, Message, Lead…)
  - `api.ts` — the interface the UI codes against (async, REST-shaped)
  - `mockAdapter.ts` — seeded in-memory + localStorage persistence (ships working)
  - `httpAdapter.ts` — full REST client implementing the API contract
    (selected via `VITE_API_MODE=http`)
  - Adapter chosen by env (`VITE_API_MODE`), not source edits.
- `backend/server.mjs` — **reference backend** (repo root): zero-dependency Node ≥ 24
  server implementing docs/API_CONTRACT.md 1:1 with JSON-file storage and demo
  auth, so http mode works today. `backend/smoke.mjs` = 55-assertion contract
  test. What the owner must replace for production: docs/BACKEND.md.
- Auth is mocked (any email/password → seeded session); JWT/session flow documented in
  API_CONTRACT.md for the real backend.

## Milestones

- [x] M1 Survey live site, record home + pricing
- [x] M2 Trial-access test (see ACCESS)
- [x] M3 Marketing site plan (out/plan.md) + build + verify
- [x] M4 Product app build (dashboard + 14 modules)
- [x] M5 Mock backend + API contract docs
- [x] M6 Final verify sweep, CHANGELOG + report
- [x] M7 Push to GitHub (private repo ifreakingampsv/Lawleit) + backend fill-in:
  httpAdapter implemented, reference backend + smoke suite, env-driven adapter
  switch, dev tooling, docs (docs/SESSION-2026-09-20.md, docs/BACKEND.md)

## ACCESS — what needs the owner

MyCase rejects self-service trials without a verifiable real firm (email domain +
firm-info screening; the test signup got an explicit rejection email). To unlock a
pixel-faithful clone of the **product UI**, the owner should:

1. Sign up at mycase.com/free-trial with real firm details (10-day trial, no card).
2. Log in once in the ZCode in-app browser and leave the session — recordings of every
   product screen can then be made and the app UI upgraded from "interpreted" to
   "pixel-faithful".

Everything else (marketing site, app functionality, mock backend, docs) proceeds
without the owner.

## Risks / notes

- Marketing recordings capture MyCase's own screenshots/videos; those are replaced in
  the clone with Lawleit-styled equivalents (drawn UI mockups, our own product shots
  from the built app) so no copyrighted imagery ships.
- Copy is paraphrased-not-verbatim where it is marketing prose; feature names and
  structure are kept for parity.
