/* Feature sections (S8–S11): AI, lead management, case management, billing. */

export function PlayButton({ className = "" }: { className?: string }) {
  return (
    <span className={`flex h-16 w-24 items-center justify-center rounded-xl bg-neutral-900/85 ${className}`}>
      <svg viewBox="0 0 24 24" className="h-7 w-7 fill-white"><path d="M8 5v14l11-7z" /></svg>
    </span>
  );
}

const AI_THUMB_BG =
  "bg-[radial-gradient(130%_140%_at_18%_35%,#c22a52_0%,#8f2044_38%,#4d1430_68%,#330d22_100%)]";

function SectionText({
  title, body, bullets, cta, testid,
}: {
  title: React.ReactNode; body: string; bullets: string[]; cta: string; testid?: string;
}) {
  return (
    <div className="max-w-[560px]">
      <h2 className="font-display text-[40px] font-bold leading-[1.15] tracking-tight text-neutral-900">{title}</h2>
      <p className="mt-5 text-[16px] leading-relaxed text-neutral-800">{body}</p>
      <ul className="mt-7 space-y-3">
        {bullets.map((b) => (
          <li key={b} className="flex gap-3 text-[16px] text-neutral-800">
            <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-800" />
            {b}
          </li>
        ))}
      </ul>
      <button data-testid={testid} className="mt-9 rounded-full bg-lawleit px-7 py-3.5 text-[15px] font-bold text-white transition hover:bg-lawleit-dark">
        {cta}
      </button>
    </div>
  );
}

/* ---- S8: AI section ---- */

export function AiSection() {
  return (
    <section className="bg-[#fafaf8] py-24">
      <div className="mx-auto grid max-w-[1280px] grid-cols-[1fr_1.1fr] items-center gap-16 px-8">
        <div className={`relative h-[430px] overflow-hidden rounded-2xl ${AI_THUMB_BG}`}>
          <div className="absolute left-8 top-10 h-32 w-24 rotate-[-8deg] rounded-lg bg-[#f3e2d8] p-2 shadow-xl">
            <p className="text-[9px] font-bold text-neutral-600">Passport</p>
            <div className="mt-1 h-2 w-3/4 rounded bg-neutral-300" />
            <div className="mt-1 h-2 w-1/2 rounded bg-neutral-300" />
          </div>
          <div className="absolute bottom-14 left-24 h-36 w-28 rotate-[5deg] rounded-lg bg-[#efe6ee] p-2 shadow-xl">
            <p className="text-[9px] font-bold text-neutral-600">Deposition</p>
            <div className="mt-1 space-y-1">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-1.5 rounded bg-neutral-300" />)}
            </div>
          </div>
          <div className="absolute right-8 top-16 h-24 w-20 rotate-[10deg] rounded-lg bg-[#e7d9e4] p-2 shadow-xl">
            <p className="text-[9px] font-bold text-neutral-600">Exhibit C</p>
            <div className="mt-1 h-10 w-full rounded bg-neutral-300/70" />
          </div>
          <PlayButton className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>
        <div>
          <h2 className="font-display text-[40px] font-bold leading-[1.15] tracking-tight text-neutral-900">
            Work faster, with legal AI tools built into Lawleit
          </h2>
          <p className="mt-5 max-w-[560px] text-[16px] leading-relaxed text-neutral-800">
            Lawleit AI™ is built into Lawleit to support you with AI-assisted case management, image-based
            search with optical character recognition (OCR), contact and document review, and legal writing
            tools. No separate tools, copied client data, or context switching.
          </p>
          <button className="mt-8 rounded-full bg-lawleit px-7 py-3.5 text-[15px] font-bold text-white transition hover:bg-lawleit-dark">
            Explore Lawleit AI
          </button>
        </div>
      </div>
    </section>
  );
}

/* ---- S9: Lead management ---- */

