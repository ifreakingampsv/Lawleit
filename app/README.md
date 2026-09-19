# Lawleit — app (front-end)

Legal practice management SaaS clone (MyCase → Lawleit rebrand). React 19 +
TypeScript + Vite + Tailwind v4 + shadcn/ui, react-router. Project overview lives
in the repo root: [PLAN.md](../PLAN.md), [CHANGELOG.md](../CHANGELOG.md).

## Run

```bash
npm install        # once
npm run dev        # marketing site + app on :3000, mock data layer (default)
```

Login accepts any email/password in mock mode — a seeded demo firm loads.

## Run against a real HTTP backend

```bash
npm run dev:http   # vite (:3000) + reference backend (backend/server.mjs, :8787)
```

This sets `VITE_API_MODE=http` and proxies `/api/*` to the backend. Login with any
email + non-empty password (the reference backend runs demo auth). Equivalent manual
steps: `npm run dev:api` in one terminal, `npm run dev` with a `.env` (see
[.env.example](./.env.example)) in the other. Full details:
[docs/BACKEND.md](../docs/BACKEND.md) and [docs/API_CONTRACT.md](../docs/API_CONTRACT.md).

## Data layer (the backend seam)

- `src/lib/data/api.ts` — `LawleitApi` interface; the UI codes only against this.
- `src/lib/data/types.ts` — domain models, single source of truth.
- `src/lib/data/mockAdapter.ts` — seeded in-memory DB persisted to localStorage.
- `src/lib/data/httpAdapter.ts` — REST client implementing the API contract 1:1.
- `src/lib/data/index.ts` — picks the adapter from `VITE_API_MODE` (`mock` | `http`).

To point at your own backend, implement the contract in `docs/API_CONTRACT.md`
(any stack — plain JSON shapes) and set `VITE_API_MODE=http` +
`VITE_API_BASE_URL=https://your-api/v1`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | vite dev server (mock data layer) |
| `npm run dev:api` | reference backend only (`:8787`) |
| `npm run dev:http` | backend + vite together, http mode, combined log in `logs/dev.log` |
| `npm run build` | `tsc -b` + vite build + SPA-fallback entrypoints for all routes |
| `npm run smoke:api` | 55-assertion smoke suite against the reference backend |
| `npm run lint` | eslint |

## Other

ESLint config and template notes: see [eslint.config.js](./eslint.config.js). The
React Compiler is not enabled (build/dev performance); enable per
[react.dev/learn/react-compiler](https://react.dev/learn/react-compiler/installation).
