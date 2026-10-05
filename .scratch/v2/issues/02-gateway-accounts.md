# 02: Gateway accounts — connect the firm's own Razorpay (schema, encryption, owner-only routes)

**What to build:** A firm owner can connect the firm's own Razorpay account in one
owner-only step: `PUT /gateway/account` stores the provider (razorpay), key id, key
secret, and webhook secret; `GET /gateway/account` reports connection status without
ever returning a secret; `DELETE /gateway/account` disconnects. Secrets are encrypted
at rest (AES-256-GCM) with a `GATEWAY_ENCRYPTION_KEY` env var that follows the repo's
optional-group config pattern: unset → gateway routes answer 503 with copy explaining
the operator step; boot still succeeds. A non-owner attempting connect is rejected by
the same permission rules the invite form uses.

**Blocked by:** None (can start immediately — independent of ticket 01).

**Status:** ready-for-agent

- [ ] New versioned migration adds `gateway_accounts` (unique firm_id, provider default razorpay, encrypted secret columns, enabled flag, soft-delete stamps) following the repo's table conventions
- [ ] `GATEWAY_ENCRYPTION_KEY` optional in typed config; unset → 503 on gateway writes with explanatory message; partial/weak key (too short) fails fast naming the variable
- [ ] Encrypt/decrypt helpers with round-trip tests; ciphertext differs for equal plaintexts (random IV); no secret ever appears in any API response, log line, or error message (asserted by test)
- [ ] PUT (connect/replace) is owner-only and upserts; GET returns status shape only; DELETE soft-disconnects; disconnect clears nothing the audit needs
- [ ] Route tests (in-memory repos) cover: owner connect, non-owner 403, replace, disconnect, 503-without-key; DB twins cover unique firm_id + encrypted-at-rest round trip
- [ ] Full suites green (backend WITHOUT DATABASE_URL, app, smoke, typecheck both packages)
