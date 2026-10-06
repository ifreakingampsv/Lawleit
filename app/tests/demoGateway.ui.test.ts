import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";

/**
 * The Demo Version's simulated gateway (V2 slice 1, ticket 07): a visitor
 * collects via a payment link, "pays" on the /pay/:id sandbox checkout, and
 * the invoice updates through the SAME roll-up path as a manual record. The
 * failure toggle declines without recording, and a demo reset wipes every
 * link and payment back to the pristine seed.
 *
 * Same patterns as settingsInvite.ui.test.ts: real App under MemoryRouter,
 * createElement (no JSX) for the tests glob, modules reset per test, session
 * by direct login, `until()` polling over the mock adapter's async latency.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: { root: Root; container: HTMLElement }[] = [];

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

/** Poll until fn() holds — the mock adapter's async latency lands between acts. */
async function until(fn: () => boolean, what: string) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > 5000) throw new Error(`timed out waiting for ${what}: ${document.body.textContent?.slice(0, 400)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const testid = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-testid="${id}"]`);
const button = (container: HTMLElement, id: string) =>
  testid(container, id) as HTMLButtonElement | null;

async function click(el: HTMLElement, what: string) {
  if (!el) throw new Error(`missing element: ${what}`);
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

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

describe("the simulated gateway checkout (demo only)", () => {
  it("http mode renders the demo-only notice instead of a checkout", async () => {
    vi.stubEnv("VITE_API_MODE", "http");
    const { App, mockAdapter } = await freshApp();
    await mockAdapter.login("arjun@kaulbhatnagar.example", "demo");
    const { container } = await renderAt(App, "/pay/whatever");
    await until(() => !!testid(container, "mock-gateway-page"), "gateway page");
    expect(container.textContent).toContain("Demo Version only");
  });

  it("collect → pay on the sandbox page → the invoice updates through the roll-up", async () => {
    const { App, mockAdapter } = await freshApp();
    await mockAdapter.login("arjun@kaulbhatnagar.example", "demo");
    await mockAdapter.connectGatewayAccount({
      keyId: "rzp_test_DemoKey", keySecret: "secret", webhookSecret: "whsec",
    });
    const invoices = await mockAdapter.listInvoices();
    const invoice = invoices.find((i) => i.status !== "paid")!;
    const total = invoice.lines.reduce((s, l) => s + l.quantity * l.rate, 0);
    const paidBefore = (await mockAdapter.listPayments())
      .filter((p) => p.invoiceId === invoice.id && p.status !== "failed")
      .reduce((s, p) => s + p.amount, 0);
    const outstanding = total - paidBefore;

    const link = await mockAdapter.createPaymentLink(invoice.id);
    expect(link.status).toBe("active");
    expect(link.amount).toBe(outstanding);
    expect(link.shortUrl).toContain(`/pay/${link.id}`);

    const { container } = await renderAt(App, `/pay/${link.id}`);
    await until(() => !!testid(container, "pay-amount"), "checkout amount");
    expect(testid(container, "pay-amount")!.textContent).toContain("₹");
    await click(button(container, "pay-method-card")!, "card method");
    await click(button(container, "pay-now")!, "pay now");
    await until(() => !!testid(container, "pay-success"), "success screen");

    // The roll-up ran: enough "money" moved on the invoice — the demo seed's
    // link covers the full outstanding amount, so a draft lands on paid
    // directly (recording never auto-sends, and full payment marks paid).
    const after = (await mockAdapter.getInvoice(invoice.id))!;
    if (outstanding === total - paidBefore) {
      expect(after.status).toBe("paid");
    }
    expect((await mockAdapter.listPaymentLinks(invoice.id))[0]!.status).toBe("paid");
  });

  it("the failure toggle declines without recording anything", async () => {
    const { App, mockAdapter } = await freshApp();
    await mockAdapter.login("arjun@kaulbhatnagar.example", "demo");
    await mockAdapter.connectGatewayAccount({
      keyId: "rzp_test_DemoKey", keySecret: "secret", webhookSecret: "whsec",
    });
    const invoices = await mockAdapter.listInvoices();
    const invoice = invoices.find((i) => i.status !== "paid")!;
    const paymentsBefore = (await mockAdapter.listPayments()).length;

    const link = await mockAdapter.createPaymentLink(invoice.id);
    const { container } = await renderAt(App, `/pay/${link.id}`);
    await until(() => !!button(container, "pay-toggle-failure"), "failure toggle");
    await click(button(container, "pay-toggle-failure")!, "failure toggle");
    await click(button(container, "pay-now")!, "pay now");
    await until(() => !!testid(container, "pay-error"), "decline message");
    expect(testid(container, "pay-error")!.textContent).toContain("Payment failed");
    expect((await mockAdapter.listPayments()).length).toBe(paymentsBefore);
    expect((await mockAdapter.getPaymentLink(link.id))!.status).toBe("active");
  });

  it("reset demo data wipes every link and payment back to the pristine seed", async () => {
    const { App, mockAdapter } = await freshApp();
    await mockAdapter.login("arjun@kaulbhatnagar.example", "demo");
    const seededIds = new Set((await mockAdapter.listPayments()).map((p) => p.id));
    await mockAdapter.connectGatewayAccount({
      keyId: "rzp_test_DemoKey", keySecret: "secret", webhookSecret: "whsec",
    });
    const invoice = (await mockAdapter.listInvoices()).find((i) => i.status !== "paid")!;
    const link = await mockAdapter.createPaymentLink(invoice.id);
    await mockAdapter.payMockLink(link.id, "upi");
    expect((await mockAdapter.listPayments()).some((p) => !seededIds.has(p.id))).toBe(true);

    await mockAdapter.resetDemoData();
    expect(await mockAdapter.getPaymentLink(link.id)).toBeNull();
    expect(await mockAdapter.getGatewayAccount()).toMatchObject({ connected: false });
    // The seeded payments survive; the simulated one does not.
    expect((await mockAdapter.listPayments()).every((p) => seededIds.has(p.id))).toBe(true);
  });
});
