# 01: Widen the payment method vocabulary to Indian rails (contract-first expand)

**What to build:** The API contract, the production backend, the reference backend, and
the mock adapter all accept `upi` and `netbanking` as payment methods — everywhere a
firm user records money received, and in every response shape. Manual recording still
works exactly as before with the old values; this ticket only *expands* the accepted
vocabulary (per the schema comment that explicitly reserved this widening for V2). No
UI or collect flow yet — that is what makes this a safe first slice.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [x] `docs/API_CONTRACT.md` documents the widened vocabulary (card | echeck | wallet | upi | netbanking) including where it appears
- [x] Production backend accepts and stores the new values; unknown methods still 400 with the contract error envelope
- [x] Reference backend (`server.mjs`) accepts the new values 1:1 with the contract (permissive by design — `method ?? "card"`; proven by the httpAdapter contract test driving it with upi/netbanking)
- [x] Mock adapter type + validation widened; byte-shape parity holds across all three
- [x] Tests updated on all surfaces (parity pinned); full suites green (backend WITHOUT DATABASE_URL, app, smoke, typecheck both packages) — backend 243/243 (db twins skipped), app 70/70, smoke 65/65
- [x] `npm run build` clean
