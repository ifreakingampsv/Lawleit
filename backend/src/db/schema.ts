import { relations } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Ticket 07 tables: firms, users, sessions, password_reset_tokens.
 * Ticket 09 table: contacts.
 * Ticket 10 tables: cases, case_number_counters.
 * Ticket 11 tables: events, tasks.
 * Ticket 12 tables: time_entries, expenses.
 * Ticket 13 tables: invoices, invoice_line_items, invoice_number_counters.
 * Ticket 14 table: payments.
 * Ticket 15 table: trust_transactions.
 * Ticket 16 tables: leads, lead_stage_history.
 * Ticket 17 table: documents.
 * Ticket 18 table: email_outbox.
 * Ticket 20 tables: threads, thread_messages, notifications.
 * V2 slice 1 tables: gateway_accounts (ticket 02), payment_links (ticket 03),
 * gateway_events (ticket 04).
 *
 * Conventions (drizzle/README.md): snake_case names, uuid primary keys with
 * gen_random_uuid() defaults, firm_id uuid not null + index on every tenant
 * table (ADR-0003), bigint integer-paise money, timestamptz created_at and
 * app-maintained updated_at, nullable deleted_at soft deletes with partial
 * unique indexes. Password material lives only in users.password_hash and
 * password_reset_tokens.token_hash — never in API responses or logs.
 */

export const firms = pgTable("firms", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  practiceAreas: text("practice_areas").array().notNull().default(sql`'{}'::text[]`),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  address: text("address").notNull().default(""),
  plan: text("plan").notNull().default("basic"),
  trialEndsAt: date("trial_ends_at", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    name: text("name").notNull(),
    // Login is by email across the whole system (no firm scope), so the value
    // is unique globally and stored lowercase (normalized by the service).
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("owner"),
    avatarColor: text("avatar_color").notNull().default("#4B4ACF"),
    hourlyRate: bigint("hourly_rate", { mode: "number" }).notNull().default(300000),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("users_firm_id_idx").on(table.firmId),
    uniqueIndex("users_email_live_key").on(table.email).where(sql`deleted_at is null`),
  ],
);

/**
 * Server-side sessions (ADR-0005): the primary key IS the opaque bearer/cookie
 * token — 32 random bytes, base64url (not a UUID, hence the text column).
 * Revocation is a hard delete (logout, password reset, deactivation); expiry is
 * checked against expires_at. No soft delete: dead sessions have no value.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sessions_firm_id_idx").on(table.firmId),
    index("sessions_user_id_idx").on(table.userId),
  ],
);

/**
 * Password reset tokens are a separate table (not users columns): a user can
 * have several outstanding requests, each token is single-use and expiring, and
 * consumption must not touch the password row until it succeeds. Only the
 * SHA-256 hash of the token is stored, so a database leak yields no usable
 * tokens; lookups go by hash, which is also the timing-safe comparison path.
 */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_token_hash_key").on(table.tokenHash),
    index("password_reset_tokens_user_id_idx").on(table.userId),
    index("password_reset_tokens_firm_id_idx").on(table.firmId),
  ],
);

/**
 * Contacts (ticket 09) — the firm's directory of clients, companies, opposing
 * parties, witnesses and referral sources. No unique-ish business fields (the
 * contract's Contact has none: emails repeat across contacts), so no partial
 * unique indexes here — soft delete needs no index carve-out. `case_ids` is a
 * uuid[] mirror of the linked cases (maintained by the contacts/cases
 * services; ticket 10 owns the case side, ticket 16 conversion appends to it),
 * kept as a plain array rather than a join table to match the contract's
 * `caseIds: ID[]` shape.
 */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    type: text("type").notNull().default("client"),
    name: text("name").notNull(),
    company: text("company"),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    address: text("address").notNull().default(""),
    caseIds: uuid("case_ids").array().notNull().default(sql`'{}'::uuid[]`),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("contacts_firm_id_idx").on(table.firmId)],
);

/**
 * Cases (ticket 10) — the firm's matters. Column set mirrors the contract's
 * Case (app/src/lib/data/types.ts) 1:1: money is bigint paise
 * (billable_rate, trust_balance), dates are plain `date` columns (the contract
 * carries ISO YYYY-MM-DD strings), and status/stage live as text with the
 * contract's vocabularies enforced in the service. `number` is server-assigned
 * ("2026-XXXX" — case_number_counters below); the partial unique index on
 * (firm_id, number) of live rows is the race backstop behind the counter.
 * `client_id` is a nullable FK to contacts: the model allows a matter without
 * a client yet (the mock/reference store "" there), and soft deletes keep the
 * referenced row alive so no ON DELETE action is needed. lead_attorney_id has
 * no FK on purpose — cross-entity references without an existence rule mirror
 * the reference backend (contacts.case_ids is the same kind of soft link).
 */
export const cases = pgTable(
  "cases",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    number: text("number").notNull(),
    title: text("title").notNull(),
    clientId: uuid("client_id").references(() => contacts.id),
    practiceArea: text("practice_area").notNull().default("General"),
    stage: text("stage").notNull().default("intake"),
    status: text("status").notNull().default("open"),
    openDate: date("open_date", { mode: "string" }).notNull(),
    courtDate: date("court_date", { mode: "string" }),
    statute: text("statute"),
    leadAttorneyId: uuid("lead_attorney_id").notNull(),
    description: text("description").notNull().default(""),
    billableRate: bigint("billable_rate", { mode: "number" }).notNull().default(300000),
    trustBalance: bigint("trust_balance", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("cases_firm_id_idx").on(table.firmId),
    index("cases_client_id_idx").on(table.clientId),
    uniqueIndex("cases_firm_number_live_key")
      .on(table.firmId, table.number)
      .where(sql`deleted_at is null`),
  ],
);

