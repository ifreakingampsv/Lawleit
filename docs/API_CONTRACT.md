# Lawleit API Contract

The contract the front-end codes against. `src/lib/data/httpAdapter.ts` is a
complete implementation of it, and **`backend/server.mjs` is a runnable
reference backend that implements it exactly** (zero dependencies, JSON-file
storage, demo auth) — see [BACKEND.md](./BACKEND.md). The **production backend**
(`backend/src`, Fastify + Postgres per ADR-0002) implements this contract —
including the V1 cutover additions marked below — live at
`https://lawleit-api.onrender.com`. To go live on your own stack, reimplement
these endpoints (plain JSON shapes) and run the front-end with:

```env
VITE_API_MODE=http
VITE_API_BASE_URL=https://your-api/v1
```

All types live in `src/lib/data/types.ts` (single source of truth). Shapes below are
abbreviated — trust the TypeScript interface `LawleitApi` in `src/lib/data/api.ts` over this doc.

## Conventions

- Base URL: `import.meta.env.VITE_API_BASE_URL` (default `/api/v1`). Set it in `.env`.
- Auth: **opaque server-side session tokens (not JWT)** — delivered as
  `Authorization: Bearer <token>` AND the `lawleit_session` httpOnly cookie
  (ADR-0005); the UI never touches tokens directly.
- CORS: browser origins must be allow-listed server-side, and the preflight must
  advertise `PATCH`/`DELETE` (plus `OPTIONS`) — browsers preflight every non-simple
  method, and the UI edits via PATCH.
- Every failure is JSON `{ error: <message> }`; the adapter surfaces that string verbatim.
- All list endpoints return JSON arrays; all writes accept JSON bodies and return the updated entity.
- Dates are ISO `YYYY-MM-DD` (days) or full ISO timestamps (messages, notifications).

## Endpoints

