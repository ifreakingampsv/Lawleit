import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";
import { cn } from "@/lib/utils";

/* ---- S18/S19: hero + plan cards + [D5] billing toggle ---- */

const PLANS = [
  {
    name: "Lawleit Basic", accent: "", tagline: "Organize the essentials. Get paid faster.",
    saveAnnual: "Save $120/year", annual: 50, monthly: 60,
    cta: "outline",
    features: [
      "Case and Contact Management",
      "Time Entry, Invoicing and Trust Accounting",
      "Online Payments with Next-Day Deposits|New",
      "Customizable Reporting|New",
      "Unlimited Document Storage",
      "Client Portal (Limited)",
    ],
  },
  {
    name: "Lawleit Pro", accent: "text-lawleit", tagline: "Automate routine work. Scale the firm.",
    saveAnnual: "Save $240/year", annual: 100, monthly: 120, popular: true,
    cta: "solid",
    features: [
      "Everything in Basic",
      "Unlimited eSignature and Document Generation",
      "Automated Workflows",
      "Client Intake Forms and Legal CRM",
      "2-Way Texting, Chat, and Call Log",
      "Premium Billing, Invoicing, and Reporting",
      "Lawleit AI Writing and Document Assistant",
      "70+ Integrations",
    ],
  },
  {
    name: "Lawleit Advanced", accent: "", tagline: "Deeper intelligence. Sharper insights.",
    saveAnnual: "Save $240/year", annual: 130, monthly: 150,
    cta: "dark",
    features: [
      "Everything in Lawleit Pro",
      "Lawleit AI Case Assistant",
      "Lawleit AI Discovery Assistant (OCR)|New",
      "Advanced Document Automation",
      "Desktop Drive (PC & Mac)",
      "Conflict Check Tracking",
      "Split Billing",
      "Open API",
    ],
  },
];

