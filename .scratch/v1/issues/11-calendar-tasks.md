# 11: Calendar events + tasks (production backend)

**What to build:** Calendar events and tasks work against the real backend: schemas with firm scoping and case links, endpoints per the contract, contract/smoke coverage, parity with mock mode. The calendar's event-source field (the V2 seam for court cause-list awareness) is present from day one.

**Blocked by:** 10 (Cases module + auto numbers + case detail).

**Status:** ready-for-agent

- [ ] Events and tasks CRUD per contract, firm-scoped, linkable to cases; due/start datetimes stored UTC
- [ ] Event-source field exists (nullable, defaults to manual) — V2 seam open
- [ ] Cross-firm isolation asserted by tests; contract + smoke suites green
- [ ] Mock-mode parity spot checklist passes for both modules
