import { randomUUID } from "node:crypto";
import { InMemoryCaseNumberRepository, InMemoryCaseRepository } from "../cases/in-memory.js";
import type { CaseRow } from "../cases/repository.js";
import { InMemoryContactRepository } from "../contacts/in-memory.js";
import type { ContactRow } from "../contacts/repository.js";
import { InMemoryEventRepository } from "../events/in-memory.js";
import type { EventRow } from "../events/repository.js";
import { InMemoryTaskRepository } from "../tasks/in-memory.js";
import type { TaskRow } from "../tasks/repository.js";
import { InMemoryTimeEntryRepository } from "../time/in-memory.js";
import type { TimeEntryRow } from "../time/repository.js";
import { InMemoryExpenseRepository } from "../expenses/in-memory.js";
import type { ExpenseRow } from "../expenses/repository.js";
import type {
  AuthRepositories,
  FirmPatch,
  FirmRepository,
  FirmRow,
  NewFirm,
  NewSession,
  NewUser,
  PasswordResetRepository,
  ResetTokenRow,
  SessionBundle,
  SessionRepository,
  UserPatch,
  UserRepository,
  UserRow,
} from "./repository.js";

/**
 * In-memory AuthRepositories for tests (this ticket and later modules copy
 * this pattern). Honors the seam's semantics — firm scoping, soft-delete
 * filtering, session expiry — so service and route tests exercise real logic
 * without a database. The Drizzle implementation remains the production
 * binding; the DB-backed tests assert the two stay behaviorally identical.
 */

function nowDate(): Date {
  return new Date();
}

class InMemoryFirmRepository implements FirmRepository {
  constructor(readonly store: Store) {}

  async create(input: NewFirm): Promise<FirmRow> {
    const row: FirmRow = {
      id: randomUUID(),
      ...input,
      createdAt: nowDate(),
      updatedAt: nowDate(),
      deletedAt: null,
    };
    this.store.firms.push(row);
    return row;
  }

  async findById(id: string): Promise<FirmRow | null> {
    return this.store.firms.find((f) => f.id === id && f.deletedAt === null) ?? null;
  }

  async update(id: string, patch: FirmPatch): Promise<FirmRow | null> {
    const row = await this.findById(id);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: nowDate() });
    return row;
  }
}

class InMemoryUserRepository implements UserRepository {
  constructor(readonly store: Store) {}

  async create(input: NewUser): Promise<UserRow> {
    const row: UserRow = {
      id: randomUUID(),
      ...input,
      createdAt: nowDate(),
      updatedAt: nowDate(),
      deletedAt: null,
    };
    this.store.users.push(row);
    return row;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    return this.store.users.find((u) => u.email === email && u.deletedAt === null) ?? null;
  }

  async findById(id: string): Promise<UserRow | null> {
    return this.store.users.find((u) => u.id === id && u.deletedAt === null) ?? null;
  }

  async listByFirm(firmId: string): Promise<UserRow[]> {
    return this.store.users
      .filter((u) => u.firmId === firmId && u.deletedAt === null)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  }

  async update(id: string, patch: UserPatch): Promise<UserRow | null> {
    const row = await this.findById(id);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: nowDate() });
    return row;
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    const row = await this.findById(id);
    if (row) row.passwordHash = passwordHash;
  }
}

class InMemorySessionRepository implements SessionRepository {
  constructor(readonly store: Store) {}

  async create(input: NewSession): Promise<void> {
    this.store.sessions.push({ ...input });
  }

  async findActive(token: string, now: Date): Promise<SessionBundle | null> {
    const session = this.store.sessions.find((s) => s.token === token);
    if (!session) return null;
    if (session.expiresAt.getTime() <= now.getTime()) {
      this.store.sessions = this.store.sessions.filter((s) => s !== session);
      return null;
    }
    const user = this.store.users.find(
      (u) => u.id === session.userId && u.active && u.deletedAt === null,
    );
    const firm = this.store.firms.find((f) => f.id === session.firmId && f.deletedAt === null);
    if (!user || !firm) return null;
    return {
      token,
      userId: session.userId,
      firmId: session.firmId,
      expiresAt: session.expiresAt,
      user,
      firm,
    };
  }

