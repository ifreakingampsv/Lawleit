import type { AuthRepositories } from "../auth/repository.js";
import { HttpError } from "../httpError.js";
import { toApiCase, type ApiCase } from "../cases/repository.js";
import { toApiContact, type ApiContact } from "../contacts/repository.js";
import type { ApiLead, LeadActivityEntry } from "./repository.js";
import {
  LEAD_SOURCES,
  LEAD_STAGES,
  toApiLead,
  type LeadPatch,
  type LeadSource,
  type LeadStage,
} from "./repository.js";

/** Shown (as a 400) when `stage` is not in the contract's LeadStage vocabulary. */
export const LEAD_STAGE_MESSAGE =
  "Stage must be new, consult scheduled, contacted, fee agreement, converted, or lost";
/** Shown (as a 400) when `source` is not in the contract's Lead source vocabulary. */
export const LEAD_SOURCE_MESSAGE = "Source must be website, referral, call, ads, or walk-in";
/** Shown (as a 400) when `value` is not a non-negative integer paise amount. */
export const LEAD_VALUE_MESSAGE = "Value must be a non-negative integer";
/** Shown (as a 400) when the firm somehow has no user to default the attorney to. */
const NO_USER_MESSAGE = "Firm has no users";

/** UUID shape of every production id (same rule as the :id params). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_VALUE = 1_000_000_000;
/** The mock adapter's conversion default (₹3,000/hr in paise); the reference's 300 is its stale dollar-era value. */
const DEFAULT_BILLABLE_RATE = 300000;

const LENGTH_LIMITS = {
  name: [200, "Name is too long"],
  email: [320, "Email is too long"],
  phone: [40, "Phone is too long"],
  practiceArea: [120, "Practice area is too long"],
  notes: [4000, "Notes are too long"],
  title: [200, "Title is too long"],
  description: [4000, "Description is too long"],
} as const satisfies Record<string, [number, string]>;

/**
 * The writable lead input (create and patch). Deliberately free-form: the
 * reference backend and the mock adapter store these fields verbatim (no
 * trimming, no email format check — a lead is not a login key), and the
 * parity checklist in the ticket depends on that. `activity` and the
 * conversion links are not here at all — they are server-managed (the
 * contract makes appending to `activity` a server responsibility, and only
 * the conversion transaction stamps the links), so a client-sent value is
 * ignored rather than stored.
 */
export interface LeadInput {
  name?: string;
  email?: string;
  phone?: string;
  source?: string;
  stage?: string;
  practiceArea?: string;
  value?: number;
  notes?: string | null;
}

/**
 * The convert payload — the reference reads only `title` and `description`
 * off the case input (`ctx.body?.title`, `ctx.body?.description`); everything
 * else on the created case is server-decided, so the schema strips the rest.
 */
export interface LeadConvertInput {
  title?: string;
  description?: string;
}

function checkLength(value: string | null | undefined, field: keyof typeof LENGTH_LIMITS): void {
  const [max, message] = LENGTH_LIMITS[field];
  if ((value ?? "").length > max) throw new HttpError(400, message);
}

function normalizePatch(patch: LeadInput): LeadPatch {
  const out: LeadPatch = {};
  if (patch.name !== undefined) {
    checkLength(patch.name, "name");
    out.name = patch.name;
  }
  if (patch.email !== undefined) {
    checkLength(patch.email, "email");
    out.email = patch.email;
  }
  if (patch.phone !== undefined) {
    checkLength(patch.phone, "phone");
    out.phone = patch.phone;
  }
  if (patch.source !== undefined) {
    if (!LEAD_SOURCES.includes(patch.source as LeadSource)) {
      throw new HttpError(400, LEAD_SOURCE_MESSAGE);
    }
    out.source = patch.source;
  }
  if (patch.stage !== undefined) {
    if (!LEAD_STAGES.includes(patch.stage as LeadStage)) throw new HttpError(400, LEAD_STAGE_MESSAGE);
    out.stage = patch.stage;
  }
  if (patch.practiceArea !== undefined) {
    checkLength(patch.practiceArea, "practiceArea");
    out.practiceArea = patch.practiceArea;
  }
  if (patch.value !== undefined) {
    const value = patch.value;
    if (!Number.isInteger(value) || value < 0 || value > MAX_VALUE) {
      throw new HttpError(400, LEAD_VALUE_MESSAGE);
    }
    out.value = value;
  }
  if (patch.notes !== undefined) {
    checkLength(patch.notes, "notes");
    out.notes = patch.notes;
  }
  return out;
}

