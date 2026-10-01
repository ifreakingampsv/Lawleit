/**
 * The report descriptor the API contract exposes — the ReportDef shape of
 * app/src/lib/data/types.ts (id, title, kind, description). The backend does
 * not import the app's types (single source of truth there, mirrored here
 * like every module's contract shape), so it is restated with the exact
 * kind vocabulary.
 */
export interface ReportDescriptor {
  id: string;
  title: string;
  kind: "revenue" | "hours" | "cases-by-stage" | "ar-aging" | "lead-source" | "expenses" | "productivity";
  description: string;
}

/**
 * The predefined report catalog (ticket 20) — GET /reports' entire payload.
 *
 * Shape decision: the contract defines this route as "predefined report
 * descriptors" and the reference backend's handler is
 * `json(ctx.res, 200, structuredClone(seedReports))` — a STATIC list, no
 * aggregation. The analytics themselves (revenue by month, hours per
 * timekeeper, cases by stage, AR aging, leads by source, expenses by case)
 * are computed by the UI from the live cases/invoices/time-entries/leads/
 * expenses lists, keyed on these descriptors' ids ("r1"–"r6" — the panels
 * compare `active === "r1"` and the default selection IS "r1", so the ids
 * are load-bearing and mirrored verbatim from the seed). So the production
 * implementation is the same static catalog — 1:1 with the reference, byte-
 * shape compatible with the mock adapter, and no server-side aggregation
 * endpoint is invented that the contract never defined. A future server-side
 * analytics route (V2) would be a new contract row, not a widening of this
 * one.
 */
export const REPORT_CATALOG: ReportDescriptor[] = [
  { id: "r1", title: "Revenue by month", kind: "revenue", description: "Collected and planned revenue across the firm" },
  { id: "r2", title: "Hours by timekeeper", kind: "hours", description: "Billable vs non-billable hours per user" },
  { id: "r3", title: "Cases by stage", kind: "cases-by-stage", description: "Open matters across pipeline stages" },
  { id: "r4", title: "AR aging", kind: "ar-aging", description: "Outstanding client balances by age" },
  { id: "r5", title: "Leads by source", kind: "lead-source", description: "Where new business comes from" },
  { id: "r6", title: "Expenses by case", kind: "expenses", description: "Advanced costs per matter" },
];

/**
 * Reports business logic (ticket 20): the read-only descriptor catalog.
 * Firm-independent by nature — every firm sees the same predefined reports —
 * but still session-gated at the route (the reference's route table makes
 * GET /reports an authenticated surface) and still gated on the repository
 * set existing (the 503 envelope applies to the whole protected surface).
 * The list is copied per call so a caller mutating the response can never
 * reach the module's catalog (the reference's structuredClone purpose).
 */
export class ReportsService {
  async list(): Promise<ReportDescriptor[]> {
    return REPORT_CATALOG.map((report) => ({ ...report }));
  }
}
