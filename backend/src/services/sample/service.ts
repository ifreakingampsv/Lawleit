import { toApiFirm, type ApiFirm, type AuthRepositories } from "../auth/repository.js";
import { HttpError } from "../httpError.js";
import { ContactsService } from "../contacts/service.js";
import { CasesService } from "../cases/service.js";
import { EventsService } from "../events/service.js";
import { TasksService } from "../tasks/service.js";
import { TimeEntriesService } from "../time/service.js";
import { InvoicesService } from "../invoices/service.js";
import { PaymentsService } from "../payments/service.js";

/** Shown (as a 409) when removal is requested with no live sample data. */
export const SAMPLE_NOTHING_TO_REMOVE =
  "No sample data to remove — this workspace's sample data was already cleared or never seeded";

/** The removal outcome, returned in the 200 body for the UI's confirmation. */
export interface SampleRemovalOutcome {
  removed: true;
  /** What was soft-deleted / voided. */
  contacts: number;
  case: number;
  event: number;
  task: number;
  timeEntry: number;
  invoice: number;
  payment: number;
  /** The trust reversal entry appended (the ledger stays append-only). */
  trustReversal: number;
}

/**
 * The sample workspace (V2 ticket 09, decision Q18) — a NEW production firm
 * opens on a small, clearly-labeled sample set (two clients, an opposing
 * counsel, one case with hearing/task/time, a draft invoice, one trust
 * deposit) so the product teaches itself before real work begins. Every
 * entity's visible name carries "Sample".
 *
 * Lifecycle, tracked by the SERVER-MANAGED firms.sample_data flag:
 *   null            → never seeded (seed runs once, on signup, best-effort:
 *                     a seed failure never fails the signup)
 *   { seeded, ids } → live; removal soft-deletes each row and appends a
 *                     trust REVERSAL entry (the ledger stays append-only,
 *                     the client's balance returns to ₹0)
 *   { removed }     → cleared; never re-seeded
 *
 * Each creation runs through the SAME services the UI uses (number
 * assignment, server-computed line amounts, the trust hook included), each
 * in its own transaction — partial failures leave the created ids recorded,
 * so removal still cleans up. The Demo Version is untouched: it ships its
 * own full seed and this flag stays null there.
 */
