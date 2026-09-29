import type { AuthRepositories } from "../auth/repository.js";
import { HttpError } from "../httpError.js";
import type {
  ApiTrustTransaction,
  NewTrustEntry,
  TrustTransactionRow,
} from "./repository.js";
import { toApiTrustTransaction } from "./repository.js";

/** Shown (as a 400) when `amount` is not a non-zero whole paise amount. */
export const TRUST_AMOUNT_MESSAGE = "Amount must be a non-zero integer";
/** Shown (as a 400) when a clientId is not a uuid — the column is a uuid FK. */
export const TRUST_CLIENT_MESSAGE = "Invalid client id";
/** Shown (as a 400) when a well-formed clientId is not a live contact of the firm. */
export const TRUST_CLIENT_MISSING_MESSAGE = "Client not found";
/** Shown (as a 400) when `date` is not an ISO YYYY-MM-DD day. */
export const TRUST_DATE_MESSAGE = "Date must be an ISO date (YYYY-MM-DD)";

/** UUID shape of every production id (same rule as the :id params). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Upper bound for |amount| paise — the payments service's cap (MAX_PAISE). */
const MAX_PAISE = 1_000_000_000;
/** The contract's date shape (conventions: ISO YYYY-MM-DD days)... */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day in ISO shape ("2026-13-01" is well-formed but not a day). */
function isIsoDay(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

/**
 * The deposit description the reference and the mock both write when a
 * trust-flagged payment lands in the ledger — byte-identical, em-dash and all.
 * `invoiceNumber` is null for an unlinked deposit (renders "(unlinked)").
 */
export function trustDepositDescription(invoiceNumber: string | null): string {
  return `Trust deposit — invoice ${invoiceNumber ?? "(unlinked)"}`;
}

/**
 * The service-level append input (there is NO contract route that calls this
 * directly — deposits enter the ledger through POST /payments with
 * trustAccount: true, the ticket-14 hook). It exists because the V1 contract
 * exposes no disbursement surface while the ledger's math must still be
 * exercisable end to end (the deposit → withdrawal → deposit tests) and
 * because V2's retainer trust model hangs off exactly this seam: one service
 * method, its own transaction, the same running-balance rule the hook gets.
 */
export interface TrustEntryInput {
  clientId?: string | null;
  caseId?: string | null;
  description?: string;
  /** Signed integer paise: + deposit (in), − disbursement (out). */
  amount: number;
  /** Optional ISO day; defaults to today (the reference stamps `today()`). */
  date?: string;
}

/**
 * One detected continuity break: the stored balanceAfter disagrees with the
 * balance recomputed from the amounts alone (the append-only history is the
 * only source of truth). `clientId` renders "" for the unattributed bucket.
 */
export interface TrustReconcileMismatch {
  id: string;
  clientId: string;
  date: string;
  seq: number;
  stored: number;
  computed: number;
}

export interface TrustReconcileReport {
  /** True when every stored balanceAfter equals the recomputed chain. */
  ok: boolean;
  /** Entries checked (the firm's whole ledger — append-only, nothing hidden). */
  entries: number;
  /** Distinct balance buckets (a null client is its own bucket). */
  clients: number;
  mismatches: TrustReconcileMismatch[];
}

/**
 * Trust ledger business logic (ticket 15) — client money held in trust, the
 * correctness-critical module. The ledger is APPEND-ONLY (the repository has
 * no update/delete path and the table has no updated_at/deleted_at — a ledger
 * never rewrites history; a mistaken entry is corrected by a contra entry,
 * the accounting practice, never by editing the past).
 *
 * The running balance rule is the reference's appendTrust verbatim: each new
 * entry's balanceAfter = the client's previous entry's balanceAfter + amount
 * (0 for the client's first entry), computed by the repository INSIDE the
 * enclosing insert transaction, with concurrent same-client appends
 * serialized (Drizzle: per-client advisory lock; see services/trust/drizzle.ts)
 * so the chain can never fork.
 *
 * Every firm member manages the ledger (practice data — the contract gates
 * nothing here), and the service is the choke point that scopes every query
 * by the session's firm (ADR-0003).
 */
export class TrustService {
  constructor(
    private readonly repos: AuthRepositories,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** GET /trust/transactions — the firm's ledger in append order (oldest first). */
  async list(firmId: string): Promise<ApiTrustTransaction[]> {
    const rows = await this.repos.trust.listByFirm(firmId);
    return rows.map(toApiTrustTransaction);
  }

  /**
   * Append one entry in its own transaction (deposit +in / disbursement
   * −out). Validation order: shape (amount/date/clientId 400s) before
   * anything is written; a provided clientId must be a live in-firm contact
   * (the ledger keys on it, mirroring the payments rule — a foreign or
   * soft-deleted client writes nothing anywhere). The balance computation
   * and the serialization live in the repository seam.
   */
  async append(firmId: string, input: TrustEntryInput): Promise<ApiTrustTransaction> {
    const row = await this.repos.transaction((tx) => this.appendInTx(tx, firmId, input));
    return toApiTrustTransaction(row);
  }

  /**
   * The transaction-bound seam: append inside the CALLER's transaction. The
   * payments hook (ticket 14's `record`) uses this shape directly via
   * `tx.trust.append` so a trust-flagged payment, its invoice roll-up and the
   * ledger entry commit atomically. Callers pass pre-validated money (the
   * hook's amount/date/clientId are already checked by the payments service).
   */
  async appendInTx(
    tx: AuthRepositories,
    firmId: string,
    input: TrustEntryInput,
  ): Promise<TrustTransactionRow> {
    const amount = input.amount;
    if (
      typeof amount !== "number" ||
      !Number.isInteger(amount) ||
      amount === 0 ||
      Math.abs(amount) > MAX_PAISE
    ) {
      throw new HttpError(400, TRUST_AMOUNT_MESSAGE);
    }
    const date = input.date ?? this.now().toISOString().slice(0, 10);
    if (!isIsoDay(date)) throw new HttpError(400, TRUST_DATE_MESSAGE);

    const clientId = input.clientId ?? null;
    if (clientId) {
      if (!UUID_PATTERN.test(clientId)) throw new HttpError(400, TRUST_CLIENT_MESSAGE);
      const client = await tx.contacts.findById(firmId, clientId);
      if (!client) throw new HttpError(400, TRUST_CLIENT_MISSING_MESSAGE);
    }

    const entry: NewTrustEntry = {
      firmId,
      clientId,
      caseId: input.caseId ?? null,
      date,
      description: input.description ?? "",
      amount,
    };
    return tx.trust.append(entry);
  }

  /**
   * Recompute the running balances from the append-only history alone and
   * assert continuity (the contract's "Trust running balance maintenance per
   * client/case", audited). Walks the firm's ledger in append order (seq —
   * per-client order is exact even for same-instant entries), keeps a running
   * sum per balance bucket (null client = its own bucket), and reports every
   * entry whose stored balanceAfter disagrees with the recomputed value.
   *
   * The contract defines NO reconcile HTTP route (API_CONTRACT.md's trust
   * surface is GET /trust/transactions only, and AGENTS.md forbids inventing
   * endpoints), so reconcile is a service-level capability: the tests drive
   * it, an operator/ops job can call it, and V2 can surface it without a
   * contract change to V1's client.
   */
  async reconcile(firmId: string): Promise<TrustReconcileReport> {
    const rows = await this.repos.trust.listByFirm(firmId);
    const running = new Map<string | null, number>();
    const mismatches: TrustReconcileMismatch[] = [];
    for (const row of rows) {
      const previous = running.get(row.clientId) ?? 0;
      const computed = previous + row.amount;
      running.set(row.clientId, computed);
      if (computed !== row.balanceAfter) {
        mismatches.push({
          id: row.id,
          clientId: row.clientId ?? "",
          date: row.date,
          seq: row.seq,
          stored: row.balanceAfter,
          computed,
        });
      }
    }
    return { ok: mismatches.length === 0, entries: rows.length, clients: running.size, mismatches };
  }
}
