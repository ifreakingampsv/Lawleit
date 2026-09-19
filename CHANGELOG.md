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
