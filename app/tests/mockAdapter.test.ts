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

  it("accepts the widened Indian-rails methods (upi, netbanking) — V2 slice 1", async () => {
    const api = await fresh();
    const iv = await api.createInvoice({
      lines: [{ id: "l1", description: "Work", quantity: 1, rate: 50000, kind: "time" }],
    });
    const upi = await api.recordPayment({ invoiceId: iv.id, amount: 20000, method: "upi" });
    expect(upi.method).toBe("upi");
    const nb = await api.recordPayment({ invoiceId: iv.id, amount: 30000, method: "netbanking" });
    expect(nb.method).toBe("netbanking");
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

describe("users — invites (ticket 08/20)", () => {
  it("owner invites a user; they appear in listUsers and can sign in like a seeded user", async () => {
    const api = await fresh();
    const before = (await api.listUsers()).length;

    const invited = await api.createUser({ name: "Kavya Iyer", email: "kavya@kaulbhatnagar.example", role: "paralegal" });
    expect(invited.role).toBe("paralegal");
    expect(invited.active).toBe(true);
    expect(invited.firmId).toBe("f1");
    expect(invited.hourlyRate).toBe(0); // default when omitted
    expect(invited.avatarColor).toMatch(/^#/); // palette default assigned

    const users = await api.listUsers();
    expect(users.length).toBe(before + 1);
    expect(users.some((u) => u.email === "kavya@kaulbhatnagar.example")).toBe(true);

    // Mock invite semantics: no password exists anywhere — login matches by
    // email alone (any password), exactly like the seeded users.
    const session = await api.login("kavya@kaulbhatnagar.example", "anything");
    expect(session.user.id).toBe(invited.id);
  });

  it("hourlyRate and avatarColor pass through when provided", async () => {
    const api = await fresh();
    const invited = await api.createUser({
      name: "Priced Attorney", email: "priced@kaulbhatnagar.example", role: "attorney",
      hourlyRate: 250000, avatarColor: "#123456",
    });
    expect(invited.hourlyRate).toBe(250000);
    expect(invited.avatarColor).toBe("#123456");
  });

  it("members cannot invite (owner-only, backend 403 message)", async () => {
    const api = await fresh();
    await api.login("fatima@kaulbhatnagar.example", "demo"); // paralegal
    await expect(api.createUser({ name: "Nope", email: "nope@kaulbhatnagar.example", role: "staff" }))
      .rejects.toThrow("Only the firm owner can manage users");
    expect((await api.listUsers()).some((u) => u.email === "nope@kaulbhatnagar.example")).toBe(false);
  });

  it("a taken email is rejected (backend 409 message, case-insensitive)", async () => {
    const api = await fresh();
    await expect(api.createUser({ name: "Dupe", email: "MEERA@kaulbhatnagar.example", role: "attorney" }))
      .rejects.toThrow("Email already registered");
  });

  it("a role outside the contract vocabulary is rejected (backend 400)", async () => {
    const api = await fresh();
    await expect(
      api.createUser({ name: "Bad Role", email: "bad@kaulbhatnagar.example", role: "intern" as never }),
    ).rejects.toThrow("Invalid role");
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

describe("documents — real files (ticket 17)", () => {
  it("uploadDocument stores the bytes and the row round-trips through download", async () => {
    const api = await fresh();
    const file = new File(["hello lawleit"], "Motion to Compel.pdf", { type: "application/pdf" });

    const doc = await api.uploadDocument({ file, folder: "Pleadings", caseId: "k1" });
    expect(doc.hasFile).toBe(true);
    expect(doc.name).toBe("Motion to Compel.pdf");
    expect(doc.kind).toBe("pdf");
    expect(doc.folder).toBe("Pleadings");
    expect(doc.caseId).toBe("k1");
    expect(doc.sizeKb).toBe(1);
    expect((await api.listDocuments()).some((d) => d.id === doc.id && d.hasFile)).toBe(true);

    const url = await api.getDocumentDownloadUrl(doc.id);
    expect(url).toMatch(/^data:application\/pdf;base64,/);
    expect(decodeURIComponent(escape(atob(url.split(",")[1]!)))).toBe("hello lawleit");
  });

  it("files above the demo cap (1 MB) are rejected with a clear message — never silently dropped", async () => {
    const api = await fresh();
    const tooBig = new File([new Uint8Array(1024 * 1024 + 1)], "huge.pdf", { type: "application/pdf" });
    await expect(api.uploadDocument({ file: tooBig })).rejects.toThrow(
      "File is too large for the demo — the limit is 1 MB (production allows 25 MB)",
    );
    // Nothing was recorded.
    expect((await api.listDocuments()).some((d) => d.name === "huge.pdf")).toBe(false);
  });

  it("metadata-only documents have no bytes to download; deleting the row drops them", async () => {
    const api = await fresh();
    const metadataOnly = await api.createDocument({ name: "Bare.docx" });
    expect(metadataOnly.hasFile).toBeUndefined();
    await expect(api.getDocumentDownloadUrl(metadataOnly.id)).rejects.toThrow(
      "Document file not found",
    );

    const file = new File(["bytes"], "Keep.pdf", { type: "application/pdf" });
    const uploaded = await api.uploadDocument({ file });
    await api.deleteDocument(uploaded.id);
    await expect(api.getDocumentDownloadUrl(uploaded.id)).rejects.toThrow("Document not found");
  });

  it("uploaded blobs survive an app reload (localStorage is the DB)", async () => {
    const api = await fresh();
    const doc = await api.uploadDocument({ file: new File(["persist me"], "Reload.docx", { type: "text/plain" }) });

    vi.resetModules();
    const { mockAdapter: reloaded } = await import("@/lib/data/mockAdapter");
    await reloaded.login("arjun@kaulbhatnagar.example", "demo");
    const url = await reloaded.getDocumentDownloadUrl(doc.id);
    expect(atob(url.split(",")[1]!)).toBe("persist me");
  });

  it("both adapters expose the same upload/download surface (api.ts is the seam)", async () => {
    const { httpAdapter } = await import("@/lib/data/httpAdapter");
    const { mockAdapter } = await import("@/lib/data/mockAdapter");
    for (const method of ["uploadDocument", "getDocumentDownloadUrl"] as const) {
      expect(typeof mockAdapter[method]).toBe("function");
      expect(typeof httpAdapter[method]).toBe("function");
    }
  });

  it("kindForFile maps pdf/images/office/text to the contract kinds", async () => {
    const { kindForFile } = await import("@/lib/data/api");
    expect(kindForFile("application/pdf", "a.pdf")).toBe("pdf");
    expect(kindForFile("image/png", "b.png")).toBe("image");
    expect(kindForFile("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "c.xlsx")).toBe("sheet");
    expect(kindForFile("application/msword", "d.doc")).toBe("doc");
    expect(kindForFile("text/plain", "e.txt")).toBe("doc");
    expect(kindForFile("application/octet-stream", "f.bin")).toBe("other");
    // Extension fallback for browsers that report no content type.
    expect(kindForFile("", "g.pdf")).toBe("pdf");
    expect(kindForFile("", "h.docx")).toBe("doc");
  });
});
