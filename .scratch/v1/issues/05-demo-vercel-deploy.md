# 05: Demo live on Vercel

**What to build:** The Demo Version deployed to a public URL on Vercel free tier (static build with SPA fallback), so the portfolio link always works. Includes the production build wiring (absolute base paths, route entrypoints) and a deploy script the owner can re-run.

**Blocked by:** 04 (One-click demo entry + reset).

**Status:** ready-for-agent — **requires owner**: a Vercel account (guided step at execution).

- [ ] Demo builds for static hosting and deep links resolve (no 404s on refresh)
- [ ] Deployed public URL serves the demo end to end; one-click entry works from the live marketing site
- [ ] Deploy is repeatable via a documented command (owner can redeploy after edits)
- [ ] Owner has the URL and it is added to the portfolio-ready state
