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
import type { ContactRepository } from "../contacts/repository.js";

export interface FirmRow {
  id: string;
  name: string;
  practiceAreas: string[];
  phone: string;
  email: string;
  address: string;
  plan: string;
  trialEndsAt: string | null;
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
>;

/** Destructuring is the whitelist — password_hash and bookkeeping cannot leak. */
export function toApiUser(row: UserRow): ApiUser {
  const { id, firmId, name, email, role, avatarColor, hourlyRate, active } = row;
  return { id, firmId, name, email, role, avatarColor, hourlyRate, active };
}

export function toApiFirm(row: FirmRow): ApiFirm {
  const { id, name, practiceAreas, phone, email, address, plan, trialEndsAt } = row;
  return { id, name, practiceAreas, phone, email, address, plan, trialEndsAt };
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
  transaction<T>(work: (repos: AuthRepositories) => Promise<T>): Promise<T>;
}
