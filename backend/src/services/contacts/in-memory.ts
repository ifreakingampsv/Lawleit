import { randomUUID } from "node:crypto";
import type {
  ContactPatch,
  ContactRepository,
  ContactRow,
  NewContact,
} from "./repository.js";

/**
 * In-memory ContactRepository for tests — the contacts twin of
 * services/auth/testing.ts's fakes. Honors the seam's semantics (firm
 * scoping, newest-first listing, soft delete) so service and route tests
 * exercise real logic without a database; the DB twin proves the Drizzle
 * binding stays behaviorally identical.
 */
export class InMemoryContactRepository implements ContactRepository {
  constructor(readonly contacts: ContactRow[]) {}

  async create(input: NewContact): Promise<ContactRow> {
    const row: ContactRow = {
      id: randomUUID(),
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    // Newest first, mirroring the mock/reference unshift.
    this.contacts.unshift(row);
    return row;
  }

  async findById(firmId: string, id: string): Promise<ContactRow | null> {
    return (
      this.contacts.find(
        (c) => c.id === id && c.firmId === firmId && c.deletedAt === null,
      ) ?? null
    );
  }

  async listByFirm(firmId: string): Promise<ContactRow[]> {
    // unshift keeps the store newest-first, so filtering preserves the
    // contract order exactly (same-millisecond inserts included).
    return this.contacts.filter((c) => c.firmId === firmId && c.deletedAt === null);
  }

  async update(firmId: string, id: string, patch: ContactPatch): Promise<ContactRow | null> {
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
