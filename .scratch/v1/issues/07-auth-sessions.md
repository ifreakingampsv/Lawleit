# 07: Auth — register Firm, login, sessions

**What to build:** Real authentication: Firm registration (creates the Firm + its admin user), email+password login, logout, current-user lookup, and password-reset token flow (token issuance + consumption; email delivery is stubbed behind a mailer interface until the email ticket). Password hashing with argon2. Sessions are server-side records (revocable) with httpOnly credential cookies/tokens exactly as the API contract and the existing REST adapter expect. This ticket also establishes the cross-firm isolation test pattern every later module copies.

**Blocked by:** 06 (Postgres wiring + migrations).

**Status:** ready-for-agent

- [ ] Register → login → me → logout works end to end; passwords hashed with argon2
- [ ] Credentials are httpOnly; sessions are server-side and revocable (logout/deactivation kills them)
- [ ] Password reset issues a single-use expiring token and consumes it correctly
- [ ] Contract + smoke suites green against this backend for the auth surface
- [ ] Cross-firm isolation asserted by tests: another firm's data 404s, never leaks
- [ ] Any deviation from the cookie-session suggestion in the plan docs (in favor of what the API contract specifies) is recorded as an ADR
