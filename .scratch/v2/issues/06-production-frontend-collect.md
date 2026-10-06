# 06: Production frontend — Settings gateway card + Collect action on invoices

**What to build:** The Production Version's UI catches up with the API: Settings gains
a "Payments gateway" card (owner-only) to connect/replace/disconnect the firm's
Razorpay account, including a short KYC checklist link (entity/PAN, bank account in
the business name, business proof, website policy pages, verification call — the #1
rejection cause is missing policy pages). Billing gains the "Collect via payment
link" action on draft/sent/overdue invoices: a dialog showing the link, a copy
button, a prefilled WhatsApp click-to-chat message (wa.me deep link — zero API),
status chip (active/paid/expired) and the link history; expired links are
regenerable. The payments list renders upi/netbanking method badges. The httpAdapter
implements every new endpoint 1:1 with the contract, and a firm without a connected
gateway sees the collect action explain the owner step instead of erroring.

**Blocked by:** 01 (vocabulary), 03 (link routes), 05 (sync action).

**Status:** ready-for-agent

- [x] httpAdapter implements PUT/GET/DELETE gateway account, POST/GET payment links, sync — contract shapes byte-exact
- [x] Settings gateway card: owner-only visibility, connect/replace/disconnect flows, secret fields write-only (never echoed back), KYC checklist link, 503-without-encryption-key state handled with the operator message
- [x] Collect dialog: create link, copy button, WhatsApp deep link with invoice number + amount + link, status chip, history list, regenerate-on-expired; paid invoice hides the action
- [x] Payments list shows upi/netbanking badges; demo-mode banner copy stays mock-mode-only (prior fix preserved)
- [x] App vitest suite covers the adapter endpoints and the not-connected UX; full suites green (backend WITHOUT DATABASE_URL, app, smoke, typecheck, `npm run build`) — app 74/74, backend 279/279, smoke 65/65, build clean
