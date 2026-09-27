# 15: Trust accounts — append-only ledger (production backend)

**What to build:** Client money held in trust works against the real backend: trust accounts per client, an append-only transaction ledger with running balance-after, deposits and (contract-permitted) disbursements, and a reconcile endpoint that asserts ledger continuity. This is the correctness-critical module — treated accordingly by tests.

**Blocked by:** 14 (Payments — manual record).

**Status:** ready-for-agent

- [ ] Ledger is append-only (no update/delete paths); every transaction stores running balance-after
- [ ] Payments flagged to trust append ledger entries exactly as mock mode does (prior parity fix behavior)
- [ ] Reconcile endpoint verifies balance continuity; test asserts a tampered/inconsistent ledger is detected
- [ ] Cross-firm isolation asserted; contract + smoke suites green