/**
 * Case number counters (ticket 10) — one row per (firm, year) holding the
 * last sequence handed out for the server-assigned "YYYY-NNNN" case numbers.
 * The reference backend counts rows (`length + 50`), which reuses numbers
 * after deletions and collides under concurrent creates; a counter row
 * incremented by an INSERT … ON CONFLICT DO UPDATE inside the create
 * transaction is atomic per firm-year (the row lock serializes concurrent
 * creates) and never reuses a number. The composite primary key leads with
 * firm_id, so the tenant index the conventions require is the key itself.
 */
export const caseNumberCounters = pgTable(
  "case_number_counters",
  {
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    year: integer("year").notNull(),
    lastValue: integer("last_value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.firmId, table.year] })],
);

/**
 * Calendar events (ticket 11) — the firm's calendar. Column set mirrors the
 * contract's CalendarEvent (app/src/lib/data/types.ts) 1:1 with one deliberate
 * extra: `source` (ticket 11's V2 seam — court cause-list feeds in V2 will
 * stamp their own value; every V1 event is 'manual', the column default). The
 * contract's CalendarEvent has no source field, so the API mapper whitelists
 * it out — responses stay byte-shape compatible with the mock adapter.
 *
 * Datetime handling (the contract is the authority): the contract's calendar
 * surface deals in ISO calendar days, not instants — `date` is YYYY-MM-DD and
 * the mock/reference filter lists with day-string comparison
 * (`e.date >= from && e.date <= to`) — so `date` is a plain `date
 * mode:string` column (same as the cases dates). `start`/`end` are the
 * contract's "HH:MM" time-of-day strings verbatim: a `time` column would read
 * back "11:00:00" and break the byte-shape parity, so they are text, shape-
 * checked by the service. Only the bookkeeping stamps (created_at,
 * updated_at, deleted_at) are timestamptz. `case_id` is a nullable FK to
 * cases (the model allows firm-wide events; soft deletes keep the referenced
 * row alive, so no ON DELETE action) and indexed — the case detail page
 * client-filters events by it. `attendee_ids` is a uuid[] soft link with no
 * existence rule (the contacts.case_ids pattern). The type vocabulary
 * (meeting/court/deadline/personal/task) lives as text, enforced in the
 * service like the cases status/stage vocabularies.
 */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    title: text("title").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    start: text("start").notNull(),
    end: text("end").notNull(),
    allDay: boolean("all_day"),
    location: text("location"),
    caseId: uuid("case_id").references(() => cases.id),
    attendeeIds: uuid("attendee_ids").array().notNull().default(sql`'{}'::uuid[]`),
    type: text("type").notNull().default("meeting"),
    color: text("color").notNull().default("#4B4ACF"),
    reminders: text("reminders").array(),
    /** V2 seam: 'manual' today; a court cause-list feed stamps its own value later. */
    source: text("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("events_firm_id_idx").on(table.firmId),
    index("events_case_id_idx").on(table.caseId),
  ],
);

/**
 * Tasks (ticket 11) — the firm's to-do list. Column set mirrors the contract's
 * Task (types.ts) 1:1: `due_date` is an ISO calendar day (`date mode:string` —
 * the mock/reference default it to `today()`'s day string and the UI compares
 * day strings), priority/status live as text with the contract's vocabularies
 * enforced in the service. Completion is a plain status patch — the contract
 * defines no completedAt field and the reference's Object.assign enforces no
 * transition table. `case_id` is a nullable FK to cases, indexed (the case
 * detail page client-filters by it); `assignee_id` has no FK on purpose — the
 * cases.lead_attorney_id pattern for cross-entity soft links. Like contacts/
 * cases, the contract's `createdAt` is an ISO day: the column is the baseline
 * timestamptz stamp and the API mapper collapses it to its UTC date part.
 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    title: text("title").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    priority: text("priority").notNull().default("medium"),
    status: text("status").notNull().default("todo"),
    caseId: uuid("case_id").references(() => cases.id),
    assigneeId: uuid("assignee_id").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("tasks_firm_id_idx").on(table.firmId),
    index("tasks_case_id_idx").on(table.caseId),
  ],
);

/**
 * Time entries (ticket 12) — the firm's billable work log. Column set mirrors
 * the contract's TimeEntry (app/src/lib/data/types.ts) 1:1. Deliberate deltas
 * from the events/tasks links:
 *
 * - `case_id` is NOT NULL — a time entry always bills a matter. The reference
 *   defaults an absent caseId to `db.cases[0]` (its store is newest-first), so
 *   the service resolves the default to the firm's newest live case; the
 *   required-FK makes a dangling link impossible where the mock/reference
 *   would store one. Soft deletes keep the referenced case alive, so no ON
 *   DELETE action.
 * - `user_id` has no FK on purpose — the cases.lead_attorney_id /
 *   tasks.assignee_id pattern for cross-entity soft links (existence is the
 *   firm-roster's concern, not an insert-time join).
 * - There is NO amount column: the contract's TimeEntry carries `minutes` and
 *   `rate` only, and the UI derives value as (minutes / 60) × rate
 *   client-side (TimePage) — the reference computes nothing server-side
 *   either, so no rounding policy exists to mirror. `rate` is bigint paise
 *   (default 300000 = ₹300/hr — the mock adapter's default; the reference's
 *   300 is its dollar-scale legacy).
 * - `invoiced` starts false server-side (column default; the service stamps
 *   it) and is never client-writable — the events.`source` seam treatment.
 *   Ticket 13's invoice flow flips it through the service seam.
 *
 * `date` is a plain `date mode:string` column (the contract carries ISO
 * YYYY-MM-DD days — the mock/reference default to today's day string and the
 * UI compares day strings); only the bookkeeping stamps are timestamptz.
 */
export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id),
    userId: uuid("user_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    minutes: integer("minutes").notNull().default(0),
    rate: bigint("rate", { mode: "number" }).notNull().default(300000),
    description: text("description").notNull().default(""),
    billable: boolean("billable").notNull().default(true),
    invoiced: boolean("invoiced").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("time_entries_firm_id_idx").on(table.firmId),
    index("time_entries_case_id_idx").on(table.caseId),
  ],
);

