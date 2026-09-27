import { useState } from "react";
import { Info } from "lucide-react";
import { formatINR0 } from "@/lib/money";

/* ---- Icon grid (S4) ---- */

const TILES = [
  { label: "Client intake forms", icon: "M9 3h8l4 4v14H9V3zm8 1v4h4", badge: true },
  { label: "Client portal", icon: "M4 7h16v10H4zM4 7l8 6 8-6" },
  { label: "Calendaring", icon: "M5 6h14v14H5zM5 10h14M9 4v4m6-4v4" },
  { label: "Document management", icon: "M10 4h6l4 4v12h-10zM14 4v5h5" },
  { label: "AI-assisted case management", icon: "M6 6l6-3 6 3-6 3zM6 12l6-3 6 3-6 3zM6 18l6-3 6 3-6 3z" },
  { label: "Time entry and expense tracking", icon: "M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0-4v3m0 14v0M4 12h2m12 0h2M12 9v4l2.5 2" },
  { label: "Billing and invoicing", icon: "M7 4h10v16H7zM10 8h4m-4 4h4m-4 4h2" },
  { label: "Payments, powered by LawleitPay", icon: "M4 8h16v9H4zM4 11h16M7 15h3" },
];

function TileIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-11 w-11" fill="none" stroke="#6f6ce0" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export function IconGrid() {
  return (
    <section className="bg-[#fafaf8] pb-16 pt-6">
      <div className="mx-auto max-w-[1280px] px-8">
        <div className="flex flex-wrap justify-center gap-3">
          {TILES.map((t) => (
            <div
              key={t.label}
              data-testid="feature-tile"
              className="relative flex h-[150px] w-[133px] flex-col items-center justify-center rounded-xl bg-[#f5f5f4] px-3 text-center"
            >
              <span className="absolute right-2 top-2 text-neutral-400"><Info className="h-3.5 w-3.5" /></span>
              <TileIcon d={t.icon} />
              <p className="mt-3 text-[14px] font-medium leading-tight text-neutral-800">{t.label}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-center">
          <div className="relative flex h-[150px] w-[133px] flex-col items-center justify-center rounded-xl bg-[#f5f5f4] px-3 text-center">
            <span className="absolute right-2 top-2 text-neutral-400"><Info className="h-3.5 w-3.5" /></span>
            <TileIcon d="M10 4h6l4 4v12h-10zM14 4v5h5M11 15l2 2 4-4" />
            <p className="mt-3 text-[14px] font-medium leading-tight text-neutral-800">Customizable financial reporting</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---- ROI calculator (S6) + [D3] ---- */

const SLIDERS = [
  { label: "Estimated monthly caseload*", min: 5, max: 200, step: 1, def: 60, fmt: (v: number) => `${v} cases` },
  { label: "Billable rate*", min: 50000, max: 1000000, step: 25000, def: 300000, fmt: (v: number) => formatINR0(v) },
  { label: "Clients billed monthly*", min: 5, max: 300, step: 1, def: 50, fmt: (v: number) => `${v} clients` },
  { label: "Time spent invoicing each client per month*", min: 0.25, max: 4, step: 0.25, def: 1, fmt: (v: number) => `${v} hour` },
  { label: "Overdue invoices*", min: 0, max: 150, step: 1, def: 50, fmt: (v: number) => `${v} invoices` },
] as const;

export function RoiCalculator() {
  const [values, setValues] = useState<number[]>(SLIDERS.map((s) => s.def));
  const [monthly, setMonthly] = useState(false);

  // Defaults (60 cases/₹3,000/50 clients/1h/50 overdue → ₹15,84,000 / 276 / 528 annually):
  // reclaimed hours/mo = 0.5·caseload + 0.2·clients + 0.08·overdue = 44
  // revenue = hours × rate × 12 ; more cases = 0.523 × hours × 12
  const hoursMo = 0.5 * values[0] + 0.2 * values[2] + 0.08 * values[4];
  const hours = monthly ? hoursMo : hoursMo * 12;
  const revenue = Math.round(hoursMo * values[1] * (monthly ? 1 : 12));
  const moreCases = Math.round(hoursMo * 0.523 * (monthly ? 1 : 12));

  return (
    <section className="lawleit-band-bg rounded-t-3xl pb-20 pt-14">
      <div className="mx-auto max-w-[1280px] px-8">
        <div data-testid="roi-card" className="relative mx-auto max-w-[1260px] rounded-3xl bg-white shadow-2xl">
          <div className="absolute -top-5 left-14 flex rounded-full bg-[#3f3cb0] p-1 shadow-lg">
            <button
              data-testid="roi-annually"
              onClick={() => setMonthly(false)}
              className={`rounded-full px-5 py-2 text-sm font-semibold transition ${!monthly ? "bg-white text-neutral-900" : "text-white/85"}`}
            >Annually</button>
            <button
              data-testid="roi-monthly"
              onClick={() => setMonthly(true)}
              className={`rounded-full px-5 py-2 text-sm font-semibold transition ${monthly ? "bg-white text-neutral-900" : "text-white/85"}`}
            >Monthly</button>
          </div>
          <div className="grid grid-cols-[1fr_1.05fr]">
            <div className="p-12 pr-8">
              <p className="text-xs font-bold uppercase tracking-widest text-[#4c4cb8]">Increase revenue by</p>
              <p data-testid="roi-revenue" className="mt-1 text-[44px] font-extrabold leading-none tracking-tight text-[#4c4cb8]">
                {formatINR0(revenue)}
              </p>
              <p className="mt-1 text-xs font-bold uppercase tracking-widest text-[#4c4cb8]">{monthly ? "Monthly" : "Annually"}*</p>
              <div className="my-6 border-t border-neutral-200" />
              <div className="flex items-center">
                <div className="flex-1">
                  <p className="text-xs font-bold uppercase tracking-widest text-[#4c4cb8]">Take on</p>
                  <p data-testid="roi-cases" className="text-4xl font-extrabold text-[#4c4cb8]">{moreCases}</p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#4c4cb8]">More cases</p>
                </div>
                <div className="mx-6 h-16 w-px bg-neutral-200" />
                <div className="flex-1">
                  <p className="text-xs font-bold uppercase tracking-widest text-[#4c4cb8]">Reclaim</p>
                  <p data-testid="roi-hours" className="text-4xl font-extrabold text-[#4c4cb8]">{Math.round(hours)}</p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#4c4cb8]">{monthly ? "Hours monthly" : "Hours annually"}</p>
                </div>
              </div>
              <button className="mt-8 rounded-full bg-[#3f3cb0] px-7 py-3.5 text-[15px] font-bold text-white transition hover:bg-[#35329a]">
                Start saving today
              </button>
            </div>
            <div className="rounded-3xl bg-[#eeedfb] p-10">
              {SLIDERS.map((s, i) => (
                <div key={s.label} className={i > 0 ? "mt-5" : ""}>
                  <div className="flex items-center justify-between text-[15px]">
                    <span className="flex items-center gap-1.5 text-neutral-800">
                      {s.label} <Info className="h-3.5 w-3.5 text-neutral-500" />
                    </span>
                    <span className="font-bold text-neutral-900">{s.fmt(values[i])}</span>
                  </div>
                  <input
                    data-testid={`roi-slider-${i}`}
                    type="range"
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    value={values[i]}
                    onChange={(e) => {
                      const next = [...values];
                      next[i] = Number(e.target.value);
                      setValues(next);
                    }}
                    className="roi-slider mt-2 w-full cursor-pointer bg-[#c9c7ec] accent-[#3f3cb0]"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-8 text-center text-[13px] text-white/85">
          *This information is reflected as estimates only and are not guaranteed. <a href="/coming-soon" className="font-semibold underline">Learn more</a>
        </p>
      </div>
    </section>
  );
}
