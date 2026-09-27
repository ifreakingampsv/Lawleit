# 12: Time tracking + expenses (production backend)

**What to build:** Billable time and expenses work against the real backend: time entries (create/stop timer pair per the contract), expenses against cases, endpoints, contract/smoke coverage, parity. These feed the billing tickets.

**Blocked by:** 10 (Cases module + auto numbers + case detail).

**Status:** ready-for-agent

- [ ] Time entries: start/stop timer semantics per contract; entries link to cases and users; amounts integer paise
- [ ] Expenses CRUD against cases with amounts in paise
- [ ] Cross-firm isolation asserted; contract + smoke suites green
- [ ] Mock-mode parity spot checklist passes (timer behavior identical in both modes)
