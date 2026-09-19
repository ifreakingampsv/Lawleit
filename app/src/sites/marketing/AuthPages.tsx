import { useState } from "react";
import { Link, useNavigate } from "react-router";
import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";
import { Logo, GemMark } from "@/lib/brand";
import { api } from "@/lib/data";

/** S: /login — card form on soft background */
export function LoginPage() {
  const [email, setEmail] = useState("alex@lawleit.legal");
  const [password, setPassword] = useState("demo");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await api.login(email, password);
    navigate("/app");
  };
  return (
    <div className="flex min-h-screen flex-col bg-[#f7f7f5]">
      <div className="px-6 pt-6"><Link to="/"><Logo /></Link></div>
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <form onSubmit={submit} data-testid="login-form" className="w-[420px] rounded-2xl bg-white p-10 shadow-xl">
          <h1 className="text-center text-2xl font-bold text-neutral-900">Welcome back</h1>
          <p className="mt-1 text-center text-sm text-neutral-500">Log in to your firm workspace</p>
          <label className="mt-7 block text-[13px] font-semibold text-neutral-700">
            Email address
            <input
              data-testid="login-email"
              type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3.5 py-2.5 text-[15px] outline-none focus:border-lawleit"
            />
          </label>
          <label className="mt-4 block text-[13px] font-semibold text-neutral-700">
            Password
            <input
              data-testid="login-password"
              type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3.5 py-2.5 text-[15px] outline-none focus:border-lawleit"
            />
          </label>
          <button
            data-testid="login-submit"
            disabled={busy}
            className="mt-6 w-full rounded-full bg-lawleit py-3 text-[15px] font-bold text-white transition hover:bg-lawleit-dark disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Log In"}
          </button>
          <p className="mt-4 text-center text-[13px] text-neutral-500">
            Mock auth: any email/password works — seeded demo firm loads.
          </p>
          <p className="mt-4 text-center text-[14px] text-neutral-700">
            New to Lawleit? <Link to="/free-trial" className="font-bold text-lawleit hover:underline">Start a free trial</Link>
          </p>
        </form>
      </div>
    </div>
  );
}

