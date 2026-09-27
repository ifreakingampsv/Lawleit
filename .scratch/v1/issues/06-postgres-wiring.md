# 06: Postgres wiring + migrations

**What to build:** Connect the backend to managed Postgres (Supabase Mumbai, used as a plain database per the architecture decision): a Drizzle setup with versioned migrations, a migration-on-boot or deploy step, connection pooling/SSL appropriate for a managed provider, and graceful test behavior. The database carries `firm_id`, integer-paise money, soft deletes, and created/updated timestamps on every table from the first migration onward.

**Blocked by:** 01 (Backend skeleton + test harness).

**Status:** ready-for-agent — **requires owner**: creating the Supabase project (guided step at execution; tests skip cleanly without a database URL until then).

- [ ] Drizzle wired with versioned migration tooling and documented dev/deploy commands
- [ ] Connection config works against a managed Postgres URL (SSL, pooling) and is validated at boot
- [ ] Baseline migration conventions established (timestamps, soft deletes, firm_id expectations documented for later tables)
- [ ] Backend tests skip with a clear message when no database URL is configured, and pass when one is provided
- [ ] No Supabase-specific features used (plain Postgres only — keeps the database portable)
