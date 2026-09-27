import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Pause } from "lucide-react";
import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";
import EmailCapture from "./sections/EmailCapture";
import { cn } from "@/lib/utils";
import { formatINR0 } from "@/lib/money";

interface FeatureSectionSpec {
  title: string;
  sub: string;
  layout: "text-left" | "text-right" | "text-card-left" | "form-left" | "sign-left";
  cardTitle?: string;
  bullets?: { lead: string; text: string }[];
  visual: "intake" | "pipeline" | "donut-sign" | "donut-forms" | "invoice" | "docs";
}

export interface ProductSpec {
  slug: string;
  heroTitle: string;
  heroSub: string;
  bandTitle: string;
  faqTitle: string;
  ctaTitle: string;
  sections: FeatureSectionSpec[];
}

export const PRODUCTS: ProductSpec[] = [
  {
    slug: "client-intake-lead-management",
    heroTitle: "Streamline Lead Management & Client Intake",
    heroSub: "Create custom online intake forms with conditional logic. Collect eSignatures, track and manage leads, and deliver a client-centric experience—all in one platform.",
    bandTitle: "Scale Your Firm with Lead Management Software",
    faqTitle: "Lead Management Software FAQs",
    ctaTitle: "Streamline Legal Client Intake and Lead Management",
    sections: [
      { title: "Lead Management", sub: "Track, nurture, and convert every lead", layout: "text-left", visual: "pipeline",
        bullets: [
          { lead: "Pipeline Visibility.", text: "See every prospective client and where they stand, from first contact to signed fee agreement." },
          { lead: "Lead Source Tags.", text: "Know exactly which channels bring in business and double down on what works." },
          { lead: "Automated Follow-ups.", text: "Never let a lead go cold with reminders and templated outreach." },
          { lead: "One-Click Conversion.", text: "Turn a signed lead into a case, contact, and billing relationship in one click." },
        ] },
      { title: "Intake Forms", sub: "Collect accurate client information from the start", layout: "form-left", visual: "intake" },
      { title: "E-Signature", sub: "Make it easy for clients to sign documents electronically", layout: "sign-left", visual: "donut-sign",
        bullets: [
          { lead: "E-Signature.", text: "Add digital signature fields to documents and forms. Let clients sign, date, and initial via any device." },
          { lead: "Text Reminders.", text: "Send automated reminders to clients to sign via email and text." },
        ] },
      { title: "Fee Management", sub: "Collect consultation and retainer fees faster", layout: "form-left", visual: "invoice",
        bullets: [
          { lead: "Online Payments.", text: "Add payment links to your website, or generate invoices for new clients and send via text or email." },
          { lead: "Text Reminders.", text: "Send automated reminders to clients to pay via email and text." },
        ] },
    ],
  },
  {
    slug: "case-management",
    heroTitle: "Legal Case Management, All in One Place",
    heroSub: "Keep cases moving with centralized calendars, task assignments, secure documents, and real-time case reporting your whole firm can trust.",
    bandTitle: "Run Every Matter With Confidence",
    faqTitle: "Case Management Software FAQs",
    ctaTitle: "Bring Your Entire Firm Onto One Platform",
    sections: [
      { title: "Case Management", sub: "Every detail of every matter, organized", layout: "text-left", visual: "docs",
        bullets: [
          { lead: "Custom Case Fields.", text: "Model your practice areas with fields that fit how you actually work." },
          { lead: "Case Stages.", text: "Track matters from intake to resolution with stage pipelines and reporting." },
          { lead: "Assignments.", text: "Route work to the right teammate with roles, assignments, and notifications." },
          { lead: "Case Timelines.", text: "See a full history of every case event, note, and filing." },
        ] },
      { title: "Documents", sub: "Generate, store, and find secure documents", layout: "sign-left", visual: "docs" },
      { title: "Calendar", sub: "Never miss a deadline", layout: "text-left", visual: "pipeline" },
    ],
  },
  {
    slug: "client-communications",
    heroTitle: "Client Communication, Without the Chaos",
    heroSub: "Secure client portal, two-way texting, and email threads tied to matters — so every conversation stays in context.",
    bandTitle: "Communication That Clients Actually Love",
    faqTitle: "Client Communication Software FAQs",
    ctaTitle: "Put Every Client Conversation in One Place",
    sections: [
      { title: "Secure Messaging", sub: "Text and chat with clients, safely", layout: "text-left", visual: "pipeline",
        bullets: [
          { lead: "2-Way Texting.", text: "Message clients from your firm number; replies land in the case thread." },
          { lead: "Client Portal.", text: "Give clients a secure hub for messages, documents, invoices, and payments." },
          { lead: "Auto Reminders.", text: "Automated appointment and deadline reminders via text and email." },
          { lead: "Call Log.", text: "Track every inbound and outbound call against the right matter." },
        ] },
      { title: "Client Portal", sub: "A branded experience for your clients", layout: "sign-left", visual: "donut-forms" },
    ],
  },
  {
    slug: "billing-payments",
    heroTitle: "Billing & Payments That Get You Paid Faster",
    heroSub: "Track time, generate invoices, and accept IOLTA-compliant payments — all powered by LawleitPay.",
    bandTitle: "Billing Your Way, Payments on Autopilot",
    faqTitle: "Billing & Payments FAQs",
    ctaTitle: "Simplify Billing and Get Paid Faster",
    sections: [
      { title: "Time & Expenses", sub: "Capture every billable minute", layout: "text-left", visual: "invoice",
        bullets: [
          { lead: "Smart Time Finder.", text: "Suggests billable activities from your calendar, emails, and calls." },
          { lead: "Expense Tracking.", text: "Log advanced costs against matters and bill them back in one click." },
          { lead: "Batch Billing.", text: "Generate a month of invoices in minutes with billing presets." },
          { lead: "Evergreen Retainers.", text: "Automate replenishment requests when trust balances run low." },
        ] },
      { title: "Payments", sub: "IOLTA-compliant client payments", layout: "sign-left", visual: "donut-forms" },
    ],
  },
  {
    slug: "legal-ai",
    heroTitle: "Legal AI, Built Into Your Practice",
    heroSub: "Lawleit AI drafts, summarizes, searches, and surfaces next steps — with your case data, inside your workflow.",
    bandTitle: "An AI Assistant That Knows Your Cases",
    faqTitle: "Lawleit AI FAQs",
    ctaTitle: "Put AI to Work on Every Matter",
    sections: [
      { title: "Case Assistant", sub: "Answers grounded in your matters", layout: "text-left", visual: "docs",
        bullets: [
          { lead: "Summaries.", text: "Summarize long files, threads, and depositions in seconds." },
          { lead: "Timelines.", text: "Build chronological case timelines from documents automatically." },
          { lead: "Next Steps.", text: "Surface suggested actions based on deadlines and case activity." },
          { lead: "Writing Tools.", text: "Draft letters and emails in your firm's voice, ready to edit." },
        ] },
      { title: "OCR Search", sub: "Search every scanned page", layout: "sign-left", visual: "donut-sign" },
    ],
  },
  {
    slug: "financial-management",
    heroTitle: "Financial Management for Law Firms",
    heroSub: "Trust accounting, three-way reconciliation, and financial reporting — built for legal compliance.",
    bandTitle: "Know Your Numbers, Keep Your License Safe",
    faqTitle: "Financial Management FAQs",
    ctaTitle: "Take Control of Firm Financials",
    sections: [
      { title: "Trust Accounting", sub: "IOLTA compliance made simple", layout: "text-left", visual: "invoice",
        bullets: [
          { lead: "Three-Way Reconciliation.", text: "Bank, ledger, and client balances always agree." },
          { lead: "Safeguarding.", text: "Every rupee tagged to a client and matter, audit-ready." },
          { lead: "Reporting.", text: "Revenue, AR aging, and productivity reports out of the box." },
          { lead: "Accounting Sync.", text: "Optional Lawleit Accounting add-on for full general-ledger clarity." },
        ] },
      { title: "Reporting", sub: "Financial analytics, no spreadsheets", layout: "sign-left", visual: "donut-forms" },
    ],
  },
];

