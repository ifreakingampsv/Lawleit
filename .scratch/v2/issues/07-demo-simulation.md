# 07: Demo Version — simulate the whole collect flow (no real gateway)

**What to build:** The portfolio demo lets a visitor feel collection end to end: the
mock adapter gains a simulated gateway — creating a payment link yields a link to a
demo-only simulated gateway page (Razorpay-style hosted checkout look-and-feel with
UPI/card/netbanking options and a success/fail toggle); "paying" flows through the
same mock recordPayment path a manual record uses (webhook-equivalent, identical
roll-up semantics, partial payments included, method from the chosen option, trust
flag never set), and the whole thing wipes cleanly with the existing "Reset demo
data". The demo stays private to the visitor's browser — no network calls, no real
Razorpay anywhere in mock mode.

**Blocked by:** 06 (the Collect dialog it flows from), 01 (vocabulary).

**Status:** ready-for-agent

- [x] Mock adapter: createPaymentLink / listPaymentLinks / syncPaymentLink mirroring the contract shapes; "gateway" is in-browser simulation only
- [x] Demo-only simulated gateway page reachable from the Collect dialog's link (mock mode only — production http mode never routes there), UPI/card/netbanking options, success/fail toggle
- [x] Paying records through the mock payment path: invoice roll-up identical to manual records (partial keeps a draft a draft), method badge correct, payments list updated, trust ledger untouched
- [x] Reset demo data clears links + simulated payments completely (pinned by test)
- [x] App vitest/jsdom suite covers simulate → pay → roll-up → reset; full suites green (backend WITHOUT DATABASE_URL, app, smoke, typecheck, `npm run build`) — app 74/74 (4 new), build clean
