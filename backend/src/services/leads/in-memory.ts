import { randomUUID } from "node:crypto";
import type {
  LeadRepository,
  LeadPatch,
  LeadRow,
  LeadStageHistoryRepository,
  NewLead,
  NewStageHistoryEntry,
  LeadStageHistoryRow,
} from "./repository.js";

/**
 * In-memory LeadRepository + stage-history fake for tests — the leads twin of
 * services/auth/testing.ts's fakes. Honors the seam's semantics (firm scoping,
 * newest-first listing, soft delete) so service and route tests exercise real
 * logic without a database; the DB twin proves the Drizzle binding stays
 * behaviorally identical.
 */
export class InMemoryLeadRepository implements LeadRepository {
  constructor(readonly leads: LeadRow[]) {}

  async create(input: NewLead): Promise<LeadRow> {
    const row: LeadRow = {
      id: randomUUID(),
      ...input,
      convertedCaseId: null,
      convertedContactId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    // Newest first, mirroring the mock/reference unshift.
    this.leads.unshift(row);
    return row;
  }

  async findById(firmId: string, id: string): Promise<LeadRow | null> {
    return (
      this.leads.find(
        (l) => l.id === id && l.firmId === firmId && l.deletedAt === null,
      ) ?? null
    );
  }

  async listByFirm(firmId: string): Promise<LeadRow[]> {
    // unshift keeps the store newest-first, so filtering preserves the
    // contract order exactly.
    return this.leads.filter((l) => l.firmId === firmId && l.deletedAt === null);
  }

  async update(firmId: string, id: string, patch: LeadPatch): Promise<LeadRow | null> {
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

/** Append-only history rows; listByLead returns newest first. */
export class InMemoryLeadStageHistoryRepository implements LeadStageHistoryRepository {
  constructor(readonly rows: LeadStageHistoryRow[]) {}

  async record(input: NewStageHistoryEntry): Promise<void> {
    this.rows.push({ id: randomUUID(), ...input });
  }

  async listByLead(firmId: string, leadId: string): Promise<LeadStageHistoryRow[]> {
    return this.rows
      .filter((r) => r.firmId === firmId && r.leadId === leadId)
      .reverse();
  }
}
