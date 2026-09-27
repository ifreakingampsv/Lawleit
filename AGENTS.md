# AGENTS.md — Lawleit

Legal practice management product (MyCase-adapted) for small to mid-tier Indian law
firms. One codebase, two versions (Demo Version for the public portfolio, Production
Version for real firms) — see `CONTEXT.md` for vocabulary and `docs/adr/` for recorded
decisions. High-level plan: `PLAN.md`; running log: `CHANGELOG.md`; API spec:
`docs/API_CONTRACT.md` (contract-first — never invent endpoints).

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` glossary + `docs/adr/` ADRs; read them before exploring. See `docs/agents/domain.md`.
