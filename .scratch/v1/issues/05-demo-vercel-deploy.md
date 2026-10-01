# 05: Demo live on Vercel

**What to build:** The Demo Version deployed to a public URL on Vercel free tier (static build with SPA fallback), so the portfolio link always works. Includes the production build wiring (absolute base paths, route entrypoints) and a deploy script the owner can re-run.

**Blocked by:** 04 (One-click demo entry + reset).

**Status:** ready-for-agent — **requires owner**: a Vercel account (guided step at execution).

- [x] Demo builds for static hosting and deep links resolve (no 404s on refresh)
- [x] Deployed public URL serves the demo end to end; one-click entry works from the live marketing site
- [x] Deploy is repeatable via a documented command (owner can redeploy after edits)
- [x] Owner has the URL and it is added to the portfolio-ready state

## Comments

- (coordinator, 2026-10-01) Verified LIVE via browser: marketing site renders (₹ pricing, ROI calculator), hero 'Explore demo' lands in the Demo Firm with NO login form (dashboard greets Arjun Kaul, Demo badge shown), deep link /app/cases loads directly with no 404, account menu shows 'Reset demo data', all amounts ₹-formatted. Build source: main @ dfa9b37. URL: https://lawleit-kappa.vercel.app/ — auto-redeploys on every push to main.
