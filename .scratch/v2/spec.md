# Spec: V2 slice 1 — Collecting payments via Indian rails (Razorpay, per-firm)

Status: ready-for-agent
Feature dir: `.scratch/v2/`
Decision log: `.scratch/v2/decisions.md` (Q1–Q17; [owner] rows answered directly, [auto]
rows adopted per the owner's standing instruction) · Gateway decision: ADR-0006

## Problem Statement

A small Indian law firm using Lawleit can *record* money it received, but the product
cannot *collect* it. When an invoice goes out, the firm owner emails or WhatsApps a
client, waits for a bank transfer, then types the payment in by hand — and chases
clients who delay. Indian clients expect to tap a link and pay by UPI in seconds; firms
that can't offer that look dated and get paid slower.

## Solution

A firm owner connects the firm's own Razorpay account to Lawleit once (Settings,
owner-only, keys stored encrypted). From then on, any firm user can hit "Collect via
payment link" on an invoice: Lawleit creates a Razorpay payment link for the invoice
amount, and the user shares it by copy or a prefilled WhatsApp message. The client
pays on Razorpay's hosted page (UPI / cards / netbanking); a webhook tells Lawleit,
which records the payment through the exact same rules as a manual record (invoice
roll-up, partial payments included) and marks the link paid. Money settles directly
into the firm's bank account — Lawleit never touches it (ADR-0006). The Demo Version
simulates the whole flow with a fake gateway page so portfolio visitors can feel it.

## User Stories

1. As a firm owner, I want to connect my firm's Razorpay account by pasting my API keys in Settings, so that my firm can collect payments into my own bank account.
2. As a firm owner, I want my gateway keys stored encrypted and never shown back to anyone, so that a leaked screen or API response can't compromise my Razorpay account.
3. As a firm owner, I want to disconnect or replace my gateway account, so that a rotated key or a provider change doesn't require support.
4. As a firm owner, I want gateway connection to be owner-only, so that staff can't repoint where the firm's money lands.
5. As a lawyer, I want a "Collect via payment link" action on a draft/sent/overdue invoice, so that getting paid is one click instead of a chase.
6. As a lawyer, I want the payment link shared via a copy button or a prefilled WhatsApp message, so that I can send it through whichever channel the client actually reads.
7. As a lawyer, I want to see each invoice's link status (active / paid / expired), so that I know at a glance whether the client has paid.
8. As a lawyer, I want an expired or cancelled link replaceable with a fresh one, so that a stale link never blocks collection.
9. As a lawyer, I want partial payments accepted through a link, so that a client who can't pay the full invoice today still moves the balance (and the invoice status behaves exactly as with a manual partial record).
10. As a lawyer, I want a "sync from gateway" action on an active link, so that a webhook missed during an API cold start self-heals without waiting for Razorpay's retries.
11. As any firm user, I want collected payments to appear in the payments list with their real method (UPI / netbanking / card), so that the money trail reflects how clients actually paid.
12. As any firm user, I want a client's payment through a link to update the invoice automatically (sent → paid, partial keeps a draft a draft), so that collected and manually recorded money behave identically.
13. As a firm owner, I want gateway-collected payments to never touch the trust ledger, so that client trust money stays a deliberate manual act (Q12).
14. As a firm owner, I want each firm's webhooks isolated (a webhook call can only affect the firm named in its URL and verified against that firm's secret), so that firm A's gateway can never write into firm B's books.
15. As any firm user, I want a duplicate webhook delivery to change nothing, so that Razorpay's retries can't double-record a payment.
16. As a portfolio visitor on the Demo Version, I want to simulate the whole collect flow — collect, pay on a fake gateway page by UPI or card, and watch the invoice flip to paid — so that I can feel the feature without a real gateway.
17. As a portfolio visitor, I want the demo's simulated payments to reset with "Reset demo data", so that my experiments stay private and disposable.
18. As the owner of a firm that has NOT connected a gateway, I want the collect action to explain what's missing instead of erroring, so that onboarding is obvious.
19. As the running system, I want webhook signature verification mandatory, so that a forged request can never record a payment.
20. As the running system, I want every gateway event stored once keyed by its provider event id, so that retries and replays are provably safe.
21. As a developer/conforming server, I want the payment-method vocabulary widened in the API contract (card | echeck | wallet | upi | netbanking), so that the reference, mock, and production backends stay byte-shape compatible.
22. As the firm owner reading the smoke suite output, I want it green without any real gateway, so that CI and the portable harness never need Razorpay credentials.

## Implementation Decisions

- **Money model (ADR-0006):** bring-your-own-keys. Each firm connects its own Razorpay
  standard account; links are created via the firm's credentials; settlement is direct
  to the firm's bank. The gateway sits behind a thin **GatewayService** seam (create
  link, fetch link) so a future flip to a route/split model or a second provider is an
  implementation swap.
- **Schema (migration 0012), mirroring the module's existing five-piece pattern:**
  - `gateway_accounts` — one per firm (unique firm_id), provider (default `razorpay`),
    key_id, key_secret (AES-256-GCM encrypted at rest), webhook_secret (encrypted),
    enabled flag, soft-delete stamps.
    - `payment_links` — firm_id FK+idx, invoice_id FK+idx, provider, provider_link_id,
      short_url, amount (bigint paise), status (`active`/`paid`/`expired`/`cancelled`),
      stamps. An invoice may hold several links over time; the UI shows the latest
      non-terminal one. Amounts are integer paise end to end.
  - `gateway_events` — firm_id, provider, provider_event_id (unique per provider),
    event type, raw payload reference, processed flag — the idempotency ledger.
