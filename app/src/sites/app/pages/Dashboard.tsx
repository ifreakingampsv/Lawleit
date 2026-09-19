import { Link, useOutletContext } from "react-router";
import { CalendarDays, MessageSquare, Plus, Timer } from "lucide-react";
import { api } from "@/lib/data";
import { money, hours, fmtDate, useAsync } from "@/lib/hooks";
import { Card, CardTitle, StatusPill } from "../ui";
import type { TimeEntry } from "@/lib/data";
import type { AppShellContext } from "../context";

const today = () => new Date().toISOString().slice(0, 10);

export default function Dashboard() {
  const { session } = useOutletContext<AppShellContext>();
  const { data: cases } = useAsync(() => api.listCases(), []);
  const { data: entries } = useAsync(() => api.listTimeEntries(), []);
  const { data: invoices } = useAsync(() => api.listInvoices(), []);
  const { data: events } = useAsync(() => api.listEvents({ from: today(), to: today() }), []);
  const { data: tasks } = useAsync(() => api.listTasks(), []);

  const user = session?.user;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const mine = (entries ?? []).filter((e) => e.userId === user?.id && e.date >= new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
  const billableMin = mine.filter((e) => e.billable).reduce((s, e) => s + e.minutes, 0);
  const nonBillableMin = mine.filter((e) => !e.billable).reduce((s, e) => s + e.minutes, 0);
  const billableTotal = mine.filter((e) => e.billable).reduce((s, e) => s + (e.minutes / 60) * e.rate, 0);
  const openCases = (cases ?? []).filter((c) => c.status === "open").length;
  const outstanding = (invoices ?? []).filter((i) => i.status === "sent" || i.status === "overdue")
    .reduce((s, i) => s + i.lines.reduce((t, l) => t + l.quantity * l.rate, 0), 0);
  const trustTotal = (cases ?? []).reduce((s, c) => s + c.trustBalance, 0);

  return (
    <div data-testid="dashboard" className="px-8 pb-12">
      {/* [S35] greeting row */}
      <div className="flex items-start justify-between pb-4 pt-6">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight text-neutral-900">
            {greeting}, {(user?.name ?? "").split(" ")[0]}!
          </h1>
          <p className="mt-0.5 text-[13.5px] text-neutral-500">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric, ".length ? "numeric" : "numeric", year: "numeric" })}
          </p>
        </div>
        <button className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-[13.5px] font-semibold text-neutral-700 hover:bg-neutral-50">
          ⚙ Customize
        </button>
      </div>

      {/* quick actions */}
      <Card className="mb-5 flex items-center gap-3 px-5 py-3.5">
        <span className="text-[13.5px] font-bold text-neutral-800">Quick actions</span>
        <QuickAction icon={<CalendarDays className="h-4 w-4" />} label="Add event" to="/app/calendar" />
        <QuickAction icon={<Plus className="h-4 w-4" />} label="Add task" to="/app/tasks" />
        <QuickAction icon={<MessageSquare className="h-4 w-4" />} label="New Message" to="/app/communications" />
        <QuickAction icon={<Timer className="h-4 w-4" />} label="Create time entry" to="/app/billing/time" />
      </Card>

      <div className="grid grid-cols-[1.6fr_1fr] gap-5">
        <div className="space-y-5">
          {/* timesheet totals */}
          <Card>
            <CardTitle right={<Link to="/app/billing/time" className="text-[13px] font-semibold text-lawleit hover:underline">Open timesheet</Link>}>
              Timesheet totals
            </CardTitle>
            <div className="grid grid-cols-[auto_1fr] gap-8 px-6 pb-6">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-neutral-500">Billable total</p>
                <p data-testid="dashboard-billable-total" className="text-[34px] font-extrabold tracking-tight text-neutral-900">{money(billableTotal)}</p>
                <p className="mt-0.5 text-[12.5px] text-neutral-500">
                  {hours(billableMin)} hrs billable · {hours(nonBillableMin)} hrs non-billable
                </p>
                <div className="mt-4 flex gap-1.5">
                  {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                    <div key={i} className="flex h-12 w-9 flex-col items-center justify-center rounded-lg border border-neutral-200 text-[10px] text-neutral-500">
                      <span>{d}</span>
                      <span className="text-[11px] font-bold text-neutral-800">{(i === 2 ? hours(billableMin) : (i * 1.7).toFixed(1))}</span>
                    </div>
                  ))}
                </div>
              </div>
              <table className="w-full self-center text-left text-[13.5px]">
                <thead>
                  <tr className="text-[11.5px] uppercase tracking-wide text-neutral-500">
                    <th className="pb-2 font-semibold">Period</th><th className="pb-2 font-semibold">Billable</th>
                    <th className="pb-2 font-semibold">Non-billable</th><th className="pb-2 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {([
                    { label: "Today", from: today() },
                    { label: "This week", from: new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10) },
                    { label: "This month", from: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10) },
                  ] as const).map(({ label, from }) => {
                    const es = mine.filter((e) => e.date >= from);
                    const b = es.filter((e) => e.billable).reduce((s, e) => s + e.minutes, 0);
                    const nb = es.filter((e) => !e.billable).reduce((s, e) => s + e.minutes, 0);
                    const total = es.filter((e) => e.billable).reduce((s, e) => s + (e.minutes / 60) * e.rate, 0);
                    return (
                      <tr key={label}>
                        <td className="py-2.5 font-semibold">{label}</td>
                        <td className="py-2.5">{hours(b)}</td>
                        <td className="py-2.5">{hours(nb)}</td>
                        <td className="py-2.5 text-right font-bold">{money(total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* time entries */}
          <Card>
            <CardTitle right={<Link to="/app/billing/time" className="text-[13px] font-semibold text-lawleit hover:underline">View all</Link>}>
              Time entries
            </CardTitle>
            <table className="w-full text-left text-[13.5px]">
              <tbody className="divide-y divide-neutral-100">
                {(entries ?? []).slice(0, 5).map((e) => (
                  <tr key={e.id}>
                    <td className="px-6 py-3">{e.description}</td>
                    <td className="py-3 text-neutral-500">{(cases ?? []).find((c) => c.id === e.caseId)?.number}</td>
                    <td className="py-3">{hours(e.minutes)} hrs</td>
                    <td className="py-3">{e.billable ? <StatusPill status="open" /> : <StatusPill status="closed" />}</td>
                    <td className="px-6 py-3 text-right font-semibold">{money((e.minutes / 60) * e.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* financial overview */}
          <Card>
            <CardTitle right={<span className="rounded-lg border border-neutral-200 px-2.5 py-1 text-[12px] text-neutral-600">All cases ▾</span>}>
              Financial overview
            </CardTitle>
            <div className="grid grid-cols-3 gap-4 px-6 pb-6">
              {[
                ["Outstanding invoices", money(outstanding), "/app/billing/invoices"],
                ["Trust account balance", money(trustTotal), "/app/accounting"],
                ["Open matters", String(openCases), "/app/cases"],
              ].map(([label, value, to]) => (
                <Link key={label} to={to} className="rounded-xl border border-neutral-100 bg-neutral-50/60 p-4 hover:border-lawleit/40">
                  <p className="text-[12px] font-semibold text-neutral-500">{label}</p>
                  <p data-testid="financial-overview-value" className="mt-1 text-[22px] font-extrabold text-neutral-900">{value}</p>
                </Link>
              ))}
            </div>
          </Card>
        </div>

        {/* right column: today agenda */}
        <div className="space-y-5">
          <Card>
            <CardTitle right={<span className="text-[12px] text-neutral-500">Day ▾</span>}>
              {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            </CardTitle>
            <div data-testid="dashboard-agenda" className="px-4 pb-5">
              {(events ?? []).length === 0 && <p className="px-2 py-6 text-center text-[13px] text-neutral-400">No events today</p>}
              {(events ?? []).map((ev) => (
                <div key={ev.id} className="mb-2 flex gap-3">
                  <div className="w-16 pt-1 text-right text-[12px] text-neutral-500">{ev.start}</div>
                  <div className="flex-1 rounded-lg px-3 py-2.5" style={{ background: `${ev.color}14`, borderLeft: `3px solid ${ev.color}` }}>
                    <p className="text-[13px] font-semibold text-neutral-900">{ev.title}</p>
                    {ev.location && <p className="text-[11.5px] text-neutral-500">{ev.location}</p>}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardTitle right={<Link to="/app/tasks" className="text-[13px] font-semibold text-lawleit hover:underline">All tasks</Link>}>
              My tasks
            </CardTitle>
            <div className="px-4 pb-4">
              {(tasks ?? []).filter((t) => t.status !== "done").slice(0, 6).map((t) => (
                <label key={t.id} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-neutral-50">
                  <input type="checkbox" className="h-4 w-4 rounded accent-lawleit" onChange={() => api.updateTask(t.id, { status: "done" })} />
                  <span className="flex-1 text-[13.5px] text-neutral-800">{t.title}</span>
                  <span className="text-[11.5px] text-neutral-400">{fmtDate(t.dueDate)}</span>
                </label>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function QuickAction({ icon, label, to }: { icon: React.ReactNode; label: string; to: string }) {
  return (
    <Link to={to} className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3.5 py-2 text-[13px] font-semibold text-neutral-700 hover:border-lawleit/50 hover:text-lawleit">
      {icon} {label}
    </Link>
  );
}
