import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { trustTransactions } from "../../db/schema.js";
import type { DbExecutor } from "../auth/drizzle-repository.js";
import type { NewTrustEntry, TrustRepository, TrustTransactionRow } from "./repository.js";

/**
 * Drizzle/postgres.js binding of the trust repository seam (ticket 15) — the
 * production implementation used when DATABASE_URL is set. Append-only: no
 * update or delete statement exists for the ledger (schema.ts); every read
 * serves the whole history of the firm scope (ADR-0003) in append order.
 *
 * Concurrency design (the correctness core): two simultaneous appends for the
 * same client must not both read the same "previous balance" — a plain
 * read-then-insert races (both compute the same balanceAfter and the chain
 * forks), and FOR UPDATE on the last row does not help (a concurrent insert
 * of a NEW row is invisible to the other transaction's statement snapshot, so
 * both still read the same predecessor). Appends therefore serialize on a
 * PER-CLIENT SESSION-SCOPED-TO-THE-TRANSACTION advisory lock:
 * pg_advisory_xact_lock(md5(firm:client) → 64-bit key), held from the lock
 * call until the enclosing transaction commits/rolls back. Same-client
 * appends queue (each then reads the predecessor the previous one committed);
 * different clients never contend (distinct keys), and the in-memory twin's
 * no-await append is its behavioral twin. The lock also makes the seq column
 * (schema.ts) reflect true append order for a client, which reconcile and
 * listByFirm order by.
 */
export class DrizzleTrustRepository implements TrustRepository {
  constructor(private readonly exec: DbExecutor) {}

  async append(input: NewTrustEntry): Promise<TrustTransactionRow> {
    // One 64-bit lock key per (firm, client); the null client (the
    // reference's "" bucket) gets its own key like any other.
    const key = `${input.firmId}:${input.clientId ?? ""}`;
    await this.exec.execute(
      sql`select pg_advisory_xact_lock(('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint)`,
    );

    // Under the lock: the client's latest entry is stable until this
    // transaction ends (the reference's `[...db.trust].reverse().find(...)`).
    const [prev] = await this.exec
      .select({ balanceAfter: trustTransactions.balanceAfter })
      .from(trustTransactions)
      .where(
        and(
          eq(trustTransactions.firmId, input.firmId),
          input.clientId === null
            ? isNull(trustTransactions.clientId)
            : eq(trustTransactions.clientId, input.clientId),
        ),
      )
      .orderBy(desc(trustTransactions.seq))
      .limit(1);

    const balanceAfter = (prev?.balanceAfter ?? 0) + input.amount;
    const [row] = await this.exec
      .insert(trustTransactions)
      .values({ ...input, balanceAfter })
      .returning();
    if (!row) throw new Error("trust ledger insert returned no row");
    return row;
  }

  async listByFirm(firmId: string): Promise<TrustTransactionRow[]> {
    return this.exec
      .select()
      .from(trustTransactions)
      .where(eq(trustTransactions.firmId, firmId))
      // Append order (oldest first — the reference/mock array order). seq is
      // monotonic per client (assigned under the advisory lock); rolled-back
      // transactions can leave gaps, never reordering.
      .orderBy(trustTransactions.seq);
  }
}
