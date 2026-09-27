# Database access

The Postgres layer lands in ticket 06 (`06-postgres-wiring.md`): schema,
migrations, and the connection pool wired to `DATABASE_URL` all live here.
Until then the API has no persistence layer — connection code must not be
added ahead of that ticket.
