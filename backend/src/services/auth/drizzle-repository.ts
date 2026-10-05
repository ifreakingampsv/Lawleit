import { and, eq, gt, isNull, lt } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase, PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { DbHandle } from "../../db/client.js";
import { firms, passwordResetTokens, sessions, users } from "../../db/schema.js";
import { DrizzleCaseNumberRepository, DrizzleCaseRepository } from "../cases/drizzle.js";
import {
  DrizzleNotificationRepository,
  DrizzleThreadMessageRepository,
  DrizzleThreadRepository,
} from "../comms/drizzle.js";
import { DrizzleContactRepository } from "../contacts/drizzle.js";
import { DrizzleDocumentRepository } from "../documents/drizzle.js";
import { DrizzleEventRepository } from "../events/drizzle.js";
import { DrizzleTaskRepository } from "../tasks/drizzle.js";
import { DrizzleTimeEntryRepository } from "../time/drizzle.js";
import { DrizzleExpenseRepository } from "../expenses/drizzle.js";
import { DrizzleGatewayAccountRepository } from "../gateway/drizzle.js";
import {
  DrizzleInvoiceLineRepository,
  DrizzleInvoiceNumberRepository,
  DrizzleInvoiceRepository,
} from "../invoices/drizzle.js";
import {
  DrizzleLeadRepository,
  DrizzleLeadStageHistoryRepository,
} from "../leads/drizzle.js";
import { DrizzlePaymentRepository } from "../payments/drizzle.js";
import { DrizzleTrustRepository } from "../trust/drizzle.js";
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
 * Drizzle/postgres.js binding of the auth repository seam — the production
 * implementation used when DATABASE_URL is set (ADR-0002). Every read that
 * serves a request filters soft deletes; every write sets updated_at itself
 * (no triggers, per drizzle/README.md).
 */

/**
 * Any drizzle executor: the process-wide db or one transaction. Both carry the
 * same query surface for our schema (the relational query API is unused).
 */
export type DbExecutor =
  | PostgresJsDatabase
  | PgTransaction<
      PostgresJsQueryResultHKT,
      Record<string, never>,
      ExtractTablesWithRelations<Record<string, never>>
    >;

const liveFirm = () => isNull(firms.deletedAt);
const liveUser = () => isNull(users.deletedAt);

class DrizzleFirmRepository implements FirmRepository {
  constructor(private readonly exec: DbExecutor) {}

  async create(input: NewFirm): Promise<FirmRow> {
    const [row] = await this.exec.insert(firms).values(input).returning();
    if (!row) throw new Error("firm insert returned no row");
    return row;
  }

  async findById(id: string): Promise<FirmRow | null> {
    const [row] = await this.exec
      .select()
      .from(firms)
      .where(and(eq(firms.id, id), liveFirm()))
      .limit(1);
    return row ?? null;
  }

  async update(id: string, patch: FirmPatch): Promise<FirmRow | null> {
    const [row] = await this.exec
      .update(firms)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(firms.id, id), liveFirm()))
      .returning();
    return row ?? null;
  }
}

class DrizzleUserRepository implements UserRepository {
  constructor(private readonly exec: DbExecutor) {}

  async create(input: NewUser): Promise<UserRow> {
    const [row] = await this.exec.insert(users).values(input).returning();
    if (!row) throw new Error("user insert returned no row");
    return row;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const [row] = await this.exec
      .select()
      .from(users)
      .where(and(eq(users.email, email), liveUser()))
      .limit(1);
    return row ?? null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const [row] = await this.exec
      .select()
      .from(users)
      .where(and(eq(users.id, id), liveUser()))
      .limit(1);
    return row ?? null;
  }

  async listByFirm(firmId: string): Promise<UserRow[]> {
    return this.exec
      .select()
      .from(users)
      .where(and(eq(users.firmId, firmId), liveUser()))
      // id tie-break: same-transaction inserts share one now() timestamp.
      .orderBy(users.createdAt, users.id);
  }

  async update(id: string, patch: UserPatch): Promise<UserRow | null> {
    const [row] = await this.exec
      .update(users)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(users.id, id), liveUser()))
      .returning();
    return row ?? null;
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.exec
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(and(eq(users.id, id), liveUser()));
  }
}

