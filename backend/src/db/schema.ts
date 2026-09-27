import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
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
}));

export const eventsRelations = relations(events, ({ one }) => ({
  firm: one(firms, { fields: [events.firmId], references: [firms.id] }),
  kase: one(cases, { fields: [events.caseId], references: [cases.id] }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  firm: one(firms, { fields: [tasks.firmId], references: [firms.id] }),
  kase: one(cases, { fields: [tasks.caseId], references: [cases.id] }),
}));
