/**
 * Repository seam for the trust ledger (ticket 15) — the module seams' twin
 * (services/invoices/repository.ts): services depend only on these interfaces;
 * the Drizzle binding (`drizzle.ts`) is the production implementation and
 * tests bind the in-memory fake (`in-memory.ts`), which is also what keeps
 * the suite green with no database present.
 *
 * Tenancy (ADR-0003): every method takes the caller's firm id and filters by
 * it; a cross-firm id must look up as "not found", never as an error that
 * leaks existence. The trust tests assert that.
 *
 * This is the CORRECTNESS-CRITICAL seam: the ledger is append-only and every
 * entry carries the running per-client balance, so `append` computes
 * balanceAfter itself — reading the previous entry and inserting the new one
 * MUST be atomic per (firm, client) or concurrent appends fork the chain.
 * The two implementations own that atomicity (Drizzle: per-client advisory
 * lock inside the caller's transaction; in-memory: no await between the read
 * and the push, so an interleaved append cannot slip between them) — the
 * service never computes a balance itself.
 */

/**
 * One ledger entry to append. `balanceAfter` is deliberately absent — it is
 * computed by the repository inside the append (the previous entry's
 * balanceAfter + amount, 0 for a client's first entry — the reference's
 * `prev?.balanceAfter ?? 0`), never supplied by a caller and never updated.
 */
export interface NewTrustEntry {
  firmId: string;
  /** Null is the unattributed bucket — the reference's "" client. */
  clientId: string | null;
  /** Null for an unlinked deposit (the reference's "" case). */
  caseId: string | null;
  /** Contract date, ISO YYYY-MM-DD — the caller's already-validated day. */
  date: string;
  description: string;
  /** Signed integer paise: + in, − out (the contract's amount comment). */
  amount: number;
}

export interface TrustTransactionRow {
  id: string;
  firmId: string;
  clientId: string | null;
  caseId: string | null;
  /** Contract dates are ISO YYYY-MM-DD strings (days, not instants). */
  date: string;
  description: string;
  amount: number;
  balanceAfter: number;
  /** Insertion-order stamp (schema.ts) — DB-only, whitelisted out of the API. */
  seq: number;
  createdAt: Date;
}

/**
 * The ledger entry shape the API contract exposes (types.ts
 * TrustTransaction): all ids are `ID` strings — null links render "".
 */
export type ApiTrustTransaction = {
  id: string;
  clientId: string;
  caseId: string;
  date: string;
  description: string;
  amount: number;
  balanceAfter: number;
};

/**
 * Destructuring is the whitelist — firm_id, the DB-only seq and the
 * bookkeeping stamp cannot leak, and null links render "" (the payments
 * mapper's convention), so responses are byte-shape compatible with the mock
 * adapter's trust entries.
 */
export function toApiTrustTransaction(row: TrustTransactionRow): ApiTrustTransaction {
  const { id, clientId, caseId, date, description, amount, balanceAfter } = row;
  return { id, clientId: clientId ?? "", caseId: caseId ?? "", date, description, amount, balanceAfter };
}

/**
 * The append-only ledger. There is NO update/delete path here on purpose — a
 * ledger never rewrites history; reconcile (the service) recomputes the
 * balance chain from the amounts alone and reports any drift.
 */
export interface TrustRepository {
  /**
   * Append one entry, computing and stamping its balanceAfter in the same
   * step. Concurrent appends for the same (firm, client) serialize so the
   * chain never forks; appends for different clients proceed independently.
   */
  append(input: NewTrustEntry): Promise<TrustTransactionRow>;
  /**
   * The firm's whole ledger in append order (oldest first — the reference's
   * `db.trust` array order and the mock's push order; the UI derives the
   * per-client running balance from it in exactly that order).
   */
  listByFirm(firmId: string): Promise<TrustTransactionRow[]>;
}
