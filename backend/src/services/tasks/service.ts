import type { AuthRepositories } from "../auth/repository.js";
import { HttpError } from "../httpError.js";
import type { ApiTask, TaskPatch } from "./repository.js";
import { TASK_PRIORITIES, TASK_STATUSES, toApiTask, type TaskPriority, type TaskStatus } from "./repository.js";

/** Shown (as a 400) when `priority` is not in the contract's Task vocabulary. */
export const TASK_PRIORITY_MESSAGE = "Priority must be low, medium, or high";
/** Shown (as a 400) when `status` is not in the contract's Task vocabulary. */
export const TASK_STATUS_MESSAGE = "Status must be todo, in_progress, blocked, or done";
/** Shown (as a 400) when the due date is not an ISO YYYY-MM-DD string. */
export const TASK_DUE_DATE_MESSAGE = "Date must be a YYYY-MM-DD string";
/** Shown (as a 400) when a caseId is not a uuid — the column is uuid. */
export const TASK_CASE_MESSAGE = "Invalid case id";
/** Shown (as a 400) when a well-formed caseId is not a live case of the firm. */
export const TASK_CASE_MISSING_MESSAGE = "Case not found";
/** Shown (as a 400) when an assigneeId is not a uuid. */
export const TASK_ASSIGNEE_MESSAGE = "Invalid assignee id";
/** Shown (as a 400) when the firm somehow has no user to default the assignee to. */
const NO_USER_MESSAGE = "Firm has no users";

/** UUID shape of every production id (same rule as the :id params). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const LENGTH_LIMITS = {
  title: [200, "Title is too long"],
  description: [4000, "Description is too long"],
} as const satisfies Record<string, [number, string]>;

/**
 * The writable task input (create and patch). Deliberately free-form: the
 * reference backend and the mock adapter store these fields verbatim (no
 * trimming), and the parity checklist in the ticket depends on that.
 */
export interface TaskInput {
  title?: string;
  dueDate?: string;
  priority?: string;
  status?: string;
  caseId?: string | null;
  assigneeId?: string;
  description?: string | null;
}

function checkLength(value: string | null | undefined, field: keyof typeof LENGTH_LIMITS): void {
  const [max, message] = LENGTH_LIMITS[field];
  if ((value ?? "").length > max) throw new HttpError(400, message);
}

function checkUuid(value: string, message: string): void {
  if (!UUID_PATTERN.test(value)) throw new HttpError(400, message);
}

function checkIsoDate(value: string): void {
  if (!ISO_DATE_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, TASK_DUE_DATE_MESSAGE);
  }
}

function normalizePatch(patch: TaskInput): TaskPatch {
  const out: TaskPatch = {};
  if (patch.title !== undefined) {
    checkLength(patch.title, "title");
    out.title = patch.title;
  }
  if (patch.dueDate !== undefined) {
    checkIsoDate(patch.dueDate);
    out.dueDate = patch.dueDate;
  }
  if (patch.priority !== undefined) {
    if (!TASK_PRIORITIES.includes(patch.priority as TaskPriority)) {
      throw new HttpError(400, TASK_PRIORITY_MESSAGE);
    }
    out.priority = patch.priority;
  }
  if (patch.status !== undefined) {
    if (!TASK_STATUSES.includes(patch.status as TaskStatus)) {
      throw new HttpError(400, TASK_STATUS_MESSAGE);
    }
    out.status = patch.status;
  }
  if (patch.caseId !== undefined) {
    // "" (and null) clear the case link, mirroring the cases.clientId treatment.
    out.caseId = patch.caseId === "" || patch.caseId === null ? null : patch.caseId;
    if (out.caseId !== null) checkUuid(out.caseId, TASK_CASE_MESSAGE);
  }
  if (patch.assigneeId !== undefined) {
    checkUuid(patch.assigneeId, TASK_ASSIGNEE_MESSAGE);
    out.assigneeId = patch.assigneeId;
  }
  if (patch.description !== undefined) {
    checkLength(patch.description, "description");
    out.description = patch.description;
  }
  return out;
}

/**
 * Tasks business logic (ticket 11). Practice data of the firm: every firm
 * member manages it (unlike users — the contract and the reference backend
 * gate nothing here, so neither do we). The service is the choke point that
 * scopes every lookup by the session's firm (ADR-0003) and enforces the
 * reference backend's defaults and soft delete.
 *
 * Completion semantics: the contract's Task carries a `status` field and no
 * completedAt, and the contract's note ("status flow: todo → in_progress →
 * blocked/done") documents the UI's flow, not a server-enforced transition
 * table — the mock's Object.assign accepts any status in any order. So
 * completing a task IS `PATCH /tasks/:id { status: "done" }`, and transitions
 * are free (pinned by tests), exactly like the cases statuses.
 */
export class TasksService {
  constructor(
    private readonly repos: AuthRepositories,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Newest first — the mock and the reference both unshift new tasks. */
  async list(firmId: string): Promise<ApiTask[]> {
    const rows = await this.repos.tasks.listByFirm(firmId);
    return rows.map(toApiTask);
  }

  /**
   * POST /tasks → 201 with the created entity. Defaults mirror the reference
   * backend exactly: title "New task", dueDate today, priority "medium",
   * status "todo", no case link or description until set, and the assignee
   * defaults to the firm's first user (the reference's `db.users[0]`). The
   * contract's `createdAt` is an ISO day: the column is the baseline
   * timestamptz stamp and the mapper collapses it to its UTC date part.
   */
  async create(firmId: string, input: TaskInput): Promise<ApiTask> {
    const patch = normalizePatch(input);
    const today = this.now().toISOString().slice(0, 10);
    const row = await this.repos.transaction(async (tx) => {
      if (patch.caseId !== undefined && patch.caseId !== null) {
        const linked = await tx.cases.findById(firmId, patch.caseId);
        if (!linked) throw new HttpError(400, TASK_CASE_MISSING_MESSAGE);
      }
      let assigneeId = patch.assigneeId;
      if (assigneeId === undefined) {
        const users = await tx.users.listByFirm(firmId);
        const first = users[0];
        if (!first) throw new HttpError(400, NO_USER_MESSAGE);
        assigneeId = first.id;
      }
      return tx.tasks.create({
        firmId,
        title: patch.title ?? "New task",
        dueDate: patch.dueDate ?? today,
        priority: patch.priority ?? "medium",
        status: patch.status ?? "todo",
        caseId: patch.caseId ?? null,
        assigneeId,
        description: patch.description ?? null,
      });
    });
    return toApiTask(row);
  }

  /** PATCH /tasks/:id — only the sent fields move (mock Object.assign). */
  async update(firmId: string, id: string, patch: TaskInput): Promise<ApiTask> {
    const normalized = normalizePatch(patch);
    const row = await this.repos.transaction(async (tx) => {
      if (normalized.caseId !== undefined && normalized.caseId !== null) {
        const linked = await tx.cases.findById(firmId, normalized.caseId);
        if (!linked) throw new HttpError(400, TASK_CASE_MISSING_MESSAGE);
      }
      return tx.tasks.update(firmId, id, normalized);
    });
    if (!row) throw new HttpError(404, "Task not found");
    return toApiTask(row);
  }

  /** DELETE /tasks/:id → 204. Soft delete per the baseline convention. */
  async delete(firmId: string, id: string): Promise<void> {
    const deleted = await this.repos.tasks.delete(firmId, id);
    if (!deleted) throw new HttpError(404, "Task not found");
  }
}