/**
 * Expenses (ticket 12) — case-billed costs reimbursable through invoices.
 * Column set mirrors the contract's Expense (types.ts) 1:1: `amount` is
 * bigint integer paise stored verbatim (the client owns the conversion —
 * rupeesToPaise in the UI; the smoke posts plain integers and reads them back
 * unchanged), `category` is the contract's five-word vocabulary as text
 * enforced in the service, and `case_id` is a required FK like
 * time_entries.case_id (same default-to-newest-live-case service rule, same
 * no-ON-DELETE rationale). `invoiced` follows the time_entries rule: false
 * server-side, never client-writable. No unique-ish business fields → no
 * partial unique indexes (the contacts pattern).
 */
export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id),
    date: date("date", { mode: "string" }).notNull(),
    description: text("description").notNull().default(""),
    amount: bigint("amount", { mode: "number" }).notNull().default(0),
    billable: boolean("billable").notNull().default(true),
    invoiced: boolean("invoiced").notNull().default(false),
    category: text("category").notNull().default("other"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("expenses_firm_id_idx").on(table.firmId),
    index("expenses_case_id_idx").on(table.caseId),
  ],
);

/**
 * Invoices (ticket 13) — the billing documents. Column set mirrors the
 * contract's Invoice (app/src/lib/data/types.ts) 1:1: `number` is
 * server-assigned ("INV-XXXX" — invoice_number_counters below; the partial
 * unique index on (firm_id, number) of live rows is the race backstop behind
 * the counter, the cases pattern), `status` carries the contract's four-word
 * InvoiceStatus vocabulary as text enforced in the service, and
 * issue_date/due_date are plain `date mode:string` columns (the contract
 * carries ISO YYYY-MM-DD days; the reference stamps issued=today and
 * due=today+30 at create, both server-side — a client-sent value is ignored).
 *
 * Deliberately NO total columns: the contract's Invoice carries no
 * totalAmount/amountPaid/balance — the client derives the total from the
 * lines (`lines.reduce((s, l) => s + l.quantity * l.rate, 0)`, InvoicesPage),
 * and the reference's roll-up recomputes it from the lines on every payment.
 * The server-side computation this ticket owns lives on the line rows:
 * invoice_line_items.amount is quantity × rate computed server-side (never
 * client-sent), so the invoice total is SUM(line amounts) — an always-fresh
 * integer-paise derivation ticket 14's payment roll-up reads. Storing a
 * denormalized total would only add a drift hazard the contract never asked
 * for.
 *
 * `client_id`/`case_id` are nullable FKs (the cases.client_id pattern — the
 * model allows an invoice without either; the reference stores "" there and
 * the API mapper renders "" for null). case_id is indexed (the ticket's FK
 * index requirement; every invoice-listing page joins clients/cases
 * client-side, so client_id has no server query path and no index).
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    number: text("number").notNull(),
    clientId: uuid("client_id").references(() => contacts.id),
    caseId: uuid("case_id").references(() => cases.id),
    status: text("status").notNull().default("draft"),
    issueDate: date("issue_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("invoices_firm_id_idx").on(table.firmId),
    index("invoices_case_id_idx").on(table.caseId),
    uniqueIndex("invoices_firm_number_live_key")
      .on(table.firmId, table.number)
      .where(sql`deleted_at is null`),
  ],
);

/**
 * Invoice line items (ticket 13) — the lines behind an invoice. Column set
 * mirrors the contract's InvoiceLine (types.ts) 1:1 plus two deliberate
 * extras the API mapper whitelists out (the events.`source` seam treatment):
 *
 * - `amount` (bigint paise) — computed server-side as round(quantity × rate)
 *   on every write; never client-settable. The quantity comes in hours for
 *   time lines (minutes/60 — a repeating decimal like 10/60 whose float
 *   product with an integer paise rate rounds to the exact real-math paise:
 *   10/60 × ₹300.00/hr = 50000 paise), so the round is what keeps the money
 *   integral; the invoice total is SUM(amount) with zero float exposure.
 * - the tax columns — `tax_rate` (numeric percent) and `tax_amount` (bigint
 *   paise), both NULLABLE with no defaults: the V2 GST seam, present from day
 *   one so V2 tax computation needs no migration, but never written by V1
 *   code (the contract's InvoiceLine carries no tax fields).
 *
 * `quantity` is `double precision`, not numeric/bigint: the contract's
 * quantity is a JS number (hours for time lines, units otherwise) and a
 * binary64 round-trips it byte-exact — a numeric column would re-round the
 * stored digits and break the amount math above. `rate` is bigint paise per
 * the baseline money convention. `kind` is the contract's three-word
 * vocabulary (time/expense/flat) as text enforced in the service.
 *
 * `position` is the 0-based index the client sent the line at: same-instant
 * inserts share one created_at and UUID tie-breaks are random, so the
 * client's line order (what the invoice preview prints) needs an explicit
 * sort key.
 *
 * Lifecycle: lines are a value set of their invoice, not independently
 * soft-deletable rows — a patch that carries `lines` replaces the set (plain
 * DELETE + INSERT in one transaction) and an invoice's soft delete hides its
 * lines through the invoice join, so there is no deleted_at here (the
 * baseline convention's soft-delete rule is for independently addressable
 * tenant rows; these are only ever addressed through the invoice).
 */
