# 08: Smoke portability, docs truth, and the final verification sweep

**What to build:** The repo tells the truth about the new slice and stays certifiable
without a gateway. The portable smoke suite gains the not-connected assertions (gateway
status shape, collect 503 on a firm without a connection, paid-invoice 409 copy) and
stays fully green against both the reference backend and production — no Razorpay
credentials in CI, ever. Docs match the built system: PLAN.md's deliverable/milestone
rows mention the payments slice, CHANGELOG records it, docs/API_CONTRACT.md's going-
live checklist gains the Razorpay keys + `GATEWAY_ENCRYPTION_KEY` + per-firm webhook
URL steps, and backend/.env.example documents the new variable following the Resend
pattern's owner-steps style. Final sweep: every suite green, build clean, and a
manual smoke of the demo simulation on the built app.

**Blocked by:** 04 (webhook semantics final), 07 (demo simulation final).

**Status:** ready-for-agent

- [ ] Smoke additions pass against the reference backend AND production (portable harness, self-registering firm), no gateway credentials required anywhere
- [ ] backend/.env.example documents GATEWAY_ENCRYPTION_KEY (owner-steps style); API_CONTRACT going-live checklist gains keys + webhook URL configuration
- [ ] PLAN.md + CHANGELOG.md updated to match the built system
- [ ] Verification sweep: backend suite green WITHOUT DATABASE_URL (never points at the live database), app suite green, smoke green, typecheck both packages clean, `npm run build` clean
- [ ] Demo collect flow hand-verified on the built app (login → billing → collect → simulated pay → invoice paid → reset)