| Method | Path | Maps to `LawleitApi` | Notes |
|---|---|---|---|
| POST | /auth/login | `login(email, password)` | → `{ user, firm, users, token }` session (+ cookie) |
| POST | /auth/signup | `signup({firstName,lastName,email,firmName,zip,employees,phone})` | creates firm + owner, returns session; flat payload, `zip` a STRING and `employees` a NUMBER (form note); **no password is set — first password via the password-reset flow** (V1) |
| POST | /auth/password-reset | — | request token for an email; same response for known and unknown emails (V1; production backend — not in the reference server) |
| POST | /auth/password-reset/consume | — | `{ token, password }` → 204; single-use, expiring (V1; production backend — not in the reference server) |
| POST | /auth/logout | `logout()` | 204 |
| GET | /session | `getSession()` | 401/200-null when anonymous |
| GET | /health | — | `{ ok, service, db, now }`; `db`: ok \| unconfigured \| unreachable (V1; also served prefixless at `/health`) |
| PATCH | /firm | `updateFirm(patch)` | |
| GET | /users | `listUsers()` | |
| POST | /users | — | invite user (V1); owner-only, 201 created user; see below |
| PATCH | /users/:id | `updateUser(id, patch)` | owner-only; 409 "A firm must keep at least one active owner" (V1 clarifications) |
| GET | /cases | `listCases()` | supports `?status=&q=` |
| GET | /cases/:id | `getCase(id)` | |
| POST | /cases | `createCase(body)` | server assigns `number` |
| PATCH | /cases/:id | `updateCase(id, patch)` | |
| DELETE | /cases/:id | `deleteCase(id)` | 204 |
| GET | /contacts | `listContacts()` | |
| GET | /contacts/:id | `getContact(id)` | |
| POST | /contacts | `createContact(body)` | |
| PATCH | /contacts/:id | `updateContact(id, patch)` | |
| DELETE | /contacts/:id | `deleteContact(id)` | |
| GET | /events?from=&to= | `listEvents(range)` | range is ISO dates, inclusive |
| POST | /events | `createEvent(body)` | |
| PATCH | /events/:id | `updateEvent(id, patch)` | |
| DELETE | /events/:id | `deleteEvent(id)` | |
| GET | /tasks | `listTasks()` | |
| POST | /tasks | `createTask(body)` | |
| PATCH | /tasks/:id | `updateTask(id, patch)` | status flow: todo → in_progress → blocked/done |
| DELETE | /tasks/:id | `deleteTask(id)` | |
| GET | /time-entries | `listTimeEntries()` | |
| POST | /time-entries | `createTimeEntry(body)` | |
| PATCH | /time-entries/:id | `updateTimeEntry(id, patch)` | |
| DELETE | /time-entries/:id | `deleteTimeEntry(id)` | |
| GET | /expenses | `listExpenses()` | |
| POST | /expenses | `createExpense(body)` | |
| PATCH | /expenses/:id | `updateExpense(id, patch)` | |
| DELETE | /expenses/:id | `deleteExpense(id)` | |
| GET | /invoices | `listInvoices()` | |
| GET | /invoices/:id | `getInvoice(id)` | |
| POST | /invoices | `createInvoice(body)` | server assigns `number` (INV-XXXX) |
| PATCH | /invoices/:id | `updateInvoice(id, patch)` | status: draft → sent → paid (overdue derived from `due`) |
| DELETE | /invoices/:id | `deleteInvoice(id)` | |
| GET | /payments | `listPayments()` | |
| POST | /payments | `recordPayment(body)` | server updates invoice status; `trustAccount` routes to trust ledger; `method` ∈ card \| echeck \| wallet \| upi \| netbanking (V2 slice 1 widened — the contract owns the vocabulary, "cheque" deliberately excluded so far) |
| GET | /trust/transactions | `listTrustTransactions()` | running `balanceAfter` per client |
| GET | /documents | `listDocuments()` | metadata; every response carries `hasFile` (V1) |
| POST | /documents | `createDocument(body)` | metadata create; additive optional body fields `sizeBytes`/`storageKey`/`mimeType` complete the upload flow (V1) |
| POST | /documents/sign-upload | — | signed-URL upload request (V1); see below |
| GET | /documents/:id/download | `getDocumentDownloadUrl(id)` | signed read URL (V1); see below |
| PATCH | /documents/:id | `updateDocument(id, patch)` | `storageKey`/`mimeType` are server-managed and stripped from patches (V1) |
| DELETE | /documents/:id | `deleteDocument(id)` | stored object deleted best-effort (V1) |
| GET | /threads | `listThreads()` | messages embedded, newest last |
| POST | /threads/:id/messages | `sendMessage(threadId, { body })` | author = session user |
| POST | /threads | `createThread(body)` | |
| POST | /threads/:id/read | `markThreadRead(id)` | 204 |
| GET | /leads | `listLeads()` | |
| POST | /leads | `createLead(body)` | |
| PATCH | /leads/:id | `updateLead(id, patch)` | stage moves append to `activity` |
| DELETE | /leads/:id | `deleteLead(id)` | |
| POST | /leads/:id/convert | `convertLead(id, caseInput)` | → `{ lead, contact, case }` (creates client + matter) |
| GET | /reports | `listReports()` | predefined report descriptors |
| GET | /notifications | `listNotifications()` | |
| POST | /notifications/read | `markNotificationsRead()` | 204 |
| GET | /gateway/account | `getGatewayAccount()` | status shape only — never a secret (V2 slice 1; see below) |
| PUT | /gateway/account | `connectGatewayAccount(body)` | owner-only connect/replace; secrets write-only (V2 slice 1) |
| DELETE | /gateway/account | `disconnectGatewayAccount()` | owner-only; 204 (V2 slice 1) |
| POST | /invoices/:id/payment-link | `createPaymentLink(invoiceId)` | collect via the firm's gateway; paid → 409, no gateway → 503 (V2 slice 1) |
| GET | /invoices/:id/payment-links | `listPaymentLinks(invoiceId)` | link history, newest first (V2 slice 1) |
| POST | /payment-links/:id/sync | `syncPaymentLink(id)` | reconciliation self-heal; → `{ status, recorded }` (V2 slice 1) |
| POST | /webhooks/razorpay/:firmId | — | public server-to-server webhook; mandatory HMAC signature (V2 slice 1) |

## V1 cutover additions (2026-10)

Endpoints and clarifications added during the V1 build (the production backend
implements all of them; the reference server does not implement the password-reset
routes, `POST /users`, or the documents upload/download flow — the items marked
"V1" in the table).

