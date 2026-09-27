import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import App from "@/App";

/**
 * Demo Version entry wiring — the click-path checks behind ticket 04.
 *
 * The adapter/util behavior lives in demoFlow.test.ts; here we mount the real
 * App with a MemoryRouter to verify the friction-free journey itself:
 * the Home hero CTA lands on the dashboard with no login form, deep links
 * auto-establish the session, and the Settings reset restores the pristine
 * Demo Firm. Uses createElement (no JSX) to stay inside the tests/*.test.ts
 * vitest include glob.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: { root: Root; container: HTMLElement }[] = [];

async function renderAt(path: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(App)));
  });
  roots.push({ root, container });
  return { root, container };
}

async function click(container: HTMLElement, testid: string) {
  const el = container.querySelector(`[data-testid="${testid}"]`);
  if (!el) throw new Error(`missing [data-testid="${testid}"]`);
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** Poll until fn() holds — the mock adapter's async latency lands between acts. */
async function until(fn: () => boolean, what: string) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > 5000) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const testid = (container: HTMLElement, id: string) => container.querySelector(`[data-testid="${id}"]`);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(async () => {
  while (roots.length) {
    const { root, container } = roots.pop()!;
    await act(async () => root.unmount());
    container.remove();
  }
});

describe("demo entry", () => {
  it("Home hero CTA 'Explore demo' reaches the dashboard with no login form", async () => {
    const { container } = await renderAt("/");
    await until(() => !!testid(container, "hero-explore-demo"), "hero CTA");
    expect(testid(container, "hero-explore-demo")?.textContent).toBe("Explore demo");

    await click(container, "hero-explore-demo");
    await until(() => !!testid(container, "dashboard"), "dashboard");
    expect(testid(container, "login-form")).toBeNull();
  });

  it("a deep link into the app auto-establishes the demo session", async () => {
    const { container } = await renderAt("/app/settings");
    await until(() => !!testid(container, "settings-page"), "settings page");
    expect(testid(container, "login-form")).toBeNull();
  });
});

describe("reset demo data (Settings)", () => {
  it("asks for confirmation, then restores the pristine Demo Firm", async () => {
    const { mockAdapter } = await import("@/lib/data/mockAdapter");
    await mockAdapter.login("visitor@example.test", "");
    await mockAdapter.updateFirm({ name: "My Edited Firm" });

    const { container } = await renderAt("/app/settings");
    await until(() => !!testid(container, "demo-data-card"), "demo data card");

    // first click arms the confirmation, nothing is wiped yet
    await click(container, "reset-demo");
    expect(testid(container, "reset-demo-confirm")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("lawleit.db.v2") ?? "{}").firm?.name).toBe("My Edited Firm");

    await click(container, "reset-demo-confirm");
    await until(
      () => JSON.parse(localStorage.getItem("lawleit.db.v2") ?? "{}").firm?.name === "Kaul & Bhatnagar Associates",
      "pristine re-seed",
    );
  });
});
