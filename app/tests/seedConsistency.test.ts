import { describe, expect, it } from "vitest";
import {
  seedCases, seedContacts, seedEvents, seedExpenses, seedInvoices, seedLeads,
  seedPayments, seedTasks, seedThreads, seedTimeEntries, seedTrust, seedUsers,
} from "@/lib/data/seed";
import type { Invoice } from "@/lib/data/types";

/**
 * Invariants of the Demo Firm seed (ticket 03): the ledger must reconcile the
 * way a real firm's books would. The trust ledger must sum exactly to each
 * case's trustBalance with a correct running balanceAfter chain, payments
 * must match invoice totals, and every cross-reference must resolve.
 */

const invoiceTotal = (iv: Invoice) =>
  iv.lines.reduce((s, l) => s + l.quantity * l.rate, 0);

describe("seed consistency", () => {
  it("trust ledger sums exactly to each case's trustBalance", () => {
    for (const k of seedCases) {
      const sum = seedTrust.filter((t) => t.caseId === k.id).reduce((s, t) => s + t.amount, 0);
      expect([k.number, sum]).toEqual([k.number, k.trustBalance]);
    }
  });

  it("each client's trust entries chain balanceAfter correctly", () => {
    for (const cid of new Set(seedTrust.map((t) => t.clientId))) {
      const chain = seedTrust
        .filter((t) => t.clientId === cid)
        .sort((a, b) => a.date.localeCompare(b.date));
      let running = 0;
      for (const t of chain) {
        running += t.amount;
        expect([t.id, t.balanceAfter]).toEqual([t.id, running]);
      }
    }
  });

  it("payments never exceed invoice totals; paid invoices are fully settled", () => {
    for (const iv of seedInvoices) {
      const paid = seedPayments
        .filter((p) => p.invoiceId === iv.id && p.status !== "failed")
        .reduce((s, p) => s + p.amount, 0);
      expect(paid).toBeLessThanOrEqual(invoiceTotal(iv));
      if (iv.status === "paid") expect([iv.number, paid]).toEqual([iv.number, invoiceTotal(iv)]);
    }
  });

  it("invoices reference real clients and cases with unique numbers", () => {
    const clientIds = new Set(seedContacts.map((c) => c.id));
    const caseIds = new Set(seedCases.map((k) => k.id));
    const numbers = new Set<string>();
    for (const iv of seedInvoices) {
      expect(clientIds.has(iv.clientId)).toBe(true);
      expect(caseIds.has(iv.caseId)).toBe(true);
      expect(numbers.has(iv.number)).toBe(false);
      numbers.add(iv.number);
    }
  });

  it("time entry rates match the timekeeper's rate and references resolve", () => {
    const users = new Map(seedUsers.map((u) => [u.id, u]));
    const caseIds = new Set(seedCases.map((k) => k.id));
    for (const te of seedTimeEntries) {
      const u = users.get(te.userId);
      expect(u).toBeDefined();
      expect([te.id, te.rate]).toEqual([te.id, u!.hourlyRate]);
      expect(caseIds.has(te.caseId)).toBe(true);
    }
  });

  it("cases, contacts, events, tasks, threads and leads cross-reference cleanly", () => {
    const clientIds = new Set(seedContacts.map((c) => c.id));
    const caseIds = new Set(seedCases.map((k) => k.id));
    const userIds = new Set(seedUsers.map((u) => u.id));

    for (const k of seedCases) {
      expect(clientIds.has(k.clientId)).toBe(true);
      expect(userIds.has(k.leadAttorneyId)).toBe(true);
    }
    for (const c of seedContacts) {
      for (const id of c.caseIds) expect(caseIds.has(id)).toBe(true);
    }
    // every case's client lists the case back (bidirectional link)
    for (const k of seedCases) {
      const client = seedContacts.find((c) => c.id === k.clientId)!;
      expect(client.caseIds).toContain(k.id);
    }
    for (const e of seedEvents) {
      if (e.caseId) expect(caseIds.has(e.caseId)).toBe(true);
      for (const id of e.attendeeIds) expect(userIds.has(id)).toBe(true);
    }
    for (const t of seedTasks) {
      if (t.caseId) expect(caseIds.has(t.caseId)).toBe(true);
      expect(userIds.has(t.assigneeId)).toBe(true);
    }
    for (const th of seedThreads) {
      expect(clientIds.has(th.clientId)).toBe(true);
      if (th.caseId) expect(caseIds.has(th.caseId)).toBe(true);
    }
    for (const x of seedExpenses) expect(caseIds.has(x.caseId)).toBe(true);
    for (const l of seedLeads) expect(["new", "consult scheduled", "contacted", "fee agreement", "converted", "lost"]).toContain(l.stage);
  });
});
