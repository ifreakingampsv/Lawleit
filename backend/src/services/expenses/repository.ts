/**
 * Repository seam for expenses (ticket 12) — the time-entries seam's twin
 * (services/time/repository.ts): services depend only on these interfaces;
 * the Drizzle binding (`drizzle.ts`) is the production implementation and
 * tests bind the in-memory fake (`in-memory.ts`), which is also what keeps
 * the suite green with no database present.
 *
 * Tenancy (ADR-0003): every method takes the caller's firm id and filters by
 * it; a cross-firm id must look up as "not found", never as an error that
 * leaks existence. The expenses tests assert that.
 */

/** The category vocabulary of the API contract (app/src/lib/data/types.ts Expense). */
export const EXPENSE_CATEGORIES = ["filing", "travel", "copies", "expert", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface ExpenseRow {
  id: string;
  firmId: string;
  /** Required FK — an expense always bills a matter (like time_entries). */
  caseId: string;
  /** Contract dates are ISO YYYY-MM-DD strings (days, not instants). */
  date: string;
  description: string;
  /** Integer paise (types.ts Paise), stored verbatim — the client converts. */
  amount: number;
  billable: boolean;
  /** Server-stamped false; ticket 13's invoice flow flips it via the seam. */
  invoiced: boolean;
  category: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** The expense shape the API contract exposes (types.ts Expense). */
export type ApiExpense = Pick<
  ExpenseRow,
  "id" | "caseId" | "date" | "description" | "amount" | "billable" | "invoiced" | "category"
>;

/**
 * Destructuring is the whitelist — firm_id and bookkeeping (created_at,
 * updated_at, deleted_at) cannot leak, so responses are byte-shape compatible
 * with the mock adapter's expenses. The contract's Expense carries every
 * field required, so nothing drops conditionally.
 */
export function toApiExpense(row: ExpenseRow): ApiExpense {
  const { id, caseId, date, description, amount, billable, invoiced, category } = row;
  return { id, caseId, date, description, amount, billable, invoiced, category };
}

export interface NewExpense {
  firmId: string;
  caseId: string;
  date: string;
  description: string;
  amount: number;
  billable: boolean;
  invoiced: boolean;
  category: string;
}

/**
 * The patch a client can move. `invoiced` is deliberately absent — it is
 * server-managed end to end (stamped false on create, never client-writable,
 * the events.`source` seam treatment); ticket 13's invoice flow flips it
 * through its own seam. `caseId` is a required link: a patch may re-point it
 * but never clear it, so the type carries no null.
 */
export interface ExpensePatch {
  caseId?: string;
  date?: string;
  description?: string;
  amount?: number;
  billable?: boolean;
  category?: string;
}

export interface ExpenseRepository {
  create(input: NewExpense): Promise<ExpenseRow>;
  /** Live (non-deleted) expense in the given firm; null otherwise. */
  findById(firmId: string, id: string): Promise<ExpenseRow | null>;
  /** The firm's live expenses, newest first (the mock/reference unshift). */
  listByFirm(firmId: string): Promise<ExpenseRow[]>;
  /**
   * Ticket 13's unbilled selector: the firm's live, not-yet-invoiced
   * expenses for one case, newest first — the list an invoice builder draws
   * lines from. Billable filtering is the caller's concern; the flag is the
   * seam.
   */
  listUninvoicedByCase(firmId: string, caseId: string): Promise<ExpenseRow[]>;
  /**
   * Ticket 13's flip path: sets `invoiced` on the given live expenses of the
   * firm (firm-scoped, so a cross-firm id is silently inert) and returns how
   * many rows moved. Client patches cannot touch the flag — only this seam.
   */
  setInvoicedByIds(firmId: string, ids: string[], invoiced: boolean): Promise<number>;
  /** Live-row update; null when the row is missing, deleted, or another firm's. */
  update(firmId: string, id: string, patch: ExpensePatch): Promise<ExpenseRow | null>;
  /** Soft delete: stamps deleted_at, the row itself stays (ADR-0003 audit). */
  delete(firmId: string, id: string): Promise<boolean>;
}
