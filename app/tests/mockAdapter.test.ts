import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LawleitApi } from "@/lib/data/api";

/**
 * Unit tests for the mock adapter — the DEFAULT mode the app ships in.
 *
 * These lock the business logic the UI depends on: the auth gate, number
 * assignment, the invoice payment roll-up, the trust ledger, and lead
 * conversion. Where behavior is defined, it must match the reference
 * backend (backend/server.mjs) — both implement docs/API_CONTRACT.md.
 *
 * The adapter is a module singleton that loads its DB from localStorage at
 * import time, so every test gets a fresh module instance over cleared
 * storage via vi.resetModules + dynamic import.
 */

async function fresh(login = true): Promise<LawleitApi> {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  const { mockAdapter } = await import("@/lib/data/mockAdapter");
  if (login) await mockAdapter.login("arjun@kaulbhatnagar.example", "demo");
  return mockAdapter;
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
});

describe("auth gate", () => {
  it("rejects data calls before login", async () => {
    const api = await fresh(false);
    await expect(api.listCases()).rejects.toThrow("Not signed in");
  });

  it("login seeds a session; getSession and logout round-trip", async () => {
    const api = await fresh(false);
    const session = await api.login("arjun@kaulbhatnagar.example", "demo");
    expect(session.user.email.toLowerCase()).toBe("arjun@kaulbhatnagar.example");
    expect(session.firm.name).toBeTruthy();
    expect(session.users.length).toBeGreaterThan(0);
    expect(await api.getSession()).not.toBeNull();
    await api.logout();
    expect(await api.getSession()).toBeNull();
    await expect(api.listCases()).rejects.toThrow("Not signed in");
  });

  it("unknown email falls back to the first seeded user (demo parity)", async () => {
    const api = await fresh(false);
    const session = await api.login("nobody@nowhere.test", "whatever");
    expect(session.user.id).toBeTruthy();
    expect(session.users.some((u) => u.id === session.user.id)).toBe(true);
  });
});

describe("cases", () => {
  it("create assigns the next 2026-XXXX number; update and delete work", async () => {
    const api = await fresh();
    const before = (await api.listCases()).length;
    const created = await api.createCase({ title: "Test v. Case" });
    expect(created.number).toBe(`2026-${String(before + 50).padStart(4, "0")}`);
    expect(created.status).toBe("open");
    expect((await api.listCases()).length).toBe(before + 1);

    const patched = await api.updateCase(created.id, { stage: "discovery" });
    expect(patched.stage).toBe("discovery");

    await api.deleteCase(created.id);
    expect(await api.getCase(created.id)).toBeNull();
  });

  it("getCase for a missing id returns null (contract shape)", async () => {
    const api = await fresh();
    expect(await api.getCase("k-does-not-exist")).toBeNull();
  });
});

describe("calendar", () => {
  it("listEvents filters inclusively on from/to", async () => {
    const api = await fresh();
    const ev = await api.createEvent({ title: "Hearing", date: "2026-09-25", type: "court" });
    const inRange = await api.listEvents({ from: "2026-09-25", to: "2026-09-25" });
    expect(inRange.some((e) => e.id === ev.id)).toBe(true);
    const before = await api.listEvents({ from: "2026-01-01", to: "2026-01-02" });
    expect(before.some((e) => e.id === ev.id)).toBe(false);
  });
});

describe("billing", () => {
  it("payments roll the invoice up: partial keeps sent, full marks paid", async () => {
    const api = await fresh();
    const contact = await api.createContact({ name: "Rollup Client" });
    const iv = await api.createInvoice({
      clientId: contact.id,
      lines: [
        { id: "l1", description: "Consult", quantity: 2, rate: 15000, kind: "time" },
        { id: "l2", description: "Copies", quantity: 1, rate: 10000, kind: "flat" },
      ],
    });
    expect(iv.status).toBe("draft");
    await api.updateInvoice(iv.id, { status: "sent" });

    await api.recordPayment({ invoiceId: iv.id, amount: 25000, method: "card" });
    expect((await api.getInvoice(iv.id))?.status).toBe("sent"); // 40000 total, 25000 paid

    await api.recordPayment({ invoiceId: iv.id, amount: 15000, method: "echeck" });
    expect((await api.getInvoice(iv.id))?.status).toBe("paid");
  });

  it("a partially paid draft stays draft (never silently sent)", async () => {
    const api = await fresh();
    const iv = await api.createInvoice({
      lines: [{ id: "l1", description: "Work", quantity: 1, rate: 50000, kind: "time" }],
    });
    await api.recordPayment({ invoiceId: iv.id, amount: 10000, method: "card" });
    expect((await api.getInvoice(iv.id))?.status).toBe("draft");
  });

  it("trust-account payments append ledger entries with a running balance", async () => {
    const api = await fresh();
    const contact = await api.createContact({ name: "Trust Client" });
    await api.recordPayment({ invoiceId: "", clientId: contact.id, amount: 50000, trustAccount: true });
    await api.recordPayment({ invoiceId: "", clientId: contact.id, amount: 25000, trustAccount: true });

    const ledger = await api.listTrustTransactions();
    const mine = ledger.filter((t) => t.clientId === contact.id);
    expect(mine).toHaveLength(2);
    expect(mine[0].balanceAfter).toBe(50000);
    expect(mine[1].balanceAfter).toBe(75000);
    expect(mine[1].description).toContain("Trust deposit");
  });
});

describe("leads", () => {
  it("conversion creates a linked client contact + numbered case and marks the lead", async () => {
    const api = await fresh();
    const lead = await api.createLead({ name: "Convert Me", practiceArea: "Family" });
    const before = (await api.listCases()).length;

    const { lead: l, contact, case: k } = await api.convertLead(lead.id, {});
    expect(l.stage).toBe("converted");
    expect(contact.type).toBe("client");
    expect(contact.caseIds).toContain(k.id);
    expect(k.number).toBe(`2026-${String(before + 50).padStart(4, "0")}`);
    expect(k.clientId).toBe(contact.id);
    expect(l.activity[0].text).toContain(k.number);

    await expect(api.convertLead(lead.id, {})).rejects.toThrow("Lead already converted");
  });
});

describe("persistence", () => {
  it("mutations survive a fresh adapter load (localStorage is the DB)", async () => {
    const api = await fresh();
    const created = await api.createCase({ title: "Persisted matter" });

    // simulate an app reload: new module instance, same storage
    vi.resetModules();
    const { mockAdapter: reloaded } = await import("@/lib/data/mockAdapter");
    await reloaded.login("arjun@kaulbhatnagar.example", "demo");
    expect((await reloaded.getCase(created.id))?.title).toBe("Persisted matter");
  });
});

describe("notifications", () => {
  it("markNotificationsRead clears every unread flag", async () => {
    const api = await fresh();
    const before = await api.listNotifications();
    expect(before.some((n) => !n.read)).toBe(true);
    await api.markNotificationsRead();
    const after = await api.listNotifications();
    expect(after.every((n) => n.read)).toBe(true);
  });
});
