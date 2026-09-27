/**
 * Repository seam for contacts (ticket 09) — same pattern as the auth seam
 * (services/auth/repository.ts): services depend only on these interfaces;
 * the Drizzle binding (`drizzle.ts`) is the production implementation and
 * tests bind the in-memory fake (`in-memory.ts`), which is also what keeps
 * the suite green with no database present.
 *
 * Tenancy (ADR-0003): every method takes the caller's firm id and filters by
 * it; a cross-firm id must look up as "not found", never as an error that
 * leaks existence. The contacts service tests assert that.
 */

/** The type vocabulary of the API contract (app/src/lib/data/types.ts Contact). */
export const CONTACT_TYPES = ["client", "company", "opposing", "witness", "referral"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export interface ContactRow {
  id: string;
  firmId: string;
  type: string;
  name: string;
  company: string | null;
  email: string;
  phone: string;
  address: string;
  /** Mirrors the contract's `caseIds: ID[]`; case existence is not enforced here. */
  caseIds: string[];
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** The contact shape the API contract exposes (types.ts Contact). */
export type ApiContact = Pick<
  ContactRow,
  "id" | "type" | "name" | "email" | "phone" | "address" | "caseIds"
> & {
  company?: string;
  notes?: string;
  /** Contract shape is an ISO date (YYYY-MM-DD), not a timestamp. */
  createdAt: string;
};

/**
 * Destructuring is the whitelist — firm_id and bookkeeping (updated_at,
 * deleted_at) cannot leak. `createdAt` collapses to its UTC date part and
 * nullables vanish when empty, so responses are byte-shape compatible with
 * the mock adapter's contacts.
 */
export function toApiContact(row: ContactRow): ApiContact {
  const api: ApiContact = {
    id: row.id,
    type: row.type,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    caseIds: [...row.caseIds],
    createdAt: row.createdAt.toISOString().slice(0, 10),
  };
  if (row.company !== null) api.company = row.company;
  if (row.notes !== null) api.notes = row.notes;
  return api;
}

export interface NewContact {
  firmId: string;
  type: string;
  name: string;
  company: string | null;
  email: string;
  phone: string;
  address: string;
  caseIds: string[];
  notes: string | null;
}

export interface ContactPatch {
  type?: string;
  name?: string;
  company?: string | null;
  email?: string;
  phone?: string;
  address?: string;
  caseIds?: string[];
  notes?: string | null;
}

export interface ContactRepository {
  create(input: NewContact): Promise<ContactRow>;
  /** Live (non-deleted) contact in the given firm; null otherwise. */
  findById(firmId: string, id: string): Promise<ContactRow | null>;
  /** The firm's live contacts, newest first (the mock/reference unshift). */
  listByFirm(firmId: string): Promise<ContactRow[]>;
  /** Live-row update; null when the row is missing, deleted, or another firm's. */
  update(firmId: string, id: string, patch: ContactPatch): Promise<ContactRow | null>;
  /** Soft delete: stamps deleted_at, the row itself stays (ADR-0003 audit). */
  delete(firmId: string, id: string): Promise<boolean>;
}
