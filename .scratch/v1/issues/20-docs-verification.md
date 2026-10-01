# 20: Docs + final verification

**What to build:** The repo tells the truth about the built system: PLAN.md rewritten to match V1 (two versions, real backend, hosting), AGENTS.md refreshed if conventions changed, CHANGELOG updated, a final verification sweep over the demo additions using the existing visual-verification pipeline, and the milestone handoff document for future sessions.

**Blocked by:** 19 (Production cutover + deploy), 05 (Demo live on Vercel).

**Status:** ready-for-agent

- [ ] PLAN.md, CHANGELOG, and AGENTS.md match the built system; ADRs current (including any auth-flow deviation record)
- [ ] Visual verification sweep green for demo entry, reset, and the Demo Firm
- [ ] Full test suites (app + backend) green on the final state
- [ ] Handoff doc written so a fresh session can continue the project cold

## Comments

- (coordinator, 2026-10-02) Scope locked from walkthrough findings + owner decision: (1) PLAN.md rewrite to the built system; (2) API_CONTRACT.md additions — POST /users invite endpoint, documents sign-upload/download endpoints, GET /health, signup payload note (zip STRING, employees NUMBER); (3) smoke.mjs portability — register its own firm, service-agnostic health assert, must pass against the reference AND production; (4) login page helper copy mode-aware (no "Mock auth" text in production); (5) signup/login fetch-error handling — no infinite "Creating your workspace…" (walkthrough UX bug); (6) DECISION: invite form DESCOPED from V1 per coordinator recommendation, owner delegated — ships as first post-V1 ticket bundled with Resend key setup (API capability stays); full seed script likewise deferred to that ticket (fresh-install verification = portable smoke against prod). (7) Final verification sweep scoped to changed surfaces + handoff doc.
