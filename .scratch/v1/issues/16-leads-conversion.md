# 16: Leads + conversion (production backend)

**What to build:** The business-development pipeline works against the real backend: leads with stages (+ stage history), the pipeline board's endpoints, and one-transaction conversion of a lead into contact + case with lead state updated. Double conversion rejected with the contract's conflict error.

**Blocked by:** 10 (Cases module + auto numbers + case detail).

**Status:** ready-for-agent

- [ ] Leads CRUD + stage transitions per contract; stage history recorded
- [ ] Conversion creates contact + case + lead-state change atomically; double conversion → conflict error (matches mock parity fix)
- [ ] Cross-firm isolation asserted; contract + smoke suites green
