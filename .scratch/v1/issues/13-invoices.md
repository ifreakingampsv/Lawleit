# 13: Invoices + line items (production backend)

**What to build:** Invoicing works against the real backend: invoices with line items built from a case's unbilled time and expenses, totals computed server-side only (client-sent totals ignored), sequence-based invoice numbers, and the draft → sent → paid status flow driven by payments. Nullable tax columns on line items exist from day one (V2 seam for GST).

**Blocked by:** 12 (Time tracking + expenses).

**Status:** ready-for-agent

- [ ] Invoice creation from unbilled time/expenses per contract; line items and totals computed server-side
- [ ] Sequence-based invoice numbers server-assigned; draft/sent/paid status transitions correct
- [ ] Cross-firm isolation asserted; contract + smoke suites green
- [ ] Mock-mode parity spot checklist passes (including partially-paid invoices)
