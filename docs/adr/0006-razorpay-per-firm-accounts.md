# Razorpay per-firm accounts (bring-your-own-keys) for payment collection

V2 payment collection has each client firm connect **its own** Razorpay standard
account (API key_id/key_secret + webhook secret, stored encrypted per firm in
`gateway_accounts`); payment links are created through the firm's account via the
Payment Links API and money settles **directly into the firm's bank account** —
Lawleit never holds, routes, or touches funds. The decisive external constraint:
RBI's Payment Aggregator Directions (Sept 2025) require **₹40 lakh+ domestic turnover
proof (GST-3B)** for route/split-settlement products, which bars Lawleit (a solo-founder
startup) from Razorpay Route, Cashfree Easy Split, and PayU Split Settlements alike —
the "Lawleit collects and routes" model is not legally reachable today. Research date:
2026-10-03 (official Razorpay/Cashfree/PayU pricing and docs pages).

## Considered Options

- **Razorpay Route / Cashfree Easy Split / PayU Split Settlements** (one Lawleit
  account, sub-merchant firms) — rejected for now: the ₹40L GST-3B turnover proof
  blocks the platform itself, and each firm would still need full sub-merchant KYC
  under the same PA regime, so Lawleit would carry compliance burden without escaping
  onboarding friction. Revisit when Lawleit's own turnover qualifies.
- **Razorpay per-firm standard accounts** — adopted: best docs, test mode, Payment
  Links API, and webhook story of the three majors; 2% flat (UPI QR 0.99%); most
  mature UPI Autopay/eMandate stack for the V2 retainer follow-on; brand recognition
  reassures small-firm owners. Fee trade-off accepted: Cashfree is cheaper (1.95%,
  UPI ~0%) and is the designated runner-up if fees matter at scale.
- **PayU** — rejected: weakest API/docs of the three, sales-negotiated pricing.
- **PhonePe PG** — rejected: no collect-on-behalf product; direct-merchant only.
- **Stripe India** — rejected: invite-only, effectively unavailable.
- **Manual recording only (V1 status quo)** — rejected for V2: firms asked to
  actually collect; but manual recording remains fully supported and is the only path
  to the trust ledger (gateway money is never trust money).

## Consequences

- Lawleit stays out of money-handling compliance (no merchant-of-record obligations,
  no PA registration track) — the solo-founder-compatible position.
- Onboarding friction is real: every client firm completes its own Razorpay KYC
  (2–7 business days; proprietorship PAN acceptable; website must show
  Privacy/Terms/Refund/Contact pages with the KYC name — the #1 rejection cause).
  A templated checklist lands with the feature.
- Lawleit takes on per-tenant secret-keeping duty: `gateway_accounts.key_secret` and
  `webhook_secret` are AES-256-GCM encrypted at rest (`GATEWAY_ENCRYPTION_KEY` env),
  write-only over the API, never logged.
- Webhooks are per-firm (`POST /webhooks/razorpay/:firmId`), HMAC-SHA256-verified with
  the firm's secret, deduped on `event.id` (Razorpay has no idempotency keys).
- The gateway sits behind a thin `GatewayService` seam, so a future flip to a
  route/split model (or a second provider like Cashfree) is an implementation swap,
  not a redesign.
