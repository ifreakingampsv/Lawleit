# 02: INR money plumbing (prefactor)

**What to build:** All money in Lawleit becomes INR-native: one shared formatter that renders ₹ with Indian digit grouping (1,50,000) from integer-paise amounts, contract/domain types updated so every money field is documented integer paise, demo seed amounts switched to realistic rupee values, and every display call site migrated to the formatter. "Make the change easy, then make the easy change" — every later money touchpoint (invoices, trust, payments) inherits this.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A single money module exports format + parse helpers; no component formats currency inline anymore
- [ ] Domain types declare money as integer paise (documented); seed data uses believable rupee amounts
- [ ] No `$`/USD-style money rendering remains (grep-clean); demo UI shows ₹ with Indian grouping
- [ ] App test suite green (updated where amounts were asserted); build clean
- [ ] Smoke suite still green (units are semantic; no hardcoded dollar expectations)
