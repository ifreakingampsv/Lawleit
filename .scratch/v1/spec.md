# Spec: Lawleit V1 — Demo Version + Production Version

Status: ready-for-agent
Feature dir: `.scratch/v1/`

## Problem Statement

Small and mid-tier Indian law firms run their practice across scattered, informal
tools — notebooks, spreadsheets, WhatsApp chats — with no single place where matters,
deadlines, bills, and client money live together. International practice-management
products are shaped for US firms (US currency, US billing norms, US courts) and priced
accordingly. Separately, the owner needs a portfolio piece that lets anyone *feel* the
product instantly — without signing up, entering payment details, or being gated.

## Solution

One codebase, two versions:

- **Demo Version** — the existing rebranded frontend, opened with one click from the
  marketing site: no signup, no payment info, full access to every module, seeded with
  a believable Indian Demo Firm. Visitor edits stay private to their browser and can be
  wiped with a visible reset action.
- **Production Version** — the same frontend pointed at a real backend: real firms,
  real authentication, real file uploads, minimal transactional email, and money that
  is INR-native end to end. Indian firms can run their actual practice on it.

Everything India-specific that needs schema judgment beyond currency (GST/TDS
invoicing, payment-gateway rails, stage-based billing, retainer trust, WhatsApp,
court cause-list calendars) is V2 — but the seams it will need are left open.

## User Stories

### Demo Version (portfolio visitor)

1. As a portfolio visitor, I want to click one "Explore demo" button on the marketing site and land directly inside a working firm, so that I experience the product with zero friction.
2. As a portfolio visitor, I want every module (cases, billing, trust, documents…) fully explorable, so that I can judge the whole product rather than a teaser.
3. As a portfolio visitor, I want my demo edits to stay private to my browser, so that I can experiment freely without affecting anyone else.
4. As a portfolio visitor, I want a visible "Reset demo data" action, so that I can undo my experiments and return to the pristine demo.
5. As a portfolio visitor, I want the demo populated with a believable Indian firm — Indian names, rupee amounts, matters in a district court, the High Court, and NCLT — so that the product clearly speaks to my world.
6. As a portfolio visitor, I want to log in nowhere and enter no payment details ever, so that trying the demo costs me nothing but curiosity.

### Firm setup & users (Production Version)

7. As a firm owner, I want to register my Firm with name and email, so that my firm gets its own isolated workspace.
8. As a firm owner, I want to log in with email and password and stay logged in across visits, so that daily use feels like a tool, not a chore.
9. As a firm owner, I want to reset my password via an email link, so that a forgotten password never locks me out of my practice.
10. As a firm admin, I want to invite teammates by email, so that my Firm's lawyers each get their own login.
11. As a firm admin, I want to deactivate a user, so that departed staff lose access without losing the audit trail of their work.
12. As any firm user, I want my data invisible to every other Firm, so that client confidentiality is absolute.

### Core practice (any firm user)

13. As a lawyer, I want a dashboard showing today's events, unpaid invoices, and recent activity, so that I know what needs attention each morning.
14. As a lawyer, I want to create and browse Cases with auto-assigned numbers, so that every matter has one home with a unique handle.
15. As a lawyer, I want a case detail page gathering its contacts, notes, tasks, events, time, expenses, and invoices, so that I never hunt across screens for one matter.
16. As a lawyer, I want a Contacts address book of clients, opposing counsel, and courts, so that people and their matters stay linked.
17. As a lawyer, I want to schedule calendar events with dates, times, and case links, so that court dates and meetings never slip.
18. As a lawyer, I want a task list per case with due dates and completion state, so that nothing falls through the cracks.
19. As a lawyer, I want a start/stop timer that records billable time against a case, so that my hours capture themselves.
20. As a lawyer, I want to log expenses against a case, so that recoverable costs are tracked at the source.

### Money (any firm user)

21. As a lawyer, I want invoices built from a case's unbilled time and expenses with server-computed line items and totals, so that bills are accurate and untamperable.
22. As a lawyer, I want invoice statuses (draft → sent → paid) driven by recorded payments, so that the ledger reflects reality.
23. As a lawyer, I want to record a payment received by bank transfer, UPI, or cheque against an invoice, so that money-tracking matches how Indian firms actually get paid.
24. As a lawyer, I want trust accounts with an append-only ledger and running balance per client, so that client money is provably intact.
25. As a lawyer, I want every amount displayed in ₹ with Indian digit grouping, so that the money language is mine.
26. As a lawyer, I want sequence-based invoice numbers assigned by the server, so that numbering is gapless and trustworthy.

### Documents & communication (any firm user)

27. As a lawyer, I want to upload real files to a case's documents (permission-checked, size/type-limited), so that pleadings and agreements live with the matter.
28. As a lawyer, I want to download any document I have access to via a secure expiring link, so that retrieval is safe and fast.
29. As a lawyer, I want per-case document folders, so that document organization mirrors matter organization.
30. As a lawyer, I want message threads per contact/case with recorded entries, so that client communication history is in one place. (Sending/reminders via WhatsApp/SMS/email are V2; the thread model leaves a channel seam open.)

### Growth & oversight (any firm user)

31. As a lawyer, I want a leads board with stages and one-step conversion into contact + case, so that business development lives in the same tool as delivery.
32. As a firm owner, I want reports on revenue, hours, and outstanding balances, so that I can see the firm's health.
33. As a firm admin, I want firm settings (name, users, preferences), so that the workspace reflects the practice.

