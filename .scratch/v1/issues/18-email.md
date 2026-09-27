# 18: Transactional email via Resend

**What to build:** The mailer stub becomes real: transactional email (password reset links, user invites) sends via Resend with a small database-backed retry queue for failures. Minimal set only — invoice/reminder email stays V2. Templates are simple, branded, English-first.

**Blocked by:** 07 (Auth — register Firm, login, sessions), 08 (User management).

**Status:** ready-for-agent — **requires owner**: a Resend account + API key (guided step at execution; a verified domain is a launch-time concern, the test sender works for development).

- [ ] Password-reset emails send with working links; invite emails send on user creation
- [ ] Failed sends retry via the DB-backed queue with backoff; poison messages surfaced in logs
- [ ] Provider behind the existing mailer interface (stub swappable by config; tests use the stub)
- [ ] No secrets in the repo; key supplied by environment