  async delete(token: string): Promise<void> {
    this.store.sessions = this.store.sessions.filter((s) => s.token !== token);
  }

  async deleteForUser(userId: string): Promise<void> {
    this.store.sessions = this.store.sessions.filter((s) => s.userId !== userId);
  }
}

class InMemoryPasswordResetRepository implements PasswordResetRepository {
  constructor(readonly store: Store) {}

  async create(input: {
    userId: string;
    firmId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    this.store.resetTokens.push({ id: randomUUID(), ...input, usedAt: null });
  }

  async findActive(tokenHash: string, now: Date): Promise<ResetTokenRow | null> {
    return (
      this.store.resetTokens.find(
        (t) =>
          t.tokenHash === tokenHash &&
          t.usedAt === null &&
          t.expiresAt.getTime() > now.getTime() &&
          this.store.users.some((u) => u.id === t.userId && u.deletedAt === null),
      ) ?? null
    );
  }

  async markUsed(id: string): Promise<void> {
    const row = this.store.resetTokens.find((t) => t.id === id);
    if (row) row.usedAt = nowDate();
  }
}

interface Store {
  firms: FirmRow[];
  users: UserRow[];
  sessions: NewSession[];
  resetTokens: ResetTokenRow[];
  contacts: ContactRow[];
  cases: CaseRow[];
  /** Keyed `${firmId}:${year}` — the in-memory twin of case_number_counters. */
  caseNumbers: Map<string, number>;
  events: EventRow[];
  tasks: TaskRow[];
  timeEntries: TimeEntryRow[];
  expenses: ExpenseRow[];
}

/**
 * Builds one independent in-memory repo set. `transaction` runs the callback
 * against the same store (single-process tests have no partial failure to
 * roll back; the Drizzle impl owns real atomicity). Module repositories
 * (contacts, ticket 09; cases, ticket 10; events + tasks, ticket 11; time
 * entries + expenses, ticket 12) share
 * this store so their tests bind the same way.
 */
export function inMemoryAuthRepositories(): AuthRepositories {
  const store: Store = {
    firms: [],
    users: [],
    sessions: [],
    resetTokens: [],
    contacts: [],
    cases: [],
    caseNumbers: new Map(),
    events: [],
    tasks: [],
    timeEntries: [],
    expenses: [],
  };
  const repos: AuthRepositories = {
    firms: new InMemoryFirmRepository(store),
    users: new InMemoryUserRepository(store),
    sessions: new InMemorySessionRepository(store),
    passwordResets: new InMemoryPasswordResetRepository(store),
    contacts: new InMemoryContactRepository(store.contacts),
    cases: new InMemoryCaseRepository(store.cases),
    caseNumbers: new InMemoryCaseNumberRepository(store.caseNumbers),
    events: new InMemoryEventRepository(store.events),
    tasks: new InMemoryTaskRepository(store.tasks),
    timeEntries: new InMemoryTimeEntryRepository(store.timeEntries),
    expenses: new InMemoryExpenseRepository(store.expenses),
    async transaction(work) {
      return work(repos);
    },
  };
  return repos;
}

/** Mailer fake for tests: captures sends instead of logging. */
export class CapturingMailer {
  readonly sends: { to: string; token: string; expiresAt: string }[] = [];
  /** Ticket 08: invite emails, same envelope as resets (token is reusable). */
  readonly invites: { to: string; token: string; expiresAt: string }[] = [];

  async sendPasswordReset(email: { to: string; token: string; expiresAt: string }): Promise<void> {
    this.sends.push(email);
  }

  async sendUserInvite(email: { to: string; token: string; expiresAt: string }): Promise<void> {
    this.invites.push(email);
  }
}
