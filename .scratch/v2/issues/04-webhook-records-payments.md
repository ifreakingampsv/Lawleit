# 04: Webhook — Razorpay results record payments through the existing roll-up

**What to build:** Razorpay's webhook (`payment_link.paid`) lands on a public
unauthenticated route `POST /webhooks/razorpay/:firmId` and becomes a recorded
payment — through the SAME service path the manual route uses, so the invoice roll-up
behaves identically (paid when Σ non-failed payments ≥ total; a partial payment keeps
a draft a draft; overdue rolls back to sent on partial). The instrument maps into the
widened method vocabulary (upi/netbanking/card); the payment is always recorded with
`trust_account=false` — gateway money can never enter the trust ledger. Every event is
stored once in `gateway_events` keyed by provider event id; a replayed or duplicate
delivery changes nothing. The signature is mandatory: an HMAC-SHA256
`X-Razorpay-Signature` mismatch is a 400 before any processing, and a valid signature
from firm A's secret cannot touch firm B's link (cross-firm 404). `payment.failed` and
expiry events append to the event ledger only.

**Blocked by:** 03 (links must exist for webhook events to reference).

**Status:** ready-for-agent

- [ ] New versioned migration adds `gateway_events` (firm_id, provider, provider_event_id unique per provider, event type, processed flag, stamps) — the idempotency ledger
- [ ] Webhook route: signature verified against the URL-named firm's webhook secret; mismatch 400 with empty body; unknown firm 404; 2xx returned fast
- [ ] payment_link.paid → payment recorded via the same transactional path as manual recording (method mapping, trust flag hard-wired false) + link status flips to paid; duplicate/replayed event id is a no-op 2xx (asserted: exactly one payment row after N replays)
- [ ] Cross-firm isolation test: valid signature, foreign firm id in URL → 404 and no rows written anywhere
- [ ] payment.failed/expiry events recorded in the ledger without side effects on payments or invoices
- [ ] Route tests (fake provider signatures) + DB twins for the unique event constraint; full suites green (backend WITHOUT DATABASE_URL, app, smoke, typecheck)
