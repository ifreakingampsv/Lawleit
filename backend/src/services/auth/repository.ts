/**
 * Repository seam for auth (ticket 07). Services depend only on these narrow
 * interfaces; the Drizzle/postgres.js implementation
 * (`drizzle-repository.ts`) is the production binding used when DATABASE_URL
 * is set. Tests bind in-memory fakes, which is also what keeps the suite
 * green with no database present.
 *
 * Tenancy (ADR-0003): every repo method that takes a firm scope filters by it;
 * cross-firm ids must look up as "not found", never as an error that leaks
 * existence. Each module's tests assert that.
 *
 * Since ticket 09 this aggregate carries the module repositories too
 * (`contacts`), so every module's tables share one transaction() seam — the
 * wiring functions in testing.ts / drizzle-repository.ts attach them.
 */

import type { CaseNumberRepository, CaseRepository } from "../cases/repository.js";
import type {
  NotificationRepository,
  ThreadMessageRepository,
  ThreadRepository,
} from "../comms/repository.js";
import type { ContactRepository } from "../contacts/repository.js";
import type { DocumentRepository } from "../documents/repository.js";
import type { EventRepository } from "../events/repository.js";
import type { TaskRepository } from "../tasks/repository.js";
import type { TimeEntryRepository } from "../time/repository.js";
import type { ExpenseRepository } from "../expenses/repository.js";
import type {
  GatewayAccountRepository,
  GatewayEventRepository,
  PaymentLinkRepository,
} from "../gateway/repository.js";
import type {
  InvoiceLineRepository,
  InvoiceNumberRepository,
  InvoiceRepository,
} from "../invoices/repository.js";
import type { LeadRepository, LeadStageHistoryRepository } from "../leads/repository.js";
import type { PaymentRepository } from "../payments/repository.js";
import type { TrustRepository } from "../trust/repository.js";

/**
 * The sample-workspace state (V2 ticket 09) — SERVER-MANAGED, stored as the
 * firms.sample_data jsonb column. Null = never seeded; the seeded state
 * carries the created ids so removal can find them without name-matching;
 * the removed state means the owner cleared it and it never comes back.
 */
export type SampleDataState =
  | {
      seeded: true;
      contactIds: string[];
      caseId: string;
      eventId: string;
      taskId: string;
      timeEntryId: string;
      invoiceId: string;
      paymentId: string;
      trustClientId: string;
      trustAmount: number;
    }
  | { removed: true };

