import { randomUUID } from "node:crypto";
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
 * In-memory comms repositories for tests — the comms twin of
 * services/auth/testing.ts's fakes. Honors the seam's semantics (firm
 * scoping, newest-first thread/notification listings, oldest-last messages,
 * the append-only message log) so service and route tests exercise real
 * logic without a database; the DB twin proves the Drizzle binding stays
 * behaviorally identical.
 */
export class InMemoryThreadRepository implements ThreadRepository {
  constructor(readonly threads: ThreadRow[]) {}

  async create(input: NewThread): Promise<ThreadRow> {
    const row: ThreadRow = {
      id: randomUUID(),
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    // Newest first, mirroring the mock/reference unshift.
    this.threads.unshift(row);
    return row;
  }

  async findById(firmId: string, id: string): Promise<ThreadRow | null> {
    return (
      this.threads.find(
        (t) => t.id === id && t.firmId === firmId && t.deletedAt === null,
      ) ?? null
    );
  }

  async listByFirm(firmId: string): Promise<ThreadRow[]> {
    // unshift keeps the store newest-first, so filtering preserves the
    // contract order exactly (same-millisecond inserts included).
    return this.threads.filter((t) => t.firmId === firmId && t.deletedAt === null);
  }

  async update(firmId: string, id: string, patch: ThreadPatch): Promise<ThreadRow | null> {
    const row = await this.findById(firmId, id);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date() });
    return row;
  }
}

export class InMemoryThreadMessageRepository implements ThreadMessageRepository {
  /** The in-memory twin of thread_messages.seq — insertion order. */
  private nextSeq = 1;

  constructor(readonly messages: ThreadMessageRow[]) {}

  async create(input: NewThreadMessage): Promise<ThreadMessageRow> {
    const row: ThreadMessageRow = {
      id: randomUUID(),
      seq: this.nextSeq++,
      ...input,
      createdAt: new Date(),
    };
    // Append-only log: push (never unshift) — oldest first, like the
    // reference pushing onto the thread's messages array.
    this.messages.push(row);
    return row;
  }

  async listByThreads(firmId: string, threadIds: string[]): Promise<ThreadMessageRow[]> {
    const ids = new Set(threadIds);
    return this.messages
      .filter((m) => m.firmId === firmId && ids.has(m.threadId))
      // Push order IS seq order here; sorting keeps the twin honest if a
      // test seeds rows out of order.
      .sort((a, b) => a.seq - b.seq);
  }
}

export class InMemoryNotificationRepository implements NotificationRepository {
  constructor(readonly notifications: NotificationRow[]) {}

  async create(input: NewNotification): Promise<NotificationRow> {
    const row: NotificationRow = {
      id: randomUUID(),
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.notifications.unshift(row);
    return row;
  }

  async listByFirm(firmId: string): Promise<NotificationRow[]> {
    // Newest first by `at` (the reference seeds its demo rows that way);
    // id breaks ties between rows sharing one timestamp.
    return this.notifications
      .filter((n) => n.firmId === firmId)
      .sort((a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id));
  }

  async markAllRead(firmId: string): Promise<void> {
    for (const row of this.notifications) {
      if (row.firmId === firmId) {
        row.read = true;
        row.updatedAt = new Date();
      }
    }
  }
}