- **Users / invites** — `POST /users`, owner-only (members get 403 "Only the firm
  owner can manage users"; anonymous 401). Body `{ name, email, role, hourlyRate?,
  avatarColor? }` → 201 created user; 409 "Email already registered" on a taken
  email. Role vocabulary: `owner | attorney | paralegal | staff`. The invite token
  rides the mailer (an invite IS the password-reset machinery — the consume call
  sets the first password). `PATCH /users/:id` stays owner-only and enforces the
  last-active-owner invariant: 409 "A firm must keep at least one active owner"
  when a patch would deactivate or demote the only active owner.
- **Upload/download flow** — `POST /documents/sign-upload` body
  `{ caseId?, name, contentType, sizeBytes }`: permission, MIME allowlist
  (pdf/images/office/text) and the 25 MB size cap (`S3_MAX_UPLOAD_MB`) are checked
  BEFORE any URL exists. → 201 `{ storageKey, url, method: "PUT", expiresIn: 900 }`;
  the browser PUTs the bytes straight to object storage (the API never proxies file
  bodies) and then calls `POST /documents` with the additive `sizeBytes`/
  `storageKey`/`mimeType` fields to record the row. A client-sent `storageKey`
  outside the firm's own `firms/<firmId>/` prefix is 400 "Invalid storage key" —
  never a stored pointer. `GET /documents/:id/download` → 200
  `{ url, expiresIn: 900 }`; 404 "Document not found" (missing/foreign/deleted),
  404 "Document file not found" (metadata-only row), 503 when storage is
  unconfigured (metadata CRUD keeps working without it). Every document response
  gains `hasFile: boolean`.
- **Health** — `GET /health` (and `/api/v1/health` under the base URL) →
  `{ ok, service, db, now }` where `db` is `ok | unconfigured | unreachable`; a
  down database must not take the health endpoint down.
- **Signup payload** — flat `{ firstName, lastName, email, firmName, zip,
  employees, phone }`; `zip` is a STRING and `employees` a NUMBER (the signup form
  sends numbers; fixtures should match). Signup creates the Firm + owner with NO
  password set — the first password arrives through the password-reset flow
  (`POST /auth/password-reset` → token → `POST /auth/password-reset/consume`).
- **Auth** — tokens are opaque server-side session records (revocable on logout,
  deactivation, password reset), NOT JWTs, delivered both as
  `Authorization: Bearer <token>` and the `lawleit_session` httpOnly cookie
  (ADR-0005). CORS preflights must advertise PATCH/DELETE or browser clients
  silently lose every edit.
- **Patch semantics** — write endpoints accept whole-entity saves: unknown keys are
  stripped, and server-managed fields are ignored wherever a client sends them —
  `id`, `firmId`, timestamps; case `number`/`trustBalance` (server-assigned);
  invoice `number` and line `amount`s (server-computed); payment `status`/`date`;
  time-entry/expense `invoiced`; lead `activity` (the server appends stage moves);
  document `storageKey`/`mimeType` on PATCH.
- **Implemented in the V1 cutover** — the threads/messages, notifications, and
  report-descriptor routes (`GET /threads`, `POST /threads`,
  `POST /threads/:id/messages`, `POST /threads/:id/read`, `GET /notifications`,
  `POST /notifications/read`, `GET /reports`) are implemented 1:1 by BOTH the reference server and the production backend
  (migration 0011: threads, thread_messages, notifications): in http mode the UI calls
  them and gets 404s, so Communications, the notification bell, and the report
  catalog carry no production data in V1. (The production Reports page's revenue
  analytics compute from real invoices/time entries; the descriptor route is the
  only missing piece there.)

## V2 slice 1 additions (2026-10) — collecting payments via Indian rails

The production backend implements these (migration 0012: `gateway_accounts`;
`payment_links` and `gateway_events` arrive with the collect/webhook tickets in
the same slice); the reference server implements the
not-connected surface so the smoke suite certifies both. Per-firm Razorpay
bring-your-own-keys (ADR-0006): money settles into the firm's own bank —
Lawleit never holds or routes funds. The provider sits behind a thin
GatewayService seam (create link, fetch link), so a future provider/model swap
is an implementation change, not a redesign.

- **Gateway account** — the firm's own Razorpay account, connected once by the
  owner (Settings, owner-only).
  - `GET /gateway/account` → 200 status shape only:
    `{ connected: boolean, provider: string | null, keyId: string | null,
    enabled: boolean, connectedAt: string | null }` (not connected:
    all-null/false). `connectedAt` is a full ISO timestamp. **No response on
    this surface ever carries `keySecret` or `webhookSecret`** — secrets are
    write-only.
  - `PUT /gateway/account` (owner-only; members 403 "Only the firm owner can
    manage the payments gateway") — connect/replace (rotate keys), one account
    per firm. Body `{ provider?, keyId, keySecret, webhookSecret }`
    (`provider` defaults to and currently must be `razorpay`; blank key fields
    → 400 "Key id, key secret, and webhook secret are required") → 200 the
    status shape. Secrets are stored AES-256-GCM-encrypted at rest
    (`GATEWAY_ENCRYPTION_KEY`), never returned, never logged.
  - `DELETE /gateway/account` (owner-only) → 204; soft delete (the audit row
    stays; the firm can connect again). Not connected → 404.
  - **Without `GATEWAY_ENCRYPTION_KEY`** every gateway WRITE answers
    `503 { error: "Payments gateway not configured — set
    GATEWAY_ENCRYPTION_KEY (see .env.example)" }`; boot succeeds and the
    status read keeps working (the feature is inert until the operator sets
    the key — the S3_*/Resend optional-env pattern).
- **Collect via payment link** — any firm user creates a Razorpay Payment
  Link for a draft/sent/overdue invoice through the firm's connected account.
  - `POST /invoices/:id/payment-link` → 201 the link shape
    `{ id, invoiceId, provider, providerLinkId, shortUrl, amount, status,
    createdAt }` (amount = the invoice's outstanding total in integer paise;
    `createdAt` a full ISO timestamp). A paid invoice → 409 "Invoice is
    already paid"; unknown/foreign/soft-deleted invoice → 404 "Invoice not
    found"; the firm has no connected gateway (or the operator has no
    encryption key) → 503 `{ error: "No payment gateway connected — the firm
    owner must connect one in Settings" }` (the owner-step copy).
  - `GET /invoices/:id/payment-links` → 200 link history, newest first; 404
    for a foreign/unknown invoice.
  - `POST /payment-links/:id/sync` → 200 `{ status, recorded }` — the
    server re-fetches the link from Razorpay and, if paid-but-unrecorded
    (a webhook lost to an API cold start), records the payment through the
    same service path as the webhook; already-recorded links sync as a no-op.
    Cross-firm/unknown link → 404; no connected gateway → 503.