- **Config:** `GATEWAY_ENCRYPTION_KEY` env var, optional as a group of one (S3/Resend
  pattern): unset → collect/connect routes answer 503 with an explanatory message;
  set → full feature. Boot does not require it (the feature is inert until a firm
  connects).
- **API surface (contract-first — docs/API_CONTRACT.md is updated in the same change):**
  - `PUT /gateway/account` (owner-only) — connect/replace { provider, keyId,
    keySecret, webhookSecret }; secrets write-only, never returned (responses carry
    provider, keyId, enabled, connectedAt).
  - `DELETE /gateway/account` (owner-only) — disconnect (soft delete).
  - `GET /gateway/account` — connection status for the settings UI.
  - `POST /invoices/:id/payment-link` — create a payment link (draft/sent/overdue
    invoices only; paid → 409; no connected gateway → 503 with copy explaining the
    owner step).
  - `GET /invoices/:id/payment-links` — link history.
  - `POST /payment-links/:id/sync` — reconciliation: server fetches the link from
    Razorpay and, if paid-but-unrecorded, records the payment through the same service
    path as the webhook (and the manual route).
  - `POST /webhooks/razorpay/:firmId` — public, unauthenticated, server-to-server:
    mandatory HMAC-SHA256 `X-Razorpay-Signature` verification against that firm's
    webhook secret (400 on mismatch), dedupe on provider event id, 2xx fast.
- **Webhook semantics:** `payment_link.paid` maps the payment instrument to the widened
  method vocabulary (`upi`/`netbanking`/`card`) and records a Payment with
  `trust_account` hard-wired false, then the existing same-transaction roll-up runs
  (paid when Σ non-failed payments ≥ total; partial keeps a draft a draft; overdue
  rolls back to sent on partial). `payment.failed`/link expiry append only to
  `gateway_events`. The firm in the URL path must match the link's firm — a valid
  signature from firm A's secret cannot touch firm B's link (cross-firm 404, tested).
- **Method vocabulary:** widened to `card | echeck | wallet | upi | netbanking` in the
  contract, `types.ts`, the production backend, the reference backend, and the mock —
  the widening the schema comment explicitly reserved for V2. No `cheque` value this
  slice.
- **Frontend:** Settings gains a "Payments gateway" card (owner-only): connect /
  replace / disconnect with a KYC checklist link; Billing gains the Collect action and
  link status/history; Payments page gains upi/netbanking method badges. The
  httpAdapter implements the new endpoints 1:1 with the contract.
- **Demo Version:** the mock adapter gains a simulated gateway: creating a link yields
  a link to a demo-only simulated Razorpay-style page (UPI/card options, success/fail
  toggle), "paying" flows through the same mock recordPayment path (webhook-equivalent),
  and everything resets with the existing demo reset.
- **Cold-start reality (Q17):** Render free tier sleeps ~15 idle minutes; a webhook may
  arrive while the API is waking. Razorpay retries, but the "sync from gateway"
  reconciliation (story 10) is the self-heal path; the UI surfaces it on active links.

## Testing Decisions

- **Good tests assert external behavior only** — HTTP status/shape via route tests,
  observable state (invoice status, payment rows, ledger untouched), never internals.
- **Zero new test seams.** Production side: the existing route-test seam (Fastify
  `inject` binding in-memory repositories), with a fake Razorpay HTTP server standing
  in for the provider behind the GatewayService seam — signature-valid, signature-
  invalid, replayed, cross-firm, cold-response cases all driven through the public
  webhook/collect routes. DB twins (real Postgres) cover the new tables' constraints
  and the unique event-id dedupe, following every module's existing
  `service.db.test.ts` pattern. Demo side: the existing vitest + jsdom seam over the
  mock adapter (simulate collect → simulated pay → invoice roll-up → reset), prior art
  in `app/tests/mockAdapter.test.ts`.
- **Smoke stays portable and gateway-free:** it asserts the not-connected behavior
  (503/409 + explanatory copy) on any conforming server; no Razorpay credentials in
  CI, ever.
- **Backend tests must run without `DATABASE_URL`** (in-memory bindings) so a test run
  can never truncate the production database.

## Out of Scope

- Refunds (in-product), gateway-fee accounting, subscriptions/UPI Autopay/eMandates
  (the V2 retainer follow-on), payment plans/installments.
- WhatsApp Business API sending (phase 2) — this slice shares links via the zero-cost
  click-to-chat deep link only.
- The Lawleit-as-collector model (Razorpay Route / Easy Split) — barred by the RBI PA
  turnover bar; revisited when Lawleit's turnover qualifies (ADR-0006).
- Cheque as a collected method; multiple providers per firm; gateway onboarding
  automation (the firm's Razorpay KYC is a firm-side task — the UI links a checklist).
- The production-DB seed script (separate approved item, ticketed separately).

## Further Notes

- Deploy is push-to-deploy on `main` (Vercel ×2 + Render with migrations-on-boot); the
  feature is inert on production until a firm connects keys, so shipping is safe
  before any KYC is done (Q3/Q15).
- Go-live owner checklist (Razorpay KYC: entity/PAN, bank account in the business
  name, business proof, website policy pages, verification call, 2–7 days) ships with
  the Settings card.
- Decisions Q1–Q17 and their rationale: `.scratch/v2/decisions.md`. Vocabulary additions
  (Record/Collect/Payment Link/Gateway Account): `CONTEXT.md`.