export const invoiceLineItems = pgTable(
  "invoice_line_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    position: integer("position").notNull(),
    description: text("description").notNull().default(""),
    quantity: doublePrecision("quantity").notNull(),
    /** Per hour / per unit, integer paise (types.ts Paise). */
    rate: bigint("rate", { mode: "number" }).notNull(),
    /** Server-computed round(quantity × rate), integer paise — never client-set. */
    amount: bigint("amount", { mode: "number" }).notNull(),
    kind: text("kind").notNull().default("flat"),
    /** V2 GST seam: percent; NULL until V2 tax computation writes it. */
    taxRate: numeric("tax_rate", { precision: 6, scale: 2, mode: "number" }),
    /** V2 GST seam: integer paise; NULL until V2 tax computation writes it. */
    taxAmount: bigint("tax_amount", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("invoice_line_items_firm_id_idx").on(table.firmId),
    index("invoice_line_items_invoice_id_idx").on(table.invoiceId),
  ],
);

/**
 * Invoice number counters (ticket 13) — the case_number_counters pattern
 * copied for "INV-XXXX" numbering, as its own table rather than a
 * generalization of case_number_counters: the invoice sequence has no year
 * dimension (the reference's sequence is one running per-firm count, format
 * INV-XXXX — no YYYY component to key on), so sharing the table would force a
 * discriminator column onto a differently-keyed sequence; two tables keep
 * both counters' atomic upserts and audit rows independent and identical in
 * shape. One row per firm holding the last sequence handed out; the
 * INSERT … ON CONFLICT DO UPDATE inside the create transaction is atomic per
 * firm (the row lock serializes concurrent creates) and never reuses a
 * number. The composite primary key leads with firm_id, so the tenant index
 * the conventions require is the key itself. The reference's +1044 offset is
 * its demo-seed legacy — with no production seed to clear, sequences start at
 * 1 (the same rationale as the case counter's +50).
 */
