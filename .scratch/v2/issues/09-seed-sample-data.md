# 09: Seed script (Option B) — new production firms open on a labeled sample workspace

**What to build:** When a production firm signs up, it no longer lands on empty tables:
the server seeds a small, clearly-labeled sample workspace — two sample clients, one
opposing counsel, one sample case ("Sample matter — cheque bounce (s.138)") with a
hearing, a task, and a billable time entry, one draft invoice, and one trust deposit —
every entity visibly named "Sample …". A banner on the dashboard explains it and offers
a loud **Remove sample data** action (confirm-first); removing soft-deletes the sample
rows and appends a trust REVERSAL entry so the append-only ledger stays honest and the
client's balance returns to ₹0. A server-managed flag (`firms.sample_data`) tracks
never-seeded / live / removed — removed firms are never re-seeded, and existing firms
are not retrofitted. The Demo Version is untouched (it has its own full seed); the
mock adapter implements the new firm-shape field and the remove call as honest no-ops.

**Blocked by:** None.

**Status:** ready-for-agent

- [x] Migration 0015 adds `firms.sample_data` jsonb (null = not seeded); the flag is server-managed — no client path can write it (PATCH /firm's zod schema strips it; pinned by test)
- [x] Signup seeds the sample workspace for the new firm (best-effort: a seed failure never fails the signup); every sample entity carries "Sample" in its visible name; the flag records the created ids; the 201's firm shape reports the post-seed flag (refreshed after seeding)
- [x] `POST /firm/sample-data/remove` (any firm user): soft-deletes the sample rows (contacts, case, event, task, time entry, invoice, payment) and appends the trust reversal in one transaction (payments gained the seam's first `softDelete`); the flag flips to removed; second call is a no-op 409 with clear copy
- [x] The firm API shape gains `hasSampleData` (server-computed); contract + types + toApiFirm + mock adapter updated 1:1 (mock: the demo has its own seed — remove is a no-op, the banner never shows)
- [x] Dashboard banner (production http mode only): explains the sample data, Remove = confirm-first; hidden when absent/removed; Demo Version shows nothing new
- [x] Route tests: signup seeds everything labeled; remove cleans + reverses; double-remove 409; PATCH /firm cannot touch the flag; firm shape carries hasSampleData. Full suites green (backend WITHOUT DATABASE_URL, app, smoke, typecheck, build) — backend 282/282 (3 new), app 74/74