export interface FirmRow {
  id: string;
  name: string;
  practiceAreas: string[];
  phone: string;
  email: string;
  address: string;
  plan: string;
  trialEndsAt: string | null;
  /** Optional so in-memory create sites and pre-0015 rows need no change. */
  sampleData?: SampleDataState | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface UserRow {
  id: string;
  firmId: string;
  name: string;
  email: string;
  /** Argon2id hash. Never leaves the service layer — the API mappers strip it. */
  passwordHash: string;
  role: string;
  avatarColor: string;
  hourlyRate: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ResetTokenRow {
  id: string;
  userId: string;
  firmId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

/** Session row plus its live user and firm, joined in one lookup. */
export interface SessionBundle {
  token: string;
  userId: string;
  firmId: string;
  expiresAt: Date;
  user: UserRow;
  firm: FirmRow;
}

/** The user shape the API contract exposes (app/src/lib/data/types.ts User). */
export type ApiUser = Pick<
  UserRow,
  "id" | "firmId" | "name" | "email" | "role" | "avatarColor" | "hourlyRate" | "active"
>;

/** The firm shape the API contract exposes (types.ts Firm). */
export type ApiFirm = Pick<
  FirmRow,
  "id" | "name" | "practiceAreas" | "phone" | "email" | "address" | "plan" | "trialEndsAt"
> & {
  /** Server-computed from sample_data — the dashboard banner's trigger. */
  hasSampleData: boolean;
};

/** Destructuring is the whitelist — password_hash and bookkeeping cannot leak. */
export function toApiUser(row: UserRow): ApiUser {
  const { id, firmId, name, email, role, avatarColor, hourlyRate, active } = row;
  return { id, firmId, name, email, role, avatarColor, hourlyRate, active };
}

export function toApiFirm(row: FirmRow): ApiFirm {
  const { id, name, practiceAreas, phone, email, address, plan, trialEndsAt, sampleData } = row;
  return {
    id, name, practiceAreas, phone, email, address, plan, trialEndsAt,
    hasSampleData: sampleData !== null && sampleData !== undefined && "seeded" in sampleData,
  };
}

export interface NewFirm {
  name: string;
  practiceAreas: string[];
  phone: string;
  email: string;
  address: string;
  plan: string;
  trialEndsAt: string | null;
}

export interface NewUser {
  firmId: string;
  name: string;
  email: string;
  passwordHash: string;
  role: string;
  avatarColor: string;
  hourlyRate: number;
  active: boolean;
}

export interface NewSession {
  token: string;
  userId: string;
  firmId: string;
  expiresAt: Date;
}

export interface UserPatch {
  name?: string;
  role?: string;
  avatarColor?: string;
  hourlyRate?: number;
  active?: boolean;
}

export interface FirmPatch {
  name?: string;
  practiceAreas?: string[];
  phone?: string;
  email?: string;
  address?: string;
  plan?: string;
  /** SERVER-MANAGED — the sample seeder/remover writes it directly at the
   * repository; the PATCH /firm route's zod schema strips it from clients. */
  sampleData?: SampleDataState | null;
}

export interface FirmRepository {
  create(input: NewFirm): Promise<FirmRow>;
  findById(id: string): Promise<FirmRow | null>;
  /** Live (non-deleted) firm update; null when the row is missing or deleted. */
  update(id: string, patch: FirmPatch): Promise<FirmRow | null>;
}

export interface UserRepository {
  create(input: NewUser): Promise<UserRow>;
  /** Email is unique globally (login has no firm scope); stored lowercase. */
  findByEmail(email: string): Promise<UserRow | null>;
  findById(id: string): Promise<UserRow | null>;
  listByFirm(firmId: string): Promise<UserRow[]>;
  update(id: string, patch: UserPatch): Promise<UserRow | null>;
  updatePasswordHash(id: string, passwordHash: string): Promise<void>;
}

export interface SessionRepository {
  create(input: NewSession): Promise<void>;
  /**
   * One indexed lookup joining user + firm. A session counts as active only
   * when unexpired, its user is active and not deleted, and its firm is not
   * deleted; anything else returns null (→ 401 upstream).
   */
  findActive(token: string, now: Date): Promise<SessionBundle | null>;
  delete(token: string): Promise<void>;
  deleteForUser(userId: string): Promise<void>;
}

export interface PasswordResetRepository {
  create(input: { userId: string; firmId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  /** Unexpired, unconsumed token by hash; null otherwise. */
  findActive(tokenHash: string, now: Date): Promise<ResetTokenRow | null>;
  markUsed(id: string): Promise<void>;
}

/**
 * The aggregate handed to services. transaction() is the seam's atomicity
 * primitive: inside the callback every repo is bound to one database
 * transaction, so multi-row writes (firm + owner, password + token + sessions,
 * counter + case) commit or roll back together. In-memory fakes run the
 * callback directly.
 */
export interface AuthRepositories {
  firms: FirmRepository;
  users: UserRepository;
  sessions: SessionRepository;
  passwordResets: PasswordResetRepository;
  /** Ticket 09: contacts ride the same aggregate and transaction seam. */
  contacts: ContactRepository;
  /** Ticket 10: cases and their per-firm-year number counters ditto. */
  cases: CaseRepository;
  caseNumbers: CaseNumberRepository;
  /** Ticket 11: calendar events and tasks ride the same aggregate and seam. */
  events: EventRepository;
  tasks: TaskRepository;
  /** Ticket 12: time entries and expenses ride the same aggregate and seam. */
  timeEntries: TimeEntryRepository;
  expenses: ExpenseRepository;
  /** Ticket 13: invoices, their line items and the INV-XXXX counter ditto. */
  invoices: InvoiceRepository;
  invoiceLines: InvoiceLineRepository;
  invoiceNumbers: InvoiceNumberRepository;
  /** Ticket 14: payments ride the same aggregate and transaction seam — the
   * roll-up (payment insert + invoice status re-derivation) commits atomically. */
  payments: PaymentRepository;
  /** Ticket 15: the append-only trust ledger rides the same aggregate and
   * transaction seam — a trust-flagged payment and its ledger entry commit
   * atomically, and the per-client append serialization holds inside it. */
  trust: TrustRepository;
  /** Ticket 16: leads and their stage-history audit trail ditto. */
  leads: LeadRepository;
  leadStageHistory: LeadStageHistoryRepository;
  /** Ticket 17: documents ride the same aggregate and transaction seam —
   * the metadata row and its storage-key binding commit atomically. */
  documents: DocumentRepository;
  /** Ticket 20: threads, their append-only messages and the notification
   * bell ride the same aggregate and transaction seam — a message append
   * and its thread stamp commit atomically. */
  threads: ThreadRepository;
  threadMessages: ThreadMessageRepository;
  notifications: NotificationRepository;
  /** V2 slice 1 (ticket 02): the firm's one gateway account rides the same
   * aggregate and transaction seam — the connect/replace upsert commits
   * atomically (the partial unique firm_id index guards the invariant). */
  gatewayAccounts: GatewayAccountRepository;
  /** V2 slice 1 (ticket 03): the firm's payment links ditto — the webhook
   * path (ticket 04) flips a link's status and records its payment inside
   * one transaction. */
  paymentLinks: PaymentLinkRepository;
  /** V2 slice 1 (ticket 04): the webhook idempotency ledger ditto — the
   * event row and the payment it produces commit in ONE transaction, so a
   * replayed delivery dies on the unique (provider, provider_event_id) index
   * and writes nothing. */
  gatewayEvents: GatewayEventRepository;
  transaction<T>(work: (repos: AuthRepositories) => Promise<T>): Promise<T>;
}
