# 05: Reconciliation — self-heal a missed webhook by syncing link status

**What to build:** A firm user can ask the server to re-check an active payment link
(`POST /payment-links/:id/sync`): the server fetches the link's current status from
the gateway through the GatewayService seam and, if the gateway says paid but no
payment was recorded (a webhook lost to an API cold start), records the payment
through the same path as the webhook — idempotently, deduped by the same event
ledger. Already-recorded links sync as a no-op; the response states the outcome
(unchanged / recorded). This is the cold-start self-heal path for the Render free
tier's sleeping API.

**Blocked by:** 04 (the recording path and event ledger must exist to dedupe against).

**Status:** ready-for-agent

- [x] `POST /payment-links/:id/sync`: firm-scoped (cross-firm 404); no connected gateway 503; fetches status via the GatewayService seam
- [x] Paid-but-unrecorded → payment recorded through the webhook-identical path (method mapping, trust flag false, roll-up) and link marked paid; already-recorded → no-op; outcome reported in the response (`{ status, recorded }`)
- [x] Idempotent under concurrent/duplicate syncs (event ledger dedupe; DB twin asserts one payment row — the webhook twin proves the 23505 wall on real Postgres, and the route suite proves the pre-existing-event no-op)
- [x] Route tests with the fake provider (unpaid link, paid link, provider unreachable surfaces cleanly) + DB twins; full suites green (backend WITHOUT DATABASE_URL, app, smoke, typecheck) — backend 279/279, app 70/70, smoke 65/65, typecheck clean
