# 03: Collect — create payment links for invoices through the firm's gateway

**What to build:** Any firm user can hit "collect" on a draft, sent, or overdue
invoice: the server creates a Razorpay Payment Link for the invoice's outstanding
amount (integer paise) through the firm's connected account (GatewayService seam) and
stores it in a new `payment_links` table (provider link id, short URL, status
active/paid/expired/cancelled — an invoice may hold several links over time).
`GET /invoices/:id/payment-links` returns the history. A paid invoice refuses new
links (409); a firm without a connected gateway (or the operator without an
encryption key) gets 503 with copy pointing at the owner step. The Razorpay client is
a thin implementation behind the GatewayService interface so tests run against a fake
provider server and a future provider/model swap is contained.

**Blocked by:** 02 (gateway accounts must exist to attach links to).

**Status:** ready-for-agent

- [ ] New versioned migration adds `payment_links` (firm_id FK+idx, invoice_id FK+idx, provider, provider_link_id, short_url, amount bigint paise, status, stamps) with the repo's conventions
- [ ] `POST /invoices/:id/payment-link`: creates the link server-side via the firm's connected account; 201 returns the link shape; draft/sent/overdue only — paid 409; unknown/cross-firm invoice 404; no gateway 503 (owner-step copy)
- [ ] `GET /invoices/:id/payment-links`: newest-first history; cross-firm 404
- [ ] GatewayService seam (create link, fetch link) with the Razorpay client behind it; credentials decrypted in-memory only, never logged (asserted)
- [ ] Route tests against a fake provider HTTP server: happy path, provider failure surfaces as a clean 502/503 envelope, amount correctness (paise), link persisted; DB twins for the table constraints; full suites green (backend WITHOUT DATABASE_URL, app, smoke, typecheck)
