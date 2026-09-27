import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { startDemoSession } from "@/lib/data/demo";
import { CheckBadge } from "@/lib/brand";
import { formatINR, formatINR0 } from "@/lib/money";

const BULLETS = [
  "Capture every lead with customizable intake forms — no chasing details over email",
  "Build case documents from templates, auto-filled with what intake already collected",
  "Send retainers and agreements for signature, and see at a glance what's signed",
  "Ask Lawleit AI Case Assistant to summarize a file, build a timeline, or surface next steps",
];

/* ---------- drawn product-UI mockup states (rebrand: teal accents) ---------- */

function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl bg-white shadow-[0_18px_40px_-18px_rgba(15,23,42,0.25)] ring-1 ring-neutral-900/5 ${className}`}>
      {children}
    </div>
  );
}

function MiniBarChart({ teal = false }: { teal?: boolean }) {
  const bars = [38, 52, 30, 60, 44];
  return (
    <div className="flex h-16 items-end gap-1.5">
      {bars.map((b, i) => (
        <div
          key={i}
          className={`w-4 rounded-sm ${i % 2 ? (teal ? "bg-[#8fd8d2]" : "bg-[#b9b7ef]") : teal ? "bg-[#3dbdb4]" : "bg-[#6f6ce0]"}`}
          style={{ height: `${b}%` }}
        />
      ))}
    </div>
  );
}

function MiniLineChart() {
  return (
    <svg viewBox="0 0 120 44" className="h-16 w-full">
      <polyline points="4,36 26,26 48,30 70,16 92,20 116,8" fill="none" stroke="#3dbdb4" strokeWidth="2" />
      <polyline points="4,40 26,36 48,38 70,30 92,34 116,24" fill="none" stroke="#c9c8f2" strokeWidth="2" />
      {[[70, 16], [116, 8]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.6" fill="#3dbdb4" />
      ))}
    </svg>
  );
}

/** State A — billing collage (composition mirrors source: dominant card center-left) */
function VisualBilling() {
  return (
    <div className="relative h-full w-full">
      <Card className="absolute left-6 top-0 w-[345px] p-5">
        <p className="text-[16px] font-bold text-neutral-900">Batch billing setup</p>
        <p className="mt-1 text-[10px] text-neutral-500">Filter time/expense entries by date range:</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="rounded-full bg-[#3dbdb4] px-2 py-0.5 text-[9px] font-bold text-white">28 cases selected</span>
          <span className="flex-1 rounded-md border border-neutral-200 px-2 py-1 text-[10px] text-neutral-500">All time ▾</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[9px] text-neutral-500">
          <div>
            <p className="mb-1 font-semibold text-neutral-700">Invoice date</p>
            <div className="rounded-md border border-neutral-200 px-2 py-1.5">02/18/2026 ▾</div>
          </div>
          <div>
            <p className="mb-1 font-semibold text-neutral-700">Terms</p>
            <div className="rounded-md border border-neutral-200 px-2 py-1.5" />
          </div>
          <div>
            <p className="mb-1 font-semibold text-neutral-700">Payment terms</p>
            <div className="rounded-md border border-neutral-200 px-2 py-1.5">Net 30 ▾</div>
          </div>
          <div>
            <p className="mb-1 font-semibold text-neutral-700">Notes</p>
            <div className="rounded-md border border-neutral-200 px-2 py-1.5" />
          </div>
        </div>
      </Card>
      <Card className="absolute right-0 top-36 w-[230px] p-4">
        <p className="text-[12px] font-bold text-neutral-900">Payment plan insights</p>
        <p className="text-[8px] text-neutral-500">Planned payments · installments over time</p>
        <p className="mt-1 text-2xl font-extrabold text-neutral-900">{formatINR0(27500000)}</p>
        <div className="mt-1 flex items-end gap-2">
          <MiniBarChart teal />
          <div className="flex-1"><MiniLineChart /></div>
        </div>
      </Card>
      <Card className="absolute bottom-3 left-0 w-[235px] p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-[12px] font-bold text-neutral-900">Trust account overview</p>
          <span className="text-[8px] text-[#3dbdb4]">View activity</span>
        </div>
        <p className="text-[8px] text-neutral-400">Account balance</p>
        <p className="text-xl font-extrabold text-neutral-900">{formatINR(43000000)}</p>
        <div className="mt-2 flex gap-1.5">
          <div className="h-5 flex-1 rounded-full bg-[#3dbdb4]" />
          <div className="h-5 w-14 rounded-full bg-[#d9f3f0]" />
        </div>
      </Card>
      <Card className="absolute bottom-6 right-2 w-[230px] p-4">
        <p className="text-[12px] font-bold text-neutral-900">Smart time finder</p>
        <div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-x-2 gap-y-1.5 text-[8.5px] text-neutral-500">
          <span className="font-semibold text-neutral-700">Today's activities</span>
          <span className="font-semibold text-neutral-700">Case</span>
          <span />
          {[
            ["Court hearing", "Divorce"],
            ["Client consult", "Potential case"],
            ["Case update", "Roberts case"],
          ].map(([a, b]) => (
            <div key={a} className="col-span-3 flex items-center justify-between">
              <span>{a}</span>
              <span>{b}</span>
              <span className="rounded-full border border-[#3dbdb4] px-2 py-0.5 text-[7.5px] font-bold text-[#3dbdb4]">Track time</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/** State B — dashboard day view */
function VisualDashboard() {
  return (
    <Card className="mx-auto w-[420px] overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2">
        <span className="text-[10px] font-bold text-neutral-800">Lawleit</span>
        <div className="flex gap-1">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="h-1.5 w-6 rounded-full bg-neutral-200" />)}</div>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4">
        <div>
          <p className="mb-2 text-[10px] font-bold text-neutral-800">Today's events</p>
          {[
            ["9:00am", "Court hearing", "w-4/5"],
            ["11:00am", "Client meeting", "w-3/5"],
            ["1:00pm", "Case review", "w-2/3"],
          ].map(([t, label, w]) => (
            <div key={t} className="mb-2 flex items-center gap-2">
              <span className="w-10 shrink-0 text-[7.5px] text-neutral-400">{t}</span>
              <span className={`flex-1`}>
                <span className={`flex h-5 items-center rounded-sm bg-[#3dbdb4]/90 px-1.5 text-[7.5px] font-semibold text-white ${w}`}>{label}</span>
              </span>
            </div>
          ))}
          <p className="mt-3 mb-2 text-[10px] font-bold text-neutral-800">Cases by stage</p>
          {["Prospect", "Intake", "Discovery", "Negotiation", "Trial"].map((s, i) => (
            <div key={s} className="mb-1">
              <p className="text-[7px] text-neutral-400">{s}</p>
              <div className="h-1.5 rounded-full bg-neutral-100"><div className="h-1.5 rounded-full bg-[#6f6ce0]" style={{ width: `${70 - i * 11}%` }} /></div>
            </div>
          ))}
        </div>
        <div>
          <p className="mb-2 text-[10px] font-bold text-neutral-800">New communications</p>
          <div className="mb-3 grid grid-cols-3 gap-1.5 text-center">
            {[["💬", "4", "Tasks"], ["✉️", "12", "Messages"], ["📞", "2", "Calls"]].map(([e, n, l]) => (
              <div key={l} className="rounded-lg bg-neutral-50 p-1.5">
                <p className="text-[10px]">{e}</p>
                <p className="text-[13px] font-extrabold text-neutral-800">{n}</p>
                <p className="text-[7px] text-neutral-400">{l}</p>
              </div>
            ))}
          </div>
          <p className="mb-2 text-[10px] font-bold text-neutral-800">Alerts</p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1.5 text-[7.5px] text-red-700"><span className="h-2 w-2 rounded-full bg-red-500" /> Overdue invoice</div>
            <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[7.5px] text-amber-700"><span className="h-2 w-2 rounded-full bg-amber-500" /> Court date in 3 days</div>
            <div className="h-2 w-3/4 rounded-full bg-neutral-100" />
            <div className="h-2 w-2/3 rounded-full bg-neutral-100" />
            <div className="h-2 w-1/2 rounded-full bg-neutral-100" />
          </div>
        </div>
      </div>
    </Card>
  );
}

