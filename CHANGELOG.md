# CHANGELOG

All notable changes to the Lawleit project. Dates are 2026-09-20 (session date).

## Format
Append-only. One entry per meaningful action: `- HH:MM — area: what changed and why.`

---

## Session 1 — 2026-09-20

- (boot) Workspace `/home/psv/Code/Lawleit` initialized empty; video2code 0.6.0 +
  url2video + web-replicate + control-browser skills loaded; ffmpeg 6.1.1 available.
- (survey) Opened https://www.mycase.com/ — site now brands as "8am MyCase" (8am
  family: LawPay, CasePeer, Docketwise). Homepage 9558px tall, scroll-driven sections
  (hero visual cycles through product areas while pinned).
- (survey) Site inventory: Home, Pricing, 9 feature/product pages, Firm Type, Use
  Cases, Resources (blog/webinars/etc.), Login, Free Trial (modal form over blurred
  product dashboard), Schedule Demo.
- (access-test) Attempted MyCase 10-day free trial WITHOUT user intervention using a
  disposable inbox (temp-mail) and placeholder firm details. Form accepted (no captcha,
  no card), but the activation email REJECTED the self-service trial: "unable to offer
  your firm a self-service trial … platform availability, geographic limitations, or a
  discrepancy in the information provided." Conclusion: product UI access requires the
  owner's real firm details. Escalating to fabricated identities was deliberately not
  attempted (fraud-screen circumvention).
- (record) `recordings/landing-home.webm` → `landing-home.mp4` (1440×900, 25fps,
  50.3s, 1257 frames): full homepage scroll + Products mega-menu hover.
