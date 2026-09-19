# Lawleit API Contract

The contract the front-end codes against. Implement these endpoints in your backend,
fill in `src/lib/data/httpAdapter.ts`, then flip one line in `src/lib/data/index.ts`:

```ts
export const api: LawleitApi = httpAdapter;
```

All types live in `src/lib/data/types.ts` (single source of truth). Shapes below are
abbreviated — trust the TypeScript interface `LawleitApi` in `src/lib/data/api.ts` over this doc.

## Conventions

- Base URL: `import.meta.env.VITE_API_BASE_URL` (default `/api/v1`). Set it in `.env`.
- Auth: cookie session (httpOnly) or `Authorization: Bearer <jwt>`; the UI never touches tokens directly.
- All list endpoints return JSON arrays; all writes accept JSON bodies and return the updated entity.
- Dates are ISO `YYYY-MM-DD` (days) or full ISO timestamps (messages, notifications).

## Endpoints

| Method | Path | Maps to `LawleitApi` | Notes |
|---|---|---|---|
| POST | /auth/login | `login(email, password)` | → `{ user, firm, users }` session |
| POST | /auth/signup | `signup({firstName,lastName,email,firmName,zip,employees,phone})` | creates firm + owner, returns session |
| POST | /auth/logout | `logout()` | 204 |
| GET | /session | `getSession()` | 401/200-null when anonymous |
| PATCH | /firm | `updateFirm(patch)` | |
| GET | /users | `listUsers()` | |
| PATCH | /users/:id | `updateUser(id, patch)` | |
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
| POST | /payments | `recordPayment(body)` | server updates invoice status; `trustAccount` routes to trust ledger |
| GET | /trust/transactions | `listTrustTransactions()` | running `balanceAfter` per client |
| GET | /documents | `listDocuments()` | file blobs out of scope for v1 — metadata only |
| POST | /documents | `createDocument(body)` | multipart when real uploads land |
| PATCH | /documents/:id | `updateDocument(id, patch)` | |
| DELETE | /documents/:id | `deleteDocument(id)` | |
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

## Server-side responsibilities (the mock does these client-side)

- Case and invoice **number assignment** (`2026-XXXX`, `INV-XXXX`).
- **Invoice status roll-up** when payments are recorded (paid when sum(payments) ≥ total).
- **Lead conversion** transaction: create contact + case, mark lead converted, append activity.
- Trust **running balance** maintenance per client/case.
- **Trial expiry** (`firm.trialEndsAt`) enforcement.

## Going live checklist

1. Stand up the API (any stack — the shapes are plain JSON).
2. Implement `httpAdapter` methods (they already have the paths wired).
3. `export const api = httpAdapter` in `src/lib/data/index.ts`.
4. Delete `localStorage["lawleit.db.v1"]` and `sessionStorage["lawleit.session.v1"]` to drop mock state.
5. Set `VITE_API_BASE_URL` and deploy.
