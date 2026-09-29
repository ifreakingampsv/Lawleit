import { randomUUID } from "node:crypto";
import type { DocumentPatch, DocumentRepository, DocumentRow, NewDocument } from "./repository.js";

/**
 * In-memory DocumentRepository fake for tests — the documents twin of
 * services/leads/in-memory.ts. Honors the seam's semantics (firm scoping,
 * newest-first listing, soft delete) so service and route tests exercise real
 * logic without a database; the DB twin proves the Drizzle binding stays
 * behaviorally identical.
 */
export class InMemoryDocumentRepository implements DocumentRepository {
  constructor(readonly documents: DocumentRow[]) {}

  async create(input: NewDocument): Promise<DocumentRow> {
    const row: DocumentRow = {
      id: randomUUID(),
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    // Newest first, mirroring the mock/reference unshift.
    this.documents.unshift(row);
    return row;
  }

  async findById(firmId: string, id: string): Promise<DocumentRow | null> {
    return (
      this.documents.find(
        (d) => d.id === id && d.firmId === firmId && d.deletedAt === null,
      ) ?? null
    );
  }

  async listByFirm(firmId: string): Promise<DocumentRow[]> {
    // unshift keeps the store newest-first, so filtering preserves the
    // contract order exactly.
    return this.documents.filter((d) => d.firmId === firmId && d.deletedAt === null);
  }

  async update(firmId: string, id: string, patch: DocumentPatch): Promise<DocumentRow | null> {
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
