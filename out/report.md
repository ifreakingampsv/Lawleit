# Report — MyCase → Lawleit

**Shipped:** A full-stack-front-end clone of mycase.com rebranded as **Lawleit**: the
pixel-faithful marketing site (home with autoplaying hero collage, ROI calculator,
mega-menu nav, reviews carousels; pricing with plan cards/billing toggle/compare table;
6 product template pages; login/free-trial/demo pages) plus a fully functional product
app (dashboard, cases, contacts, calendar, tasks, leads pipeline, time & expenses,
invoices, payments, trust accounting, documents, communications, reports, settings —
all CRUD-backed by a seeded mock adapter with localStorage persistence and a documented
swap point for a real backend).

**Deployed at:** http://localhost:38133/ (session-local; rebuild with `cd app && npm run build`, serve `app/dist`)

**Verification:** every plan id has a final line in `out/verify.jsonl` on the final
post-scrub build — 33 [S] ids pass on SRC|REP composites (`out/cmp2/`), 10 [D] ids pass
on paired interaction evidence (screenshot-burst/before-after), and 2 ids (S5 association
band, S7 stats row) are `removed` per the 2026-09-20 owner request (real MyCase claims —
no REP comparison exists or is required). The 2026-09-24 pass also caught and fixed two
rebrand-contract violations: the pricing customer-stories names matched the source
verbatim (incl. the real firms Murphy Jones Law / McFarling Law Group) and the product
carousel carried a thin disguise of the real Nanthaveth customer — all fictionalized,
rebuilt, and re-verified (`out/shots4/`).

**Deferred (known limitations):** none deferred; interpreted-by-design areas below.

**Interpreted, not pixel-cloned (no source available):**
- Product app UI beyond the dashboard shell — MyCase rejected the self-service trial
  (geo/eligibility screening; this environment egresses from India). The dashboard shell
  was matched against the one real reference (their signup-complete backdrop); the other
  modules are functional interpretations of the documented feature set. If you sign up
  with a US-eligible firm, I can record the real UI and upgrade fidelity.
- Nav mega-menu contents, reviews/story carousel cadence, monthly pricing values —
  the live site never exposed these during capture; mechanisms are implemented to
  standard behavior and marked "interpreted" in out/plan.md.
- Marketing imagery: all MyCase screenshots/videos/logos are replaced with drawn
  Lawleit-styled mockups (see docs/REBRAND.md); real customer names replaced with
  fictional ones.

**Owner integration points:**
- `docs/API_CONTRACT.md` — REST mapping for every method of `LawleitApi`.
- `app/src/lib/data/httpAdapter.ts` — implement against your backend, flip one line in
  `app/src/lib/data/index.ts`.
- `docs/REBRAND.md` — brand-token mapping; `CHANGELOG.md` — full session log.
