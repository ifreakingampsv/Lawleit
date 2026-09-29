import { and, desc, eq, isNull } from "drizzle-orm";
import { leadStageHistory, leads } from "../../db/schema.js";
import type { DbExecutor } from "../auth/drizzle-repository.js";
import type {
  LeadPatch,
  LeadRepository,
  LeadRow,
  LeadStageHistoryRepository,
  LeadStageHistoryRow,
  NewLead,
  NewStageHistoryEntry,
} from "./repository.js";

/**
 * Drizzle/postgres.js binding of the leads repository seam (ticket 16) —
 * the production implementation used when DATABASE_URL is set. Every read
 * that serves a request filters soft deletes and the firm scope (ADR-0003);
 * the write path sets updated_at itself (no triggers, per drizzle/README.md).
 */

const liveLead = () => isNull(leads.deletedAt);

export class DrizzleLeadRepository implements LeadRepository {
  constructor(private readonly exec: DbExecutor) {}

  async create(input: NewLead): Promise<LeadRow> {
    const [row] = await this.exec.insert(leads).values(input).returning();
    if (!row) throw new Error("lead insert returned no row");
    return row;
  }

  async findById(firmId: string, id: string): Promise<LeadRow | null> {
    const [row] = await this.exec
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), eq(leads.firmId, firmId), liveLead()))
      .limit(1);
    return row ?? null;
  }

  async listByFirm(firmId: string): Promise<LeadRow[]> {
    return this.exec
      .select()
      .from(leads)
      .where(and(eq(leads.firmId, firmId), liveLead()))
      // Newest first (the mock/reference unshift); id breaks ties between
      // rows sharing one timestamp.
      .orderBy(desc(leads.createdAt), desc(leads.id));
  }

  async update(firmId: string, id: string, patch: LeadPatch): Promise<LeadRow | null> {
    const [row] = await this.exec
      .update(leads)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(leads.id, id), eq(leads.firmId, firmId), liveLead()))
      .returning();
    return row ?? null;
  }

  /** Soft delete: the row stays with deleted_at stamped (baseline convention). */
  async delete(firmId: string, id: string): Promise<boolean> {
    const [row] = await this.exec
      .update(leads)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(leads.id, id), eq(leads.firmId, firmId), liveLead()))
      .returning();
    return row !== undefined;
  }
}

export class DrizzleLeadStageHistoryRepository implements LeadStageHistoryRepository {
  constructor(private readonly exec: DbExecutor) {}

  /** Append-only: inserts never update or delete history rows. */
  async record(input: NewStageHistoryEntry): Promise<void> {
    await this.exec.insert(leadStageHistory).values(input);
  }

  async listByLead(firmId: string, leadId: string): Promise<LeadStageHistoryRow[]> {
    return this.exec
      .select()
      .from(leadStageHistory)
      .where(and(eq(leadStageHistory.firmId, firmId), eq(leadStageHistory.leadId, leadId)))
      // Newest first (the list convention); id breaks same-instant ties.
      .orderBy(desc(leadStageHistory.at), desc(leadStageHistory.id));
  }
}
