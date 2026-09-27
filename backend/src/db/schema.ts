import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Ticket 07 tables: firms, users, sessions, password_reset_tokens.
 * Ticket 09 table: contacts.
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

export const firmsRelations = relations(firms, ({ many }) => ({
  users: many(users),
  sessions: many(sessions),
  contacts: many(contacts),
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

export const contactsRelations = relations(contacts, ({ one }) => ({
  firm: one(firms, { fields: [contacts.firmId], references: [firms.id] }),
}));