### Owner/operator

34. As the owner, I want the Demo Version deployed publicly on free hosting, so that my portfolio link always works.
35. As the owner, I want the Production Version's backend deployed with a seed script, so that real firms can be onboarded.
36. As the owner, I want the existing contract test suite to certify any backend claiming the contract, so that my backend investment is protected by tests, not vibes.
37. As the owner, I want V2 seams open (invoice tax columns, thread channel field, calendar event source), so that India localization later needs no migration pain.
38. As the owner, I want docs (plan, ADRs, glossary) updated to match the built system, so that future sessions and future me inherit the truth.

## Implementation Decisions

- **Two versions, one codebase** (ADR-0001): Demo Version runs the existing mock adapter (browser-local persistence); Production Version runs the REST adapter against the new backend. Selected by environment variable; the frontend is never rebuilt or forked, and production gating never adds demo friction.
- **Backend** (ADR-0002): TypeScript + Fastify + Drizzle ORM on managed Postgres hosted by Supabase in its Mumbai region — database only; Supabase auth/APIs/platform features unused. Layout: routes → services → db. The existing zero-dependency reference backend stays as the dev/parity harness.
- **Schema invariants**: `firm_id` on every table; money as integer paise; soft deletes; created/updated timestamps; UTC date storage; sequence-based case/invoice numbers assigned server-side.
- **Tenancy** (ADR-0003): isolation enforced in the service layer with mandatory firm scoping; no Row-Level Security in V1 (trigger to revisit: any second DB writer).
- **Auth**: email + password, argon2 hashing, httpOnly cookie sessions, server-side password-reset tokens, admin email invites. No OAuth in V1.
- **Email**: Resend, minimal set only — password reset and user invites — with a small DB-backed retry queue. Invoice/reminder email is V2.
- **Uploads**: object storage via Supabase Storage (same region as DB), signed-URL upload and download flows with permission checks, file-type allowlist, size limits; documents store metadata + storage key. S3-compatible API kept so the provider is swappable.
- **Payments**: manual record-only in V1 (bank transfer/UPI/cheque recorded server-side with invoice status roll-up); no gateway moves money. Indian gateway rails are V2.
- **Currency**: INR display with Indian digit grouping throughout; integer paise storage.
- **Demo additions**: one-click entry that lands in a seeded session (no login form), visible reset action, and a rebuilt seed portraying the fictional Demo Firm (6-lawyer Delhi firm; district court, High Court, NCLT matters; Indian names; rupees).
- **V2 seams left open**: nullable tax columns on invoice line items, a channel field on message threads, an event-source field on calendar events.
- **Hosting** (ADR-0004): both frontends are static builds on Vercel (free subdomains); the API is a long-running process on Fly.io's Mumbai region next to the database; CORS allow-list covers the Vercel origins; a purchased domain becomes required only at launch for production email.
- **Docs**: `PLAN.md` rewritten to match the built system; `AGENTS.md` conventions maintained; decisions keep landing as ADRs.

## Testing Decisions

- **A good test asserts external behavior at a seam, never implementation internals.** The codebase has exactly one logical seam — the typed API interface the frontend codes against — exercised two ways: the mock adapter in-process, and the REST adapter over real HTTP against a spawned backend.
- **The existing test suites are prior art and the definition of done**: the vitest unit/contract suite (mock-adapter units + real-adapter contract tests) and the 55-assertion smoke suite. The new backend is done per module when both suites pass against it — the contract suite doubles as the acceptance harness.
- **Tenancy tests per module**: cross-firm access attempts must 404, not leak — every module's slice includes this assertion.
- **Correctness-focused asserts**: trust ledger `balanceAfter` continuity and reconcile check; invoice status roll-up after payments; double lead-conversion rejection; server-side totals (client-sent totals ignored).
- **Upload/email flows** tested at the HTTP seam with the storage/mail providers stubbed; provider contracts verified once in a thin integration check.
- **Demo UX additions** (entry, reset, seed believability) verified visually via the existing browser-recording verification pipeline rather than unit tests.

## Out of Scope

- GST/TDS invoicing, Indian payment gateways, stage-based billing, retainer trust model changes (V2 — seams open).
- WhatsApp/SMS channels, email/SMS reminders, invoice delivery by email (V2).
- Court cause-list / hearing-aware calendars (V2).
- AI features of any kind (marketing-only today; V2 decision pending).
- Client portal, e-signature, calendar sync, QuickBooks/integrations marketplace.
- Row-Level Security hardening, custom domain purchase, caching/CDN, rate-limit tuning beyond sane defaults, OAuth/social login.
- Pixel-faithful product UI (blocked on a US-eligible MyCase trial; current UI is functional-but-interpreted and the owner may reskin later).

## Further Notes

- The frontend already exists, is rebranded, and must never be regenerated; all backend cutover happens behind the data-layer seam, and M1 only adds demo entry, reset, and seed to the existing app.
- Owner-only steps (creating the Supabase project, Fly app, Resend account) are human prerequisites; guided walkthroughs will be generated when those milestones arrive. No domain is owned; free platform subdomains are used until launch.
- The environment cannot authenticate to GitHub Issues (`gh` CLI unauthenticated) — hence the local-markdown tracker.
- Working rhythm: milestone-boundary reviews (M1 demo, M2 auth, M3 core modules, M4 billing, M5 uploads+email, M6 deploy+docs), with implementation driven ticket-by-ticket by parallel agents.
