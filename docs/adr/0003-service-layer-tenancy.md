# Firm isolation enforced in the service layer, not Postgres RLS (for now)

Every table carries `firm_id`. In V1, tenant isolation is enforced exclusively in the
service layer — every query filters by the authenticated user's firm — and proven by
the contract tests, which attempt cross-firm access and must fail. Postgres
Row-Level Security (RLS) is deliberately deferred to a hardening phase.

## Considered Options

- RLS from day one — rejected for V1: policies are easy to get subtly wrong, every
  request must carry firm identity into the DB session, and "why is this row
  invisible" debugging is a known time sink; our service layer is already a single
  choke point fully covered by tests.

## Consequences

- Revisit when a second writer touches the database that is not our backend (e.g. a
  future client portal with its own service, or third-party SQL access) — that is the
  trigger for adding RLS as a safety net, not a replacement for the service-layer
  scoping.
- Tests are the enforcement: a module without cross-firm assertion is incomplete.
