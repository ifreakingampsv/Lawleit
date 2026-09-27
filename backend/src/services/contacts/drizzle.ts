import { and, desc, eq, isNull } from "drizzle-orm";
import { contacts } from "../../db/schema.js";
import type { DbExecutor } from "../auth/drizzle-repository.js";
import type {
  ContactPatch,
  ContactRepository,
  ContactRow,
  NewContact,
} from "./repository.js";

/**
 * Drizzle/postgres.js binding of the contacts repository seam (ticket 09) —
 * the production implementation used when DATABASE_URL is set. Every read
 * that serves a request filters soft deletes and the firm scope (ADR-0003);
 * the write path sets updated_at itself (no triggers, per drizzle/README.md).
 */

const liveContact = () => isNull(contacts.deletedAt);

export class DrizzleContactRepository implements ContactRepository {
  constructor(private readonly exec: DbExecutor) {}

  async create(input: NewContact): Promise<ContactRow> {
    const [row] = await this.exec.insert(contacts).values(input).returning();
    if (!row) throw new Error("contact insert returned no row");
    return row;
  }

  async findById(firmId: string, id: string): Promise<ContactRow | null> {
    const [row] = await this.exec
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.firmId, firmId), liveContact()))
      .limit(1);
    return row ?? null;
  }

  async listByFirm(firmId: string): Promise<ContactRow[]> {
    return this.exec
      .select()
      .from(contacts)
      .where(and(eq(contacts.firmId, firmId), liveContact()))
      // Newest first (the mock/reference unshift); id breaks ties between
      // rows sharing one timestamp.
      .orderBy(desc(contacts.createdAt), desc(contacts.id));
  }

  async update(firmId: string, id: string, patch: ContactPatch): Promise<ContactRow | null> {
    const [row] = await this.exec
      .update(contacts)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(contacts.id, id), eq(contacts.firmId, firmId), liveContact()))
      .returning();
    return row ?? null;
  }

  /** Soft delete: the row stays with deleted_at stamped (baseline convention). */
  async delete(firmId: string, id: string): Promise<boolean> {
    const [row] = await this.exec
      .update(contacts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(contacts.id, id), eq(contacts.firmId, firmId), liveContact()))
      .returning();
    return row !== undefined;
  }
}
