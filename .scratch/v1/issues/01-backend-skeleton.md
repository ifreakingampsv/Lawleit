# 01: Backend skeleton + test harness

**What to build:** A runnable TypeScript + Fastify backend service in its own package (the monolith home for all V1 API work) with a health check, a standardized error envelope matching the API contract, a CORS allow-list, typed env config (database URL, port, cookie/token secret, allowed origins), and the routes → services → db folder layout. The existing smoke and contract test harnesses must be able to target it. No database schema or business endpoints yet — this is the skeleton everything else plugs into.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] The backend package runs in dev mode and serves a health endpoint
- [ ] Error responses match the API contract's error shape so the existing REST adapter's error handling works unchanged
- [ ] Vitest suite green: health, error envelope, not-found shape
- [ ] Typecheck passes; boot fails fast with a message naming any missing required env var
- [ ] Reference backend and smoke suite untouched and still green (`npm run smoke:api` from the app package)
