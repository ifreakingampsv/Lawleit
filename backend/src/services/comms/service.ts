import type { AuthRepositories } from "../auth/repository.js";
import { HttpError } from "../httpError.js";
import type {
  ApiNotification,
  ApiThread,
  MessageSender,
  NewThreadMessage,
  ThreadChannel,
} from "./repository.js";
import {
  MESSAGE_SENDERS,
  NOTIFICATION_KINDS,
  THREAD_CHANNELS,
  toApiNotification,
  toApiThread,
} from "./repository.js";

/** Shown (as a 400) when `channel` is not in the contract's Thread vocabulary. */
export const THREAD_CHANNEL_MESSAGE = "Channel must be secure, email, or sms";
/** Shown (as a 400) when a create-time message's `from` is not in the contract's vocabulary. */
export const THREAD_SENDER_MESSAGE = "Sender must be firm or client";
/** Shown (as a 400) when a create-time message's `at` is not parseable as a timestamp. */
export const THREAD_MESSAGE_AT_MESSAGE = "Message timestamp must be an ISO timestamp";
/** Shown (as a 400) when a clientId is not a uuid — the column is a uuid FK. */
export const THREAD_CLIENT_MESSAGE = "Invalid client id";
/** Shown (as a 400) when a well-formed clientId is not a live contact of the firm. */
export const THREAD_CLIENT_MISSING_MESSAGE = "Client not found";
/** Shown (as a 400) when a caseId is not a uuid — the column is a uuid FK. */
export const THREAD_CASE_MESSAGE = "Invalid case id";
/** Shown (as a 400) when a well-formed caseId is not a live case of the firm. */
export const THREAD_CASE_MISSING_MESSAGE = "Case not found";
/** Shown (as a 400) when a notification kind is not in the contract's vocabulary. */
export const NOTIFICATION_KIND_MESSAGE = "Kind must be info, payment, deadline, or message";

/** UUID shape of every production id (same rule as the :id params). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Cap on create-time imported messages (the contacts MAX_CASE_LINKS pattern). */
const MAX_THREAD_MESSAGES = 100;

const LENGTH_LIMITS = {
  subject: [200, "Subject is too long"],
  authorName: [200, "Author name is too long"],
  body: [4000, "Message is too long"],
} as const satisfies Record<string, [number, string]>;

/**
 * The writable thread input (create). Deliberately free-form strings: the
 * reference backend and the mock adapter store them verbatim (no trimming),
 * and the parity checklist in the ticket depends on that. `unread` is not
 * here at all — server-managed (created false; the reference hard-codes it
 * and only POST /threads/:id/read moves it), so a client-sent value is
 * stripped by the zod schema and ignored. `messages` is the reference's
 * create-time import surface (`b.messages ?? []` — the UI composes with an
 * empty array); entries append in the order sent, oldest last.
 */
export interface ThreadInput {
  subject?: string;
  clientId?: string | null;
  caseId?: string | null;
  channel?: string;
  messages?: ThreadMessageInput[];
}

export interface ThreadMessageInput {
  from?: string;
  authorName?: string;
  body?: string;
  /** Optional backdated stamp for imported entries; defaults to now. */
  at?: string;
}

/**
 * The writable notification input — NOT exposed by any route (the contract
 * and the reference generate no notifications at runtime; the reference only
 * seeds its demo rows). The service validates the kind vocabulary so a V2
 * generation rule cannot silently write an off-vocabulary value.
 */
export interface NotificationInput {
  text: string;
  kind?: string;
  read?: boolean;
  at?: Date;
}

function checkLength(value: string | null | undefined, field: keyof typeof LENGTH_LIMITS): void {
  const [max, message] = LENGTH_LIMITS[field];
  if ((value ?? "").length > max) throw new HttpError(400, message);
}

function checkUuid(value: string, message: string): void {
  if (!UUID_PATTERN.test(value)) throw new HttpError(400, message);
}

