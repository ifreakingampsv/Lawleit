import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";

/**
 * Settings invite form (ticket 20, item 8) — the owner-only vertical slice
 * over POST /users.
 *
 * Owner sees the "Invite user" card, a successful invite adds the user to the
 * table with a confirmation line, members see no card at all, and failures
 * follow the auth-pages rule: server messages verbatim (role="alert"), a
 * dropped fetch gets the retry hint, and the button always recovers.
 *
 * Same patterns as authPages.ui.test.ts: real App under MemoryRouter,
 * createElement (no JSX) to stay inside the tests/*.test.ts vitest glob,
 * modules reset per test so each test gets a pristine mockAdapter and a
 * session established by direct login before the App renders.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: { root: Root; container: HTMLElement }[] = [];

async function freshApp() {
  vi.resetModules();
  const [{ default: App }, { mockAdapter }, { ApiError }] = await Promise.all([
    import("@/App"),
    import("@/lib/data/mockAdapter"),
    import("@/lib/data"),
  ]);
  return { App, mockAdapter, ApiError };
}

async function renderAt(App: (props: unknown) => unknown, path: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(App)));
  });
  roots.push({ root, container });
  return { root, container };
}

async function submitForm(container: HTMLElement, testid: string) {
  const form = container.querySelector(`[data-testid="${testid}"]`);
  if (!form) throw new Error(`missing [data-testid="${testid}"]`);
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

/** Set a controlled input/select value the way React tracks it, inside act. */
async function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
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

const testid = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-testid="${id}"]`);
const button = (container: HTMLElement, id: string) =>
  testid(container, id) as HTMLButtonElement | null;

const NETWORK_HINT =
  "Couldn't reach the server — it may be waking up. Try again in a moment.";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  while (roots.length) {
    const { root, container } = roots.pop()!;
    await act(async () => root.unmount());
    container.remove();
  }
});

describe("invite form visibility", () => {
  it("the owner sees the invite form", async () => {
    const { App, mockAdapter } = await freshApp();
    await mockAdapter.login("arjun@kaulbhatnagar.example", "demo"); // owner
    const { container } = await renderAt(App, "/app/settings");
    await until(() => !!testid(container, "settings-page"), "settings page");
    await until(() => !!testid(container, "invite-card"), "invite card");
    expect(testid(container, "invite-name")).toBeTruthy();
    expect(testid(container, "invite-email")).toBeTruthy();
    expect(testid(container, "invite-role")).toBeTruthy();
    expect(button(container, "invite-submit")?.textContent).toBe("Send invite");
  });

  it("a member does not see the invite form (owner-only)", async () => {
    const { App, mockAdapter } = await freshApp();
    await mockAdapter.login("fatima@kaulbhatnagar.example", "demo"); // paralegal
    const { container } = await renderAt(App, "/app/settings");
    await until(() => !!testid(container, "settings-page"), "settings page");
    await until(() => container.textContent!.includes("Firm users (8)"), "users table");
    expect(testid(container, "invite-card")).toBeNull();
    expect(testid(container, "invite-form")).toBeNull();
    // The users table itself is still there.
    expect(container.textContent).toContain("Firm users (8)");
  });
});

describe("invite submit", () => {
  it("inviting adds the user to the table, confirms, clears, and re-enables", async () => {
    const { App, mockAdapter } = await freshApp();
    await mockAdapter.login("arjun@kaulbhatnagar.example", "demo");
    const { container } = await renderAt(App, "/app/settings");
    await until(() => !!testid(container, "invite-card"), "invite card");

    await setValue(testid(container, "invite-name") as HTMLInputElement, "Kavya Iyer");
    await setValue(testid(container, "invite-email") as HTMLInputElement, "kavya@kaulbhatnagar.example");
    await setValue(testid(container, "invite-role") as HTMLSelectElement, "paralegal");
    await submitForm(container, "invite-form");

    await until(() => !!testid(container, "invite-sent"), "confirmation line");
    expect(testid(container, "invite-sent")?.textContent).toBe(
      "Invite sent — kavya@kaulbhatnagar.example will get a link to set their password.",
    );
    await until(() => container.textContent!.includes("Firm users (9)"), "users count");
    expect(container.textContent).toContain("Kavya Iyer");
    expect(container.textContent).toContain("kavya@kaulbhatnagar.example");
    expect((testid(container, "invite-name") as HTMLInputElement).value).toBe("");
    expect((testid(container, "invite-email") as HTMLInputElement).value).toBe("");
    expect((testid(container, "invite-role") as HTMLSelectElement).value).toBe("attorney");
    expect(button(container, "invite-submit")?.disabled).toBe(false);
    expect(button(container, "invite-submit")?.textContent).toBe("Send invite");
  });

  it("surfaces the server's ApiError message verbatim (role=alert) and recovers", async () => {
    const { App, mockAdapter, ApiError } = await freshApp();
    await mockAdapter.login("arjun@kaulbhatnagar.example", "demo");
    vi.spyOn(mockAdapter, "createUser")
      .mockRejectedValue(new ApiError(409, "Email already registered"));
    const { container } = await renderAt(App, "/app/settings");
    await until(() => !!testid(container, "invite-card"), "invite card");

    await setValue(testid(container, "invite-name") as HTMLInputElement, "Dupe Person");
    await setValue(testid(container, "invite-email") as HTMLInputElement, "meera@kaulbhatnagar.example");
    await submitForm(container, "invite-form");

    await until(() => !!testid(container, "invite-error"), "error line");
    expect(testid(container, "invite-error")?.textContent).toBe("Email already registered");
    expect(testid(container, "invite-error")?.getAttribute("role")).toBe("alert");
    expect(button(container, "invite-submit")?.disabled).toBe(false);
    expect(testid(container, "invite-sent")).toBeNull();
  });

  it("a dropped fetch shows the network hint and re-enables the button", async () => {
    const { App, mockAdapter } = await freshApp();
    await mockAdapter.login("arjun@kaulbhatnagar.example", "demo");
    vi.spyOn(mockAdapter, "createUser").mockRejectedValue(new TypeError("Failed to fetch"));
    const { container } = await renderAt(App, "/app/settings");
    await until(() => !!testid(container, "invite-card"), "invite card");

    await submitForm(container, "invite-form");
    await until(() => !!testid(container, "invite-error"), "error line");
    expect(testid(container, "invite-error")?.textContent).toBe(NETWORK_HINT);
    expect(button(container, "invite-submit")?.disabled).toBe(false);
  });
});