export function LeadSection() {
  return (
    <section className="bg-[#fafaf8] pb-24">
      <div className="mx-auto grid max-w-[1280px] grid-cols-2 items-center gap-16 px-8">
        <SectionText
          title="Grow faster with lead management"
          body="Get a 360-degree view of your law firm's prospective client pipeline. Attorneys and staff can track leads from first contact through to signing, and see exactly where there's room to grow."
          bullets={[
            "Customize web-based client intake forms for any area of your practice",
            "Handle the client intake process from start to finish",
            "Easily automate the creation and signing of retainer agreements",
          ]}
          cta="Read more about lead management"
          testid="cta-lead-management"
        />
        <div className="space-y-5">
          <div className="rounded-2xl bg-white p-5 shadow-[0_18px_40px_-20px_rgba(15,23,42,0.25)] ring-1 ring-neutral-900/5">
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-bold text-neutral-900">Pipeline Management</p>
              <span className="rounded-full bg-[#e8f6f4] px-3 py-1 text-[10px] font-bold text-[#2c9c93]">This week</span>
            </div>
            <div className="mt-4 grid grid-cols-[1.2fr_1fr] gap-3">
              <div className="rounded-xl bg-[#fdf3ef] p-4">
                <p className="text-[11px] font-semibold text-neutral-600">Leads Added</p>
                <p className="text-4xl font-extrabold text-[#d96342]">134</p>
                <p className="text-[10px] font-semibold text-[#2c9c93]">↑ 12% vs last week</p>
                <svg viewBox="0 0 200 56" className="mt-2 w-full">
                  <path d="M0 48 C40 44 60 30 90 26 S150 18 200 6 L200 56 L0 56 Z" fill="#f0b7a2" opacity="0.5" />
                  <path d="M0 48 C40 44 60 30 90 26 S150 18 200 6" fill="none" stroke="#d96342" strokeWidth="2" />
                </svg>
                <div className="mt-2 flex items-center justify-between text-[9px] text-neutral-500">
                  <span>Converted to consult</span><span className="font-bold text-neutral-700">47%</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-neutral-200"><div className="h-1.5 w-[47%] rounded-full bg-[#d96342]" /></div>
              </div>
              <div className="space-y-3">
                {[
                  ["Consult Scheduled", "63", "↑ 8%"],
                  ["Leads Contacted", "23", "↓ 5%"],
                  ["Pending Fee & Agreement", "38", "↑ 3%"],
                ].map(([label, n, delta]) => (
                  <div key={label} className="rounded-xl border border-neutral-100 p-3">
                    <p className="text-[10px] text-neutral-500">{label}</p>
                    <div className="flex items-baseline justify-between">
                      <p className="text-xl font-extrabold text-neutral-900">{n}</p>
                      <p className={`text-[10px] font-semibold ${delta.startsWith("↑") ? "text-[#2c9c93]" : "text-[#d96342]"}`}>{delta}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow-[0_18px_40px_-20px_rgba(15,23,42,0.25)] ring-1 ring-neutral-900/5">
            <p className="text-[15px] font-bold text-neutral-400">Leads Over Time</p>
            <svg viewBox="0 0 480 150" className="mt-2 w-full">
              {[20, 50, 80, 110, 140].map((y) => <line key={y} x1="30" x2="470" y1={y} y2={y} stroke="#f0f0ee" strokeWidth="1" />)}
              <polyline points="40,90 110,40 180,70 250,35 320,55 390,30 460,45" fill="none" stroke="#6f6ce0" strokeWidth="2" />
              <polyline points="40,110 110,80 180,95 250,75 320,90 390,70 460,85" fill="none" stroke="#d98d8d" strokeWidth="2" />
              <polyline points="40,130 110,125 180,128 250,122 320,127 390,120 460,124" fill="none" stroke="#c9c8c5" strokeWidth="2" />
              {["Q1", "Q2", "Q3", "Q4"].map((q, i) => (
                <text key={q} x={40 + i * 140} y="146" fontSize="10" fill="#a3a29e">{q}</text>
              ))}
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---- S10: Case management ---- */

export function CaseSection() {
  return (
    <section className="bg-[#fafaf8] pb-24">
      <div className="mx-auto grid max-w-[1280px] grid-cols-2 items-center gap-16 px-8">
        <div className="space-y-5">
          <div className="rounded-2xl bg-white p-6 shadow-[0_18px_40px_-20px_rgba(15,23,42,0.25)] ring-1 ring-neutral-900/5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#d96342]">Case files</p>
            <div className="flex items-center justify-between">
              <p className="text-2xl font-bold text-neutral-900">Case documents</p>
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-500">Upload <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#d96342] text-[10px] font-bold text-white">42</span></span>
            </div>
            <p className="mt-1 text-[12px] font-semibold text-neutral-700">Browse by tags →</p>
            <table className="mt-4 w-full text-left text-[12px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-neutral-400">
                  <th className="pb-2 font-semibold">Title</th><th className="pb-2 font-semibold">Case</th>
                  <th className="pb-2 font-semibold">Assigned</th><th className="pb-2 font-semibold">Updated</th>
                </tr>
              </thead>
              <tbody className="text-neutral-700">
                {[
                  ["retainer.docx", "ABC vs. XYZ", "Feb 9, 2026", "Feb 9, 2026", true],
                  ["hwilllet.docx", "H. Wells accident", "Feb 9, 2026", "Feb 8, 2026", false],
                  ["prospect.pdf", "ABC vs. XYZ", "Feb 9, 2026", "Feb 2, 2026", false],
                ].map(([t, c, a, u, bold]) => (
                  <tr key={String(t)} className="border-t border-neutral-100">
                    <td className={`py-2.5 ${bold ? "font-bold" : ""} text-[#4c4cb8]`}>{t}</td>
                    <td className="py-2.5">{c}</td><td className="py-2.5">{a}</td><td className="py-2.5">{u}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-2xl bg-white p-6 shadow-[0_18px_40px_-20px_rgba(15,23,42,0.25)] ring-1 ring-neutral-900/5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#d96342]">Caseload</p>
            <p className="text-2xl font-bold text-neutral-900">Cases by stage</p>
            <div className="mt-5 space-y-4">
              {[
                ["Discovery", "14", "48%", "w-[48%]", "#d96342"],
                ["Consult", "8", "26%", "w-[26%]", "#e89877"],
                ["Court date pending", "7", "24%", "w-[24%]", "#f3c9b8"],
              ].map(([stage, n, pct, w, color]) => (
                <div key={String(stage)}>
                  <div className="flex items-baseline justify-between text-[12px]">
                    <span className="text-neutral-500">{stage}</span>
                    <span className="text-neutral-700">{n} <span className="text-neutral-400">{pct}</span></span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-neutral-100"><div className={`h-2 rounded-full ${w}`} style={{ background: String(color) }} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <SectionText
          title="Stay organized with legal case management"
          body="From calendaring and communications to document management and case reporting, keep track of every detail without falling behind."
          bullets={[
            "Stay in front of important deadlines with one centralized calendar",
            "Easily generate, edit, and access secure documents",
            "Connect with clients via a secure client portal, integrated text messaging, and event text reminders",
          ]}
          cta="Read more about case management"
          testid="cta-case-management"
        />
      </div>
    </section>
  );
}

/* ---- S11: Billing ---- */

export function BillingSection() {
  return (
    <section className="bg-[#fafaf8] pb-28">
      <div className="mx-auto grid max-w-[1280px] grid-cols-2 items-center gap-16 px-8">
        <SectionText
          title={<>Get paid faster with billing and payments, powered by LawleitPay</>}
          body="One solution for all your firm's billing and payment needs. Track time and simplify essential tasks from one convenient hub."
          bullets={[
            "Accept IOLTA-compliant credit card, eCheck, and mobile wallet payments",
            "Capture and find every billable minute with ease",
            "Take the stress out of invoicing and payment collection",
            "Understand firm performance with financial analytics reports",
          ]}
          cta="Learn more about billing & payments"
          testid="cta-billing"
        />
        <div className="space-y-5">
          <div className="rounded-2xl bg-white p-6 shadow-[0_18px_40px_-20px_rgba(15,23,42,0.25)] ring-1 ring-neutral-900/5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#d96342]">Billing</p>
            <p className="text-2xl font-bold text-neutral-900">Payment plan insights</p>
            <div className="mt-4 grid grid-cols-[1fr_1.3fr] gap-4">
              <div className="rounded-xl bg-[#fdf3ef] p-4">
                <p className="text-[10px] text-neutral-500">Planned payments</p>
                <p className="text-3xl font-extrabold text-neutral-900">$2,750</p>
                <div className="mt-3 flex h-16">
                  <div className="w-[62%] bg-[#d96342]" />
                  <div className="w-[38%] bg-[#f6ded4]" />
                </div>
                <div className="mt-1 flex text-[9px] font-semibold text-neutral-600">
                  <span className="w-[62%]">Autopay</span><span>Manual</span>
                </div>
              </div>
              <div>
                <p className="text-[10px] text-neutral-500">Payment installments over time</p>
                <svg viewBox="0 0 240 90" className="mt-1 w-full">
                  <polyline points="10,74 50,62 90,54 130,38 170,30 210,18 232,12" fill="none" stroke="#5a58c4" strokeWidth="2" />
                  <polyline points="10,80 50,72 90,66 130,56 170,50 210,42 232,36" fill="none" stroke="#d96342" strokeWidth="2" />
                  {[[10, 74], [90, 54], [170, 30], [232, 12]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.5" fill="#5a58c4" />)}
                  {[[10, 80], [90, 66], [170, 50], [232, 36]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.5" fill="#d96342" />)}
                </svg>
                <div className="mt-1 flex gap-4 text-[9px] text-neutral-600">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 bg-[#5a58c4]" /> Collected payments</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 bg-[#d96342]" /> Planned payments</span>
                </div>
              </div>
            </div>
          </div>
          <div className="rounded-2xl bg-white p-6 shadow-[0_18px_40px_-20px_rgba(15,23,42,0.25)] ring-1 ring-neutral-900/5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#d96342]">Billing</p>
            <div className="flex items-baseline justify-between">
              <p className="text-2xl font-bold text-neutral-900">Billing actions</p>
              <p className="text-[10px] text-neutral-400">Four taps, no context switching</p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[
                ["Add invoice", "M4 7h16v10H4zM8 7v10"],
                ["Add time entry", "M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0-4v3"],
                ["Record payment", "M4 12h16M12 4v16"],
                ["Deposit into trust", "M12 4l8 5-8 5-8-5zM4 14l8 5 8-5"],
              ].map(([label, d]) => (
                <div key={label} className="flex items-center justify-between rounded-xl border border-neutral-100 px-4 py-3">
                  <span className="flex items-center gap-2.5 text-[13px] font-semibold text-neutral-700">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="#4c4cb8" strokeWidth="1.8" strokeLinecap="round"><path d={d} /></svg>
                    {label}
                  </span>
                  <span className="text-neutral-300">→</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