class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly exec: DbExecutor) {}

  async create(input: NewSession): Promise<void> {
    // The sessions table's primary key IS the token (ADR-0005).
    await this.exec.insert(sessions).values({
      id: input.token,
      userId: input.userId,
      firmId: input.firmId,
      expiresAt: input.expiresAt,
    });
  }

  async findActive(token: string, now: Date): Promise<SessionBundle | null> {
    const [row] = await this.exec
      .select({ session: sessions, user: users, firm: firms })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .innerJoin(firms, eq(sessions.firmId, firms.id))
      .where(
        and(
          eq(sessions.id, token),
          gt(sessions.expiresAt, now),
          eq(users.active, true),
          liveUser(),
          liveFirm(),
        ),
      )
      .limit(1);
    if (row) {
      return {
        token,
        userId: row.session.userId,
        firmId: row.session.firmId,
        expiresAt: row.session.expiresAt,
        user: row.user,
        firm: row.firm,
      };
    }
    // Opportunistic cleanup: only this session's expired row, only on the
    // failed-lookup path, so dead sessions do not accumulate without a job.
    await this.exec.delete(sessions).where(and(eq(sessions.id, token), lt(sessions.expiresAt, now)));
    return null;
  }

  async delete(token: string): Promise<void> {
    await this.exec.delete(sessions).where(eq(sessions.id, token));
  }

  async deleteForUser(userId: string): Promise<void> {
    await this.exec.delete(sessions).where(eq(sessions.userId, userId));
  }
}

class DrizzlePasswordResetRepository implements PasswordResetRepository {
  constructor(private readonly exec: DbExecutor) {}

  async create(input: {
    userId: string;
    firmId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.exec.insert(passwordResetTokens).values(input);
  }

  async findActive(tokenHash: string, now: Date): Promise<ResetTokenRow | null> {
    const [row] = await this.exec
      .select({ token: passwordResetTokens })
      .from(passwordResetTokens)
      .innerJoin(users, eq(passwordResetTokens.userId, users.id))
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          gt(passwordResetTokens.expiresAt, now),
          isNull(passwordResetTokens.usedAt),
          liveUser(),
        ),
      )
      .limit(1);
    return row?.token ?? null;
  }

  async markUsed(id: string): Promise<void> {
    await this.exec
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, id));
  }
}

/** Builds a repo set bound to the given executor (the db or a transaction). */
export function reposOnExecutor(exec: DbExecutor): AuthRepositories {
  return {
    firms: new DrizzleFirmRepository(exec),
    users: new DrizzleUserRepository(exec),
    sessions: new DrizzleSessionRepository(exec),
    passwordResets: new DrizzlePasswordResetRepository(exec),
    contacts: new DrizzleContactRepository(exec),
    cases: new DrizzleCaseRepository(exec),
    caseNumbers: new DrizzleCaseNumberRepository(exec),
    events: new DrizzleEventRepository(exec),
    tasks: new DrizzleTaskRepository(exec),
    timeEntries: new DrizzleTimeEntryRepository(exec),
    expenses: new DrizzleExpenseRepository(exec),
    invoices: new DrizzleInvoiceRepository(exec),
    invoiceLines: new DrizzleInvoiceLineRepository(exec),
    invoiceNumbers: new DrizzleInvoiceNumberRepository(exec),
    payments: new DrizzlePaymentRepository(exec),
    trust: new DrizzleTrustRepository(exec),
    leads: new DrizzleLeadRepository(exec),
    leadStageHistory: new DrizzleLeadStageHistoryRepository(exec),
    documents: new DrizzleDocumentRepository(exec),
    threads: new DrizzleThreadRepository(exec),
    threadMessages: new DrizzleThreadMessageRepository(exec),
    notifications: new DrizzleNotificationRepository(exec),
    gatewayAccounts: new DrizzleGatewayAccountRepository(exec),
    transaction: () => {
      throw new Error("transaction() is only available on the root repository set");
    },
  };
}

export function createDrizzleRepositories(handle: DbHandle): AuthRepositories {
  const root = reposOnExecutor(handle.db);
  return {
    ...root,
    transaction<T>(work: (repos: AuthRepositories) => Promise<T>): Promise<T> {
      return handle.db.transaction((tx) => work(reposOnExecutor(tx)));
    },
  };
}
