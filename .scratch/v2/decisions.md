# V2 slice 1: Collecting payments via Indian rails — decision log

**Status:** Auto-approved. Per owner instruction (2026-10-03): *"For all the grill
questions going forward, just go with your recommendation … assume that as my answer
and complete all the questions … make sure you log all of these so that I can check
them later."* Every row marked **[auto]** carries the owner's standing approval of the
recommendation; review pending. Rows marked **[owner]** were answered directly.

The subagent gateway research (Razorpay/Cashfree/PayU/PhonePe/Stripe India, Oct 2026,
official pricing/docs pages) is the evidence base for Q4/Q6; key finding: **RBI's
Payment Aggregator Directions (Sept 2025) require ₹40 lakh+ domestic turnover proof
(GST-3B) for route/split-settlement products** — Razorpay Route, Cashfree Easy Split,
PayU Split Settlements are all out of reach for Lawleit today.

| # | Question | Decision | Notes |
|---|---|---|---|
| Q1 | Which feature is "P2"? | **[owner]** (a) Collecting payments via Indian rails — first slice of V2 | Slice-by-slice over whole-phase planning |
| Q2 | Demo Version behavior | **[owner]** (i) simulate — demo shows a realistic fake collect flow | Mock adapter + demo-only simulated gateway page |
| Q3 | Definition of done | **[owner]** (i) code-complete + deployed, keys pending | Go-live = owner pastes keys after KYC (30-min step) |
| Q4 | Money model | **[auto]** (i) bring-your-own-keys — each firm connects its OWN gateway account; money settles direct to the firm's bank; Lawleit never touches funds | Independently confirmed by research: the RBI ₹40L bar bars Route/Easy Split today; revisit when Lawleit's turnover qualifies. GatewayService seam leaves (ii) open |
| Q5 | Slice scope | **[auto]** Core collect flow + partial payments IN; refunds OUT; gateway-fee accounting OUT | Partial payments nearly free (roll-up already pinned by tests); refunds/fees = honest later tickets |
| Q6 | Which gateway | **[auto]** Razorpay, one standard account per firm | Best docs/test mode/links API/webhooks; 2% flat (UPI QR 0.99%); UPI Autopay maturity for the retainer follow-on; brand trust for small-firm owners. Cashfree runner-up (1.95%, UPI ~0%) — fee revisit at scale. PayU (weakest API), PhonePe (no route product, direct only), Stripe India (invite-only) out |
| Q7 | Where keys live | **[auto]** New per-firm `gateway_accounts` table (firm_id unique, provider `razorpay`, key_id, key_secret + webhook_secret AES-256-GCM-encrypted at rest with `GATEWAY_ENCRYPTION_KEY` env, enabled flag). Secrets write-only — never returned by any API response | Follows the S3/env optional-group pattern: collect routes answer 503 when the encryption key is unset; firm sees "not connected" |
| Q8 | Webhook design | **[auto]** Public unauthenticated `POST /api/v1/webhooks/razorpay/:firmId`; HMAC-SHA256 `X-Razorpay-Signature` verified with that firm's webhook secret (400 on mismatch); dedupe on `event.id` via `gateway_events` table (unique provider_event_id); 2xx fast; processing idempotent | Razorpay has no Stripe-style idempotency keys — dedupe on event.id per research |
| Q9 | Link lifecycle | **[auto]** "Collect" on a draft/sent/overdue invoice → Razorpay Payment Link (paise amount, invoice reference) → row in new `payment_links` table (link id, short_url, status active/paid/expired/cancelled — an invoice may have several over time, latest active shown). `payment_link.paid` → records a Payment via the SAME service path the manual route uses (roll-up in the same transaction, partial keeps a draft a draft); `payment.failed`/expired → event row only, no payment | |
| Q10 | Method vocabulary | **[auto]** Contract widens to `card \| echeck \| wallet \| upi \| netbanking` | The schema comment (db/schema.ts payments block) explicitly reserves this widening for V2 — this IS that seam. No `cheque` value this slice |
| Q11 | UI surface | **[auto]** "Collect via payment link" on invoice rows/detail (Billing): dialog with link, copy button, WhatsApp click-to-chat prefilled message (wa.me, zero API — the V2 phase-1 pattern), link status chip + history. PaymentsPage: upi/netbanking method badges. Demo-only simulated gateway page (`/pay/:linkId`, mock UPI/card options + success/fail toggle) | |
| Q12 | Trust firewall | **[auto]** Gateway-collected payments are ALWAYS `trust_account=false`; the webhook path cannot set the flag; trust ledger untouched by this feature | Client money stays manual-record only |
| Q13 | Permissions | **[auto]** Connect/disconnect the firm's gateway account = owner-only (matches the invite-form pattern); creating links = any firm user (practice data, matches V1 payments permission) | |
| Q14 | Testing posture | **[auto]** Route tests bind in-memory repos + a fake Razorpay HTTP server; signature-verification and replay/idempotency tests; DB twins for gateway_accounts/payment_links/gateway_events; mock-adapter demo-sim tests; smoke stays portable — asserts 503/409 when the firm has no gateway connected, full collect flow only via fake-server route tests (no real gateway in CI) | |
| Q15 | Rollout | **[auto]** No feature flag — the feature is inert until a firm connects keys; deploy to production per Q3(i) | |
| Q16 | Secrets hygiene | **[auto]** Secrets encrypted at rest, write-only over the API, never logged; webhook signature mandatory; webhook is server-to-server (no CORS) | |

**Go-live owner checklist (from the research; for later, not this slice):** proprietorship
PAN acceptable; current account in exact business name; business proof (GST/Udyam/CoR/CA
certificate); the firm's website must show Privacy/Terms/Refund/Contact pages with the
KYC name in the footer (the #1 activation rejection cause); expect a verification call;
activation 2–7 business days.

## Follow-up slice decisions (2026-10-06) — auto-adopted per the standing instruction

| # | Question | Decision | Notes |
|---|---|---|---|
| Q18 | Seed script (Option B) — exact shape? | **[auto]** Seed ON SIGNUP (production firms only), best-effort in its own step: 2 clients + 1 opposing counsel, 1 case ("Sample matter — cheque bounce (s.138)"), 1 hearing, 1 task, 1 billable time entry, 1 draft invoice, 1 trust deposit — every entity's visible name carries "Sample". Removal = soft-delete rows + a trust REVERSAL entry (the ledger stays append-only; balance returns to ₹0), tracked by a server-managed `firms.sample_data` jsonb flag (null → not seeded; ids → live; `{removed:true}` → never re-seed). Removal endpoint member-writable (matches PATCH /firm's rule); seeding is server-internal. Sample entities are NOT retrofitted to existing firms. | Trust ledger stays append-only; soft-delete columns exist for exactly this future path (payments gains the seam's first softDelete) |
| Q19 | Conflict checks — thin slice? | **[auto]** `GET /contacts/conflict-check?name=X` (firm-scoped): normalized token overlap against every contact, returning matches + their case links; the case/lead create UI calls it and shows a "possible conflict" warning. Non-blocking (an alert, not a gate) — Bar Council conflict rules are the lawyer's judgment; the tool surfaces the facts. | Full adversarial-conflict modeling is a later slice |
| Q20 | PWA | **[auto]** Manifest + SVG icon + theme-color meta: the existing SPA becomes installable ("Add to Home screen") at near-zero cost. Native apps remain out of scope. | |