function normalizeConvertInput(input: LeadConvertInput): LeadConvertInput {
  const out: LeadConvertInput = {};
  if (input.title !== undefined) {
    checkLength(input.title, "title");
    out.title = input.title;
  }
  if (input.description !== undefined) {
    checkLength(input.description, "description");
    out.description = input.description;
  }
  return out;
}

/** The contract's `convertLead` return shape: `{ lead, contact, case }`. */
export interface ConversionResult {
  lead: ApiLead;
  contact: ApiContact;
  case: ApiCase;
}

/**
 * Leads business logic (ticket 16). Practice data of the firm: every firm
 * member manages it (unlike users — the contract and the reference backend
 * gate nothing here, so neither do we), and the service is the choke point
 * that scopes every lookup by the session's firm (ADR-0003) and enforces the
 * reference backend's defaults and soft delete.
 *
 * Stage history design (one line): the contract makes appending to
 * `activity` a server responsibility on stage moves and conversion — the
 * reference's Object.assign instead lets the client overwrite the array
 * wholesale — so the production backend owns the log: a stage move prepends a
 * `Moved to <stage>` entry (newest-first, the same position and wording the
 * reference's conversion entry uses) and writes one lead_stage_history row in
 * the same transaction; a patch that sends the current stage is a no-op.
 */
