# Plan — Lawleit (8am MyCase clone)

**Sources:** `recordings/landing-home.mp4` (50.3s, 1440×900), `recordings/pricing.mp4` (26.4s),
`recordings/product-intake.mp4` (37.4s), stills under `out/stills/`, app reference
`out/stills/app_dashboard_ref.png` (product dashboard visible behind trial modal on the live
site's /signup_complete page).

**Rebrand contract (applies to every id):** brand identity is Lawleit, not MyCase. Layout,
structure, copy structure, interactions replicate the source; brand tokens differ by design:
MyCase orange → Lawleit violet (CTA #4B4ACF), purple band #5657D6 → lawleit gradient
(#3E3A8C→#5B54D6), footer teal → dark navy-violet #201F3D, "8am MyCase" → "Lawleit",
"8am IQ" → "Lawleit AI", "LawPay" → "LawleitPay", bar-association marks → drawn generic
association marks, real customer names → fictional ones. A composite color delta caused by
this mapping is an intentional rebrand, not a defect; everything else judges per Parity.

## Layout strategy

[S1] Global header: 52px utility bar (left brand-family links ×4, right Support/Login, bg #F5F5F3, 13px) + floating white main-nav card (24px side margins, rounded-b-xl, shadow) with logo left (~140px), 6 nav items 16px with chevrons, "Get a Demo" orange text link + 150×48px orange pill CTA (still @0.5s) {core}
[S2] Hero (full-frame anchor at load): H1 3 lines ~58px/800 black spanning ~0.42 viewport, left column ~600px; 18px paragraph; 4 bullets with 24px indigo check circles, 16px text; email input ~320×56 rounded-xl + orange 150×56 rounded-xl button, "No credit card required." 13px centered under button; right half = floating product-card collage ~600×480 (still @0.5s) {core}
[S3] Hero collage state A: white cards with soft shadows — "Batch billing setup" ~340×280 (title, filter pill, date/term fields), "Payment plan insights" ~250×130 ($2,750, teal bar+line chart), "Trust account overview" ~230×120 ($430,000.00, teal progress pills), "Smart time finder" ~230×130 (3 rows with Track-time pills); teal accent #3DBDB4 (still @0.5s) {core}
[S4] Feature icon grid (full-frame anchor): 8 tiles in row 1 + 1 centered in row 2; tile ~133×150, bg #F5F5F4 rounded-xl, periwinkle glyph ~44px top-center, 14px label, small ⓘ top-right; labels: Client intake forms, Client portal, Calendaring, Document management, AI-assisted case management, Time entry and expense tracking, Billing and invoicing, Payments powered by LawleitPay, Customizable financial reporting (still @8.45s) {core}
[S5] Association band: full-width purple (rebrand gradient) with rounded top ~24px, white H2 40px "Partnered with over 130+ bar associations" centered; 6 white drawn association marks in row 1 + 1 centered row 2 (still @8.45s bottom) {core}
[S6] ROI calculator (full-frame anchor): white rounded-3xl card ~1260×520 on purple; pill toggle (Annually active white-on-indigo, Monthly) overlapping top edge center-left; left white panel: eyebrow "INCREASE REVENUE BY" 12px caps indigo, "$158,400" ~44px indigo-700, "ANNUALLY*" 12px, divider, two stat columns split by vertical rule ("TAKE ON 276 MORE CASES" | "RECLAIM 528 HOURS ANNUALLY"), dark-indigo 180×48 rounded-full "Start saving today"; right lavender #EEEDFB panel: 5 slider rows (label 15px + ⓘ, value right 15px semibold, 4px track with dark filled portion, 20px white knob): caseload 60 cases / billable rate $300 / clients billed 50 / time invoicing 1 hour / overdue invoices 50; below card white/80 disclaimer line 13px with underlined "Learn more" (still @13.8s) {core}
[S7] Stats row on purple (full-frame anchor): 3 white cards ~400×270 rounded-2xl, gap ~24px; numbers ~64px/700 indigo (37% / 19,000+ / 64hrs), thin divider, 18px indigo label (still @14.9s) {core}
[S8] AI section: white bg; left video-thumbnail card ~515×430 (dark maroon image, floating doc labels Passport/Deposition, dark play button ~100×64 centered); right: H2 40px "Work faster, with legal AI tools built into Lawleit", 16px paragraph, orange pill "Explore Lawleit AI" (still @18.5s) {core}
[S9] Lead management (full-frame anchor): left ~560px: H2 40px "Grow faster with lead management", 16px paragraph, 3 disc bullets 16px, orange pill "Read more about lead management"; right: "Pipeline Management" card ~500×310 (eyebrow pill "This week", big orange 134 Leads Added + area chart, 3 stat tiles 63/23/38 with tiny deltas) + "Leads Over Time" line-chart card ~520×260 below (still @19.5s) {core}
[S10] Case management (full-frame anchor): mirrored: left "Case documents" card ~510×290 (orange eyebrow CASE FILES, table: retainer.docx/ABC vs. XYZ + rows) + "Cases by stage" card ~510×290 (orange horizontal bars Discovery 14 48% / Consult 8 26% / Court date pending 7 24%); right text + 3 bullets + orange pill (still @24.6s) {core}
[S11] Billing section (full-frame anchor): left text + 4 bullets + orange pill "Learn more about billing & payments"; right "Payment plan insights" card ($2,750, Autopay/Manual split bars, collected/planned line chart) + "Billing actions" card (2×2 tiles: Add invoice, Add time entry, Record payment, Deposit into trust) (still @26.7s) {core}
[S12] "Do more" panel: white rounded-3xl container on #F5F5F3; H2 40px left + "See all features" orange pill right; 3 equal columns each: 44px icon in light-indigo circle, H3 24px, two 15px gray paragraphs, orange 15px link with chevron (Easy onboarding / Feel safe and secure / Connected to your tools) (still @29.8s) {core}
[S13] Video testimonial: left dark video card ~515×290 (city dusk image, wordmark overlay, play); right bold quote ~28px/700 4 lines + attribution 15px gray (still @32.8s) {detail}
[S14] Reviews carousel (full-frame anchor): H2 36px centered "Leading law firms choose Lawleit"; white card ~1100×350 rounded-2xl shadow: purple quote glyph ~60px, quote ~24px/500 centered ~880px, avatar 40px + name 14px semibold; controls below: pause icon, 12 dots (active = elongated dark pill), prev/next 44px circle outline buttons (still @36.9s) {core}
[S15] Final CTA (full-frame anchor): white rounded-3xl card ~1260px on light bg; H2 40px "Run a more profitable firm with Lawleit", 16px sub, centered email input 320×56 + orange button (still @40s) {core}
[S16] Footer: dark navy-violet (rebrand) full-width, rounded-t-3xl; brand row of 4 white/orange wordmarks; 9 link columns in two tiers (Get in touch / Products / Pricing / Firm Type / Partner Network // Resources / Use Cases / Support / Company), 15px links white/80; divider; legal links row + 4 social glyph icons right; 12px copyright block (still @44.1s) {core}
[S17] Design tokens: text near-black #1A1A1A on #FAFAF8 page; Lawleit violet primary #4B4ACF (CTA fill, hover #3F3DB5), indigo accent #4C4CB8 for big numerals, band gradient #3E3A8C→#5B54D6, lavender surface #EEEDFB, gem-teal secondary #3DBDB4 (product-card accents), footer navy-violet #201F3D, light tile #F5F5F4; radius: cards 16–24px, pills/buttons full-or-12px; type: Inter-class sans, H1 56–58/800, H2 36–40/700, H3 24/700, body 16, captions 13–14 (read off stills @0.5–44.1s) {core}

## Pricing page (recording pricing.mp4)

[S18] Pricing hero (full-frame anchor): soft violet/lavender radial-tint bg (rebrand of pink/green wash); eyebrow "Lawleit Plans" 16px semibold; H1 ~44px/700 "Everything you need to run your firm"; 18px sub; "Bill me:" radio row — Annually (dark dot) + "Save up to 16%" soft-violet chip + Monthly (still @1.06s) {core}
[S19] Plan cards ×3 ~420px wide: Basic white ($50 strikethrough $60, outline CTA), Pro center highlighted — dark navy-violet topper bar "Most popular" (white 13px), mint #E9F5F0 body tint, name in orange-violet accent, $100 strikethrough $120, orange CTA, tallest; Advanced white ($130 / $150, dark CTA); each: tagline 16px, "Save $XXX/year" chip, price ~48px/700 + gray strikethrough, "USD/user/month" 13px, "No credit card required" 13px, divider, "What you get" 15px bold + check rows 15px (still @1.06s, @4.22s) {core}
[S20] Enhancements: eyebrow "Enhancements", H2 40px "Your whole firm, fully connected"; two columns split by vertical rule: "LawleitPay Payments $0" / "Lawleit Accounting $39", each tagline + 3 check rows (still @4.22s) {detail}
[S21] Compare table (full-frame anchor): H2 40px centered; "Expand all ⌄" left; 3 column headers (plan name + Try free buttons: outline/orange/dark); accordion groups — "Legal AI" group open showing rows (chevron + 15px bold name + 14px gray desc) with — or ✓ per column, thin row dividers (still @8.45s) {core}
[S22] No-cost tiles: H2 centered "Enjoy these features at no additional cost"; 2×2 tiles: teal glyph 44px, H3 24px dark-teal, 15px gray paragraph ×3 lines (Guided implementation / Training sessions / Award-winning support / Ongoing updates) (still @12.67s) {detail}
[S23] Customer stories: eyebrow "Customer stories", H2 36px "The proof is in their prosperity"; 3 cards ~430×390 (blush #FDF1EE rebrand→soft lavender #F3F2FC, teal quote glyph, 18px quote, bold 15px name, 14px gray firm); pill page-toggle + 2 navy 44px circular arrows bottom-right (still @14.78s) {detail}
[S24] Pricing FAQ: centered "FAQ" eyebrow, H2 40px "Frequently asked questions about pricing"; accordion rows divided by hairlines, 20px semibold questions, violet chevrons right, first item expanded with 16px answer (still @17.95s) {detail}

## Product template page (recording product-intake.mp4; same template ×6 product pages)

[S25] Product hero (full-frame anchor): centered H1 ~54px/700 2 lines "Streamline Lead Management & Client Intake", 18px 2-line sub, email capture (input 320×52 + orange 150×52), "No credit card required.", below: full-width ~1200px product screenshot card fading in from edges (still @1.04s) {core}
[S26] Feature-section pattern: thin dashed connector path with arrowheads between sections; centered H2 ~32px/700 + 14px sub; content 2-col: product-screenshot card (light border, rounded-2xl) opposite a white text card with 4 rows of indigo-check + bold lead-in + 15px text, orange pill "Try Lawleit free" + violet "Learn more ›" link (stills @9.34s, @12.45s, @16.6s) {core}
[S27] Intake Forms section specifics: left "Immigration Intake" form card (name/email/passport/SSN/visa radios ~530px wide) on mint gradient wash; right "Create custom online intake forms" card (still @9.34s) {detail}
[S28] E-Signature + stats donuts: "Streamline Onboarding" text card; "eSignature Requests" card with donut (59 Total) + 3 stat tiles 29 Pending / 12 Signed / 18 Unsent; second donut 39 Total / 19 Sent / 17 Completed / 3 In Progress (still @12.45s) {detail}
[S29] Fee Management section: left "Add Invoice" form card (Lead/Invoice Date/Invoice #/Due Date fields), right "Collect Payment Online and Automate Payment Reminders" text card (still @16.6s) {detail}
[S30] Purple testimonial band (full-frame anchor): violet band (rebrand gradient) rounded-3xl inset ~24px; white H2 ~32px "Scale Your Firm with Lead Management Software"; inner lavender #F0EFFB rounded-2xl card ~1100×370: violet quote glyph, 28px/500 quote 2 lines, avatar 44px + bold name / gray firm; controls: pause, progress pill + dots, prev/next circles (still @20.76s) {core}
[S31] Report band: white rounded-2xl card; eyebrow + H3 24px "2024 Legal Industry Trends Report", 3 short check bullets, orange pill CTA; right stacked report mockup ~300×220 (still @25.94s context) {detail}
[S32] Product FAQ: H2 32px left "Lead Management Software FAQs"; bordered rounded-xl accordion cards, 20px semibold questions, violet chevrons, first expanded with linked 15px answer (still @25.94s) {detail}
[S33] Purple CTA band: violet band; inner lavender rounded-3xl card: H2 ~40px/700 violet 2 lines, email input + dark-indigo 150×52 "Get Started", "No credit card required." 13px violet (still @29.06s) {core}

## Product app (source: out/stills/app_dashboard_ref.png — only real product evidence; rest is functional spec, untagged)

[S34] App shell: dark sidebar ~240px (logo, nav: Home, Calendar, Tasks, Cases, Contacts, Reports; "Modules" label; Billing, Payments, Accounting, Documents, Communications, Leads — each with chevron; active row highlighted); top bar: hamburger, search input ~330px, run-timer "▶ 00:00:00", 4 icon buttons (one with 99+ badge), + button in orange square, avatar chip (ref still) {core}
[S35] Dashboard (full-frame anchor): "Good morning, Alex!" 24px bold + date line, "Customize" outline button right; Quick actions card (Add event / Add task / New Message / Create time entry pill buttons); Timesheet card: "Billable total $2,220" big number, mini month calendar tile, stats Billable/Non-billable/Total rows (Today 3.5/3.2/$700 · This week 11.1/22.9/$2,220.00 · This month 81.9/46.4/$16,380.00); Financial overview card with "All cases" filter; right column: date+agenda (colored event rows: Client Meeting 11am–12pm Main Conference Room; Lunch with Bob Bryant 12–1pm; New Client Consultation – Family Law 1pm) with All users/All types/Day filters (ref still) {core}

### App functional spec (untagged — no source video exists; MyCase product access requires real-firm signup, owner action pending. UI interpreted from ref still + feature set; owner will restyle.)

- Auth: /login, /free-trial (form over blurred app preview — mirrors live site's modal page), /schedule-demo. Mock auth: any credentials → seeded firm session; trial form → creates firm + redirects to /app with onboarding checklist.
- Routes under /app: dashboard, calendar (month/week/day, event create), tasks (list w/ status flow), cases (list + detail: overview/documents/time/tasks/billing tabs, case create), contacts (clients/companies, detail), leads (kanban pipeline with stage drag), time (timer + entry grid), expenses, invoices (create, line items, status, mark sent/paid), payments (list, record payment), accounting (trust balances, transactions), documents (folders, upload-mock, templates), communications (threaded messages/emails), reports (predefined charts: revenue, hours, cases by stage, AR aging), settings (firm, users, billing sync toggle).
- Global: command-palette-style search, run timer in topbar that creates time entries, notifications drawer, all mutations persist to localStorage via mock adapter.

## Component breakdown (untagged — architectural)
- `src/sites/marketing/`: `SiteHeader` (utility bar + mega nav), `SiteFooter`, section components per id; pages Home, Pricing, ProductPage (content-config driven ×6), Login, FreeTrial, ScheduleDemo, ComingSoon.
- `src/sites/app/`: `AppShell` (sidebar + topbar + timer store), module pages.
- `src/lib/data/`: types.ts, api.ts (interface), mockAdapter.ts (localStorage, seeded), httpAdapter.ts (fetch stub for owner's backend), index.ts (swap point).
- Drawn SVG assets: logo (faceted gem wordmark), association marks ×7, donut/line/area/bar charts (recharts or hand SVG), all product-mockup cards as DOM (crisp at 3×), social glyphs.

## Interactions & animations
[D1] Hero collage autoplay: cycles 4 product-UI states (A billing collage → B dashboard w/ Today's events → C dashboard + Leads-over-time overlay → D calendar/board view) by crossfade ~500–700ms (cards blur/fade out, next set eases in), full cycle ~2.5–3s per state, time-driven (runs with cursor parked, no scroll — clip 0.3–7.5s; framer-motion AnimatePresence; testid=hero-visual) {core} {render}
[D2] Nav mega-menu: hover-intent on Products/Firm Type/Use Cases/Resources opens dropdown panel (~900px, link columns + short descriptors), closes on outside move; not captured open in source recording (cursor sat on trigger, menu did not open — click-gated on live site) → pattern interpreted from nav labels + footer sitemap (clip 0.3–7.5s; testid=mega-menu) {detail} {render}
[D3] ROI calculator: dragging any slider live-updates $158,400 / 276 / 528 figures (formula fit to source defaults: hours/mo = 0.5·caseload + 0.2·clients + 0.08·overdue; cases = 0.523·hours; revenue = 12·hours·rate); Annually/Monthly toggle re-scales figures (annually shown by default) (clip 9.5–16.5s; testid=roi-card, roi-slider-0..4, roi-revenue) {core} {render}
[D4] Reviews carousel: prev/next arrows swap quote with horizontal slide ~300ms, active dot elongates; 12 pages; autoplay present but slow (pause control) — arrow click not captured in source (dots/arrows visible still @36.9s); interpreted cadence (testid=reviews-carousel, reviews-next) {detail} {render}
[D5] Pricing billing toggle: Annually↔Monthly swaps all three plan prices ($50→$60, $100→$120, $130→$150 monthly equivalents) and hides save chips; radio dot slides (interpreted: source shows toggled states at 1.06s annually; testid=billing-toggle) {core} {render}
[D6] Pricing compare accordion: group + row chevrons expand/collapse with ~200ms height ease; "Expand all" opens every group (clip 7–10s shows collapsed/expanded states; testid=compare-group-legal-ai) {detail} {render}
[D7] Pricing FAQ + product FAQ accordions: click expands answer, chevron rotates 180°, ~200ms (stills @17.95s, @25.94s; testid=faq-item-0) {detail} {render}
[D8] Pricing customer-stories carousel: arrows advance 3-card page with slide, pill toggle tracks page (still @14.78s; testid=stories-carousel) {detail} {render}
[D9] Product purple testimonial carousel: auto-advances (progress pill fills), pause button, arrows (still @20.76s shows pause + progress); cadence interpreted ~6s (testid=product-carousel) {detail} {render}
[D10] Sticky header behavior: main nav card stays pinned while utility bar scrolls away (header is sticky card at every scroll position in recording; clip 9.5–16.5s top edge; CSS sticky; testid=site-header) {core} {render}

Confidence notes: D2/D4/D9 cadence and D5 monthly prices are interpreted (marked) — source recording never triggered them; mechanisms implemented to standard SaaS behavior. All other [D] numbers read off clips.

## Verification anchors
Full-frame SRC|REP anchors: S2, S4, S6, S7, S9, S10, S11, S14, S15, S18, S19, S21, S25, S30, S33, S35. Section ids may share their anchor's composite. Rebrand color deltas are per the rebrand contract, not defects.
