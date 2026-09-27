# 09: Contacts module (production backend)

**What to build:** The existing Contacts UI works against the real backend: schema (with firm scoping), REST endpoints per the API contract, service-layer firm filtering, and contract/smoke coverage. The frontend already speaks the seam — this ticket makes the same UI true against Postgres. First of the module series that copies the auth ticket's isolation test pattern.

**Blocked by:** 07 (Auth — register Firm, login, sessions).

**Status:** ready-for-agent

- [ ] Contacts CRUD per the API contract, server-side validation, firm-scoped
- [ ] Cross-firm isolation asserted by tests (another firm's contact 404s)
- [ ] Contract + smoke suites green for contacts
- [ ] Mock-mode parity: the same UI actions behave identically in mock and http modes (spot checklist)
