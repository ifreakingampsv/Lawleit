/**
 * Repository seam for communications (ticket 20) — same pattern as the auth
 * seam (services/auth/repository.ts): services depend only on these interfaces;
 * the Drizzle binding (`drizzle.ts`) is the production implementation and
 * tests bind the in-memory fake (`in-memory.ts`), which is also what keeps
 * the suite green with no database present.
 *
 * Tenancy (ADR-0003): every method takes the caller's firm id and filters by
 * it; a cross-firm id must look up as "not found", never as an error that
 * leaks existence. The comms service tests assert that.
 */

/** The contract's MessageThread.channel vocabulary (app/src/lib/data/types.ts). */
export const THREAD_CHANNELS = ["secure", "email", "sms"] as const;
export type ThreadChannel = (typeof THREAD_CHANNELS)[number];

/** The contract's message `from` vocabulary — who authored an entry. */
export const MESSAGE_SENDERS = ["firm", "client"] as const;
export type MessageSender = (typeof MESSAGE_SENDERS)[number];

/** The contract's Notification.kind vocabulary. */
export const NOTIFICATION_KINDS = ["info", "payment", "deadline", "message"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface ThreadRow {
  id: string;
  firmId: string;
  subject: string;
  /** The conversation's client contact; null renders "" in the API shape. */
  clientId: string | null;
  /** The matter the conversation belongs to; omitted from the API shape when null. */
  caseId: string | null;
  channel: string;
  /** Server-managed: false on create, moved only by mark-read. */
  unread: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ThreadMessageRow {
  id: string;
  firmId: string;
  threadId: string;
  /** Insertion-order stamp (the trust_transactions seq pattern) — DB-only. */
  seq: number;
  from: string;
  authorName: string;
  body: string;
  /** The contract's full-ISO-timestamp field (types.ts header note). */
  at: Date;
  createdAt: Date;
}

export interface NotificationRow {
  id: string;
  firmId: string;
  text: string;
  kind: string;
  read: boolean;
  /** The contract's full-ISO-timestamp field. */
  at: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** The contract's MessageThread.messages entry shape. */
export interface ApiThreadMessage {
  id: string;
  from: string;
  authorName: string;
  body: string;
  /** Full ISO timestamp (the contract carries instants for messages). */
  at: string;
}

export function toApiThreadMessage(row: ThreadMessageRow): ApiThreadMessage {
  return {
    id: row.id,
    from: row.from,
    authorName: row.authorName,
    body: row.body,
    at: row.at.toISOString(),
  };
}

/** The thread shape the API contract exposes (types.ts MessageThread). */
export interface ApiThread {
  id: string;
  subject: string;
  /** The reference stores "" for "no client"; null renders that way too. */
  clientId: string;
  caseId?: string;
  channel: string;
  unread: boolean;
  /** Oldest last — the contract's list note; the UI previews the last entry. */
  messages: ApiThreadMessage[];
}

/**
 * Destructuring is the whitelist — firm_id, seq and bookkeeping (updated_at,
 * deleted_at) cannot leak; `clientId` collapses to "" for null (the
 * invoices.clientId treatment) and `caseId` vanishes when null, so responses
 * are byte-shape compatible with the mock adapter's threads.
 */
export function toApiThread(row: ThreadRow, messages: ThreadMessageRow[]): ApiThread {
  const api: ApiThread = {
    id: row.id,
    subject: row.subject,
    clientId: row.clientId ?? "",
    channel: row.channel,
    unread: row.unread,
    messages: messages.map(toApiThreadMessage),
  };
  if (row.caseId !== null) api.caseId = row.caseId;
  return api;
}

/** The notification shape the API contract exposes (types.ts Notification). */
export interface ApiNotification {
  id: string;
  text: string;
  /** Full ISO timestamp. */
  at: string;
  read: boolean;
  kind: string;
}

/** Destructuring is the whitelist — firm_id and bookkeeping cannot leak. */
export function toApiNotification(row: NotificationRow): ApiNotification {
  const { id, text, at, read, kind } = row;
  return { id, text, at: at.toISOString(), read, kind };
}

export interface NewThread {
  firmId: string;
  subject: string;
  clientId: string | null;
  caseId: string | null;
  channel: string;
  unread: boolean;
}

/** The only mutable thread field: the read flag (no PATCH /threads/:id route). */
export interface ThreadPatch {
  unread?: boolean;
}

export interface NewThreadMessage {
  firmId: string;
  threadId: string;
  from: string;
  authorName: string;
  body: string;
  at: Date;
}

export interface NewNotification {
  firmId: string;
  text: string;
  kind: string;
  read: boolean;
  at: Date;
}

export interface ThreadRepository {
  create(input: NewThread): Promise<ThreadRow>;
  /** Live (non-deleted) thread in the given firm; null otherwise. */
  findById(firmId: string, id: string): Promise<ThreadRow | null>;
  /** The firm's live threads, newest first (the mock/reference unshift). */
  listByFirm(firmId: string): Promise<ThreadRow[]>;
  /** Live-row update (the read flag); null when the row is missing, deleted, or another firm's. */
  update(firmId: string, id: string, patch: ThreadPatch): Promise<ThreadRow | null>;
}

export interface ThreadMessageRepository {
  create(input: NewThreadMessage): Promise<ThreadMessageRow>;
  /**
   * Every message of the given live threads, oldest first (the contract's
   * "newest last" — the reference pushes onto the array). Ordered by the
   * insertion-order stamp so same-instant appends cannot scramble.
   */
  listByThreads(firmId: string, threadIds: string[]): Promise<ThreadMessageRow[]>;
}

export interface NotificationRepository {
  create(input: NewNotification): Promise<NotificationRow>;
  /** The firm's notifications, newest first (the reference seeds that order). */
  listByFirm(firmId: string): Promise<NotificationRow[]>;
  /** POST /notifications/read: marks every row of the firm read, in one UPDATE. */
  markAllRead(firmId: string): Promise<void>;
}
