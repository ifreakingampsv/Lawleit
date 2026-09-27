import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Demo Version entry + reset — the zero-friction path (ADR 0001).
 *
 * startDemoSession must land a visitor in the seeded Demo Firm with no
 * credentials, and resetDemoData must restore the pristine seed after any
 * local edits. Same module-singleton pattern as mockAdapter.test.ts:
 * vi.resetModules over cleared storage, then dynamic import.
 */

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
});

describe("startDemoSession", () => {
  it("establishes a Demo Firm session with no credentials", async () => {
    const { startDemoSession } = await import("@/lib/data/demo");
    const session = await startDemoSession();
    expect(session?.firm.name).toBe("Kaul & Bhatnagar Associates");
    expect(session?.user.email).toBeTruthy();
    expect(session?.users.length).toBeGreaterThan(0);
  });

  it("seeds the local DB on first entry", async () => {
    const { startDemoSession } = await import("@/lib/data/demo");
    await startDemoSession();
    const stored = JSON.parse(localStorage.getItem("lawleit.db.v2") ?? "{}");
    expect(stored.firm?.name).toBe("Kaul & Bhatnagar Associates");
    expect((stored.cases as unknown[]).length).toBeGreaterThan(0);
  });

  it("keeps the visitor's current session instead of rotating it", async () => {
    const { startDemoSession } = await import("@/lib/data/demo");
    const { mockAdapter } = await import("@/lib/data/mockAdapter");
    const mine = await mockAdapter.login("meera@kaulbhatnagar.example", "");
    const again = await startDemoSession();
    expect(again?.user.id).toBe(mine.user.id);
  });
});

describe("resetDemoData", () => {
  it("wipes local edits and re-seeds the pristine Demo Firm", async () => {
    const { mockAdapter } = await import("@/lib/data/mockAdapter");
    await mockAdapter.login("visitor@example.test", "");
    await mockAdapter.updateFirm({ name: "My Edited Firm" });
    const scratchCase = await mockAdapter.createCase({ title: "Scratch matter" });
    await mockAdapter.createTask({ title: "Scratch task" });
    await mockAdapter.createContact({ name: "Scratch contact" });

    const session = await mockAdapter.resetDemoData();

    expect(session.firm.name).toBe("Kaul & Bhatnagar Associates");
    expect(await mockAdapter.getCase(scratchCase.id)).toBeNull();
    expect((await mockAdapter.listCases()).some((c) => c.title === "Scratch matter")).toBe(false);
    expect((await mockAdapter.listTasks()).some((t) => t.title === "Scratch task")).toBe(false);
    expect((await mockAdapter.listContacts()).some((c) => c.name === "Scratch contact")).toBe(false);
  });

  it("persists the pristine seed for the visitor's next visit", async () => {
    const { mockAdapter } = await import("@/lib/data/mockAdapter");
    await mockAdapter.login("visitor@example.test", "");
    await mockAdapter.updateFirm({ name: "My Edited Firm" });
    await mockAdapter.createCase({ title: "Scratch matter" });
    await mockAdapter.resetDemoData();

    const stored = JSON.parse(localStorage.getItem("lawleit.db.v2") ?? "{}");
    expect(stored.firm?.name).toBe("Kaul & Bhatnagar Associates");

    // simulate the visitor returning later: a fresh adapter over the same storage
    vi.resetModules();
    const { mockAdapter: reloaded } = await import("@/lib/data/mockAdapter");
    await reloaded.login("visitor@example.test", "");
    expect((await reloaded.listUsers())[0].name).toBe("Arjun Kaul");
    expect((await reloaded.listCases()).some((c) => c.title === "Scratch matter")).toBe(false);
  });

  it("re-establishes the session so the visitor stays signed in", async () => {
    const { mockAdapter } = await import("@/lib/data/mockAdapter");
    await mockAdapter.login("visitor@example.test", "");
    await mockAdapter.resetDemoData();
    const session = await mockAdapter.getSession();
    expect(session?.firm.name).toBe("Kaul & Bhatnagar Associates");
    expect(session?.user.name).toBe("Arjun Kaul");
  });
});