/** State C — dashboard + leads overlay */
function VisualLeads() {
  return (
    <div className="relative h-full w-full">
      <VisualDashboard />
      <Card className="absolute -right-2 bottom-0 w-[220px] p-4">
        <p className="text-[11px] font-bold text-neutral-900">Leads over time</p>
        <p className="mb-1 text-[8px] text-neutral-400">59</p>
        <MiniLineChart />
        <div className="mt-1 flex gap-2 text-[7px] text-neutral-500">
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#3dbdb4]" /> Added</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#c9c8f2]" /> Did not hire</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#6f6ce0]" /> Converted</span>
        </div>
      </Card>
    </div>
  );
}

/** State D — calendar board */
function VisualCalendar() {
  return (
    <Card className="mx-auto w-[420px] p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold text-neutral-800">Calendar — Week 38</span>
        <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-[7.5px] font-semibold text-neutral-500">Month ▾</span>
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => (
          <div key={d} className="rounded-lg bg-neutral-50 p-1.5">
            <p className="mb-1 text-[7.5px] font-bold text-neutral-500">{d}</p>
            {(d === "Mon" ? [["#3dbdb4", "9:00 Hearing"], ["#6f6ce0", "1:00 Intake"]] : d === "Wed" ? [["#4B4ACF", "11:00 Client"], ["#E0876A", "2:00 Depo"]] : d === "Fri" ? [["#3dbdb4", "10:00 Status"]] : []).map(([c, label]) => (
              <div key={String(label)} className="mb-1 h-6 rounded-sm px-1 py-1 text-[6.5px] font-semibold leading-tight text-white" style={{ background: String(c) }}>
                {label}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 rounded-lg border border-neutral-100 p-2">
        <p className="text-[8px] font-bold text-neutral-700">Upcoming deadlines</p>
        <div className="mt-1 h-2 w-4/5 rounded-full bg-neutral-100" />
        <div className="mt-1 h-2 w-3/5 rounded-full bg-neutral-100" />
      </div>
    </Card>
  );
}

const STATES = [VisualBilling, VisualDashboard, VisualLeads, VisualCalendar];

/** [D1] time-driven autoplay: crossfade between 4 product states every ~3s */
export default function Hero() {
  const [idx, setIdx] = useState(0);
  const [entering, setEntering] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    const t = window.setInterval(() => setIdx((i) => (i + 1) % STATES.length), 3000);
    return () => window.clearInterval(t);
  }, []);
  const Visual = STATES[idx] ?? VisualBilling;
  const enterDemo = async () => {
    setEntering(true);
    await startDemoSession();
    navigate("/app");
  };
  return (
    <section data-testid="hero" className="hero-grid-bg">
      <div className="mx-auto grid max-w-[1280px] grid-cols-[minmax(0,600px)_1fr] items-center gap-10 px-8 pb-24 pt-20">
        <div>
          <h1 className="font-display text-[58px] font-extrabold leading-[1.08] tracking-tight text-neutral-900">
            Legal practice management, all in one place
          </h1>
          <p className="mt-7 text-lg leading-relaxed text-neutral-800">
            Lawleit keeps cases, clients, documents, and billing together. Your team stops switching tabs to find things.
          </p>
          <ul className="mt-7 space-y-4">
            {BULLETS.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <CheckBadge className="mt-0.5 h-6 w-6 shrink-0" />
                <span className="text-[16px] leading-snug text-neutral-800">{b}</span>
              </li>
            ))}
          </ul>
          <div className="mt-10">
            <button
              data-testid="hero-explore-demo"
              onClick={enterDemo}
              disabled={entering}
              className="h-14 rounded-xl bg-lawleit px-9 text-[15px] font-bold text-white transition hover:bg-lawleit-dark disabled:opacity-60"
            >
              {entering ? "Opening the demo…" : "Explore demo"}
            </button>
            <p className="mt-2.5 text-[13px] text-neutral-600">No signup. No credit card. Your edits stay in your browser.</p>
          </div>
        </div>
        <div data-testid="hero-visual" className="relative h-[480px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -10, filter: "blur(6px)" }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="absolute inset-0"
            >
              <Visual />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
