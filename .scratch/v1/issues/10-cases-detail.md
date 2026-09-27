# 10: Cases module + auto numbers + case detail (production backend)

**What to build:** Cases work against the real backend: schema, endpoints per the contract, server-assigned sequence-based case numbers, and the case detail aggregation (its contacts, notes, tasks, events, time, expenses, invoices) the detail page consumes. Links to contacts from the previous ticket.

**Blocked by:** 09 (Contacts module).

**Status:** ready-for-agent

- [ ] Cases CRUD per contract; numbers assigned server-side in the established format (client-sent numbers ignored)
- [ ] Case detail endpoint returns the aggregated matter view the UI expects
- [ ] Cross-firm isolation asserted by tests
- [ ] Contract + smoke suites green for cases; mock-mode parity spot checklist passes
