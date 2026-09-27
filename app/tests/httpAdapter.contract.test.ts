import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LawleitApi } from "@/lib/data/api";

/**
 * Contract test: the REAL httpAdapter against the reference backend.
 *
 * smoke.mjs exercises the server with raw fetch; this exercises the exact
 * code path the app runs in http mode (VITE_API_MODE=http) — token handling,
 * 404→null mapping, ApiError statuses, session shape — so adapter, server,
 * and docs/API_CONTRACT.md can never drift apart silently.
 *
 * THE OWNER HANDOFF: this same suite certifies any backend that claims the
 * contract. Point VITE_API_BASE_URL at your running API and run:
 *
 *   VITE_API_BASE_URL=http://your-host:port/api/v1 npm run test
 *
 * The suite skips spawning the bundled server when VITE_API_BASE_URL is
 * already set (it tests against whatever you pointed it at).
 */

const OWN_SERVER = !process.env.VITE_API_BASE_URL;
const PORT = 38000 + Math.floor(Math.random() * 20000);
const BASE = process.env.VITE_API_BASE_URL ?? `http://127.0.0.1:${PORT}/api/v1`;

let server: ChildProcess | null = null;
let scratchDir: string | null = null;
let api: LawleitApi;

async function healthy(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  if (OWN_SERVER) {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawleit-contract-"));
    const backendDir = path.resolve(__dirname, "../../backend");
    server = spawn(process.execPath, [path.join(backendDir, "server.mjs")], {
      env: { ...process.env, PORT: String(PORT), LAWLEIT_DB: path.join(scratchDir, "db.json") },
      stdio: "ignore",
    });
    const deadline = Date.now() + 10_000;
    while (!(await healthy())) {
      if (Date.now() > deadline) throw new Error(`reference backend did not become healthy on :${PORT}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  // Fresh adapter instance pointed at the test server; jsdom provides
  // sessionStorage/window; fetch comes from Node.
  vi.stubEnv("VITE_API_BASE_URL", BASE);
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  ({ httpAdapter: api } = await import("@/lib/data/httpAdapter"));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  server?.kill();
  if (scratchDir) fs.rmSync(scratchDir, { recursive: true, force: true });
});

describe("auth", () => {
  it("empty credentials → ApiError 401", async () => {
    await expect(api.login("", "")).rejects.toMatchObject({ name: "ApiError", status: 401 });
  });

  it("login returns a token-stripped session and stores the token", async () => {
    const session = await api.login("arjun@kaulbhatnagar.example", "demo");
    expect((session as unknown as { token?: string }).token).toBeUndefined();
    expect(session.user.email.toLowerCase()).toBe("arjun@kaulbhatnagar.example");
    expect(session.firm.name).toBeTruthy();
    expect(session.users.length).toBeGreaterThan(0);
    expect(sessionStorage.getItem("lawleit.auth.token")).toBeTruthy();
    expect(await api.getSession()).not.toBeNull();
  });
});

describe("cases", () => {
  it("server assigns the 2026-XXXX number; CRUD round-trips", async () => {
    const before = (await api.listCases()).length;
    const created = await api.createCase({ title: "Contract v. Test" });
    expect(created.number).toMatch(/^2026-\d{4}$/);
    expect((await api.listCases()).length).toBe(before + 1);

    const patched = await api.updateCase(created.id, { stage: "discovery" });
    expect(patched.stage).toBe("discovery");

    await api.deleteCase(created.id);
    expect(await api.getCase(created.id)).toBeNull();
  });

  it("missing entity maps 404 → null, other errors keep ApiError status", async () => {
    expect(await api.getCase("k-nope")).toBeNull();
    await expect(api.updateCase("k-nope", { title: "x" })).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
    });
  });
});

describe("billing — server-side responsibilities", () => {
  it("partial payment keeps sent, full payment rolls up to paid", async () => {
    const contact = await api.createContact({ name: "Contract Client" });
    const iv = await api.createInvoice({
      clientId: contact.id,
      lines: [
        { id: "l1", description: "Consult", quantity: 2, rate: 15000, kind: "time" },
        { id: "l2", description: "Copies", quantity: 1, rate: 10000, kind: "flat" },
      ],
    });
    expect(iv.number).toMatch(/^INV-\d{4}$/);
    await api.updateInvoice(iv.id, { status: "sent" });

    await api.recordPayment({ invoiceId: iv.id, amount: 25000, method: "card" });
    expect((await api.getInvoice(iv.id))?.status).toBe("sent");

    await api.recordPayment({ invoiceId: iv.id, amount: 15000, method: "echeck" });
    expect((await api.getInvoice(iv.id))?.status).toBe("paid");
  });

  it("trust payments append ledger entries with running balanceAfter", async () => {
    const contact = await api.createContact({ name: "Contract Trust Client" });
    await api.recordPayment({ invoiceId: "", clientId: contact.id, amount: 50000, trustAccount: true });
    await api.recordPayment({ invoiceId: "", clientId: contact.id, amount: 25000, trustAccount: true });

    const ledger = await api.listTrustTransactions();
    const mine = ledger.filter((t) => t.clientId === contact.id);
    expect(mine).toHaveLength(2);
    expect(mine[0].balanceAfter).toBe(50000);
    expect(mine[1].balanceAfter).toBe(75000);
  });
});

describe("leads", () => {
  it("conversion creates contact + case; double conversion → ApiError 409", async () => {
    const lead = await api.createLead({ name: "Contract Lead", practiceArea: "Family" });
    const { lead: l, contact, case: k } = await api.convertLead(lead.id, {});
    expect(l.stage).toBe("converted");
    expect(contact.type).toBe("client");
    expect(contact.caseIds).toContain(k.id);
    expect(k.number).toMatch(/^2026-\d{4}$/);

    await expect(api.convertLead(lead.id, {})).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
    });
  });
});

describe("sessions", () => {
  it("logout invalidates the token server-side", async () => {
    const session = await api.login("arjun@kaulbhatnagar.example", "demo");
    expect(session.user).toBeTruthy();
    await api.logout();
    expect(await api.getSession()).toBeNull();
    expect(sessionStorage.getItem("lawleit.auth.token")).toBeNull();
  });
});