export const invoiceNumberCounters = pgTable(
  "invoice_number_counters",
  {
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    lastValue: integer("last_value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.firmId] })],
);

/**
 * Leads (ticket 16) — the business-development pipeline. Column set mirrors
 * the contract's Lead (app/src/lib/data/types.ts) 1:1: `value` is bigint
 * integer paise (the estimated matter value), `created_at` is the baseline
 * timestamptz stamp the API mapper collapses to its UTC date part (the
 * reference stamps `today()` — an ISO day — into the contract's createdAt),
 * and stage/source live as text with the contract's vocabularies enforced in
 * the service.
 *
 * `activity` is the contract's `activity: {at, text}[]` log, stored as jsonb
 * (the contract makes the server responsible for appending to it on stage
 * moves and conversion — see the leads service). The reference instead lets
 * the client overwrite the array via Object.assign; the production backend
 * treats it as server-managed, so the entry order is newest-first
 * consistently (the reference's conversion entry is also unshifted).
 *
 * `converted_case_id` / `converted_contact_id` are nullable links stamped by
 * the conversion transaction — DB-only traceability the contract's Lead shape
 * does not carry, so the API mapper whitelists them out (the events.`source`
 * seam treatment). No FK ON DELETE action: every entity soft-deletes, which
 * keeps referenced rows alive. No unique-ish business fields → no partial
 * unique indexes (the contacts pattern).
 */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    name: text("name").notNull(),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    source: text("source").notNull().default("website"),
    stage: text("stage").notNull().default("new"),
    practiceArea: text("practice_area").notNull().default("General"),
    value: bigint("value", { mode: "number" }).notNull().default(0),
    notes: text("notes"),
    activity: jsonb("activity").$type<{ at: string; text: string }[]>().notNull().default(sql`'[]'::jsonb`),
    convertedCaseId: uuid("converted_case_id").references(() => cases.id),
    convertedContactId: uuid("converted_contact_id").references(() => contacts.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("leads_firm_id_idx").on(table.firmId)],
);

/**
 * Payments (ticket 14) — the manual money-received record (V1: no gateway, no
 * real money ever moves — a user records that a bank transfer / card / echeck /
 * wallet receipt happened). Column set mirrors the contract's Payment
 * (app/src/lib/data/types.ts) 1:1:
 *
 * - `amount` is bigint integer paise, service-validated > 0 (the ticket's
 *   rule; the reference would store anything).
 * - `method` is the contract's exact vocabulary — "card" | "echeck" | "wallet" |
 *   "upi" | "netbanking" (default "card", the reference's `b.method ?? "card"`).
 *   The V1 ticket floated "bank transfer/UPI/cheque" as the V2 seam; V2 slice 1
 *   widened the contract THERE (upi/netbanking — Indian rails), keeping the
 *   vocabulary contract-owned rather than invented ad hoc. "cheque" remains
 *   deliberately outside the vocabulary in slice 1.
 * - `status` carries the contract's pending/deposited/failed vocabulary but is
 *   server-managed: V1 records always land "deposited" (the reference
 *   hard-codes it; no client path writes pending/failed). The roll-up's
 *   `status <> 'failed'` filter mirrors the reference for the day a gateway
 *   (V2) starts writing the other values.
 * - `date` is a plain `date mode:string` column (the contract carries ISO
 *   YYYY-MM-DD days) — server-stamped with today on every record; both the
 *   reference and the mock ignore a client-sent date.
 * - `invoice_id` is a NULLABLE FK, indexed (the ticket's FK-index
 *   requirement): the reference and the mock both accept payments with no
 *   invoice (empty invoiceId — the unlinked trust deposit the app tests pin),
 *   so "no invoice" is null and renders "" in the API shape.
 * - `client_id` is a nullable FK like invoices.client_id: the reference
 *   defaults it from the invoice; existence-checked in the service (ticket
 *   15's ledger keys on it, so a dangling link must be impossible where the
 *   reference would store one). Unindexed — no V1 server query path.
 * - `trust_account` is the contract's `trustAccount` flag flowing through
 *   verbatim (default false). Ticket 15 appends the trust-ledger entry for
 *   flagged payments — see the marked hook in the payments service.
 *
 * No unique-ish business fields → no partial unique indexes (the contacts
 * pattern). Soft delete per the baseline convention (no V1 route exercises
 * it; the column exists so a future refund/void path needs no migration).
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    clientId: uuid("client_id").references(() => contacts.id),
    date: date("date", { mode: "string" }).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    method: text("method").notNull().default("card"),
    status: text("status").notNull().default("deposited"),
    trustAccount: boolean("trust_account").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("payments_firm_id_idx").on(table.firmId),
    index("payments_invoice_id_idx").on(table.invoiceId),
  ],
);

/**
 * Trust transactions (ticket 15) — the client-money ledger, the
 * correctness-critical module. Column set mirrors the contract's
 * TrustTransaction (app/src/lib/data/types.ts) 1:1:
 *
 * - `amount` is bigint integer paise SIGNED (+ in, − out — the contract's
 *   "amount: Paise; // + in, - out") and `balance_after` is the running
 *   per-client balance stamped by the append itself.
 * - `date` is a plain `date mode:string` column (the contract carries ISO
 *   YYYY-MM-DD days — the reference/mock stamp today's day string).
 * - `client_id` is a nullable FK, indexed (the ticket's FK-index requirement;
 *   the running balance is keyed by it). Null is the unattributed bucket the
 *   reference stores as "" when a trust-flagged payment names no client —
 *   entries still append and render "" in the API shape. Its liveness is
 *   enforced upstream (the payments service only appends for live in-firm
 *   clients), so soft deletes keep the referenced row alive and no ON DELETE
 *   action is needed — a client's deletion must never rewrite their money
 *   history.
 * - `case_id` is a nullable FK (the reference's `invoice?.caseId ?? ""` —
 *   null for unlinked deposits), indexed like invoices.case_id.
 *
 * APPEND-ONLY, deliberately departing from the baseline conventions: there is
 * NO update path, NO updated_at, and NO deleted_at — a ledger never rewrites
 * history (the model/contract has no edit or delete surface, and a trust
 * reconciliation is only meaningful over an immutable history; a mistaken
 * entry is corrected by a contra entry, the accounting practice). Rows are
 * never soft-deleted, so every read sees the whole history and the balance
 * chain can be recomputed from the amounts alone.
 *
 * `seq` is the DB-only insertion-order stamp (bigserial): concurrent appends
 * for one client serialize on a per-client advisory lock, and the sequence —
 * assigned at insert time under that lock — makes the true append order
 * deterministic where (created_at, id) is not (same-instant inserts, random
 * UUID tie-breaks). The API mapper whitelists it out (the events.`source`
 * seam treatment); reconcile and list order by it. No unique-ish business
 * fields → no partial unique indexes.
 */
export const trustTransactions = pgTable(
  "trust_transactions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    clientId: uuid("client_id").references(() => contacts.id),
    caseId: uuid("case_id").references(() => cases.id),
    date: date("date", { mode: "string" }).notNull(),
    description: text("description").notNull().default(""),
    /** Signed integer paise: + in, − out (types.ts Paise). */
    amount: bigint("amount", { mode: "number" }).notNull(),
    /** Running per-client balance after this entry, integer paise. */
    balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
    /** Insertion-order stamp (see above) — DB-only, never in API responses. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trust_transactions_firm_id_idx").on(table.firmId),
    index("trust_transactions_client_id_idx").on(table.clientId),
    index("trust_transactions_case_id_idx").on(table.caseId),
  ],
);

/**
 * Lead stage history (ticket 16) — the relational audit trail behind the
 * contract's "stage moves append to `activity`": one row per actual stage
 * change (a patch that sends the current stage records nothing), written by
 * the leads service inside the same transaction as the move. `activity` is
 * the client-facing log; this table is the queryable record (per-lead funnel
 * reporting, cycle times) that outlives the jsonb's display purpose.
 *
 * Append-only: rows are never updated or deleted, so there is no updated_at/
 * deleted_at — `at` is both the event time and the row's stamp (the same
 * instant the service passes to the activity entry). `changed_by` has no FK
 * on purpose — the cases.lead_attorney_id pattern for cross-entity soft
 * links (existence is the firm roster's concern).
 */
export const leadStageHistory = pgTable(
  "lead_stage_history",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    fromStage: text("from_stage").notNull(),
    toStage: text("to_stage").notNull(),
    changedBy: uuid("changed_by").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("lead_stage_history_firm_id_idx").on(table.firmId),
    index("lead_stage_history_lead_id_idx").on(table.leadId),
  ],
);

/**
 * Documents (ticket 17) — the firm's file library: metadata rows here, bytes
 * in object storage (Supabase Storage's S3 layer behind StorageService,
 * ADR-0002). Column set mirrors the contract's DocumentFile (types.ts) with
 * the upload-ticket deltas:
 *
 * - `size_bytes` is the exact byte count as bigint; the contract's
 *   `sizeKb` shape is KB-granular, so the API mapper renders
 *   round(size_bytes / 1024) (metadata creates store sizeKb × 1024, so
 *   they round-trip exactly; uploads store the browser's exact byte count).
 * - `mime_type` / `storage_key` are DB-only — the API mapper whitelists
 *   them out (the events.`source` seam treatment) and exposes the derived
 *   `hasFile` boolean instead. `storage_key` is only ever written with a
 *   key minted by the firm's own sign-upload (the service enforces the
 *   firms/<firmId>/ prefix), so a document can never point at another
 *   tenant's object.
 * - `uploaded_by` has no FK on purpose — the cases.lead_attorney_id pattern
 *   for cross-entity soft links.
 * - `starred` / `template_fields` mirror the model's optional fields as
 *   nullable columns (the events.reminders pattern for the array).
 *
 * `case_id` is a nullable FK, indexed (the ticket's FK-index requirement;
 * the model allows firm-wide documents — the seed's Templates folder has
 * none). Soft deletes keep the referenced case alive, so no ON DELETE
 * action. No unique-ish business fields → no partial unique indexes (the
 * contacts pattern).
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    caseId: uuid("case_id").references(() => cases.id),
    name: text("name").notNull(),
    folder: text("folder").notNull().default("General"),
    kind: text("kind").notNull().default("doc"),
    /** Exact byte count; the contract shape renders KB (see above). */
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    mimeType: text("mime_type"),
    /** Object-storage key; null = metadata-only document (no bytes yet). */
    storageKey: text("storage_key"),
    /** The session user that signed the upload / created the row — soft link. */
    uploadedBy: uuid("uploaded_by").notNull(),
    starred: boolean("starred"),
    templateFields: text("template_fields").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("documents_firm_id_idx").on(table.firmId),
    index("documents_case_id_idx").on(table.caseId),
  ],
);

