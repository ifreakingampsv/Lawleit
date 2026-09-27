# 19: Production cutover + deploy

**What to build:** The Production Version goes live: module-by-module parity checklist completed against the real backend, the API deployed as a long-running process on Fly.io's Mumbai region (next to the database), the production frontend deployed on Vercel pointing at it via environment configuration, CORS allow-list covering the deployed origins, and a seed script for fresh installs/demo instances.

**Blocked by:** 15 (Trust accounts), 16 (Leads + conversion), 17 (Real file uploads), 18 (Transactional email).

**Status:** ready-for-agent — **requires owner**: Fly.io account (guided step at execution).

- [ ] Full contract + smoke suites green against the deployed API
- [ ] Parity checklist: every module's UI actions verified identical in mock and http modes
- [ ] API deployed (Fly Mumbai) with health check, migrations applied on deploy, secrets via platform config
- [ ] Production frontend deployed and talking to the API end to end (register → use → logout)
- [ ] Seed script can hydrate a fresh install with the Demo Firm data
