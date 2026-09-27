import { randomUUID } from "node:crypto";
import type {
  CaseListFilter,
  CaseNumberRepository,
  CasePatch,
  CaseRepository,
  CaseRow,
  NewCase,
} from "./repository.js";

/**
 * In-memory CaseRepository + number counter for tests — the cases twin of
 * services/auth/testing.ts's fakes. Honors the seam's semantics (firm
 * scoping, newest-first listing, the reference's ?status=/?q= matching, soft
 * delete, per-firm-year counters) so service and route tests exercise real
 * logic without a database; the DB twin proves the Drizzle binding stays
 * behaviorally identical.
 */
export class InMemoryCaseRepository implements CaseRepository {
  constructor(readonly cases: CaseRow[]) {}

  async create(input: NewCase): Promise<CaseRow> {
    const row: CaseRow = {
      id: randomUUID(),
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    // Newest first, mirroring the mock/reference unshift.
    this.cases.unshift(row);
    return row;
  }

  async findById(firmId: string, id: string): Promise<CaseRow | null> {
    return (
      this.cases.find(
        (c) => c.id === id && c.firmId === firmId && c.deletedAt === null,
      ) ?? null
    );
  }

  async listByFirm(firmId: string, filter: CaseListFilter): Promise<CaseRow[]> {
    // unshift keeps the store newest-first, so filtering preserves the
    // contract order exactly. Matching semantics are the reference backend's:
    // exact status equality and a case-insensitive substring over
    // `${number} ${title}`.
    return this.cases.filter((c) => {
      if (c.firmId !== firmId || c.deletedAt !== null) return false;
      if (filter.status !== undefined && c.status !== filter.status) return false;
      if (filter.q !== undefined) {
        const q = filter.q.toLowerCase();
        if (!`${c.number} ${c.title}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }

  async update(firmId: string, id: string, patch: CasePatch): Promise<CaseRow | null> {
    const row = await this.findById(firmId, id);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date() });
    return row;
  }

  /** Soft delete — the row stays in the store with deleted_at stamped. */
  async delete(firmId: string, id: string): Promise<boolean> {
    const row = await this.findById(firmId, id);
    if (!row) return false;
    row.deletedAt = new Date();
    row.updatedAt = row.deletedAt;
    return true;
  }
}

/** Per-(firm, year) counters, single-threaded so "increment" is atomic. */
export class InMemoryCaseNumberRepository implements CaseNumberRepository {
  constructor(readonly counters: Map<string, number>) {}

  async next(firmId: string, year: number): Promise<number> {
    const key = `${firmId}:${year}`;
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }
}
