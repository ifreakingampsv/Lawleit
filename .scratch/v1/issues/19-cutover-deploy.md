# 19: Production cutover + deploy

**What to build:** The Production Version goes live: module-by-module parity checklist completed against the real backend, the API deployed as a long-running process on Fly.io's Mumbai region (next to the database), the production frontend deployed on Vercel pointing at it via environment configuration, CORS allow-list covering the deployed origins, and a seed script for fresh installs/demo instances.

**Blocked by:** 15 (Trust accounts), 16 (Leads + conversion), 17 (Real file uploads), 18 (Transactional email).

**Status:** ready-for-agent — **requires owner**: Fly.io account (guided step at execution).

- [ ] Full contract + smoke suites green against the deployed API
- [ ] Parity checklist: every module's UI actions verified identical in mock and http modes
- [ ] API deployed (Fly Mumbai) with health check, migrations applied on deploy, secrets via platform config
- [ ] Production frontend deployed and talking to the API end to end (register → use → logout)
- [ ] Seed script can hydrate a fresh install with the Demo Firm data

## Comments

- (coordinator, 2026-10-01) Phase 2 DONE — API live on Render free tier (blueprint exs-dav9vud9fdbs73bfiirg, singapore): /health 200 db:ok; auth gate 401s correct; POST /auth/signup → 201 (firm+owner+token, flat contract payload: firstName/lastName/email/firmName/zip(number)/employees(number)/phone); passwordHash leak fix verified live (absent from response). Certification basis: 304/304 backend suite incl. 77 real-DB twins against the same Supabase database (afdbd27). FLY PIVOT: Fly required a card → owner chose Render free; ADR-0004 updated; fly.toml removed; Dockerfile host-agnostic. FOR TICKET 20 (harness portability): smoke.mjs assumes the reference server — (a) asserts service name "lawleit-reference-backend" (production returns "lawleit-api"), (b) logs in with SEEDED demo credentials (production DB is empty by design). Fix: make smoke register its own firm via the contract signup flow and assert service-agnostic health. Also note: signup zod requires employees+zip as NUMBERS (smoke/fixtures should match; the marketing signup form must send numbers — verify in parity pass).
