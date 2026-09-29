import { and, desc, eq, isNull } from "drizzle-orm";
import { documents } from "../../db/schema.js";
import type { DbExecutor } from "../auth/drizzle-repository.js";
import type { DocumentPatch, DocumentRepository, DocumentRow, NewDocument } from "./repository.js";

/**
 * Drizzle/postgres.js binding of the documents repository seam (ticket 17) —
 * the production implementation used when DATABASE_URL is set. Every read
 * that serves a request filters soft deletes and the firm scope (ADR-0003);
 * the write path sets updated_at itself (no triggers, per drizzle/README.md).
 */

const liveDocument = () => isNull(documents.deletedAt);

export class DrizzleDocumentRepository implements DocumentRepository {
  constructor(private readonly exec: DbExecutor) {}

  async create(input: NewDocument): Promise<DocumentRow> {
    const [row] = await this.exec.insert(documents).values(input).returning();
    if (!row) throw new Error("document insert returned no row");
    return row;
  }

  async findById(firmId: string, id: string): Promise<DocumentRow | null> {
    const [row] = await this.exec
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.firmId, firmId), liveDocument()))
      .limit(1);
    return row ?? null;
  }

  async listByFirm(firmId: string): Promise<DocumentRow[]> {
    return this.exec
      .select()
      .from(documents)
      .where(and(eq(documents.firmId, firmId), liveDocument()))
      // Newest first (the mock/reference unshift); id breaks ties between
      // rows sharing one timestamp.
      .orderBy(desc(documents.createdAt), desc(documents.id));
  }

  async update(firmId: string, id: string, patch: DocumentPatch): Promise<DocumentRow | null> {
    const [row] = await this.exec
      .update(documents)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.firmId, firmId), liveDocument()))
      .returning();
    return row ?? null;
  }

  /** Soft delete: the row stays with deleted_at stamped (baseline convention). */
  async delete(firmId: string, id: string): Promise<boolean> {
    const [row] = await this.exec
      .update(documents)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.firmId, firmId), liveDocument()))
      .returning();
    return row !== undefined;
  }
}
