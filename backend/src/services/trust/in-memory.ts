import { randomUUID } from "node:crypto";
import type { NewTrustEntry, TrustRepository, TrustTransactionRow } from "./repository.js";

/**
 * In-memory trust repository for tests — the invoices twin of
 * services/auth/testing.ts's fakes. Honors the seam's semantics (firm
 * scoping, append-only history, append-order listing) so service and route
 * tests exercise real logic without a database; the DB twin proves the
 * Drizzle binding stays behaviorally identical.
 *
 * Atomicity twin of the Drizzle binding's per-client advisory lock: the
 * append reads the previous entry and pushes the new one with NO await
 * between, so the whole append runs in one microtask — an interleaved
 * (Promise.all) append for the same client can never slip between the read
 * and the write, and the balance chain cannot fork. The concurrency tests
 * pin exactly that.
 */
export class InMemoryTrustRepository implements TrustRepository {
  constructor(readonly entries: TrustTransactionRow[]) {}

  async append(input: NewTrustEntry): Promise<TrustTransactionRow> {
    // The balance computation happens HERE, before any await — do not insert
    // an await between this read and the push below.
    const prev = this.lastBalanceFor(input.firmId, input.clientId);
    const row: TrustTransactionRow = {
      id: randomUUID(),
      ...input,
      balanceAfter: (prev?.balanceAfter ?? 0) + input.amount,
      // Array append order == seq order in-memory (single-threaded appends);
      // the last row always carries the highest seq.
      seq: (this.entries[this.entries.length - 1]?.seq ?? 0) + 1,
      createdAt: new Date(),
    };
    // Append (push), never unshift: the ledger reads oldest-first, the
    // reference's db.trust.push order.
    this.entries.push(row);
    return row;
  }

  async listByFirm(firmId: string): Promise<TrustTransactionRow[]> {
    // The store is append-ordered, so filtering preserves the contract order.
    return this.entries.filter((t) => t.firmId === firmId);
  }

  /** The client's most recent entry (the reference's reverse().find()), or null. */
  private lastBalanceFor(firmId: string, clientId: string | null): TrustTransactionRow | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i]!;
      if (entry.firmId === firmId && entry.clientId === clientId) return entry;
    }
    return null;
  }
}