function PlanCard({ plan, annual }: { plan: (typeof PLANS)[number]; annual: boolean }) {
  return (
    <div
      data-testid={`plan-${plan.name.split(" ")[1].toLowerCase()}`}
      className={cn(
        "relative rounded-t-2xl px-8 pb-8",
        plan.popular
          ? "bg-[#e9f5f0] shadow-2xl ring-1 ring-[#12333b]/10"
          : "bg-white/85 ring-1 ring-neutral-200/70",
      )}
    >
      {plan.popular && (
        <div className="absolute inset-x-0 -top-9 rounded-t-2xl bg-[#28344a] px-8 py-2.5 text-center text-[13px] font-semibold text-white">
          Most popular
        </div>
      )}
      <h3 className={cn("pt-10 text-[28px] font-bold tracking-tight", plan.accent || "text-[#28344a]")}>{plan.name}</h3>
      <p className="mt-1.5 text-[16px] text-neutral-600">{plan.tagline}</p>
      <div className="mt-5 inline-block rounded-md bg-[#f7ded4] px-2.5 py-1 text-[13px] font-semibold text-[#b0552f]">
        {annual ? plan.saveAnnual : "Billed monthly"}
      </div>
      <div className="mt-3 flex items-baseline gap-2.5">
        <span data-testid={`price-${plan.name.split(" ")[1].toLowerCase()}`} className="text-5xl font-extrabold tracking-tight text-[#28344a]">
          ${annual ? plan.annual : plan.monthly}
        </span>
        <span className="text-lg font-semibold text-neutral-400 line-through">
          ${annual ? plan.monthly : plan.annual}
        </span>
      </div>
      <p className="mt-1 text-[13px] text-neutral-500">USD/user/month</p>
      <button
        className={cn(
          "mt-5 w-full rounded-full py-3 text-[15px] font-bold transition",
          plan.cta === "outline" && "border-2 border-[#28344a] text-[#28344a] hover:bg-[#28344a] hover:text-white",
          plan.cta === "solid" && "bg-lawleit text-white hover:bg-lawleit-dark",
          plan.cta === "dark" && "bg-[#28344a] text-white hover:bg-[#1d2637]",
        )}
      >
        Try Lawleit free
      </button>
      <p className="mt-2 text-[13px] text-neutral-500">No credit card required</p>
      <div className="mt-6 border-t border-neutral-200 pt-5">
        <p className="text-[15px] font-bold text-neutral-900">What you get</p>
        <ul className="mt-3 space-y-2.5">
          {plan.features.map((f) => {
            const [label, badge] = f.split("|");
            return (
              <li key={label} className="flex items-start gap-2.5 text-[15px] text-neutral-800">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#9fd8cd]">
                  <Check className="h-3 w-3 text-white" strokeWidth={3} />
                </span>
                {label}
                {badge && <span className="rounded-md bg-[#f7ded4] px-1.5 py-0.5 text-[11px] font-bold text-[#b0552f]">{badge}</span>}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/* ---- S21: compare table + [D6] ---- */

const COMPARE_GROUPS = [
  {
    title: "Legal AI", icon: "✦",
    rows: [
      { name: "Lawleit AI Case Assistant", desc: "AI-powered case analysis and research assistant so you can get the answers you need quickly.", vals: ["—", "—", "✓"] },
      { name: "Lawleit AI Discovery Assistant", desc: "Image-based search across scanned documents with OCR.", vals: ["—", "—", "✓"] },
      { name: "Lawleit AI Writing Assistant", desc: "Draft letters, briefs and emails from case context.", vals: ["—", "✓", "✓"] },
      { name: "Lawleit AI Document Assistant", desc: "Summarize and review documents in place.", vals: ["—", "✓", "✓"] },
    ],
  },
  {
    title: "Case management",
    rows: [
      { name: "Case and contact management", desc: "Track every matter and relationship.", vals: ["✓", "✓", "✓"] },
      { name: "Custom fields", desc: "Model your practice's data.", vals: ["✓", "✓", "✓"] },
      { name: "Conflict check tracking", desc: "Flag conflicts before engagement.", vals: ["—", "—", "✓"] },
    ],
  },
  {
    title: "Billing & payments",
    rows: [
      { name: "Time tracking and billing", desc: "Capture every billable minute.", vals: ["✓", "✓", "✓"] },
      { name: "Split billing", desc: "Divide invoices across payers.", vals: ["—", "—", "✓"] },
      { name: "LawleitPay payments", desc: "IOLTA-compliant client payments.", vals: ["✓", "✓", "✓"] },
    ],
  },
];

export function CompareTable() {
  const [open, setOpen] = useState<string[]>(["Legal AI"]);
  const toggle = (t: string) => setOpen((o) => (o.includes(t) ? o.filter((x) => x !== t) : [...o, t]));
  return (
    <section className="py-20">
      <div className="mx-auto max-w-[1280px] px-8">
        <h2 className="text-center font-display text-[40px] font-bold tracking-tight text-[#28344a]">
          Compare all features
        </h2>
        <div className="mt-10 grid grid-cols-[1fr_repeat(3,180px)] items-center gap-4">
          <button
            data-testid="compare-expand-all"
            onClick={() => setOpen(open.length === COMPARE_GROUPS.length ? [] : COMPARE_GROUPS.map((g) => g.title))}
            className="flex items-center gap-1 text-[17px] font-bold text-[#28344a]"
          >
            {open.length === COMPARE_GROUPS.length ? "Collapse all" : "Expand all"}
            <ChevronDown className="h-4 w-4" />
          </button>
          {[
            ["Lawleit Basic", "outline"],
            ["Lawleit Pro", "solid"],
            ["Lawleit Advanced", "dark"],
          ].map(([name, kind]) => (
            <div key={name} className="text-center">
              <p className="text-[15px] font-bold text-[#28344a]">{name}</p>
              <button
                className={cn(
                  "mt-2 rounded-full px-5 py-1.5 text-[13px] font-bold",
                  kind === "outline" && "border border-[#28344a] text-[#28344a]",
                  kind === "solid" && "bg-lawleit text-white",
                  kind === "dark" && "bg-[#28344a] text-white",
                )}
              >Try free</button>
            </div>
          ))}
        </div>
        {COMPARE_GROUPS.map((group) => (
          <div key={group.title} className="mt-8">
            <button
              data-testid={`compare-group-${group.title.toLowerCase().replace(/[^a-z]+/g, "-")}`}
              onClick={() => toggle(group.title)}
              className="flex w-full items-center justify-between border-y border-neutral-200 py-4 text-left"
            >
              <span className="flex items-center gap-3 text-[19px] font-bold text-[#28344a]">
                <span className="text-lawleit">{group.icon}</span> {group.title}
              </span>
              <ChevronDown className={cn("h-5 w-5 text-neutral-500 transition-transform", open.includes(group.title) && "rotate-180")} />
            </button>
            {open.includes(group.title) && (
              <div>
                {group.rows.map((row) => (
                  <div key={row.name} className="grid grid-cols-[1fr_repeat(3,180px)] items-start gap-4 border-b border-neutral-100 py-4">
                    <div>
                      <button className="flex items-center gap-1.5 text-[15px] font-bold text-neutral-900">
                        <ChevronDown className="h-3.5 w-3.5 text-neutral-400" /> {row.name}
                      </button>
                      <p className="ml-5 mt-1 text-[13px] leading-relaxed text-neutral-500">{row.desc}</p>
                    </div>
                    {row.vals.map((v, i) => (
                      <div key={i} className="text-center text-[15px] text-neutral-700">{v === "—" ? <span className="text-neutral-300">—</span> : "✓"}</div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---- S23: customer stories + [D8] ---- */

const STORIES = [
  [
    { quote: "Lawleit has been a game changer for our practice. It allows us to keep track of every file in the same location and I am able to check on a file at any time, from anywhere.", name: "Marcy Tate", firm: "Tate & Ellis Law" },
    { quote: "Lawleit has freed me up so I can spend that extra time at the office on client development, which is what we're all trying to do anyway.", name: "Priya Nadel", firm: "Nadel Law Office" },
    { quote: "I can keep all my client communications in one easy-to-access location. The ability to send a client a quick text message is amazing, especially when clients are difficult to reach by phone.", name: "Gordon Reeves", firm: "Reeves Law Group" },
  ],
  [
    { quote: "Billing used to take our bookkeeper a full week each month. With Lawleit batch billing it's an afternoon, and collections are faster too.", name: "Dana Whitmore", firm: "Whitmore & Associates" },
    { quote: "The intake forms feed straight into our cases — no more retyping client details, no more lost checkboxes.", name: "Luis Ferrer", firm: "Ferrer Legal Group" },
    { quote: "Trust accounting finally feels safe. Every dollar is tagged to a matter and reconciles in minutes.", name: "Hannah Cole", firm: "Cole & Partners" },
  ],
];

export function Stories() {
  const [page, setPage] = useState(0);
  return (
    <section className="py-20">
      <div className="mx-auto max-w-[1280px] px-8">
        <p className="text-[15px] font-bold text-[#28344a]">Customer stories</p>
        <h2 className="mt-1 font-display text-[36px] font-bold tracking-tight text-[#28344a]">The proof is in their prosperity</h2>
        <div data-testid="stories-carousel" className="mt-10 grid grid-cols-3 gap-6">
          {STORIES[page]?.map((s) => (
            <div key={s.name} className="flex flex-col justify-between rounded-2xl bg-[#f3f2fc] p-8 ring-1 ring-neutral-200/60">
              <div>
                <span className="text-5xl font-black leading-none text-[#3dbdb4]">"</span>
                <p className="mt-3 text-[17px] leading-relaxed text-neutral-800">{s.quote}</p>
              </div>
              <div className="mt-8">
                <p className="text-[15px] font-bold text-neutral-900">{s.name}</p>
                <p className="text-[14px] text-neutral-500">{s.firm}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-8 flex items-center justify-end gap-4">
          <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 shadow-sm ring-1 ring-neutral-200">
            {STORIES.map((_, i) => (
              <button
                key={i}
                aria-label={`Stories page ${i + 1}`}
                onClick={() => setPage(i)}
                className={cn("h-2 rounded-full transition-all", i === page ? "w-8 bg-neutral-800" : "w-2 bg-neutral-300")}
              />
            ))}
          </div>
          <button aria-label="Previous stories" onClick={() => setPage((p) => Math.max(0, p - 1))} className="flex h-11 w-11 items-center justify-center rounded-full bg-[#28344a] text-white">
            <ChevronDown className="h-5 w-5 rotate-90" />
          </button>
          <button data-testid="stories-next" aria-label="Next stories" onClick={() => setPage((p) => Math.min(STORIES.length - 1, p + 1))} className="flex h-11 w-11 items-center justify-center rounded-full bg-[#28344a] text-white">
            <ChevronDown className="h-5 w-5 -rotate-90" />
          </button>
        </div>
      </div>
    </section>
  );
}

/* ---- S24: pricing FAQ + [D7] ---- */

const FAQS = [
  { q: "How many people can use Lawleit?", a: "While there is no limit to how many firm clients can access the Lawleit client portal, the number of firm employees who can use Lawleit will depend on the number of active firm users you have added to your account." },
  { q: "How safe and secure is my work?", a: "Lawleit safeguards your data with bank-grade encryption in transit and at rest, role-based access controls, and independent third-party audits of our infrastructure." },
  { q: "How much does Lawleit cost?", a: "Plans start at $50 per user/month billed annually. Every plan includes a 10-day free trial with full access — no credit card required." },
  { q: "What if I want to cancel my account?", a: "You can cancel anytime from firm settings. Your data remains exportable for 90 days after cancellation." },
];

export function Faq({ items = FAQS, title = "Frequently asked questions about pricing" }: { items?: { q: string; a: string }[]; title?: string }) {
  const [open, setOpen] = useState(0);
  return (
    <section className="pb-24 pt-10">
      <div className="mx-auto max-w-[1020px] px-8">
        <p className="text-center text-[15px] font-bold text-[#28344a]">FAQ</p>
        <h2 className="mt-1 text-center font-display text-[40px] font-bold tracking-tight text-[#28344a]">{title}</h2>
        <div className="mt-12">
          {items.map((f, i) => (
            <div key={f.q} className="border-t border-neutral-200 last:border-b">
              <button
                data-testid={`faq-item-${i}`}
                onClick={() => setOpen(open === i ? -1 : i)}
                className="flex w-full items-center justify-between py-6 text-left"
              >
                <span className="text-[20px] font-semibold text-neutral-900">{f.q}</span>
                <ChevronDown className={cn("h-5 w-5 text-[#c4552e] transition-transform", open === i && "rotate-180")} />
              </button>
              {open === i && <p className="pb-6 pr-12 text-[16px] leading-relaxed text-neutral-700">{f.a}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---- S20: enhancements ---- */

function CheckRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-[15px] text-neutral-800">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#9fd8cd]">
        <Check className="h-3 w-3 text-white" strokeWidth={3} />
      </span>
      {children}
    </li>
  );
}

export function Enhancements() {
  return (
    <section className="pb-8 pt-16">
      <div className="mx-auto max-w-[1020px] px-8 text-center">
        <p className="text-[15px] font-bold text-[#28344a]">Enhancements</p>
        <h2 className="mt-1 font-display text-[40px] font-bold tracking-tight text-[#28344a]">Your whole firm, fully connected</h2>
      </div>
      <div className="mx-auto mt-12 grid max-w-[1020px] grid-cols-2 divide-x divide-neutral-200 px-8">
        <div className="pr-12">
          <h3 className="text-[28px] font-bold text-[#28344a]">LawleitPay Payments</h3>
          <p className="mt-1 text-[16px] text-neutral-600">Faster payments, more control</p>
          <p className="mt-5 text-5xl font-extrabold text-[#28344a]">$0</p>
          <ul className="mt-6 space-y-3 text-left">
            <CheckRow>Simple, secure online payments making it easy for your clients to pay</CheckRow>
            <CheckRow>All your billing, payments, and cases fully integrated in one platform</CheckRow>
            <CheckRow>IOLTA trust account protection and compliance with ABA guidelines</CheckRow>
          </ul>
        </div>
        <div className="pl-12">
          <h3 className="text-[28px] font-bold text-[#28344a]">Lawleit Accounting</h3>
          <p className="mt-1 text-[16px] text-neutral-600">Full financial clarity, built right in</p>
          <p className="mt-5 text-5xl font-extrabold text-[#28344a]">$39</p>
          <ul className="mt-6 space-y-3 text-left">
            <CheckRow>Compliance with three way trust reconciliations</CheckRow>
            <CheckRow>Fewer tools and a holistic view of firm financials</CheckRow>
            <CheckRow>Real-time financial clarity whenever you need it</CheckRow>
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ---- S22: no-cost tiles ---- */

const NOCOST = [
  { title: "Guided implementation", icon: "M4 6h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4zM8 6v13M16 9h4v6h-4", body: "We'll guide you step-by-step, helping you configure the platform to meet your firm's specific needs. Whether it's importing your existing data, customizing workflows, or setting up essential features, we're here to make the process easy and efficient." },
  { title: "Training sessions", icon: "M8 9a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm8 0a3 3 0 1 1 0-6 3 3 0 0 1 0 6zM2 20v-1a5 5 0 0 1 5-5m10 0a5 5 0 0 1 5 5v1", body: "Our hands-on training sessions cover everything from the basics to advanced tips and tricks, ensuring every team member is equipped to maximize the platform's potential. Learn how to save time, stay organized, and enhance collaboration with live, interactive sessions designed to fit your schedule." },
  { title: "Award-winning support", icon: "M12 20l-7-7a4.5 4.5 0 1 1 7-5.6A4.5 4.5 0 1 1 19 13l-7 7zM12 20V9", body: "We don't just provide software—we deliver peace of mind. Our award-winning support team offers fast, personalized solutions to help your firm succeed, from onboarding to workflow optimization. With industry-leading response times and legal expertise, we're here when you need us." },
  { title: "Ongoing updates", icon: "M12 4l8 5-8 5-8-5zM4 14l8 5 8-5M4 17l8 5 8-5", body: "At Lawleit, innovation never stops. We're constantly improving and expanding our platform to meet the evolving needs of law firms like yours. From introducing new integrations and streamlining workflows to enhancing security and performance, every update is designed to make managing your practice easier and more efficient." },
];

export function NoCostTiles() {
  return (
    <section className="py-16">
      <div className="mx-auto max-w-[1180px] px-8">
        <h2 className="text-center font-display text-[36px] font-bold tracking-tight text-[#28344a]">
          Enjoy these features at no additional cost
        </h2>
        <div className="mt-12 grid grid-cols-2 gap-x-16 gap-y-12">
          {NOCOST.map((t) => (
            <div key={t.title}>
              <svg viewBox="0 0 24 24" className="h-11 w-11" fill="#4aa9a0"><path d={t.icon} /></svg>
              <h3 className="mt-4 text-2xl font-bold text-[#28344a]">{t.title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-neutral-600">{t.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function PricingPage() {
  const [annual, setAnnual] = useState(true);
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="pricing-hero-bg">
        <section className="pt-16">
          <div className="mx-auto max-w-[1280px] px-8 text-center">
            <p className="text-[16px] font-bold text-[#28344a]">Lawleit Plans</p>
            <h1 className="mt-2 font-display text-[44px] font-bold tracking-tight text-[#28344a]">
              Everything you need to run your firm
            </h1>
            <p className="mt-5 text-lg text-neutral-700">Start your free trial. Full access. No credit card required.</p>
            <div data-testid="billing-toggle" className="mt-8 flex items-center justify-center gap-4">
              <span className="text-[15px] font-bold text-neutral-900">Bill me:</span>
              <label className="flex cursor-pointer items-center gap-2 text-[15px] font-medium text-neutral-800">
                <input type="radio" checked={annual} onChange={() => setAnnual(true)} className="h-4 w-4 accent-[#28344a]" />
                Annually
                <span className={cn("rounded-md px-2 py-0.5 text-[13px] font-bold", annual ? "bg-[#f7ded4] text-[#b0552f]" : "bg-neutral-100 text-neutral-500")}>
                  Save up to 16%
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[15px] font-medium text-neutral-800">
                <input type="radio" checked={!annual} onChange={() => setAnnual(false)} className="h-4 w-4 accent-[#28344a]" />
                Monthly
              </label>
            </div>
          </div>
          <div className="mx-auto mt-16 grid max-w-[1280px] grid-cols-3 gap-6 px-8 pb-4">
            {PLANS.map((p) => <PlanCard key={p.name} plan={p} annual={annual} />)}
          </div>
          <div className="pb-6 pt-10 text-center">
            <a href="#compare" className="text-[19px] font-bold text-[#28344a] hover:underline">Compare all features ↓</a>
          </div>
        </section>
        <Enhancements />
        <NoCostTiles />
        <div id="compare"><CompareTable /></div>
        <Stories />
        <Faq />
      </main>
      <SiteFooter />
    </div>
  );
}
