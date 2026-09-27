/**
 * Repository seam for tasks (ticket 11) — the contacts/cases seam's twin
 * (services/contacts/repository.ts): services depend only on these interfaces;
 * the Drizzle binding (`drizzle.ts`) is the production implementation and
 * tests bind the in-memory fake (`in-memory.ts`), which is also what keeps
 * the suite green with no database present.
 *
 * Tenancy (ADR-0003): every method takes the caller's firm id and filters by
 * it; a cross-firm id must look up as "not found", never as an error that
 * leaks existence. The tasks tests assert that.
 */

/** The priority vocabulary of the API contract (app/src/lib/data/types.ts Task). */
export const TASK_PRIORITIES = ["low", "medium", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** The status vocabulary of the API contract (types.ts Task). */
export const TASK_STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskRow {
  id: string;
  firmId: string;
  title: string;
  /** Contract dates are ISO YYYY-MM-DD strings (days, not instants). */
  dueDate: string;
  priority: string;
  status: string;
  /** Nullable FK to the firm's cases; null = firm-wide task. */
  caseId: string | null;
  /** FK-less soft link (cases.lead_attorney_id pattern). */
  assigneeId: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** The task shape the API contract exposes (types.ts Task). */
export type ApiTask = Pick<
  TaskRow,
  "id" | "title" | "dueDate" | "priority" | "status" | "assigneeId"
> & {
  caseId?: string;
  description?: string;
  /** Contract shape is an ISO date (YYYY-MM-DD), not a timestamp. */
  createdAt: string;
};

/**
 * Destructuring is the whitelist — firm_id and bookkeeping (updated_at,
 * deleted_at) cannot leak, the timestamptz created_at collapses to its UTC
 * date part, and nullables vanish when empty, so responses are byte-shape
 * compatible with the mock adapter's tasks.
 */
export function toApiTask(row: TaskRow): ApiTask {
  const api: ApiTask = {
    id: row.id,
    title: row.title,
    dueDate: row.dueDate,
    priority: row.priority,
    status: row.status,
    assigneeId: row.assigneeId,
    createdAt: row.createdAt.toISOString().slice(0, 10),
  };
  if (row.caseId !== null) api.caseId = row.caseId;
  if (row.description !== null) api.description = row.description;
  return api;
}

export interface NewTask {
  firmId: string;
  title: string;
  dueDate: string;
  priority: string;
  status: string;
  caseId: string | null;
  assigneeId: string;
  description: string | null;
}

export interface TaskPatch {
  title?: string;
  dueDate?: string;
  priority?: string;
  status?: string;
  caseId?: string | null;
  assigneeId?: string;
  description?: string | null;
}

export interface TaskRepository {
  create(input: NewTask): Promise<TaskRow>;
  /** Live (non-deleted) task in the given firm; null otherwise. */
  findById(firmId: string, id: string): Promise<TaskRow | null>;
  /** The firm's live tasks, newest first (the mock/reference unshift). */
  listByFirm(firmId: string): Promise<TaskRow[]>;
  /** Live-row update; null when the row is missing, deleted, or another firm's. */
  update(firmId: string, id: string, patch: TaskPatch): Promise<TaskRow | null>;
  /** Soft delete: stamps deleted_at, the row itself stays (ADR-0003 audit). */
  delete(firmId: string, id: string): Promise<boolean>;
}
