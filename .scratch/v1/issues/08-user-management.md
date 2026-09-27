# 08: User management

**What to build:** Firm admins manage their Firm's users: invite (create user with a role), list users, deactivate a user. Deactivation revokes sessions and blocks login but preserves the audit trail of their work. Invite emails are stubbed behind the mailer interface and actually send once the email ticket lands.

**Blocked by:** 07 (Auth — register Firm, login, sessions).

**Status:** ready-for-agent

- [ ] Admin can invite a user (name, email, role) and the user appears in the Firm's user list
- [ ] Deactivated users lose access immediately (sessions revoked, login blocked) while their historical records remain attributed to them
- [ ] Only admins manage users; members cannot (permission check tested)
- [ ] Cross-firm isolation asserted: admin cannot see or manage another Firm's users
- [ ] Contract + smoke suites green for the user-management surface
