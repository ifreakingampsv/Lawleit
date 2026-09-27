import type { AuthRepositories } from "../auth/repository.js";
import { HttpError } from "../httpError.js";
import type { ApiContact, ContactPatch, ContactType } from "./repository.js";
import { CONTACT_TYPES, toApiContact } from "./repository.js";

/** Shown (as a 400) when `type` is not in the contract's Contact vocabulary. */
export const CONTACT_TYPE_MESSAGE = "Type must be client, company, opposing, witness, or referral";
/** Shown (as a 400) when a caseIds entry is not a uuid — the column is uuid[]. */
export const CONTACT_CASE_ID_MESSAGE = "Invalid case id";
/** UUID shape of every production id (same rule as the :id params). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CASE_LINKS = 100;

const LENGTH_LIMITS = {
  name: [200, "Name is too long"],
  company: [200, "Company is too long"],
  email: [320, "Email is too long"],
  phone: [40, "Phone is too long"],
  address: [500, "Address is too long"],
  notes: [4000, "Notes are too long"],
} as const satisfies Record<string, [number, string]>;

/**
 * The writable contact input (create and patch). Deliberately free-form: the
 * reference backend and the mock adapter store these fields verbatim (no
 * trimming, no email format check — a contact directory is not a login key),
 * and the parity checklist in the ticket depends on that.
 */
export interface ContactInput {
  type?: string;
  name?: string;
  company?: string | null;
  email?: string;
  phone?: string;
  address?: string;
  caseIds?: string[];
  notes?: string | null;
}

function validateType(type: string): void {
  if (!CONTACT_TYPES.includes(type as ContactType)) {
    throw new HttpError(400, CONTACT_TYPE_MESSAGE);
  }
}

function validateCaseIds(caseIds: string[]): void {
  if (caseIds.length > MAX_CASE_LINKS) throw new HttpError(400, "Too many cases linked");
  for (const id of caseIds) {
    if (!UUID_PATTERN.test(id)) throw new HttpError(400, CONTACT_CASE_ID_MESSAGE);
  }
}

function checkLength(value: string | null | undefined, field: keyof typeof LENGTH_LIMITS): void {
  const [max, message] = LENGTH_LIMITS[field];
  if ((value ?? "").length > max) throw new HttpError(400, message);
}

function normalizePatch(patch: ContactInput): ContactPatch {
  const out: ContactPatch = {};
  if (patch.type !== undefined) {
    validateType(patch.type);
    out.type = patch.type;
  }
  if (patch.name !== undefined) {
    checkLength(patch.name, "name");
    out.name = patch.name;
  }
  if (patch.company !== undefined) {
    checkLength(patch.company, "company");
    out.company = patch.company;
  }
  if (patch.email !== undefined) {
    checkLength(patch.email, "email");
    out.email = patch.email;
  }
  if (patch.phone !== undefined) {
    checkLength(patch.phone, "phone");
    out.phone = patch.phone;
  }
  if (patch.address !== undefined) {
    checkLength(patch.address, "address");
    out.address = patch.address;
  }
  if (patch.notes !== undefined) {
    checkLength(patch.notes, "notes");
    out.notes = patch.notes;
  }
  if (patch.caseIds !== undefined) {
    validateCaseIds(patch.caseIds);
    out.caseIds = patch.caseIds;
  }
  return out;
}

/**
 * Contacts business logic (ticket 09). Practice data of the firm: every firm
 * member manages it (unlike users — the contract and the reference backend
 * gate nothing here, so neither do we), and the service is the choke point
 * that scopes every lookup by the session's firm (ADR-0003) and enforces the
 * reference backend's defaults and soft delete.
 */
export class ContactsService {
  constructor(private readonly repos: AuthRepositories) {}

  /** Newest first — the mock and the reference both unshift new contacts. */
  async list(firmId: string): Promise<ApiContact[]> {
    const rows = await this.repos.contacts.listByFirm(firmId);
    return rows.map(toApiContact);
  }

  /** 404 for missing, soft-deleted, and other firms' contacts alike. */
  async get(firmId: string, id: string): Promise<ApiContact> {
    const row = await this.repos.contacts.findById(firmId, id);
    if (!row) throw new HttpError(404, "Contact not found");
    return toApiContact(row);
  }

  /**
   * POST /contacts → 201 with the created entity. Defaults mirror the
   * reference backend exactly: type "client", name "New contact", empty
   * email/phone/address, empty caseIds; `company` is dropped (it is patch-only
   * there too) and missing notes stay absent from the response.
   */
  async create(firmId: string, input: ContactInput): Promise<ApiContact> {
    const patch = normalizePatch(input);
    const row = await this.repos.contacts.create({
      firmId,
      type: patch.type ?? "client",
      name: patch.name ?? "New contact",
      // The reference never reads `company` on create; patch-only field.
      company: null,
      email: patch.email ?? "",
      phone: patch.phone ?? "",
      address: patch.address ?? "",
      caseIds: patch.caseIds ?? [],
      notes: patch.notes ?? null,
    });
    return toApiContact(row);
  }

  /** PATCH /contacts/:id — only the sent fields move (mock Object.assign). */
  async update(firmId: string, id: string, patch: ContactInput): Promise<ApiContact> {
    const normalized = normalizePatch(patch);
    const row = await this.repos.contacts.update(firmId, id, normalized);
    if (!row) throw new HttpError(404, "Contact not found");
    return toApiContact(row);
  }

  /** DELETE /contacts/:id → 204; soft delete (the row stays, reads filter it). */
  async delete(firmId: string, id: string): Promise<void> {
    const deleted = await this.repos.contacts.delete(firmId, id);
    if (!deleted) throw new HttpError(404, "Contact not found");
  }
}
