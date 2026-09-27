# Opaque server-side session tokens, not JWTs

Auth issues an opaque, random 256-bit token (32 bytes, base64url) that is the
primary key of a `sessions` row, checked on every request against the live
user and firm. The API contract's "Bearer \<jwt\>" wording is satisfied by
"Bearer \<token\>" — the REST adapter (`app/src/lib/data/httpAdapter.ts`) and
the cookie (`lawleit_session`, HttpOnly, Path=/, SameSite=Lax, Max-Age=604800,
SameSite/Secure configurable via `COOKIE_SAMESITE`/`COOKIE_SECURE` for the
ticket-19 cross-site deploy) both treat the value as an opaque string, so no
client change is involved. Password hashing is argon2id (OWASP parameters,
m=19 MiB, t=2, p=1) via `@node-rs/argon2`.

## Considered Options

- JWTs (stateless signed tokens) — rejected: sessions must be revocable, and a
  JWT is a capability that lives until it expires. Logout, deactivation, and
  password resets must kill access immediately (the ticket's acceptance
  criteria), which would force a server-side deny-list anyway — at which point
  the token is stateful with extra steps plus signature/key-management surface.
- The plan docs' suggested cookie-session identifier — adopted, with the token
  generation made explicit (32 random bytes rather than a bare UUID's 122
  bits) and the same value accepted as `Authorization: Bearer` so the adapter's
  dual mechanism works unchanged.
- Long-lived refresh tokens / sliding sessions — deferred: V1 has no mobile
  client and no requirement beyond the one-week session the reference backend
  already models.

## Consequences

- Every request does one indexed lookup joining `sessions`, `users`, and
  `firms`; a session only authenticates while it is unexpired, its user is
  active and not soft-deleted, and its firm is not soft-deleted. Revocation is
  a hard delete (logout, password reset, deactivation).
- The sessions table is the revocation ledger; it grows with logins and is
  cleaned opportunistically on expired lookups (a periodic sweep can land with
  the ticket-19 hardening).
- No signature secrets on the hot path: `SESSION_SECRET` stays required for
  configuration compatibility but nothing signs or verifies tokens today.
- Password reset tokens follow the same scheme but are stored only as SHA-256
  hashes (single-use, one-hour expiry), so a database leak yields no usable
  reset links.
