# 20: Docs + final verification

**What to build:** The repo tells the truth about the built system: PLAN.md rewritten to match V1 (two versions, real backend, hosting), AGENTS.md refreshed if conventions changed, CHANGELOG updated, a final verification sweep over the demo additions using the existing visual-verification pipeline, and the milestone handoff document for future sessions.

**Blocked by:** 19 (Production cutover + deploy), 05 (Demo live on Vercel).

**Status:** ready-for-agent

- [ ] PLAN.md, CHANGELOG, and AGENTS.md match the built system; ADRs current (including any auth-flow deviation record)
- [ ] Visual verification sweep green for demo entry, reset, and the Demo Firm
- [ ] Full test suites (app + backend) green on the final state
- [ ] Handoff doc written so a fresh session can continue the project cold
