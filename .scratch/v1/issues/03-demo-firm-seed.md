# 03: Demo Firm seed

**What to build:** The Demo Version's dataset is rebuilt as a believable fictional Indian firm: a ~6-lawyer firm in Delhi with matters spanning a district court, the Delhi High Court, and NCLT; Indian names throughout; rupee amounts; realistic case numbers, invoices, trust balances, leads, tasks, events, and threads. This is the Demo Firm a portfolio visitor lands in — believable at a glance, never a real firm.

**Blocked by:** 02 (INR money plumbing).

**Status:** ready-for-agent

- [ ] Seed covers every module with believable, internally consistent data (dates near "today", linked contacts ↔ cases ↔ invoices ↔ payments)
- [ ] All names/firms are fictional; no real person or firm appears (rebrand rule)
- [ ] Matters reference Indian courts/forums believably (district court, Delhi HC, NCLT)
- [ ] Amounts are rupee-realistic for a small firm (per ticket 02's paise convention)
- [ ] Demo app loads each module without errors; app test suite stays green