/** Mirrors the live site's free-trial modal page: form floating over a blurred app preview. */
export function FreeTrialPage() {
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", firmName: "",
    zip: "", employees: "3", phone: "", legal: "yes",
  });
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await api.signup({
      firstName: form.firstName, lastName: form.lastName, email: form.email,
      firmName: form.firmName, zip: form.zip, employees: Number(form.employees) || 1, phone: form.phone,
    });
    navigate("/app");
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#eef0f4]">
      {/* blurred product preview backdrop (drawn, not an image) */}
      <div className="pointer-events-none absolute inset-0 scale-105 blur-[10px]">
        <div className="flex h-full">
          <div className="w-[240px] shrink-0 bg-[#20202f] p-6">
            <Logo light size="sm" />
            <div className="mt-8 space-y-4">
              {["Home", "Calendar", "Tasks", "Cases", "Contacts", "Reports"].map((n) => (
                <div key={n} className="flex items-center gap-3 text-[15px] text-white/85"><GemMark size={16} className="text-white/50" />{n}</div>
              ))}
              <p className="pt-4 text-[11px] font-bold uppercase tracking-wider text-white/40">Modules</p>
              {["Billing", "Payments", "Accounting", "Documents", "Communications", "Leads"].map((n) => (
                <div key={n} className="text-[15px] text-white/85">{n}</div>
              ))}
            </div>
          </div>
          <div className="flex-1 bg-white/90 p-8">
            <div className="h-12 rounded-lg bg-neutral-100" />
            <div className="mt-8 h-8 w-72 rounded bg-neutral-200" />
            <div className="mt-8 grid grid-cols-3 gap-6">
              <div className="h-40 rounded-xl bg-neutral-100" />
              <div className="h-40 rounded-xl bg-neutral-100" />
              <div className="h-40 rounded-xl bg-neutral-100" />
            </div>
            <div className="mt-8 h-56 rounded-xl bg-neutral-100" />
          </div>
        </div>
      </div>

      {/* modal form */}
      <div className="relative flex min-h-screen items-center justify-center px-6 py-12">
        <form onSubmit={submit} data-testid="trial-form" className="w-[720px] rounded-2xl bg-white p-12 shadow-2xl">
          <h1 className="text-center text-[28px] font-bold tracking-tight text-[#28344a]">Try Lawleit free</h1>
          <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-5">
            {([
              ["First Name:", "firstName", "text", true],
              ["Last Name:", "lastName", "text", true],
              ["Email Address:", "email", "email", true],
              ["Firm Name:", "firmName", "text", true],
              ["Firm Zip Code:", "zip", "text", true],
              ["Number of Employees:", "employees", "number", false],
              ["Phone Number:", "phone", "tel", true],
            ] as const).map(([label, key, type, required]) => (
              <label key={key} className="block text-[14px] font-semibold text-[#28344a]">
                {label}
                <input
                  data-testid={`trial-${key}`}
                  type={type} required={required} value={form[key]} onChange={set(key)}
                  className="mt-1.5 h-11 w-full rounded-lg border border-neutral-300 px-3.5 text-[15px] outline-none focus:border-lawleit"
                />
              </label>
            ))}
            <div className="text-[14px] font-semibold text-[#28344a]">
              Are you a legal professional?
              <div className="mt-2.5 flex items-center gap-6 text-[15px] font-normal text-neutral-700">
                {[["yes", "Yes"], ["no", "No"]].map(([v, l]) => (
                  <label key={v} className="flex cursor-pointer items-center gap-2">
                    <input type="radio" name="legal" checked={form.legal === v} onChange={() => setForm((f) => ({ ...f, legal: v }))} className="h-4 w-4 accent-lawleit" />
                    {l}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <button
            data-testid="trial-submit"
            disabled={busy}
            className="mt-9 w-full rounded-full bg-lawleit py-4 text-lg font-bold text-white transition hover:bg-lawleit-dark disabled:opacity-60"
          >
            {busy ? "Creating your workspace…" : "Get Started"}
          </button>
          <p className="mt-4 text-center text-[13px] italic text-neutral-500">
            By submitting this form, you agree that Lawleit may collect and use your contact information to respond to your inquiry. You can unsubscribe at any time. See our Privacy Policy for more details.
          </p>
          <p className="mt-2 text-center text-[13px] text-neutral-600">10-day free trial. No credit card required.</p>
        </form>
      </div>
    </div>
  );
}

export function ScheduleDemoPage() {
  const [sent, setSent] = useState(false);
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="flex min-h-[70vh] items-center justify-center px-6 py-20">
        <div className="w-[520px] rounded-2xl bg-white p-10 shadow-lg">
          <h1 className="text-[28px] font-bold tracking-tight text-[#28344a]">Get a Demo</h1>
          <p className="mt-2 text-[15px] text-neutral-600">
            See how Lawleit runs your intake, cases, billing, and payments — in 30 minutes with a product specialist.
          </p>
          {sent ? (
            <div data-testid="demo-success" className="mt-8 rounded-xl bg-[#e9f5f0] p-5 text-[15px] font-semibold text-[#1d6e63]">
              Request received — our team will reach out within one business day.
            </div>
          ) : (
            <form
              className="mt-7 space-y-4"
              onSubmit={(e) => { e.preventDefault(); setSent(true); }}
            >
              <input data-testid="demo-name" required placeholder="Full name" className="h-12 w-full rounded-lg border border-neutral-300 px-4 text-[15px] outline-none focus:border-lawleit" />
              <input data-testid="demo-email" required type="email" placeholder="Work email" className="h-12 w-full rounded-lg border border-neutral-300 px-4 text-[15px] outline-none focus:border-lawleit" />
              <input data-testid="demo-firm" required placeholder="Firm name" className="h-12 w-full rounded-lg border border-neutral-300 px-4 text-[15px] outline-none focus:border-lawleit" />
              <button data-testid="demo-submit" className="w-full rounded-full bg-lawleit py-3.5 text-[15px] font-bold text-white hover:bg-lawleit-dark">
                Request Demo
              </button>
            </form>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

export function ComingSoonPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <GemMark size={44} className="text-lawleit" />
        <h1 className="mt-6 font-display text-4xl font-bold tracking-tight text-neutral-900">This page is on the roadmap</h1>
        <p className="mt-3 max-w-[520px] text-[16px] text-neutral-600">
          This section is part of the Lawleit clone base and is left as an integration point — wire it up or restyle it as you build on the platform.
        </p>
        <a href="/" className="mt-8 rounded-full bg-lawleit px-7 py-3 font-bold text-white hover:bg-lawleit-dark">Back to home</a>
      </main>
      <SiteFooter />
    </div>
  );
}
