# 09: Contacts module (production backend)

**What to build:** The existing Contacts UI works against the real backend: schema (with firm scoping), REST endpoints per the API contract, service-layer firm filtering, and contract/smoke coverage. The frontend already speaks the seam — this ticket makes the same UI true against Postgres. First of the module series that copies the auth ticket's isolation test pattern.

**Blocked by:** 07 (Auth — register Firm, login, sessions).

**Status:** ready-for-agent

- [x] Contacts CRUD per the API contract, server-side validation, firm-scoped
- [x] Cross-firm isolation asserted by tests (another firm's contact 404s)
- [x] Contract + smoke suites green for contacts
- [x] Mock-mode parity: the same UI actions behave identically in mock and http modes (spot checklist)

## Comments

- (agent, post-build) Delete IS in the contract (`DELETE /contacts/:id`), the reference (`server.mjs`) and the adapter — no additive gap for ticket 20. Permission decision: contacts are practice data, so every firm member manages them (no owner gate, unlike POST/PATCH /users) — the contract and reference gate nothing here, so neither does the backend. Implementation deltas are deliberate hardening, observable behavior unchanged: zod strips server-managed fields (id/firmId/createdAt/…) from whole-entity saves; delete is a soft delete (row stays, `deleted_at` stamped) behind identical 204/404s; type vocabulary, caseIds uuid shape and length caps get server-side 400s the mock never had (the UI only ever sends valid values — ContactsPage TYPES match `CONTACT_TYPES` exactly). No unique-ish contact fields (emails repeat), so no partial unique indexes — a same-email recreate after delete works, matching mock + reference.
- (agent, post-build) Parity spot checklist — UI action vs mock adapter, verified in-memory (route tests bind the in-memory repos): New contact with empty name/email/phone/address → "New contact" / type client / empty strings / empty caseIds, appears first in list (newest first, both sides unshift); create omits `company` on both sides (patch-only, mock and reference never read it on create); PATCH persistence — only sent fields move, whole entity echoed; Delete contact → 204, drawer contact 404s after, leaves the list, repeat delete 404s. `notes` absent from responses unless set, `createdAt` is a YYYY-MM-DD date on both sides. Route suite 12/12 green in-memory; the DB twin (`service.db.test.ts`, 4 tests) skips until the owner's DATABASE_URL exists — THAT is the real parity pass, and the truncate list there already includes `contacts`.