function checkChannel(channel: string): void {
  if (!THREAD_CHANNELS.includes(channel as ThreadChannel)) {
    throw new HttpError(400, THREAD_CHANNEL_MESSAGE);
  }
}

function checkSender(from: string): void {
  if (!MESSAGE_SENDERS.includes(from as MessageSender)) {
    throw new HttpError(400, THREAD_SENDER_MESSAGE);
  }
}

/** "" (and null) clear a link, mirroring the events.caseId treatment. */
function normalizeLink(value: string | null | undefined): string | null {
  return value === "" || value === null || value === undefined ? null : value;
}

function normalizeMessage(entry: ThreadMessageInput, now: () => Date): NewThreadMessage {
  const from = entry.from ?? "firm";
  checkSender(from);
  const authorName = entry.authorName ?? "";
  checkLength(authorName, "authorName");
  const body = entry.body ?? "";
  checkLength(body, "body");
  let at = now();
  if (entry.at !== undefined) {
    const parsed = new Date(entry.at);
    if (Number.isNaN(parsed.getTime())) throw new HttpError(400, THREAD_MESSAGE_AT_MESSAGE);
    at = parsed;
  }
  return { firmId: "", threadId: "", from, authorName, body, at };
}

/**
 * Communications business logic (ticket 20): the threads/messages surface
 * plus the notification bell. Practice data of the firm: every firm member
 * reads and writes it (the contract and the reference backend gate nothing
 * here, so neither do we), and the service is the choke point that scopes
 * every lookup by the session's firm (ADR-0003) and enforces the reference
 * backend's defaults.
 *
 * Message appends carry the session user's name as the author with
 * `from: "firm"` (the reference's hard-coded sender — there is no inbound
 * client-message surface in V1), and touch nothing else on the thread: the
 * reference updates neither `unread` nor any preview on append (the UI
 * derives the preview from the last message), so neither do we.
 *
 * Notifications are read-only data for V1: the reference generates none at
 * runtime (its bell is three seeded demo rows), so production firms start
 * with an empty bell and the only write surface is mark-all-read — the
 * create path exists for the repo seam and V2's generation rules.
 */