/**
 * Email outbox (ticket 18) — the durable queue behind transactional email
 * (password resets, user invites; invoice/reminder mail is V2). The auth
 * services write here through the Mailer seam and a small in-process worker
 * (services/email/worker.ts) drains it: send now, retry with exponential
 * backoff, poison after repeated failures.
 *
 * Deliberate deltas from the tenant-table conventions:
 *
 * - `firm_id` is a NULLABLE soft link (no FK, the lead_attorney_id pattern):
 *   the outbox is operational data addressed by the recipient's email, and
 *   the send machinery (the worker) runs without firm context — the link is
 *   informational (support/debug: "what did we mail firm X") and must never
 *   constrain or reject a send.
 * - NO soft delete (no deleted_at): the outbox is operational data, not
 *   tenant-addressable content — rows are terminal on send or poison, and
 *   pruning old terminal rows is a maintenance concern, not a feature.
 *
 * `kind` is the V1 vocabulary (reset|invite) as text enforced in the email
 * service; `status` is pending|sent|failed. `available_at` (default now) is
 * the backoff clock the worker's due query reads; `(status, available_at)` is
 * indexed because that query is the table's only hot path. No secrets: the
 * body carries a single-use token URL, never the token hash material (that
 * lives in password_reset_tokens only).
 */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Soft link to firms — informational only, see above. */
    firmId: uuid("firm_id"),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    bodyHtml: text("body_html"),
    kind: text("kind").notNull().default("reset"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** Backoff clock: the row becomes drainable when available_at <= now(). */
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("email_outbox_firm_id_idx").on(table.firmId),
    index("email_outbox_due_idx").on(table.status, table.availableAt),
  ],
);

/**
 * Message threads (ticket 20) — the Communications inbox: secure-portal /
 * email / SMS conversations with a client, the messages themselves living in
 * thread_messages below. Column set mirrors the contract's MessageThread
 * (app/src/lib/data/types.ts) 1:1:
 *
 * - `channel` is the contract's three-word vocabulary (secure | email | sms)
 *   as text, enforced in the service like the cases status/stage vocabularies.
 * - `client_id` is a nullable FK to contacts (the cases.client_id pattern —
 *   the reference stores "" for "no client" and the API mapper renders ""
 *   for null), existence-checked in the service (a dangling link must be
 *   impossible where the reference would store one). Indexed — the thread
 *   rows render the client's name via a client-side join, but per-client
 *   queries (a client portal, V2) are the natural future path.
 * - `case_id` is a nullable FK to cases (the events.case_id pattern), the
 *   matter the conversation belongs to; existence-checked in the service.
 * - `unread` is server-managed: created false (the reference hard-codes it)
 *   and only ever moved by POST /threads/:id/read. There is no inbound
 *   message surface in V1 (no client portal), so nothing else flips it.
 *
 * Soft delete per the baseline convention: threads are tenant content and a
 * future archive route must need no migration; reads filter deleted_at and a
 * deleted thread takes its messages' visibility with it (they are only ever
 * addressed through the thread). No unique-ish business fields → no partial
 * unique indexes (the contacts pattern).
 */
