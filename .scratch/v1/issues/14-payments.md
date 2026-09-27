# 14: Payments — manual record (production backend)

**What to build:** Recording money received works against the real backend: a user records a payment (bank transfer / UPI / cheque — mode recorded) against an invoice; the server applies it, updates invoice status roll-up, and never moves real money. No gateway in V1 (V2 seam: payment-mode enum already Indian-realistic).

**Blocked by:** 13 (Invoices + line items).

**Status:** ready-for-agent

- [ ] Payment recorded per contract; overpayment under/tolerance behavior matches the contract exactly
- [ ] Invoice status roll-up after every payment (matches mock-mode behavior — prior parity fix)
- [ ] Cross-firm isolation asserted; contract + smoke suites green
