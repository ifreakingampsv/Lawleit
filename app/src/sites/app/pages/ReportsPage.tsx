import { useState } from "react";
import { api } from "@/lib/data";
import { seedReports } from "@/lib/data/seed";
import { useAsync, money } from "@/lib/hooks";
import { Card, CardTitle } from "../ui";
import { cn } from "@/lib/utils";
import type { Case, Expense, Invoice, Lead, TimeEntry } from "@/lib/data";

export default function ReportsPage() {
  const { data: reports } = useAsync(() => api.listReports(), []);
  const { data: cases } = useAsync(() => api.listCases(), []);
  const { data: entries } = useAsync(() => api.listTimeEntries(), []);
  const { data: invoices } = useAsync(() => api.listInvoices(), []);
  const { data: leads } = useAsync(() => api.listLeads(), []);
  const { data: expenses } = useAsync(() => api.listExpenses(), []);
  const [active, setActive] = useState<string>("r1");

  const revenueByMonth = monthlyRevenue(invoices ?? []);
  const hoursByUser = hoursPerUser(entries ?? []);

  return (
    <div data-testid="reports-page" className="px-8 pb-12">
      <div className="pb-2 pt-6">
        <h1 className="text-[22px] font-bold tracking-tight text-neutral-900">Reports</h1>
        <p className="mt-0.5 text-[13px] text-neutral-500">Predefined firm analytics</p>
      </div>
      <div className="flex gap-6">
        <div className="w-56 shrink-0">
          <Card className="p-2">
            {(reports ?? []).map((r) => (
              <button
                key={r.id}
                data-testid={`report-${r.kind}`}
                onClick={() => setActive(r.id)}
                className={cn("w-full rounded-lg px-3 py-2.5 text-left text-[13.5px] font-medium",
                  active === r.id ? "bg-[#eeedfb] text-lawleit" : "text-neutral-700 hover:bg-neutral-50")}
              >
                {r.title}
              </button>
            ))}
          </Card>
        </div>
        <div className="min-w-0 flex-1 space-y-5">
          {active === "r1" && (
            <Card className="p-6">
              <CardTitle>Revenue by month (billed)</CardTitle>
              <div className="flex h-56 items-end gap-3 px-2">
                {revenueByMonth.map(([label, v]) => (
                  <div key={label} className="flex flex-1 flex-col items-center gap-2">
                    <span className="text-[11px] font-bold text-neutral-600">{money(v)}</span>
                    <div className="w-full rounded-t-lg bg-lawleit/80" style={{ height: `${Math.max(4, (v / Math.max(...revenueByMonth.map(([, x]) => x), 1)) * 170)}px` }} />
                    <span className="text-[11px] text-neutral-500">{label}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {active === "r2" && (
            <Card className="p-6">
              <CardTitle>Billable vs non-billable hours by timekeeper</CardTitle>
              <table className="w-full text-left text-[13.5px]">
                <thead><tr className="border-b border-neutral-200 text-[11.5px] uppercase text-neutral-500">
                  <th className="py-2">Timekeeper</th><th className="py-2">Billable hrs</th><th className="py-2">Non-billable hrs</th><th className="py-2 text-right">Billed value</th>
                </tr></thead>
                <tbody className="divide-y divide-neutral-100">
                  {hoursByUser.map(([name, bill, nonBill, value]) => (
                    <tr key={name}>
                      <td className="py-3 font-medium">{name}</td>
                      <td className="py-3">{bill.toFixed(1)}</td>
                      <td className="py-3">{nonBill.toFixed(1)}</td>
                      <td className="py-3 text-right font-bold">{money(value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          {active === "r3" && (
            <Card className="p-6">
              <CardTitle>Open cases by stage</CardTitle>
              <div className="space-y-3">
                {stageCounts(cases ?? []).map(([stage, n]) => (
                  <div key={stage}>
                    <div className="flex justify-between text-[13px]"><span className="capitalize text-neutral-700">{stage}</span><span className="font-bold">{n}</span></div>
                    <div className="mt-1 h-2.5 rounded-full bg-neutral-100">
                      <div className="h-2.5 rounded-full bg-lawleit" style={{ width: `${(n / Math.max((cases ?? []).length, 1)) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {active === "r4" && (
            <Card className="p-6">
              <CardTitle>Accounts receivable aging</CardTitle>
              <table className="w-full text-left text-[13.5px]">
                <thead><tr className="border-b border-neutral-200 text-[11.5px] uppercase text-neutral-500">
                  <th className="py-2">Invoice</th><th className="py-2">Status</th><th className="py-2 text-right">Balance</th>
                </tr></thead>
                <tbody className="divide-y divide-neutral-100">
                  {(invoices ?? []).filter((i) => i.status === "sent" || i.status === "overdue").map((i) => (
                    <tr key={i.id}>
                      <td className="py-3 font-medium">{i.number}</td>
                      <td className="py-3 capitalize">{i.status}</td>
                      <td className="py-3 text-right font-bold">{money(i.lines.reduce((s, l) => s + l.quantity * l.rate, 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          {active === "r5" && (
            <Card className="p-6">
              <CardTitle>Leads by source</CardTitle>
              <div className="flex h-52 items-end gap-3 px-2">
                {sourceCounts(leads ?? []).map(([source, n]) => (
                  <div key={source} className="flex flex-1 flex-col items-center gap-2">
                    <span className="text-[13px] font-bold">{n}</span>
                    <div className="w-full rounded-t-lg bg-[#3dbdb4]" style={{ height: `${(n / Math.max(...sourceCounts(leads ?? []).map(([, x]) => x), 1)) * 150}px` }} />
                    <span className="text-[11px] capitalize text-neutral-500">{source}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {active === "r6" && (
            <Card className="p-6">
              <CardTitle>Expenses by case</CardTitle>
              <table className="w-full text-left text-[13.5px]">
                <thead><tr className="border-b border-neutral-200 text-[11.5px] uppercase text-neutral-500">
                  <th className="py-2">Case</th><th className="py-2">Expenses</th><th className="py-2 text-right">Total</th>
                </tr></thead>
                <tbody className="divide-y divide-neutral-100">
                  {expenseByCase(expenses ?? [], cases ?? []).map(([number, n, total]) => (
                    <tr key={number}>
                      <td className="py-3 font-medium">{number}</td>
                      <td className="py-3">{n}</td>
                      <td className="py-3 text-right font-bold">{money(total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function monthlyRevenue(invoices: Invoice[]): [string, number][] {
  const map = new Map<string, number>();
  invoices.forEach((i) => {
    const m = i.issued.slice(0, 7);
    map.set(m, (map.get(m) ?? 0) + i.lines.reduce((s, l) => s + l.quantity * l.rate, 0));
  });
  return [...map.entries()].sort().map(([m, v]) => [
    new Date(`${m}-15`).toLocaleDateString("en-US", { month: "short" }), v,
  ]);
}

function hoursPerUser(entries: TimeEntry[]): [string, number, number, number][] {
  const map = new Map<string, { b: number; nb: number; v: number }>();
  entries.forEach((e) => {
    const cur = map.get(e.userId) ?? { b: 0, nb: 0, v: 0 };
    if (e.billable) { cur.b += e.minutes / 60; cur.v += (e.minutes / 60) * e.rate; } else { cur.nb += e.minutes / 60; }
    map.set(e.userId, cur);
  });
  return [...map.entries()].map(([id, x]) => [id === "u1" ? "Alex Reed" : id === "u2" ? "Maria Ortiz" : id === "u3" ? "Sam Whitfield" : id, x.b, x.nb, x.v]);
}

function stageCounts(cases: Case[]): [string, number][] {
  const map = new Map<string, number>();
  cases.filter((c) => c.status === "open").forEach((c) => map.set(c.stage, (map.get(c.stage) ?? 0) + 1));
  return [...map.entries()];
}

function sourceCounts(leads: Lead[]): [string, number][] {
  const map = new Map<string, number>();
  leads.forEach((l) => map.set(l.source, (map.get(l.source) ?? 0) + 1));
  return [...map.entries()];
}

function expenseByCase(expenses: Expense[], cases: Case[]): [string, number, number][] {
  const map = new Map<string, { n: number; total: number }>();
  expenses.forEach((x) => {
    const cur = map.get(x.caseId) ?? { n: 0, total: 0 };
    cur.n += 1; cur.total += x.amount;
    map.set(x.caseId, cur);
  });
  return [...map.entries()].map(([cid, x]) => [cases.find((c) => c.id === cid)?.number ?? cid, x.n, x.total]);
}
