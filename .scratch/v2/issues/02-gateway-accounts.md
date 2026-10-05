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

- [x] New versioned migration adds `gateway_accounts` (unique firm_id, provider default razorpay, encrypted secret columns, enabled flag, soft-delete stamps) following the repo's table conventions
- [x] `GATEWAY_ENCRYPTION_KEY` optional in typed config; unset → 503 on gateway writes with explanatory message; partial/weak key (too short) fails fast naming the variable
- [x] Encrypt/decrypt helpers with round-trip tests; ciphertext differs for equal plaintexts (random IV); no secret ever appears in any API response, log line, or error message (asserted by test)
- [x] PUT (connect/replace) is owner-only and upserts; GET returns status shape only; DELETE soft-disconnects; disconnect clears nothing the audit needs
- [x] Route tests (in-memory repos) cover: owner connect, non-owner 403, replace, disconnect, 503-without-key; DB twins cover unique firm_id + encrypted-at-rest round trip (db twins authored, skipped in this run — tests must run WITHOUT DATABASE_URL per the safety rule; the truncate list there includes `gateway_accounts`)
- [x] Full suites green (backend WITHOUT DATABASE_URL, app, smoke, typecheck both packages) — backend 258 passed / 85 skipped (db twins), app 70/70, smoke 65/65, both typechecks clean

## Comments

- (agent, post-build) Migration `0012_calm_trish_tilby.sql` generated via `npm run db:generate` (drizzle-kit, offline); the one-per-firm invariant is a PARTIAL unique index (`gateway_accounts_firm_id_live_key ... WHERE deleted_at is null` — the `cases_firm_number_live_key` pattern), so a soft-disconnect frees the firm to connect again and the reconnect test pins it. Secrets are stored as base64(iv ‖ authTag ‖ ciphertext) AES-256-GCM with a random 12-byte IV; the AES key is SHA-256 of `GATEWAY_ENCRYPTION_KEY` (config enforces ≥ 32 chars — length is the entropy floor, any charset works; a shorter key fails BOOT naming the variable, a misconfiguration not a mode).
- (agent, post-build) Config carries `gatewayEncryptionKey: string | null` (optional group of one, S3_/Resend pattern); app.ts plumbs it to the new `routes/gateway.ts` (registered inside protectedRoutes — session guard applies; the public webhook arrives in ticket 04). Without the key: PUT/DELETE → 503 "Payments gateway not configured — set GATEWAY_ENCRYPTION_KEY (see .env.example)", GET /gateway/account keeps answering the status shape so the settings UI renders the not-connected state. Status shape: `{ connected, provider, keyId, enabled, connectedAt }` — destructuring-whitelist, secrets structurally absent.
- (agent, post-build) `credentials(firmId)` is the service's single decryption path (503 without the key, null when not connected) — ticket 03's collect flow consumes it; plaintexts never leave the service layer. docs/API_CONTRACT.md gained the "V2 slice 1 additions" section (gateway account endpoints documented contract-first, collect/webhook rows arrive with their tickets) plus the six endpoint-table rows.
