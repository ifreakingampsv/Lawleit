import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";

/**
 * Auth pages — mode-aware copy and submit error handling (ticket 20, items 4–5).
 *
 * The login helper paragraph is demo-only (ADR 0001): in http mode the "Mock
 * auth" line must not leak into the Production Version. Both auth submits must
 * fail visibly — an ApiError message passes through verbatim, a dropped fetch
 * (network/CORS/cold start) gets the retry hint — and the button must recover
 * so the user can retry, instead of hanging on its busy label forever.
 *
 * Same patterns as demoEntry.ui.test.ts: real App under MemoryRouter,
 * createElement (no JSX) to stay inside the tests/*.test.ts vitest glob.
 * Modules are reset per test so (a) each test gets a pristine mockAdapter and
 * (b) VITE_API_MODE can be stubbed before the data layer evaluates.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: { root: Root; container: HTMLElement }[] = [];

/** Fresh module registry — call AFTER any vi.stubEnv so the seam re-evaluates. */
async function freshApp() {
  vi.resetModules();
  const [{ default: App }, { mockAdapter }] = await Promise.all([
    import("@/App"),
    import("@/lib/data/mockAdapter"),
  ]);
  return { App, mockAdapter };
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

describe("login helper copy", () => {
  it("renders the Mock auth line in mock mode (demo stays zero-friction)", async () => {
    const { App } = await freshApp();
    const { container } = await renderAt(App, "/login");
    expect(testid(container, "login-form")).toBeTruthy();
    expect(container.textContent).toContain(
      "Mock auth: any email/password works — seeded demo firm loads.",
    );
  });

  it("renders no Mock auth line in http mode", async () => {
    vi.stubEnv("VITE_API_MODE", "http");
    const { App } = await freshApp();
    const { container } = await renderAt(App, "/login");
    expect(testid(container, "login-form")).toBeTruthy();
    expect(container.textContent).not.toContain("Mock auth");
  });
});

describe("login submit failures", () => {
  it("shows the busy label while pending, then the network hint and a re-enabled button", async () => {
    const { App, mockAdapter } = await freshApp();
    let rejectLogin!: (e: unknown) => void;
    vi.spyOn(mockAdapter, "login").mockImplementation(
      () => new Promise((_resolve, reject) => { rejectLogin = reject; }),
    );
    const { container } = await renderAt(App, "/login");

    await submitForm(container, "login-form");
    expect(button(container, "login-submit")?.disabled).toBe(true);
    expect(button(container, "login-submit")?.textContent).toBe("Signing in…");

    await act(async () => { rejectLogin(new TypeError("Failed to fetch")); });
    await until(() => !!testid(container, "login-error"), "error paragraph");
    expect(testid(container, "login-error")?.textContent).toBe(NETWORK_HINT);
    expect(button(container, "login-submit")?.disabled).toBe(false);
    expect(button(container, "login-submit")?.textContent).toBe("Log In");
  });

  it("surfaces the server's ApiError message verbatim", async () => {
    const { App, mockAdapter } = await freshApp();
    const { ApiError } = await import("@/lib/data");
    vi.spyOn(mockAdapter, "login")
      .mockRejectedValue(new ApiError(401, "Invalid email or password"));
    const { container } = await renderAt(App, "/login");

    await submitForm(container, "login-form");
    await until(() => !!testid(container, "login-error"), "error paragraph");
    expect(testid(container, "login-error")?.textContent).toBe("Invalid email or password");
    expect(button(container, "login-submit")?.disabled).toBe(false);
  });
});

describe("signup submit failures", () => {
  it("surfaces the ApiError message verbatim and re-enables the button", async () => {
    const { App, mockAdapter } = await freshApp();
    const { ApiError } = await import("@/lib/data");
    vi.spyOn(mockAdapter, "signup")
      .mockRejectedValue(new ApiError(409, "Email already registered"));
    const { container } = await renderAt(App, "/free-trial");

    await submitForm(container, "trial-form");
    await until(() => !!testid(container, "trial-error"), "error paragraph");
    expect(testid(container, "trial-error")?.textContent).toBe("Email already registered");
    expect(button(container, "trial-submit")?.disabled).toBe(false);
    expect(button(container, "trial-submit")?.textContent).toBe("Get Started");
  });

  it("shows the network hint on a dropped fetch", async () => {
    const { App, mockAdapter } = await freshApp();
    vi.spyOn(mockAdapter, "signup").mockRejectedValue(new TypeError("Failed to fetch"));
    const { container } = await renderAt(App, "/free-trial");

    await submitForm(container, "trial-form");
    await until(() => !!testid(container, "trial-error"), "error paragraph");
    expect(testid(container, "trial-error")?.textContent).toBe(NETWORK_HINT);
    expect(button(container, "trial-submit")?.disabled).toBe(false);
    expect(testid(container, "trial-error")?.getAttribute("role")).toBe("alert");
  });
});

describe("auth success paths are unchanged", () => {
  it("login navigates to the dashboard", async () => {
    const { App } = await freshApp();
    const { container } = await renderAt(App, "/login");
    await submitForm(container, "login-form");
    await until(() => !!testid(container, "dashboard"), "dashboard");
    expect(testid(container, "login-error")).toBeNull();
  });

  it("signup navigates to the dashboard with no error shown", async () => {
    const { App } = await freshApp();
    const { container } = await renderAt(App, "/free-trial");
    await submitForm(container, "trial-form");
    await until(() => !!testid(container, "dashboard"), "dashboard");
    expect(testid(container, "trial-error")).toBeNull();
  });
});