export class LeadsService {
  constructor(
    private readonly repos: AuthRepositories,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Newest first — the mock and the reference both unshift new leads. */
  async list(firmId: string): Promise<ApiLead[]> {
    const rows = await this.repos.leads.listByFirm(firmId);
    return rows.map(toApiLead);
  }

  /**
   * POST /leads → 201 with the created entity. Defaults mirror the reference
   * backend exactly: name "New lead", empty email/phone, source "website",
   * stage "new", practiceArea "General", value 0 paise, notes absent unless
   * sent. The activity log is server-built ("Lead created") — a client-sent
   * `activity` is stripped, unlike the reference which would store it.
   * Creation is not a stage move: no history row.
   */
  async create(firmId: string, input: LeadInput): Promise<ApiLead> {
    const patch = normalizePatch(input);
    const row = await this.repos.leads.create({
      firmId,
      name: patch.name ?? "New lead",
      email: patch.email ?? "",
      phone: patch.phone ?? "",
      source: patch.source ?? "website",
      stage: patch.stage ?? "new",
      practiceArea: patch.practiceArea ?? "General",
      value: patch.value ?? 0,
      notes: patch.notes ?? null,
      activity: [{ at: this.now().toISOString(), text: "Lead created" }],
    });
    return toApiLead(row);
  }

  /**
   * PATCH /leads/:id — only the sent fields move (mock Object.assign). Stage
   * transitions are free (the contract defines no transition table — the
   * reference lets any vocabulary value through, including a direct jump to
   * "converted" or back out of it). An actual stage change prepends the
   * `Moved to <stage>` activity entry and records one lead_stage_history row
   * (from → to, the actor, the instant) in the same transaction; re-sending
   * the current stage records nothing. `activity` and the conversion links
   * are server-managed and cannot be moved from a patch.
   */
  async update(firmId: string, userId: string, id: string, patch: LeadInput): Promise<ApiLead> {
    const normalized = normalizePatch(patch);
    const at = this.now();
    const row = await this.repos.transaction(async (tx) => {
      const current = await tx.leads.findById(firmId, id);
      if (!current) return null;
      const target = normalized.stage;
      // Captured before the update: an in-memory row mutates in place, so the
      // pre-move stage must be read before (and kept separate from) the write.
      const fromStage = current.stage;
      const stageChanged = target !== undefined && target !== fromStage;
      const activity: LeadActivityEntry[] | undefined = stageChanged
        ? [{ at: at.toISOString(), text: `Moved to ${target}` }, ...current.activity]
        : undefined;
      const updated = await tx.leads.update(
        firmId,
        id,
        // Only spread when set: an explicit `activity: undefined` must not
        // clobber the log (the in-memory twin honors undefined assigns).
        activity ? { ...normalized, activity } : normalized,
      );
      if (updated && stageChanged) {
        await tx.leadStageHistory.record({
          firmId,
          leadId: id,
          fromStage,
          toStage: target,
          changedBy: userId,
          at,
        });
      }
      return updated;
    });
    if (!row) throw new HttpError(404, "Lead not found");
    return toApiLead(row);
  }

  /** DELETE /leads/:id → 204; soft delete (the row stays, reads filter it). */
  async delete(firmId: string, id: string): Promise<void> {
    const deleted = await this.repos.leads.delete(firmId, id);
    if (!deleted) throw new HttpError(404, "Lead not found");
  }

  /**
   * POST /leads/:id/convert → 201 `{ lead, contact, case }`. One transaction
   * (the contract's server-side responsibility): create the client contact
   * (type "client", the lead's name/email/phone), create the matter with a
   * server-assigned `YYYY-NNNN` number from the same per-firm-year counter
   * POST /cases uses (the reference's `assignCaseNumber()`), link the case
   * into the contact's caseIds, then mark the lead converted — stage,
   * activity entry, and the DB-only converted_case_id/converted_contact_id
   * links — plus one stage-history row. Double conversion is the parity fix's
   * conflict: 409 "Lead already converted". Case defaults mirror the
   * reference: title from the payload or `<name> — <practiceArea>`, stage
   * intake, status open, openDate today, lead attorney = the firm's first
   * user, billableRate 300000 paise, trustBalance 0; only `title` and
   * `description` are read from the payload.
   */
  async convert(
    firmId: string,
    userId: string,
    id: string,
    caseInput: LeadConvertInput,
  ): Promise<ConversionResult> {
    const input = normalizeConvertInput(caseInput);
    const at = this.now();
    const today = at.toISOString().slice(0, 10);
    const year = Number(today.slice(0, 4));
    const result = await this.repos.transaction(async (tx) => {
      const lead = await tx.leads.findById(firmId, id);
      if (!lead) throw new HttpError(404, "Lead not found");
      if (lead.stage === "converted") throw new HttpError(409, "Lead already converted");
      // Captured before the update mutates the (possibly in-memory aliased) row.
      const fromStage = lead.stage;

      const contact = await tx.contacts.create({
        firmId,
        type: "client",
        name: lead.name,
        company: null,
        email: lead.email,
        phone: lead.phone,
        address: "",
        caseIds: [],
        notes: null,
      });

      const users = await tx.users.listByFirm(firmId);
      const attorney = users[0];
      if (!attorney) throw new HttpError(400, NO_USER_MESSAGE);

      const seq = await tx.caseNumbers.next(firmId, year);
      const kase = await tx.cases.create({
        firmId,
        number: `${year}-${String(seq).padStart(4, "0")}`,
        title: input.title ?? `${lead.name} — ${lead.practiceArea}`,
        clientId: contact.id,
        practiceArea: lead.practiceArea,
        stage: "intake",
        status: "open",
        openDate: today,
        courtDate: null,
        statute: null,
        leadAttorneyId: attorney.id,
        description: input.description ?? "",
        billableRate: DEFAULT_BILLABLE_RATE,
        trustBalance: 0,
      });

      // The reference pushes the new case into the contact's caseIds.
      const linkedContact = await tx.contacts.update(firmId, contact.id, {
        caseIds: [kase.id],
      });
      if (!linkedContact) throw new HttpError(500, "Conversion contact link failed");

      const leadRow = await tx.leads.update(firmId, id, {
        stage: "converted",
        convertedCaseId: kase.id,
        convertedContactId: contact.id,
        activity: [
          { at: at.toISOString(), text: `Converted to case ${kase.number}` },
          ...lead.activity,
        ],
      });
      if (!leadRow) throw new HttpError(500, "Conversion lead update failed");

      await tx.leadStageHistory.record({
        firmId,
        leadId: id,
        fromStage,
        toStage: "converted",
        changedBy: userId,
        at,
      });

      return { leadRow, linkedContact, kase };
    });
    return {
      lead: toApiLead(result.leadRow),
      contact: toApiContact(result.linkedContact),
      case: toApiCase(result.kase),
    };
  }
}
