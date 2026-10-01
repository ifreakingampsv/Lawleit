import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { notifications, threadMessages, threads } from "../../db/schema.js";
import type { DbExecutor } from "../auth/drizzle-repository.js";
import type {
  NewNotification,
  NewThread,
  NewThreadMessage,
  NotificationRepository,
  NotificationRow,
  ThreadMessageRepository,
  ThreadMessageRow,
  ThreadPatch,
  ThreadRepository,
  ThreadRow,
} from "./repository.js";

/**
 * Drizzle/postgres.js binding of the comms repository seam (ticket 20) —
 * the production implementation used when DATABASE_URL is set. Every read
 * that serves a request filters soft deletes and the firm scope (ADR-0003);
 * the write path sets updated_at itself (no triggers, per drizzle/README.md).
 */

const liveThread = () => isNull(threads.deletedAt);

export class DrizzleThreadRepository implements ThreadRepository {
  constructor(private readonly exec: DbExecutor) {}

  async create(input: NewThread): Promise<ThreadRow> {
    const [row] = await this.exec.insert(threads).values(input).returning();
    if (!row) throw new Error("thread insert returned no row");
    return row;
  }

  async findById(firmId: string, id: string): Promise<ThreadRow | null> {
    const [row] = await this.exec
      .select()
      .from(threads)
      .where(and(eq(threads.id, id), eq(threads.firmId, firmId), liveThread()))
      .limit(1);
    return row ?? null;
  }

  async listByFirm(firmId: string): Promise<ThreadRow[]> {
    return this.exec
      .select()
      .from(threads)
      .where(and(eq(threads.firmId, firmId), liveThread()))
      // Newest first (the mock/reference unshift); id breaks ties between
      // rows sharing one timestamp.
      .orderBy(desc(threads.createdAt), desc(threads.id));
  }

  async update(firmId: string, id: string, patch: ThreadPatch): Promise<ThreadRow | null> {
    const [row] = await this.exec
      .update(threads)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(threads.id, id), eq(threads.firmId, firmId), liveThread()))
      .returning();
    return row ?? null;
  }
}

export class DrizzleThreadMessageRepository implements ThreadMessageRepository {
  constructor(private readonly exec: DbExecutor) {}

  async create(input: NewThreadMessage): Promise<ThreadMessageRow> {
    // seq comes from the bigserial — the insertion-order stamp the row's
    // position in the conversation reads back from.
    const [row] = await this.exec.insert(threadMessages).values(input).returning();
    if (!row) throw new Error("thread message insert returned no row");
    return row;
  }

  async listByThreads(firmId: string, threadIds: string[]): Promise<ThreadMessageRow[]> {
    if (threadIds.length === 0) return [];
    // Oldest last within each thread: the insertion order IS the contract
    // order (the reference pushes onto the messages array); seq makes it
    // deterministic where created_at ties (same-instant appends).
    return this.exec
      .select()
      .from(threadMessages)
      .where(and(eq(threadMessages.firmId, firmId), inArray(threadMessages.threadId, threadIds)))
      .orderBy(asc(threadMessages.seq));
  }
}

export class DrizzleNotificationRepository implements NotificationRepository {
  constructor(private readonly exec: DbExecutor) {}

  async create(input: NewNotification): Promise<NotificationRow> {
    const [row] = await this.exec.insert(notifications).values(input).returning();
    if (!row) throw new Error("notification insert returned no row");
    return row;
  }

  async listByFirm(firmId: string): Promise<NotificationRow[]> {
    // Newest first (the reference seeds its demo rows that way); id breaks
    // ties between rows sharing one timestamp.
    return this.exec
      .select()
      .from(notifications)
      .where(eq(notifications.firmId, firmId))
      .orderBy(desc(notifications.at), desc(notifications.id));
  }

  async markAllRead(firmId: string): Promise<void> {
    await this.exec
      .update(notifications)
      .set({ read: true, updatedAt: new Date() })
      .where(eq(notifications.firmId, firmId));
  }
}
