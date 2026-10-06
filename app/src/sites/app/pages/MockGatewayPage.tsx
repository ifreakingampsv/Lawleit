import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api, apiMode } from "@/lib/data";
import { formatINR } from "@/lib/money";
import type { Payment, PaymentLink } from "@/lib/data";

/**
 * The Demo Version's simulated gateway checkout (V2 slice 1, ticket 07,
 * ADR 0001): a Razorpay-style hosted page a portfolio visitor "pays" on after
 * clicking a payment link created in the demo. It looks like the real thing
 * but moves no money — the pay action flows through the SAME mock
 * recordPayment path a manual record uses (roll-up included), and everything
 * it touches resets with "Reset demo data". Mock mode only: http mode renders
 * a notice, because a real checkout lives at the provider's domain, never
 * inside this app.
 */

const METHODS: { value: Payment["method"]; label: string; hint: string }[] = [
  { value: "upi", label: "UPI", hint: "Pay with any UPI app" },
  { value: "card", label: "Card", hint: "Credit or debit card" },
  { value: "netbanking", label: "Netbanking", hint: "All major banks" },
];

export default function MockGatewayPage() {
  const { id } = useParams();
  const [link, setLink] = useState<PaymentLink | null | "loading">( "loading");
  const [method, setMethod] = useState<Payment["method"]>("upi");
  const [failMode, setFailMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    let live = true;
    if (apiMode !== "mock") return;
    api
      .getPaymentLink(id!)
      .then((l) => { if (live) setLink(l); })
      .catch(() => { if (live) setLink(null); });
    return () => { live = false; };
  }, [id]);

  if (apiMode !== "mock") {
    return (
      <Shell>
        <p className="text-[14px] text-neutral-600">
          This simulated checkout exists in the Demo Version only. A real payment link opens
          at the gateway's own hosted page.
        </p>
      </Shell>
    );
  }

  if (link === "loading") {
    return <Shell><p className="text-[14px] text-neutral-500">Loading…</p></Shell>;
  }

  if (!link) {
    return (
      <Shell>
        <p className="text-[15px] font-bold text-neutral-900">Link not found</p>
        <p className="mt-1 text-[13.5px] text-neutral-500">
          This payment link does not exist — it may belong to a demo that was reset.
        </p>
      </Shell>
    );
  }

  if (paid || link.status === "paid") {
    return (
      <Shell>
        <div data-testid="pay-success" className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl">✓</div>
          <p className="mt-3 text-[16px] font-extrabold text-neutral-900">Payment successful</p>
          <p className="mt-1 text-[13.5px] text-neutral-500">
            {formatINR(link.amount)} paid via {method.toUpperCase()} — the invoice is updated.
          </p>
          <Link to="/app/billing/invoices" className="mt-5 inline-block rounded-full bg-lawleit px-6 py-2.5 text-[14px] font-bold text-white hover:bg-lawleit-dark">
            Return to Lawleit
          </Link>
        </div>
      </Shell>
    );
  }

  if (link.status !== "active") {
    return (
      <Shell>
        <p className="text-[15px] font-bold text-neutral-900">This link is {link.status}</p>
        <p className="mt-1 text-[13.5px] text-neutral-500">Ask the firm for a fresh payment link.</p>
      </Shell>
    );
  }

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      if (failMode) {
        setError("Payment failed — your bank declined the transaction. Try another method.");
        setFailMode(false);
        return;
      }
      const updated = await api.payMockLink(link.id, method);
      setLink(updated);
      setPaid(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div className="text-center">
        <p className="text-[11.5px] font-bold uppercase tracking-wider text-neutral-400">Secure checkout</p>
        <p className="mt-1 text-3xl font-extrabold tracking-tight text-neutral-900" data-testid="pay-amount">{formatINR(link.amount)}</p>
      </div>
      <div className="mt-5 space-y-2" data-testid="pay-methods">
        {METHODS.map((m) => (
          <button
            key={m.value}
            data-testid={`pay-method-${m.value}`}
            onClick={() => setMethod(m.value)}
            className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
              method === m.value ? "border-lawleit bg-lawleit/5" : "border-neutral-200 hover:border-neutral-300"
            }`}
          >
            <span>
              <span className="block text-[14px] font-bold text-neutral-900">{m.label}</span>
              <span className="block text-[12px] text-neutral-500">{m.hint}</span>
            </span>
            <span className={`h-4 w-4 rounded-full border-2 ${method === m.value ? "border-lawleit bg-lawleit" : "border-neutral-300"}`} />
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" data-testid="pay-error" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] font-semibold text-red-600">
          {error}
        </p>
      )}
      <button
        data-testid="pay-now"
        onClick={() => void pay()}
        disabled={busy}
        className="mt-5 w-full rounded-full bg-lawleit py-3 text-[15px] font-bold text-white hover:bg-lawleit-dark disabled:opacity-60"
      >
        {busy ? "Processing…" : `Pay ${formatINR(link.amount)}`}
      </button>
      <button
        data-testid="pay-toggle-failure"
        onClick={() => setFailMode(!failMode)}
        className="mt-3 w-full text-center text-[12px] font-semibold text-neutral-400 hover:text-neutral-600"
      >
        {failMode ? "Failure simulation ON — the next pay attempt is declined" : "Simulate a payment failure"}
      </button>
    </Shell>
  );
}

/** The Razorpay-ish hosted-page frame the simulated checkout sits in. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 px-4" data-testid="mock-gateway-page">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 flex items-center justify-center gap-2 border-b border-neutral-100 pb-4">
          <span className="text-[15px] font-extrabold tracking-tight text-lawleit">LawleitPay</span>
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10.5px] font-bold uppercase text-neutral-500">Sandbox</span>
        </div>
        {children}
      </div>
    </div>
  );
}
