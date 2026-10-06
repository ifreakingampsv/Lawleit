# 10: Conflict checks — surface possible conflicts when adding a party

**What to build:** When a lawyer types a new party's name while creating a case (or a
lead), Lawleit checks the name against every contact in the firm (normalized token
overlap — case/whitespace-insensitive, significant tokens only) and warns before
saving: "⚠ Possible conflict — a similarly named party already exists: <contact>
(case 2026-0231)". The check is a read-only firm-scoped endpoint,
`GET /contacts/conflict-check?name=…`, and the UI warning is non-blocking: Bar Council
conflict rules are the lawyer's judgment; the tool surfaces the facts. No new state,
no new tables.

**Blocked by:** None.

**Status:** ready-for-agent

- [x] `GET /contacts/conflict-check?name=…`: firm-scoped, name required (400 when blank), returns `[{ contact, cases: [case numbers] }]` for token-overlap matches; exact and partial-name matches both surface
- [x] Case-create form: typing a client name runs the check (debounced) and shows the warning with the matched contact + case numbers; creation itself is never blocked (implemented on the CONTACT create form — that's where new party names enter the system; case creation selects existing clients from a dropdown, so there's nothing to screen there)
- [x] Contract documents the endpoint; httpAdapter + mockAdapter implement it 1:1 (the mock matches over its own contact store)
- [x] Route tests: exact match, token-overlap match, no-match, blank 400, cross-firm silence (plus: the ticket-09 sample clients are conflict-detectable); app test covers the adapter. Full suites green (backend WITHOUT DATABASE_URL, app, smoke, typecheck, build) — backend 285/285, app 75/75, build clean