export class CommsService {
  constructor(
    private readonly repos: AuthRepositories,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * GET /threads — the firm's threads, newest first (the reference unshifts),
   * each with its messages embedded oldest last (the contract's list note).
   */
  async list(firmId: string): Promise<ApiThread[]> {
    const rows = await this.repos.threads.listByFirm(firmId);
    const messages = await this.repos.threadMessages.listByThreads(
      firmId,
      rows.map((t) => t.id),
    );
    const byThread = new Map<string, typeof messages>();
    for (const message of messages) {
      const bucket = byThread.get(message.threadId);
      if (bucket) bucket.push(message);
      else byThread.set(message.threadId, [message]);
    }
    return rows.map((row) => toApiThread(row, byThread.get(row.id) ?? []));
  }

  /**
   * POST /threads → 201 with the created entity. Defaults mirror the
   * reference backend exactly: subject "(no subject)", channel "secure",
   * unread false, no client/case link until sent. Client/case links are
   * validated (uuid shape, then live in-firm existence — a dangling link
   * must be impossible where the reference would store one).
   */
  async create(firmId: string, input: ThreadInput): Promise<ApiThread> {
    checkLength(input.subject, "subject");
    if (input.channel !== undefined) checkChannel(input.channel);
    const clientId = normalizeLink(input.clientId);
    if (clientId) checkUuid(clientId, THREAD_CLIENT_MESSAGE);
    const caseId = normalizeLink(input.caseId);
    if (caseId) checkUuid(caseId, THREAD_CASE_MESSAGE);
    if (input.messages !== undefined && input.messages.length > MAX_THREAD_MESSAGES) {
      throw new HttpError(400, "Too many messages");
    }
    const entries = (input.messages ?? []).map((entry) => {
      const message = normalizeMessage(entry, this.now);
      return { ...message, firmId };
    });

    const { row, messages } = await this.repos.transaction(async (tx) => {
      if (clientId) {
        const client = await tx.contacts.findById(firmId, clientId);
        if (!client) throw new HttpError(400, THREAD_CLIENT_MISSING_MESSAGE);
      }
      if (caseId) {
        const linked = await tx.cases.findById(firmId, caseId);
        if (!linked) throw new HttpError(400, THREAD_CASE_MISSING_MESSAGE);
      }
      const threadRow = await tx.threads.create({
        firmId,
        subject: input.subject ?? "(no subject)",
        clientId,
        caseId,
        channel: input.channel ?? "secure",
        unread: false,
      });
      const messageRows: Awaited<ReturnType<typeof tx.threadMessages.create>>[] = [];
      for (const entry of entries) {
        messageRows.push(await tx.threadMessages.create({ ...entry, threadId: threadRow.id }));
      }
      return { row: threadRow, messages: messageRows };
    });
    return toApiThread(row, messages);
  }

  /**
   * POST /threads/:id/messages → 200 with the WHOLE thread (the reference
   * returns the updated thread, not the bare message). The appended entry is
   * `from: "firm"` authored by the session user — 404 "Thread not found" for
   * a missing, deleted, or other firm's thread alike.
   */
  async sendMessage(firmId: string, authorName: string, threadId: string, body: string): Promise<ApiThread> {
    checkLength(authorName, "authorName");
    checkLength(body, "body");
    const at = this.now();
    const result = await this.repos.transaction(async (tx) => {
      const thread = await tx.threads.findById(firmId, threadId);
      if (!thread) throw new HttpError(404, "Thread not found");
      await tx.threadMessages.create({
        firmId,
        threadId: thread.id,
        from: "firm",
        authorName,
        body,
        at,
      });
      // The append mutates the thread (a new message exists); bump its stamp.
      await tx.threads.update(firmId, thread.id, {});
      const messages = await tx.threadMessages.listByThreads(firmId, [thread.id]);
      return { thread, messages };
    });
    return toApiThread(result.thread, result.messages);
  }

  /**
   * POST /threads/:id/read → 204; stamps `unread` false. 404 "Thread not
   * found" for a missing, deleted, or other firm's thread.
   */
  async markRead(firmId: string, threadId: string): Promise<void> {
    const row = await this.repos.threads.update(firmId, threadId, { unread: false });
    if (!row) throw new HttpError(404, "Thread not found");
  }

  /** GET /notifications — the firm's bell, newest first. */
  async listNotifications(firmId: string): Promise<ApiNotification[]> {
    const rows = await this.repos.notifications.listByFirm(firmId);
    return rows.map(toApiNotification);
  }

  /**
   * POST /notifications/read → 204; marks ALL of the firm's rows read (the
   * reference's `forEach(n => n.read = true)`) — and only that firm's.
   */
  async markNotificationsRead(firmId: string): Promise<void> {
    await this.repos.notifications.markAllRead(firmId);
  }

  /**
   * The V2 seam for notification generation (no V1 route reaches it): a
   * future rule (portal reply, gateway receipt) calls this with its rendered
   * sentence. Validates the contract's kind vocabulary before any insert.
   */
  async createNotification(firmId: string, input: NotificationInput): Promise<ApiNotification> {
    const kind = input.kind ?? "info";
    if (!NOTIFICATION_KINDS.includes(kind as (typeof NOTIFICATION_KINDS)[number])) {
      throw new HttpError(400, NOTIFICATION_KIND_MESSAGE);
    }
    const row = await this.repos.notifications.create({
      firmId,
      text: input.text,
      kind,
      read: input.read ?? false,
      at: input.at ?? this.now(),
    });
    return toApiNotification(row);
  }
}