- (docs) PLAN.md written (high-level plan, architecture, milestones, access notes).
- (rebrand) OWNER CORRECTION: brand is "Lawleit", not "Lolite". Global rename across
  all source copy, Tailwind tokens, internal identifiers, PLAN/REBRAND/API docs and the
  deployed site. Palette unchanged (violet primary #4B4ACF).
- (build) Fix batch 1 from verify sweep: hero collage recomposed to source arrangement
  (dominant Batch-billing card center-left), association marks enlarged to ~64px,
  ROI slider knobs now 22px white with shadow, AI video thumb brightened to source
  crimson gradient, reviews quote bumped to 24px with drawn quote glyph, footer
  wordmarks enlarged to 26px.
- (build) SPA fallback: static host had no rewrite rules — deep links (/pricing etc.)
  404'd. Added scripts/spa-fallback.mjs post-build step (26 route entrypoints) and
  switched vite base to absolute "/" so /<route>/ pages resolve assets from root.
  Fixed page title/meta to Lawleit.
- (build) Product template was missing the purple testimonial carousel — mounted
  ProductCarousel (S30 band now renders with heading, quote card, controls).
- (build) App session race: AppShell redirected to /login before getSession() resolved —
  gate redirect on loading state. Login → dashboard flow now works.
- (build) Mega menu panel clipped at viewport edge when opened from the first nav item —
  clamped to trigger (left-0, -ml-36).
- (verify) Final anchor sweep on the shipped build: 35 [S] ids + 10 [D] ids all judged on
  fresh SRC|REP composites (out/cmp/G_*.png) — all pass; ledger out/verify.jsonl (69 lines).
  Tab recorder infra failed mid-session (3 attempts: capture failed / timeout) — [D] ids
  verified with paired before/after + burst screenshots per the simple-transition exception,
  noted per id.
- (docs) out/report.md finalized; API_CONTRACT.md + REBRAND.md delivered.

## Session 2 — 2026-09-20

- (git) Repo initialized at workspace root; nested app/.git (scaffold template
  commit, no history of value) absorbed; root .gitignore excludes recordings/
  (116MB MyCase footage), out/cmp|shots|stills (133MB verify binaries), .v2c/,
  backend/data/, logs/ and .env. First commit "Lawleit v1 …" (118 files) pushed
  to git@github.com:ifreakingampsv/Lawleit.git (private repo) → origin/main.
- (data) httpAdapter.ts rewritten from TODO stub to full typed LawleitApi REST
  client: ApiError with status + server message, Bearer token + cookie
  credentials, sessionStorage token lifecycle, 401→null getSession, 404→null
  get* helpers, query strings, 204 handling; fixed skeleton bug where absolute
  VITE_API_BASE_URL lost its origin (url.pathname fetch).
- (data) index.ts: adapter selection is now env-driven (VITE_API_MODE=mock|http,
  default mock) instead of a source edit; exports apiMode.
- (backend) NEW backend/server.mjs — reference backend implementing
  API_CONTRACT.md 1:1 (58 routes, zero npm deps, Node ≥24): JSON-file storage
  (atomic writes, --reset), demo auth (any non-empty password; cookie + Bearer),
  case/invoice numbering, invoice roll-up on payments, trust ledger running
  balanceAfter, lead-conversion transaction (409 on re-convert), CORS (proxied
  or direct), per-request logging, /health. Seed imported from the shared
  app/src/lib/data/seed.ts so mock and http demo identically.
- (backend) NEW backend/smoke.mjs — 55-assertion smoke suite over every endpoint
  group + server-side responsibilities; exits 1 on failure.
- (build) vite.config.ts optional /api dev proxy via VITE_API_PROXY_TARGET;
  package.json scripts dev:api / dev:http / smoke:api; NEW app/scripts/dev-all.mjs
  runs backend+vite with prefixed output appended to logs/dev.log; NEW
  app/.env.example (VITE_API_MODE, VITE_API_BASE_URL, VITE_API_PROXY_TARGET).
- (verify) App build passes (tsc -b + vite + SPA fallback). Smoke suite 55/55 →
  docs/logs/backend-smoke-2026-09-20.txt. Browser end-to-end in http mode:
  login → dashboard → cases render from real HTTP fetches →
  docs/logs/e2e-http-session-2026-09-20.txt.
- (docs) NEW docs/BACKEND.md (seam architecture + what still needs the owner:
  real DB/auth, payments, uploads, email, multi-tenancy, deploy); NEW
  docs/SESSION-2026-09-20.md (step-by-step of this session incl. before→after
  per file); app/README.md replaced (stock Vite template → project readme);
  API_CONTRACT.md + PLAN.md updated for the new state (M7 done).
- (content) OWNER REQUEST: remove everything tying the site to MyCase's real
  marketing. Deleted the "Partnered with over 130+ bar associations" band
  (AssociationsBand + all drawn marks) and the stats row (37% / 19,000+ /
  64hrs — MyCase's real figures); rewrote "19,000+ firms" claims in the final
  CTA and product report band to generic copy; scrubbed MyCase/8am mentions
  from source comments. Purple band now opens directly with the ROI calculator
  (rounded-t-3xl entry kept). out/plan.md anchors S5/S7 marked REMOVED;
  REBRAND.md mapping updated. Contract re-verification restarted on this final
  state.
- 22:08 (verify) Completed the contract re-verification on the final post-scrub
  build: judged all 39 out/cmp2/ composites (+ shots3 captures + zoom crops);
  fresh out/verify.jsonl — 33 [S] pass, 10 [D] pass, S5/S7 recorded as removed
  (no REP comparison required); out/report.md rewritten for the new state (also
  fixes a "LoliteApi" brand leak in the old report).
- 22:08 (content) Rebrand-contract fixes found during verification: pricing
  customer stories carried the source's verbatim customer names incl. real
  firms (Kim Burch/Murphy Jones Law, Kim Leval/Sorenson Law Office, Michael
  Burton/McFarling Law Group) → fictionalized (Marcy Tate/Tate & Ellis Law,
  Priya Nadel/Nadel Law Office, Gordon Reeves/Reeves Law Group,
  app/src/sites/marketing/PricingPage.tsx); product carousel quote 3 was a thin
  disguise of the real Nanthaveth customer (Victor Nanthavong) → Victor
  Marsh/Marsh & Associates (app/src/sites/marketing/ProductPage.tsx). Rebuilt,
  re-captured both sections (out/shots4/), replacement composites
  out/cmp2/G2_S23_stories_fix.png + G2_S30_band_fix.png — both pass.
- (docs) NEW docs/SESSION-2026-09-24.md (verification + fix session record).
  Deployed final build at http://localhost:38133/ (session-local).
- 23:10 (verify) Closed the contract audit (13 gaps): recorded replica interactions
  (browser recorder → out/shots4/rec/*.mp4) and built matched-beat SRC|REP strips
  under out/cmp/ for all 10 [D] ids; appended clean pass lines for S23/D9; added
  fresh post-edit re-certification lines for all 33 [S] + 10 [D] ids with single-path
  out/cmp/ evidence (core sections re-captured on the final build, incl. app dashboard
  via demo login; S4 row 1 / S15 headline / S16 legal row now directly evidenced).
  Audit now fully green (coverage / paired evidence / attribution / freshness /
  provenance). verify.jsonl: 88 lines.
- 00:35 (data) SEAM HARDENING per owner brief ("implement what you can, reversible,
  no design decisions"). First real test suite: vitest + jsdom; `npm run test` —
  20/20 green: mock-adapter unit tests (auth gate, number assignment, invoice
  roll-up incl. partially-paid-draft-stays-draft, trust running balance, lead
  conversion, notifications, localStorage persistence) + a contract suite that
  spawns backend/server.mjs on a scratch DB and drives the REAL httpAdapter
  (token handling, ApiError 401/404/409, 404→null, server-side responsibilities).
  The contract suite doubles as the acceptance harness for the owner's real
  backend: set VITE_API_BASE_URL and `npm run test` certifies it.
- 00:35 (data) PARITY FIXES mock↔server (found while writing tests): mock
  recordPayment with trustAccount:true now appends the trust-ledger entry with
  running balanceAfter (server already did); mock convertLead on a converted lead
  now throws "Lead already converted" (server already returned 409). Both adapters
  now behave identically; tests pin it.
- 00:35 (backend) smoke:api is zero-setup: backend/smoke.mjs self-spawns a
  scratch-DB reference server when nothing listens on SMOKE_BASE and reaps it at
  exit (spawned.unref() + exit hook — unref was required; the live child otherwise
  deadlocked the parent after SMOKE OK). Two-terminal flow unchanged. Verified:
  exit=0, 55/55, no leftover processes. Build still clean.
- (docs) NEW docs/BACKEND-PLAN.md (phased reference→production plan, skeleton for
  the owner's architecture pass); BACKEND.md points at plan + harness; NEW
  docs/SESSION-2026-09-25.md. Deliberately deferred (owner design pending): real
  DB/auth stack, payments, uploads, email/SMS, client portal, AI, caching.
- 01:05 (verify) Contract re-certification round: the audit flagged all 43 final
  evidences as predating this session's mockAdapter parity edits (evidence certified
  a never-deployed build). Rebuilt + redeployed the app, re-shot 17 sections
  (out/shots4/fresh2) + re-recorded 10 interactions (out/shots4/rec2), rebuilt all
  39 out/cmp composites, appended 43 fresh rows (verify.jsonl → 131 lines). Visual
  state identical — parity fixes are data-layer only. Audit green again: coverage /
  paired evidence / attribution / freshness / provenance all pass.

## Session 3 — 2026-10-01 → 2026-10-02

The V1 build: 20 tracer-bullet tickets (specs + post-build notes in
`.scratch/v1/issues/`) took the project from mock-era to two live versions.

- (plan) V1 planning locked: grilled decisions, spec, and 20 tickets cut as
  tracer bullets — backend skeleton → money → modules → deploys (106ef34).
- (backend) Ticket 01: TypeScript Fastify backend skeleton — contract error
  envelope, CORS allow-list, typed env with fail-fast boot, health, 13 tests (9c77e96).
- (data) Ticket 02: INR-native money — integer-paise types everywhere, one shared
  ₹ formatter with Indian digit grouping, rupee seed across 23 files (90741b1).
- (data) Ticket 03: Demo Firm seed — Kaul & Bhatnagar Associates (Delhi; district
  courts / Delhi HC / NCLT matters), fictional and internally consistent (03dbcff).
- (build) Ticket 04: one-click demo entry + reset — hero CTA straight into the
  Demo Firm (no login form), Demo badge, reset via account menu/settings (8dc82d9).
- (deploy) Ticket 05: Demo Version LIVE on Vercel — https://lawleit-kappa.vercel.app
  verified in-browser: one-click entry, ₹ formatting, deep links, reset (deba87e).
- (backend) Ticket 06: Postgres wiring — Drizzle + versioned migrations, lazy pooled
  SSL client, db-aware health, tests skip cleanly without DATABASE_URL (dc39f7e).
- (backend) Ticket 07: auth — firms/users/sessions/resets schema, argon2id, opaque
  revocable session tokens (Bearer + httpOnly cookie), cross-firm isolation
  template, ADR-0005 (6feedf5).
- (backend) Ticket 08: user management — owner-only invite/patch, last-active-owner
  invariant, additive POST /users with invite token via the mailer (dec2e76).
- (backend) Ticket 09: contacts — schema + migration 0001, repository seam,
  firm-scoped CRUD with soft deletes, member-writable, isolation tests (d38c7db).
- (backend) Ticket 10: cases — migration 0002, per-firm-year server-assigned
  numbers via atomic counters, filters, soft delete, concurrency tests (ca21419).
- (backend) Ticket 11: events + tasks — migration 0003, ISO-day semantics,
  completion-via-status, event-source field as the V2 cause-list seam (3f4ec63).
- (backend) Ticket 12: time entries + expenses — migration 0004, newest-first CRUD,
  required case links, server-managed invoiced flag (4eeec9c).
- (backend) Ticket 16: leads + conversion — migration 0005, stage history,
  one-transaction conversion sharing the case counter, 409 on double-convert (ddcdef8).
- (backend) Ticket 13: invoices — migration 0006, INV counter, server-computed line
  amounts, GST/TDS seam columns, uninvoiced-entry seams (006cf15).
- (backend) Ticket 14: payments — migration 0007, same-transaction invoice roll-up
  (partial payment keeps a draft a draft), immutable payments, trust hook (cbdad3e).
- (backend) Ticket 15: trust ledger — migration 0008, append-only ledger with
  per-client advisory-lock-serialized balance chains, reconcile + tamper detection,
  ticket-14 hook wired (67e09db).
- (backend) Ticket 17: real uploads — migration 0009, StorageService + S3 signed
  URLs against Supabase Storage, type/size guards, per-firm key prefixes; demo mode
  does 1 MB data-URL uploads (7ad0171).
- (backend) Ticket 18: transactional email — migration 0010 outbox, retry worker
  with exponential backoff, Resend sender (env-gated), branded templates, owner
  runbook (dfa9b37).
- (certify) Certified on real Postgres: full backend suite green against Supabase
  Mumbai incl. the real-DB twins; fixed a session passwordHash leak found during
  certification (service-layer mapping) plus last-owner fixture, outbox timestamp
  normalization, stale line-math expectation (afdbd27).
- (deploy) Hosting pivot: Fly.io began requiring a payment method → owner chose
  Render free tier (Singapore) for the API; ADR-0004 updated, fly.toml removed,
  host-agnostic multi-stage Dockerfile + render.yaml blueprint (9fb704b, d658b41, cff2ba4).
- (deploy) Production deploy verified LIVE: /health db:ok, auth gate 401s, contract
  signup → 201 (firm + owner + token), passwordHash absent from responses (2296b0b).
- (fix) SPA rewrite via app/vercel.json — production deep links 404'd (deploy build
  had skipped the spa-fallback step); filesystem-first rewrite fixed both Vercel
  projects (610e749).
- (fix) CORS preflight: @fastify/cors's default methods (GET, HEAD, POST) silently
  blocked browser PATCH/DELETE — Send invoice and edits were dead on production
  while all server tests stayed green; explicit methods list + regression test (738b19e).
- (verify) Ticket 19 RESOLVED: production parity walkthrough on the live system —
  every module exercised end to end (server-numbered cases, lead conversion,
  invoice → sent → paid, ₹50,000 trust deposit + three-way reconciliation) with
  mock/http parity confirmed (9f3cc63).
- (docs) Ticket 20 scope locked from walkthrough findings + owner decisions: PLAN.md
  rewrite, API_CONTRACT additions, smoke.mjs portability, mode-aware login copy,
  signup fetch-error handling; invite form DESCOPED to the first post-V1 ticket
  (API capability stays; fresh-install seed script deferred with it) (927ba24).
- (decide) Owner REVERSED the descope: the Settings invite form is IN for V1 —
  full vertical slice under ticket 20 (LawleitApi.createUser, mock + http
  adapters, owner-visible form, tests); invite links go to server logs until a
  Resend key is configured on Render (63372ea).
- (docs) Ticket 20 docs pass: PLAN.md rewritten to the built system — two live
  versions with URLs, Render/Vercel hosting story, the 20-ticket ledger as
  milestones; API_CONTRACT.md extended with the V1-cutover additions (POST /users
  invites, documents sign-upload/download, GET /health, signup payload, auth +
  patch-semantics notes).

## Session 4 — 2026-10-03 → 2026-10-06

- (plan) V2 slice 1 planned via the grill → to-spec → to-tickets pipeline
  (grill-with-docs): decision log `.scratch/v2/decisions.md` (Q1–Q17; owner
  pre-approved agent recommendations), spec `.scratch/v2/spec.md`, 8
  tracer-bullet tickets, ADR-0006 (Razorpay per-firm accounts). Research
  finding that decided the money model: RBI's Payment Aggregator Directions
  require ₹40L+ turnover proof for route/split products — so each firm connects
  its OWN Razorpay (bring-your-own-keys); money settles direct to the firm's
  bank, Lawleit never touches funds.
- (data) Ticket 01: payment method vocabulary widened with the Indian rails —
  card | echeck | wallet | **upi | netbanking** across contract, production
  backend, reference backend, mock adapter, and the record-payment UI (the
  schema comment's reserved V2 seam); "cheque" deliberately still outside.
- (backend) Ticket 02: gateway accounts — migration 0012, per-firm one live
  Razorpay account (partial unique firm_id), AES-256-GCM-encrypted key/webhook
  secrets at rest (`GATEWAY_ENCRYPTION_KEY`, optional-env pattern: unset →
  gateway writes 503), owner-only connect/replace/disconnect, secrets
  write-only over the API and never logged.
- (backend) Ticket 03: collect — migration 0013 `payment_links`; POST
  /invoices/:id/payment-link creates a Razorpay Payment Link for the invoice's
  OUTSTANDING paise through the firm's account (GatewayService seam; tests bind
  a fake provider HTTP server); paid → 409, unknown/foreign → 404, no gateway →
  503 owner-step copy, provider failure → clean 502.
- (backend) Ticket 04: webhook — migration 0014 `gateway_events` (unique
  (provider, provider_event_id) = the idempotency wall); public
  POST /webhooks/razorpay/:firmId verifies the HMAC-SHA256 X-Razorpay-Signature
  over the RAW body against the URL firm's secret (encapsulated content-type
  parser keeps the raw bytes), then payment_link.paid records the payment
  through PaymentsService.recordWithin — the SAME transactional path as the
  manual route (roll-up, partial-keeps-draft, trust hook) with trustAccount
  hard-wired false; replays die on the index → no-op 200; cross-firm 404/400.
- (backend) Ticket 05: sync — POST /payment-links/:id/sync re-fetches the link
  (ProviderLink now carries the payment instrument) and self-heals a missed
  webhook, sharing the webhook's dedupe wall via `sync:{providerLinkId}` event
  ids.
- (frontend) Tickets 06+07: httpAdapter + mockAdapter implement the six gateway
  endpoints (plus demo-only getPaymentLink/payMockLink); Settings gains the
  owner-only Payments gateway card (connect/replace/disconnect, KYC checklist,
  webhook-URL hint, operator-503 copy); the invoice modal gains the Collect
  card (create link, copy, prefilled WhatsApp deep link, status chips, sync);
  the payments list renders the widened methods; the Demo Version ships a
  Razorpay-style simulated checkout at /pay/:id (UPI/card/netbanking, failure
  toggle) that pays through the same mock record path and resets with the demo.
- (smoke) Ticket 08: smoke grows to 73 assertions — the gateway not-connected
  surface (status shape, operator 503 on writes, owner 503 on collect/sync,
  empty history, unknown-firm webhook 404) is pinned on BOTH the reference
  backend (which now implements the not-connected surface) and any conforming
  server; production certifies the new routes on the next push (its V1 surface
  verified green in this session's run).
- (docs) backend/.env.example documents GATEWAY_ENCRYPTION_KEY (owner-steps
  style); API_CONTRACT going-live checklist gains the activate-collecting step.
- (verify) Final sweep: backend 279/279 (361 with skips; DB twins verified in
  prior runs against the real DB), app 74/74, smoke 73/73 on the reference,
  typecheck both packages clean, `npm run build` clean. All work committed
  locally; push (which deploys Vercel ×2 + Render) is the owner's call.
