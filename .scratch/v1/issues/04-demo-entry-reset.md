# 04: One-click demo entry + reset

**What to build:** The marketing site's "Explore demo" call-to-action lands a visitor directly inside the seeded Demo Firm — no login form, no email, no payment info — and the app exposes a visible "Reset demo data" action that restores the pristine seed. Demo edits stay private to the visitor's browser (existing mock adapter persistence).

**Blocked by:** 03 (Demo Firm seed).

**Status:** ready-for-agent

- [ ] One click from the marketing site enters the working demo app in the Demo Firm, skipping authentication entirely
- [ ] A visible reset action wipes local demo state back to the pristine seed and returns to a clean first-run experience
- [ ] No signup or payment friction is introduced anywhere in the demo path
- [ ] Deep links into the demo app still work (SPA fallback intact)
- [ ] App test suite green; build clean