export const threads = pgTable(
  "threads",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    subject: text("subject").notNull().default("(no subject)"),
    clientId: uuid("client_id").references(() => contacts.id),
    caseId: uuid("case_id").references(() => cases.id),
    channel: text("channel").notNull().default("secure"),
    unread: boolean("unread").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("threads_firm_id_idx").on(table.firmId),
    index("threads_client_id_idx").on(table.clientId),
    index("threads_case_id_idx").on(table.caseId),
  ],
);

/**
 * Thread messages (ticket 20) — the entries inside a conversation. Column set
 * mirrors the contract's MessageThread.messages entry (types.ts) 1:1 with one
 * deliberate extra: `seq`, the DB-only insertion-order stamp (the
 * trust_transactions rationale — same-instant inserts and random UUID
 * tie-breaks would scramble the "newest last" contract order; the API mapper
 * whitelists seq out, the events.`source` seam treatment).
 *
 * - `"from"` is the contract's field name verbatim (firm | client) — a quoted
 *   reserved word, exactly like events.start/end; the vocabulary lives as
 *   text, enforced in the service.
 * - `author_name` is the contract's `authorName`; `at` is a timestamptz (the
 *   contract carries full ISO timestamps for messages — types.ts header note)
 *   rendered back via toISOString().
 * - `firm_id` is denormalized from the thread on purpose: every tenant table
 *   carries it (ADR-0003), the truncate hygiene and firm-scoped message
 *   queries read it directly, and the service only ever inserts through a
 *   live in-firm thread, so it cannot drift.
 *
 * APPEND-ONLY (the lead_stage_history pattern): the contract defines no
 * message edit/delete surface, conversations are never rewritten — so there
 * is NO updated_at and NO deleted_at. Rows are a value set of their thread
 * (the invoice_line_items rationale): they are only ever addressed through
 * the thread, and a thread's soft delete hides them through the join.
 */
export const threadMessages = pgTable(
  "thread_messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id),
    /** Insertion-order stamp (see above) — DB-only, never in API responses. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    from: text("from").notNull().default("firm"),
    authorName: text("author_name").notNull().default(""),
    body: text("body").notNull().default(""),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("thread_messages_firm_id_idx").on(table.firmId),
    index("thread_messages_thread_id_idx").on(table.threadId),
  ],
);

/**
 * Notifications (ticket 20) — the bell in the app shell. Column set mirrors
 * the contract's Notification (types.ts) 1:1: `text` is the rendered sentence,
 * `kind` is the contract's four-word vocabulary (info | payment | deadline |
 * message) as text enforced wherever rows are written, `read` the only
 * mutable field (POST /notifications/read marks ALL of the firm's rows), and
 * `at` is a timestamptz rendered as a full ISO timestamp (the messages rule).
 *
 * Deliberate deltas: NO delete/update surface beyond the read flag (the
 * contract defines none — notifications are transient bell data, terminal on
 * read), so there is no deleted_at; the baseline updated_at stays because
 * `read` mutates. V1 generates NO rows at runtime — the reference backend
 * seeds three demo rows and has no generation rule (no client portal, no
 * inbound message event), so production firms start with an empty bell and
 * the table exists for the contract's surface plus the V2 generation rules
 * (portal replies, gateway receipts). No unique-ish fields → no partial
 * unique indexes (the contacts pattern).
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    text: text("text").notNull(),
    kind: text("kind").notNull().default("info"),
    read: boolean("read").notNull().default(false),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("notifications_firm_id_idx").on(table.firmId)],
);

/**
 * Gateway accounts (V2 slice 1, ticket 02) — the firm's own Razorpay account,
 * connected by the owner pasting its API keys (ADR-0006: bring-your-own-keys;
 * money settles into the firm's bank, Lawleit never touches it). One per firm
 * — the partial unique index on firm_id of live rows (the
 * cases_firm_number_live_key pattern) enforces it while a disconnect's soft
 * delete frees the firm to connect again.
 *
 * - `key_secret` / `webhook_secret` are AES-256-GCM ciphertexts (random IV,
 *   base64 iv‖tag‖text, key derived from GATEWAY_ENCRYPTION_KEY — see
 *   services/gateway/encryption.ts), never the plaintexts: a database leak
 *   yields no usable Razorpay credentials. They are write-only over the API —
 *   the service mappers whitelist them out of every response, and the
 *   plaintexts exist only in memory for gateway calls, never in logs.
 * - `provider` is text with its vocabulary (razorpay — the only value this
 *   slice) enforced in the service; a second provider is an implementation
 *   swap behind the GatewayService seam, not a migration.
 * - `connected_at` is the operator-facing "since when" stamp the status shape
 *   exposes (updated on every connect/replace); the bookkeeping stamps follow
 *   the baseline conventions. Soft delete on disconnect — the row stays so
 *   the audit trail keeps its past connections.
 */
export const gatewayAccounts = pgTable(
  "gateway_accounts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    provider: text("provider").notNull().default("razorpay"),
    keyId: text("key_id").notNull(),
    keySecret: text("key_secret").notNull(),
    webhookSecret: text("webhook_secret").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("gateway_accounts_firm_id_idx").on(table.firmId),
    uniqueIndex("gateway_accounts_firm_id_live_key")
      .on(table.firmId)
      .where(sql`deleted_at is null`),
  ],
);

