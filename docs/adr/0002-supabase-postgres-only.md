# Rent Supabase's Postgres only — not the Backend-as-a-Service platform

The production backend needs a managed Postgres. We chose Supabase **as a database
host only** (Mumbai / ap-south-1 region — the India data-residency story matters to
law-firm buyers) while continuing to build our own Fastify backend: our own auth and
cookie sessions, our own REST API implementing `docs/API_CONTRACT.md`, our own
business rules (invoice roll-up, trust ledger). Supabase's auth, auto-generated APIs,
edge functions, and realtime stay unused.

## Considered Options

- Full Supabase BaaS (their auth/storage/APIs) — rejected: bypasses the contract-first
  architecture and couples us to their platform model.
- Neon — rejected: no Mumbai region (nearest Singapore), and Indian residency was a
  requirement.
- Self-managed Postgres on a VPS — rejected: cheapest at scale but we would own
  backups, upgrades, and security patching; wrong trade for a solo builder.

## Consequences

- One vendor (Supabase) covers Postgres and (likely) object storage in the same region.
- Migrating later means moving a vanilla Postgres database — no Supabase-specific
  schema features are to be used (no RLS policies as logic, no Supabase auth tables).
