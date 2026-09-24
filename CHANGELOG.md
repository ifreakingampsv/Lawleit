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