export const firmsRelations = relations(firms, ({ many }) => ({
  users: many(users),
  sessions: many(sessions),
  contacts: many(contacts),
  cases: many(cases),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  firm: one(firms, { fields: [users.firmId], references: [firms.id] }),
  sessions: many(sessions),
  passwordResetTokens: many(passwordResetTokens),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
  firm: one(firms, { fields: [sessions.firmId], references: [firms.id] }),
}));

export const passwordResetTokensRelations = relations(passwordResetTokens, ({ one }) => ({
  user: one(users, { fields: [passwordResetTokens.userId], references: [users.id] }),
  firm: one(firms, { fields: [passwordResetTokens.firmId], references: [firms.id] }),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  firm: one(firms, { fields: [contacts.firmId], references: [firms.id] }),
  cases: many(cases),
}));

export const casesRelations = relations(cases, ({ one, many }) => ({
  firm: one(firms, { fields: [cases.firmId], references: [firms.id] }),
  client: one(contacts, { fields: [cases.clientId], references: [contacts.id] }),
  events: many(events),
  tasks: many(tasks),
  timeEntries: many(timeEntries),
  expenses: many(expenses),
  invoices: many(invoices),
}));

export const eventsRelations = relations(events, ({ one }) => ({
  firm: one(firms, { fields: [events.firmId], references: [firms.id] }),
  kase: one(cases, { fields: [events.caseId], references: [cases.id] }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  firm: one(firms, { fields: [tasks.firmId], references: [firms.id] }),
  kase: one(cases, { fields: [tasks.caseId], references: [cases.id] }),
}));

export const timeEntriesRelations = relations(timeEntries, ({ one }) => ({
  firm: one(firms, { fields: [timeEntries.firmId], references: [firms.id] }),
  kase: one(cases, { fields: [timeEntries.caseId], references: [cases.id] }),
}));

export const expensesRelations = relations(expenses, ({ one }) => ({
  firm: one(firms, { fields: [expenses.firmId], references: [firms.id] }),
  kase: one(cases, { fields: [expenses.caseId], references: [cases.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  firm: one(firms, { fields: [invoices.firmId], references: [firms.id] }),
  client: one(contacts, { fields: [invoices.clientId], references: [contacts.id] }),
  kase: one(cases, { fields: [invoices.caseId], references: [cases.id] }),
  lines: many(invoiceLineItems),
}));

export const invoiceLineItemsRelations = relations(invoiceLineItems, ({ one }) => ({
  firm: one(firms, { fields: [invoiceLineItems.firmId], references: [firms.id] }),
  invoice: one(invoices, { fields: [invoiceLineItems.invoiceId], references: [invoices.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  firm: one(firms, { fields: [payments.firmId], references: [firms.id] }),
  invoice: one(invoices, { fields: [payments.invoiceId], references: [invoices.id] }),
  client: one(contacts, { fields: [payments.clientId], references: [contacts.id] }),
}));

export const trustTransactionsRelations = relations(trustTransactions, ({ one }) => ({
  firm: one(firms, { fields: [trustTransactions.firmId], references: [firms.id] }),
  client: one(contacts, { fields: [trustTransactions.clientId], references: [contacts.id] }),
  kase: one(cases, { fields: [trustTransactions.caseId], references: [cases.id] }),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  firm: one(firms, { fields: [leads.firmId], references: [firms.id] }),
  convertedCase: one(cases, { fields: [leads.convertedCaseId], references: [cases.id] }),
  convertedContact: one(contacts, { fields: [leads.convertedContactId], references: [contacts.id] }),
  stageHistory: many(leadStageHistory),
}));

export const leadStageHistoryRelations = relations(leadStageHistory, ({ one }) => ({
  firm: one(firms, { fields: [leadStageHistory.firmId], references: [firms.id] }),
  lead: one(leads, { fields: [leadStageHistory.leadId], references: [leads.id] }),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  firm: one(firms, { fields: [documents.firmId], references: [firms.id] }),
  kase: one(cases, { fields: [documents.caseId], references: [cases.id] }),
}));

export const emailOutboxRelations = relations(emailOutbox, ({ one }) => ({
  firm: one(firms, { fields: [emailOutbox.firmId], references: [firms.id] }),
}));

export const threadsRelations = relations(threads, ({ one, many }) => ({
  firm: one(firms, { fields: [threads.firmId], references: [firms.id] }),
  client: one(contacts, { fields: [threads.clientId], references: [contacts.id] }),
  kase: one(cases, { fields: [threads.caseId], references: [cases.id] }),
  messages: many(threadMessages),
}));

export const threadMessagesRelations = relations(threadMessages, ({ one }) => ({
  firm: one(firms, { fields: [threadMessages.firmId], references: [firms.id] }),
  thread: one(threads, { fields: [threadMessages.threadId], references: [threads.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  firm: one(firms, { fields: [notifications.firmId], references: [firms.id] }),
}));