export class SampleDataService {
  constructor(
    private readonly repos: AuthRepositories,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The firm's flag, from the row (findById is firm-global by design). */
  private async state(firmId: string) {
    const firm = await this.repos.firms.findById(firmId);
    return firm?.sampleData ?? null;
  }

  /**
   * The firm shape AFTER seeding — the signup 201 must report the flag it
   * just set (register built its SessionView before the seed ran).
   */
  async refreshedFirm(firmId: string): Promise<ApiFirm | null> {
    const row = await this.repos.firms.findById(firmId);
    return row ? toApiFirm(row) : null;
  }

  /**
   * Called from the signup handler AFTER register commits. Idempotent by the
   * flag: null seeds, anything else is a no-op. Never throws — a failed seed
   * is logged (by the caller) and simply means the firm starts empty.
   */
  async seedIfNewFirm(firmId: string): Promise<boolean> {
    const current = await this.state(firmId);
    if (current !== null) return false;

    const contacts = new ContactsService(this.repos);
    const cases = new CasesService(this.repos);
    const events = new EventsService(this.repos);
    const tasks = new TasksService(this.repos);
    const time = new TimeEntriesService(this.repos);
    const invoices = new InvoicesService(this.repos);
    const payments = new PaymentsService(this.repos);
    const day = (offset: number) =>
      new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

    const ids: string[] = [];
    const created = {
      contactIds: [] as string[],
      caseId: "",
      eventId: "",
      taskId: "",
      timeEntryId: "",
      invoiceId: "",
      paymentId: "",
      trustClientId: "",
      trustAmount: 0,
    };
    try {
      const clientA = await contacts.create(firmId, {
        type: "client", name: "Sample client — Ramesh Sharma",
        email: "ramesh@sample.example", phone: "+91 98xxx xxx01",
        notes: "Sample data — explore freely, remove from the dashboard.",
      });
      ids.push(clientA.id);
      created.contactIds.push(clientA.id);
      const clientB = await contacts.create(firmId, {
        type: "client", name: "Sample client — Priya Nair",
        email: "priya@sample.example", phone: "+91 98xxx xxx02",
      });
      ids.push(clientB.id);
      created.contactIds.push(clientB.id);
      const counsel = await contacts.create(firmId, {
        type: "opposing", name: "Sample opposing counsel — Ashok Verma",
      });
      ids.push(counsel.id);
      created.contactIds.push(counsel.id);

      const matter = await cases.create(firmId, {
        title: "Sample matter — cheque bounce (s.138)",
        clientId: clientA.id,
        stage: "court date pending",
        status: "open",
        description: "Sample case — a s.138 cheque-bounce complaint, seeded so you can see how a matter hangs together. Remove it whenever you like.",
      });
      ids.push(matter.id);
      created.caseId = matter.id;

      const hearing = await events.create(firmId, {
        title: "Sample hearing — Magistrate Court",
        date: day(7), start: "10:00", end: "11:00",
        location: "Sample District Court, Courtroom 4",
        caseId: matter.id, type: "court",
      });
      ids.push(hearing.id);
      created.eventId = hearing.id;

      const task = await tasks.create(firmId, {
        title: "Sample task — serve summons on the accused",
        dueDate: day(3), priority: "high", caseId: matter.id,
      });
      ids.push(task.id);
      created.taskId = task.id;

      const entry = await time.create(firmId, {
        caseId: matter.id, date: day(0), minutes: 120, rate: 500000,
        description: "Sample time entry — complaint drafting (2.0 hrs)", billable: true,
      });
      ids.push(entry.id);
      created.timeEntryId = entry.id;

      const invoice = await invoices.create(firmId, {
        clientId: clientA.id, caseId: matter.id,
        notes: "Sample invoice — explore freely, remove with the sample data.",
        lines: [{ description: "Sample professional services", quantity: 1, rate: 500000, kind: "flat" }],
      });
      ids.push(invoice.id);
      created.invoiceId = invoice.id;

      // The trust deposit rides the manual record path — the trust hook
      // appends the ledger entry with its running balance, exactly as the
      // V1 service pins it.
      const deposit = await payments.record(firmId, {
        invoiceId: "", clientId: clientA.id, amount: 5000000,
        method: "netbanking", trustAccount: true,
      });
      ids.push(deposit.id);
      created.paymentId = deposit.id;
      created.trustClientId = clientA.id;
      created.trustAmount = 5000000;

      await this.repos.firms.update(firmId, {
        sampleData: { seeded: true, ...created },
      });
      return true;
    } catch (error) {
      // Best-effort by decision: record whatever landed (so removal still
      // works), then swallow — the signup itself must not fail.
      if (ids.length > 0) {
        const partial = created;
        await this.repos.firms
          .update(firmId, { sampleData: { seeded: true, ...partial } })
          .catch(() => undefined);
      }
      console.error(`[sample] seeding failed for firm ${firmId}:`, error);
      return false;
    }
  }

  /**
   * POST /firm/sample-data/remove — soft-delete every sample row and append
   * the trust REVERSAL (payment void + reversal entry commit in ONE
   * transaction, so the ledger can never disagree with the payment rows).
   * The flag flips to { removed: true }; a second call is a 409.
   */
  async remove(firmId: string): Promise<SampleRemovalOutcome> {
    const state = await this.state(firmId);
    if (!state || !("seeded" in state)) {
      throw new HttpError(409, SAMPLE_NOTHING_TO_REMOVE);
    }

    const cases = new CasesService(this.repos);
    const events = new EventsService(this.repos);
    const tasks = new TasksService(this.repos);
    const time = new TimeEntriesService(this.repos);
    const invoices = new InvoicesService(this.repos);
    const today = this.now();

    // Payment void + ledger reversal: atomic, the pair the append-only
    // invariant demands (history is never rewritten — the reversal is a
    // first-class entry and the client balance lands back on ₹0).
    await this.repos.transaction(async (tx) => {
      await tx.payments.softDelete(firmId, state.paymentId);
      await tx.trust.append({
        firmId,
        clientId: state.trustClientId,
        caseId: null,
        date: today.toISOString().slice(0, 10),
        description: "Sample data removed — reversal of the sample trust deposit",
        amount: -state.trustAmount,
      });
    });

    // The rest are independent soft deletes (each already its own
    // transaction in its service); they throw 404 when already gone —
    // count the successes, never fail the removal over one.
    const tryDelete = async (fn: () => Promise<void>): Promise<number> => {
      try {
        await fn();
        return 1;
      } catch {
        return 0;
      }
    };
    const outcome: SampleRemovalOutcome = {
      removed: true, contacts: 0, case: 0, event: 0, task: 0,
      timeEntry: 0, invoice: 0, payment: 1, trustReversal: 1,
    };
    for (const contactId of state.contactIds) {
      outcome.contacts += await tryDelete(() =>
        new ContactsService(this.repos).delete(firmId, contactId));
    }
    outcome.case = await tryDelete(() => cases.delete(firmId, state.caseId));
    outcome.event = await tryDelete(() => events.delete(firmId, state.eventId));
    outcome.task = await tryDelete(() => tasks.delete(firmId, state.taskId));
    outcome.timeEntry = await tryDelete(() => time.delete(firmId, state.timeEntryId));
    outcome.invoice = await tryDelete(() => invoices.delete(firmId, state.invoiceId));

    await this.repos.firms.update(firmId, { sampleData: { removed: true } });
    return outcome;
  }
}