- **Webhook** — `POST /webhooks/razorpay/:firmId` is PUBLIC and
  unauthenticated (server-to-server; mounted outside the session guard):
  Razorpay calls it with `payment_link.paid` / `payment.failed` events. The
  `X-Razorpay-Signature` HMAC-SHA256 header is verified against the URL-named
  firm's webhook secret — mismatch → 400 (empty `{}` body), unknown firm →
  404; a valid signature from firm A's secret cannot touch firm B's link
  (cross-firm 404). Events are deduped on the provider event id (`gateway_events`
  unique per provider) — a replayed delivery is a no-op 2xx. `payment_link.paid`
  records a Payment with the real instrument mapped into the widened method
  vocabulary (upi/netbanking/card), `trustAccount` hard-wired false, and the
  same-transaction invoice roll-up as a manual record; `payment.failed` and
  expiry events append to the event ledger only.
- **Payment methods** — the vocabulary is `card | echeck | wallet | upi |
  netbanking` everywhere (the V1 cutover widening stands).

## Server-side responsibilities (the mock does these client-side)

- Case and invoice **number assignment** (`2026-XXXX`, `INV-XXXX`).
- **Invoice status roll-up** when payments are recorded (paid when sum(payments) ≥ total).
- **Lead conversion** transaction: create contact + case, mark lead converted, append activity.
- Trust **running balance** maintenance per client/case.
- **Trial expiry** (`firm.trialEndsAt`) enforcement.

## Going live checklist

1. Reimplement the API on your stack (plain JSON shapes; `backend/server.mjs` is
   the executable reference — port it or point at it) and add real auth,
   persistence, payments and uploads — **or run the production backend
   (`backend/src`, the Fastify + Postgres service behind the live API)**, which
   already implements this contract including the V1 cutover additions.
2. `VITE_API_MODE=http` and `VITE_API_BASE_URL=https://your-api/v1` — no source
   changes needed.
3. Run `cd app && npm run smoke:api` against your API: the suite asserts the
   contract behaviors (numbering, roll-up, trust ledger, conversion) — all 55
   must pass.
4. Deploy; the SPA-fallback build already emits one entrypoint per route.
