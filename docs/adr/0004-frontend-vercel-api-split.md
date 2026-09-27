# Static SPA frontends on Vercel; long-running Fastify API on Fly.io Mumbai

Both frontends (Demo Version and Production Version) are the same React SPA after
build — pure static files — so both deploy to Vercel's free tier. The production API
is a long-running Fastify process (cookie sessions, upload streaming, future retry
queues) and deploys to Fly.io's Mumbai (bom) region, next to the Supabase Mumbai
database. Free platform subdomains (`*.vercel.app`, `*.fly.dev`) during development;
a purchased domain (`lawleit.in`) becomes required at launch for production email
(Resend verification).

## Considered Options

- Everything on Vercel by converting the API to serverless functions — rejected:
  serverless is wake-per-request, seconds-lived; it fights cookie sessions, upload
  streaming, and background queues.
- Render for the API — simplest deploys but nearest region is Singapore, adding
  latency to every Mumbai-database roundtrip.
- Self-managed VPS — cheapest, wrong trade for a solo builder (owns backups/patching).

## Consequences

- Two platform accounts (Vercel, Fly.io); deploys are git-push driven.
- The API's CORS allow-list must include the Vercel origins.
- ADR-0002's "vanilla Postgres only" rule keeps the whole stack swappable per piece.
