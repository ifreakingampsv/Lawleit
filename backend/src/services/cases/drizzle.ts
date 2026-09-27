import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { caseNumberCounters, cases } from "../../db/schema.js";
import type { DbExecutor } from "../auth/drizzle-repository.js";
import type {
  CaseListFilter,
  CaseNumberRepository,
  CasePatch,
  CaseRepository,
  CaseRow,
  NewCase,
} from "./repository.js";

/**
 * Drizzle/postgres.js binding of the cases repository seam (ticket 10) —
 * the production implementation used when DATABASE_URL is set. Every read
 * that serves a request filters soft deletes and the firm scope (ADR-0003);
 * the write path sets updated_at itself (no triggers, per drizzle/README.md).
 */

const liveCase = () => isNull(cases.deletedAt);

export class DrizzleCaseRepository implements CaseRepository {
  constructor(private readonly exec: DbExecutor) {}

  async create(input: NewCase): Promise<CaseRow> {
    const [row] = await this.exec.insert(cases).values(input).returning();
    if (!row) throw new Error("case insert returned no row");
    return row;
  }

  async findById(firmId: string, id: string): Promise<CaseRow | null> {
    const [row] = await this.exec
      .select()
      .from(cases)
      .where(and(eq(cases.id, id), eq(cases.firmId, firmId), liveCase()))
      .limit(1);
    return row ?? null;
  }

  async listByFirm(firmId: string, filter: CaseListFilter): Promise<CaseRow[]> {
    const conditions = [eq(cases.firmId, firmId), liveCase()];
    if (filter.status !== undefined) conditions.push(eq(cases.status, filter.status));
    if (filter.q !== undefined) {
      // The reference matches a case-insensitive substring over
      // `${number} ${title}`. `position(needle in haystack)` is a plain
      // substring search — LIKE wildcard characters in q stay literal, which
      // is exactly the reference's `.includes()` semantics.
      conditions.push(
        sql`position(lower(${filter.q}) in lower(${cases.number} || ' ' || ${cases.title})) > 0`,
      );
    }
    return this.exec
      .select()
      .from(cases)
      .where(and(...conditions))
      // Newest first (the mock/reference unshift); id breaks ties between
      // rows sharing one timestamp.
      .orderBy(desc(cases.createdAt), desc(cases.id));
  }

  async update(firmId: string, id: string, patch: CasePatch): Promise<CaseRow | null> {
    const [row] = await this.exec
      .update(cases)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(cases.id, id), eq(cases.firmId, firmId), liveCase()))
      .returning();
    return row ?? null;
  }

  /** Soft delete: the row stays with deleted_at stamped (baseline convention). */
  async delete(firmId: string, id: string): Promise<boolean> {
    const [row] = await this.exec
      .update(cases)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(cases.id, id), eq(cases.firmId, firmId), liveCase()))
      .returning();
    return row !== undefined;
  }
}

export class DrizzleCaseNumberRepository implements CaseNumberRepository {
  constructor(private readonly exec: DbExecutor) {}

  /**
   * Atomically reserves the next sequence for (firm, year): one
   * INSERT … ON CONFLICT DO UPDATE — the counter row's lock serializes
   * concurrent creates in the firm-year until the create transaction
   * commits, so no two cases can draw the same number. Distinct firms (and
   * distinct years) have distinct counter rows, so sequences are independent.
   */
  async next(firmId: string, year: number): Promise<number> {
    const [row] = await this.exec
      .insert(caseNumberCounters)
      .values({ firmId, year, lastValue: 1, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [caseNumberCounters.firmId, caseNumberCounters.year],
        set: { lastValue: sql`${caseNumberCounters.lastValue} + 1`, updatedAt: new Date() },
      })
      .returning({ lastValue: caseNumberCounters.lastValue });
    if (!row) throw new Error("case number counter upsert returned no row");
    return row.lastValue;
  }
}