/* ---------- drawn product-UI visuals ---------- */

function Field({ label, value, placeholder }: { label: string; value?: string; placeholder?: string }) {
  return (
    <div>
      <p className="text-[11px] text-neutral-600">{label}</p>
      <div className="mt-1 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-[12px] text-neutral-500">
        {value ?? placeholder}
      </div>
    </div>
  );
}

function Visual({ kind }: { kind: FeatureSectionSpec["visual"] }) {
  if (kind === "intake")
    return (
      <div className="rounded-2xl border border-neutral-200 bg-[#f7faf8] p-7 shadow-sm">
        <p className="text-[17px] font-bold text-neutral-900">Immigration Intake</p>
        <div className="mt-2 h-px bg-neutral-200" />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="First Name" placeholder="John" />
          <Field label="Last Name" placeholder="Smith" />
          <Field label="Email Address" placeholder="john@myemail.com" />
          <Field label="Phone Number" placeholder="512-869-12.." />
        </div>
        <p className="mt-4 text-[12px] text-neutral-700">What's your passport number?</p>
        <div className="mt-1 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5" />
        <p className="mt-3 text-[12px] text-neutral-700">Do you have a social security number?</p>
        <div className="mt-1.5 flex gap-4 text-[12px] text-neutral-600">
          <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-full border border-neutral-400" /> Yes</span>
          <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-full border border-neutral-400" /> No</span>
        </div>
        <p className="mt-3 text-[12px] text-neutral-700">Are you a U.S. citizen?</p>
        <div className="mt-1.5 flex gap-4 text-[12px] text-neutral-600">
          <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-full border border-neutral-400" /> Yes</span>
          <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-full border border-neutral-400" /> No</span>
        </div>
        <p className="mt-3 text-[12px] text-neutral-700">What is your visa type?</p>
        <div className="mt-1.5 flex gap-4 text-[12px] text-neutral-600">
          {["B-1/B-2", "J-1", "F-1"].map((v) => (
            <span key={v} className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-full border border-neutral-400" /> {v}</span>
          ))}
        </div>
      </div>
    );
  if (kind === "pipeline")
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-7 shadow-sm">
        <p className="text-[17px] font-bold text-neutral-900">Forecasted Pipeline Value by Practice Area</p>
        <div className="mt-4 space-y-3">
          {[["Bankruptcy", 72, "#4B4ACF"], ["Family Law", 54, "#6f6ce0"], ["Personal Injury", 41, "#8f8ce0"], ["Estate Planning", 30, "#b7b5ef"]].map(([area, w, c]) => (
            <div key={String(area)}>
              <div className="flex justify-between text-[12px] text-neutral-600"><span>{area}</span><span className="font-semibold text-neutral-800">{formatINR0(Number(w) * 137000)}</span></div>
              <div className="mt-1 h-3 rounded-md bg-neutral-100"><div className="h-3 rounded-md" style={{ width: `${w}%`, background: String(c) }} /></div>
            </div>
          ))}
        </div>
      </div>
    );
  if (kind === "donut-sign" || kind === "donut-forms") {
    const data = kind === "donut-sign"
      ? { title: "eSignature Requests", total: "59", rows: [["29", "Pending", "#4B4ACF"], ["12", "Signed", "#3dbdb4"], ["18", "Unsent", "#c9c8f2"]] }
      : { title: "Intake Forms", total: "39", rows: [["19", "Sent", "#4B4ACF"], ["17", "Completed", "#3dbdb4"], ["3", "In Progress", "#e8674a"]] };
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-7 shadow-sm">
        <p className="text-[17px] font-bold text-neutral-900">{data.title}</p>
        <div className="mt-5 flex items-center gap-8">
          <div className="relative h-40 w-40">
            <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
              <circle cx="18" cy="18" r="14" fill="none" stroke="#eceafb" strokeWidth="6" />
              <circle cx="18" cy="18" r="14" fill="none" stroke="#4B4ACF" strokeWidth="6" strokeDasharray="45 88" strokeLinecap="butt" />
              <circle cx="18" cy="18" r="14" fill="none" stroke="#3dbdb4" strokeWidth="6" strokeDasharray="25 63" strokeDashoffset="-45" />
              <circle cx="18" cy="18" r="14" fill="none" stroke="#c9c8f2" strokeWidth="6" strokeDasharray="18 70" strokeDashoffset="-70" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-extrabold text-neutral-900">{data.total}</span>
              <span className="text-[10px] text-neutral-500">Total</span>
            </div>
          </div>
          <div className="flex-1 space-y-2.5">
            {data.rows.map(([n, label, c]) => (
              <div key={label} className="flex items-center justify-between rounded-lg bg-neutral-50 px-4 py-2.5">
                <span className="flex items-baseline gap-2">
                  <span className="text-xl font-extrabold" style={{ color: String(c) }}>{n}</span>
                  <span className="text-[12px] text-neutral-600">{label}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (kind === "invoice")
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-7 shadow-sm">
        <p className="text-[17px] font-bold text-neutral-900">Add Invoice</p>
        <div className="mt-2 h-px bg-neutral-200" />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Lead" placeholder="Cameron Chaloux" />
          <Field label="Invoice Date" value="03/15/2026" />
          <Field label="Invoice #" placeholder="10345623245678" />
          <Field label="Due Date" value="04/29/2026" />
        </div>
        <div className="mt-4 rounded-lg border border-neutral-200">
          <div className="flex justify-between border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] font-semibold text-neutral-600">
            <span>Description</span><span>Hours</span><span>Rate</span><span>Amount</span>
          </div>
          {[["Consultation re: estate plan", "1.5", "₹3,000", "₹4,500"], ["Draft retainer agreement", "1.0", "₹3,000", "₹3,000"]].map((r) => (
            <div key={String(r[0])} className="flex justify-between px-3 py-2 text-[12px] text-neutral-700">
              <span className="w-1/2">{r[0]}</span><span>{r[1]}</span><span>{r[2]}</span><span className="font-semibold">{r[3]}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <span className="rounded-full bg-neutral-100 px-4 py-1.5 text-[12px] font-semibold text-neutral-600">Cancel</span>
          <span className="rounded-full bg-lawleit px-4 py-1.5 text-[12px] font-semibold text-white">Send invoice</span>
        </div>
      </div>
    );
  // docs
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-7 shadow-sm">
      <p className="text-[17px] font-bold text-neutral-900">Documents</p>
      <div className="mt-4 space-y-2">
        {[["Retainer Agreement — Jones.docx", "84 KB"], ["Complaint — Jones v XYZ.pdf", "1.2 MB"], ["Discovery Responses Set B.docx", "310 KB"], ["Trust Instrument Draft.docx", "96 KB"]].map(([n, s]) => (
          <div key={n} className="flex items-center justify-between rounded-lg border border-neutral-100 px-4 py-2.5">
            <span className="text-[13px] font-medium text-[#4c4cb8]">{n}</span>
            <span className="text-[11px] text-neutral-400">{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- purple testimonial band + [D9] carousel ---------- */

const PRODUCT_QUOTES = [
  { quote: "Because of Lawleit, I have never been this busy. At the same time, I've never had things this under control.", name: "Aaron Feldman", firm: "Feldman Law Group" },
  { quote: "We signed up, imported everything, and were billing through Lawleit inside a week. It just works.", name: "Sarah Lindqvist", firm: "Lindqvist Law Office" },
  { quote: "Our intake capacity quadrupled. The forms do the chasing for us now.", name: "Victor Marsh", firm: "Marsh & Associates" },
];

export function ProductCarousel({ title }: { title: string }) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => setIdx((i) => (i + 1) % PRODUCT_QUOTES.length), 6000);
    return () => window.clearInterval(timer.current);
  }, [playing]);
  const q = PRODUCT_QUOTES[idx] ?? PRODUCT_QUOTES[0];
  return (
    <section className="px-6 py-16">
      <div className="lawleit-band-bg mx-auto max-w-[1392px] rounded-3xl px-14 py-16 text-white">
        <h2 className="text-center text-[32px] font-bold tracking-tight">{title}</h2>
        <div data-testid="product-carousel" className="mx-auto mt-10 max-w-[1100px] rounded-2xl bg-[#f0effb] px-16 py-12 text-center">
          <span className="text-6xl font-black leading-none text-[#4B4ACF]">"</span>
          <p key={idx} className="mx-auto mt-2 max-w-[820px] text-[26px] font-medium leading-snug text-[#3b3990]">{q.quote}</p>
          <div className="mt-7 flex items-center justify-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#4B4ACF]/15 text-sm font-bold text-[#4B4ACF]">{(q.name ?? "?").slice(0, 1)}</span>
            <span className="text-[14px]"><b className="text-neutral-900">{q.name}</b> <span className="text-neutral-500">/ {q.firm}</span></span>
          </div>
        </div>
        <div className="mt-8 flex items-center justify-center gap-3">
          <div className="flex items-center gap-2.5 rounded-full bg-white px-3.5 py-2 shadow">
            <button aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying((p) => !p)} className="text-neutral-800">
              <Pause className="h-3.5 w-3.5 fill-current" />
            </button>
            <div className="h-2.5 w-16 overflow-hidden rounded-full bg-neutral-200">
              <div className="h-full rounded-full bg-neutral-800 transition-all duration-500" style={{ width: `${((idx + 1) / PRODUCT_QUOTES.length) * 100}%` }} />
            </div>
            {PRODUCT_QUOTES.map((_, i) => (
              <button key={i} aria-label={`Quote ${i + 1}`} onClick={() => setIdx(i)} className={cn("h-2.5 rounded-full", i === idx ? "w-2.5 bg-neutral-800" : "w-2.5 bg-neutral-300")} />
            ))}
          </div>
          <button aria-label="Previous quote" onClick={() => setIdx((i) => (i - 1 + PRODUCT_QUOTES.length) % PRODUCT_QUOTES.length)} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/25 text-white hover:bg-white/40">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button data-testid="product-carousel-next" aria-label="Next quote" onClick={() => setIdx((i) => (i + 1) % PRODUCT_QUOTES.length)} className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-neutral-800 shadow hover:bg-neutral-100">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
    </section>
  );
}

/* ---------- template page ---------- */

function BulletList({ bullets }: { bullets: { lead: string; text: string }[] }) {
  return (
    <ul className="space-y-4">
      {bullets.map((b) => (
        <li key={b.lead} className="flex items-start gap-3">
          <span className="mt-0.5 flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-lawleit p-1">
            <Check className="h-3 w-3 text-white" strokeWidth={3.5} />
          </span>
          <span className="text-[15px] leading-relaxed text-neutral-800"><b className="font-bold">{b.lead}</b> {b.text}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ProductPage({ spec }: { spec: ProductSpec }) {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>
        {/* S25 hero */}
        <section className="px-8 pb-10 pt-16 text-center">
          <div className="mx-auto max-w-[900px]">
            <h1 className="font-display text-[54px] font-bold leading-[1.1] tracking-tight text-neutral-900">{spec.heroTitle}</h1>
            <p className="mx-auto mt-6 max-w-[780px] text-lg leading-relaxed text-neutral-800">{spec.heroSub}</p>
            <div className="mt-9 flex justify-center">
              <EmailCapture align="center" size="sm" />
            </div>
          </div>
          <div className="mx-auto mt-14 max-w-[1200px] rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
            <div className="grid grid-cols-3 gap-6 opacity-90">
              <Visual kind="intake" />
              <Visual kind="pipeline" />
              <Visual kind="donut-sign" />
            </div>
          </div>
        </section>

        {/* S26 feature sections with dashed connectors */}
        {spec.sections.map((s, i) => {
          const visual = <Visual kind={s.visual} />;
          const text = (
            <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-neutral-100">
              <h3 className="text-[22px] font-bold text-neutral-900">{s.cardTitle ?? s.title}</h3>
              <div className="mt-5">
                {s.bullets
                  ? <BulletList bullets={s.bullets} />
                  : <BulletList bullets={[
                      { lead: "Built-in.", text: `${s.title} comes standard on every Lawleit plan.` },
                      { lead: "Integrated.", text: `Connected to cases, contacts, and billing — no double entry.` },
                      { lead: "Customizable.", text: `Adapt ${s.title.toLowerCase()} to your practice in minutes.` },
                      { lead: "Supported.", text: `Our team migrates your existing data for you.` },
                    ]} />}
              </div>
              <div className="mt-7 flex items-center gap-6">
                <a href="/free-trial" className="rounded-full bg-lawleit px-6 py-3 text-[15px] font-bold text-white transition hover:bg-lawleit-dark">Try Lawleit free</a>
                <a href="/coming-soon" className="text-[15px] font-bold text-lawleit hover:underline">Learn more ›</a>
              </div>
            </div>
          );
          const textFirst = s.layout === "text-left" || s.layout === "sign-left";
          return (
            <div key={s.title}>
              <div className="mx-auto flex max-w-[1280px] items-center gap-6 px-8 pt-16">
                <div className="dashed-path flex-1" />
                <div className="flex items-center gap-3">
                  <span className="h-2 w-2 rounded-full bg-lawleit" />
                  <h2 className="text-[32px] font-bold tracking-tight text-neutral-900">{s.title}</h2>
                </div>
                <div className="dashed-path flex-1" />
              </div>
              <p className="mt-2 text-center text-[15px] text-neutral-600">{s.sub}</p>
              <div className="mx-auto grid max-w-[1280px] grid-cols-2 items-center gap-12 px-8 py-12">
                <div className={cn(textFirst && "order-2")}>{textFirst ? text : visual}</div>
                <div className={cn(!textFirst && "order-1")}>{textFirst ? visual : text}</div>
                {i === -1 && null}
              </div>
            </div>
          );
        })}

        {/* S30 purple testimonial band */}
        <ProductCarousel title={spec.bandTitle} />

        {/* S31 report band */}
        <section className="px-8 py-12">
          <div className="mx-auto grid max-w-[1180px] grid-cols-[1.3fr_1fr] items-center gap-10 rounded-2xl bg-white p-10 shadow-sm ring-1 ring-neutral-100">
            <div>
              <p className="text-[14px] font-bold text-neutral-800">2026 Legal Industry Trends Report</p>
              <h3 className="mt-1 text-2xl font-bold text-neutral-900">See how modern firms run a healthier practice</h3>
              <ul className="mt-4 space-y-2 text-[15px] text-neutral-700">
                {["Benchmarks for billing, realization, and lead conversion", "Tech adoption trends across practice areas", "What high-growth firms do differently"].map((b) => (
                  <li key={b} className="flex items-start gap-2.5">
                    <span className="mt-1 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-[#9fd8cd] p-0.5"><Check className="h-2.5 w-2.5 text-white" strokeWidth={4} /></span>
                    {b}
                  </li>
                ))}
              </ul>
              <a href="/coming-soon" className="mt-6 inline-block rounded-full bg-lawleit px-6 py-3 text-[15px] font-bold text-white hover:bg-lawleit-dark">Download the report</a>
            </div>
            <div className="flex justify-center">
              <div className="rotate-3 rounded-lg bg-[#28344a] p-4 shadow-xl">
                <div className="h-40 w-64 rounded bg-[#f6f4ef] p-3">
                  <p className="text-[10px] font-bold text-neutral-800">2026 Legal Industry</p>
                  <p className="text-[10px] font-bold text-neutral-800">Trends Report</p>
                  <div className="mt-2 flex h-16 items-end gap-1">
                    {[40, 65, 30, 80, 55].map((h, i) => <div key={i} className="w-4 rounded-sm bg-[#4B4ACF]" style={{ height: `${h}%` }} />)}
                  </div>
                  <div className="mt-2 h-1.5 w-3/4 rounded bg-neutral-300" />
                  <div className="mt-1 h-1.5 w-1/2 rounded bg-neutral-300" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* S32 product FAQ */}
        <section className="px-8 pb-8 pt-8">
          <div className="mx-auto max-w-[1180px]">
            <h2 className="font-display text-[32px] font-bold tracking-tight text-neutral-900">{spec.faqTitle}</h2>
            <ProductFaq slug={spec.slug} />
          </div>
        </section>

        {/* S33 CTA band */}
        <section className="px-6 pb-16 pt-8">
          <div className="lawleit-band-bg mx-auto max-w-[1392px] rounded-3xl px-14 py-16">
            <div className="mx-auto max-w-[1100px] rounded-3xl bg-[#f0effb] px-10 py-14 text-center">
              <h2 className="mx-auto max-w-[720px] font-display text-[40px] font-bold leading-tight tracking-tight text-[#3b3990]">{spec.ctaTitle}</h2>
              <div className="mt-8 flex justify-center">
                <EmailCapture align="center" size="sm" />
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

const FAQ_BY_SLUG: Record<string, { q: string; a: string }[]> = {
  default: [
    { q: "What is this software?", a: "Lawleit is an all-in-one legal practice management platform: case management, intake, billing, payments, documents, and client communication in one place." },
    { q: "Is there a free trial?", a: "Yes — 10 days with full access, no credit card required." },
    { q: "Can I migrate my existing data?", a: "Yes. Our onboarding team migrates cases, contacts, and documents from your current tools at no extra cost." },
    { q: "Is my data secure?", a: "Bank-grade encryption in transit and at rest, role-based access, and regular third-party audits." },
    { q: "What integrations are available?", a: "70+ integrations including calendars, email, accounting, and e-signature tools, plus an open API." },
  ],
};

function ProductFaq({ slug }: { slug: string }) {
  const items = FAQ_BY_SLUG[slug] ?? FAQ_BY_SLUG.default ?? [];
  const [open, setOpen] = useState(0);
  return (
    <div className="mt-8 space-y-4">
      {items.map((f, i) => (
        <div key={f.q} className="rounded-xl border-2 border-neutral-800/80 bg-white">
          <button data-testid={`faq-item-${i}`} onClick={() => setOpen(open === i ? -1 : i)} className="flex w-full items-center justify-between px-7 py-5 text-left">
            <span className="text-[19px] font-semibold text-neutral-900">{f.q}</span>
            <ChevronDown className={cn("h-5 w-5 text-lawleit transition-transform", open === i && "rotate-180")} />
          </button>
          {open === i && <p className="px-7 pb-6 text-[15px] leading-relaxed text-neutral-700">{f.a}</p>}
        </div>
      ))}
    </div>
  );
}
