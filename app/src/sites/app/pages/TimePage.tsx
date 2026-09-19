import { useEffect, useState } from "react";
import { api } from "@/lib/data";
import { useAsync, money, hours, fmtDate } from "@/lib/hooks";
import { Card, Modal, NewButton, PageHeader, Field, inputCls, Table } from "../ui";
import type { Expense, TimeEntry } from "@/lib/data";

export default function TimePage({ tab = "time" }: { tab?: "time" | "expenses" }) {
  const { data: entries, refetch } = useAsync(() => api.listTimeEntries(), []);
  const { data: expenses, refetch: refetchExp } = useAsync(() => api.listExpenses(), []);
  const { data: cases } = useAsync(() => api.listCases(), []);
  const { data: session } = useAsync(() => api.getSession(), []);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ caseId: "", date: new Date().toISOString().slice(0, 10), minutes: "60", description: "", amount: "100", category: "filing" });

  useEffect(() => {
    const handler = () => refetch();
    window.addEventListener("lawleit:time-logged", handler);
    return () => window.removeEventListener("lawleit:time-logged", handler);
  }, [refetch]);

  const isTime = tab === "time";
  const create = async () => {
    if (isTime) {
      await api.createTimeEntry({
        caseId: form.caseId || (cases ?? [])[0]?.id,
        date: form.date, minutes: Number(form.minutes) || 30,
        description: form.description || "Time entry",
        rate: (cases ?? []).find((c) => c.id === form.caseId)?.billableRate ?? 300,
        userId: session?.user.id,
        billable: true,
      });
      refetch();
    } else {
      await api.createExpense({
        caseId: form.caseId || (cases ?? [])[0]?.id,
        date: form.date, description: form.description || "Expense",
        amount: Number(form.amount) || 0, category: form.category as Expense["category"],
      });
      refetchExp();
    }
    setCreating(false);
  };

  const dayTotal = (entries ?? []).filter((e) => e.date === new Date().toISOString().slice(0, 10))
    .reduce((s, e) => s + (e.minutes / 60) * e.rate, 0);
  const weekTotal = (entries ?? []).filter((e) => e.date >= new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10))
    .reduce((s, e) => s + (e.minutes / 60) * e.rate, 0);

  return (
    <div data-testid={isTime ? "time-page" : "expenses-page"} className="px-8 pb-12">
      <PageHeader
        title={isTime ? "Time tracking" : "Expenses"}
        subtitle={isTime ? "Today: " + money(dayTotal) + " · This week: " + money(weekTotal) : "Advanced costs, billed back to clients"}
        actions={<NewButton testid={isTime ? "time-new" : "expense-new"} label={isTime ? "Add time entry" : "Add expense"} onClick={() => setCreating(true)} />}
      />
      {isTime ? (
        <Card>
          <Table head={["Date", "Case", "Description", "Hours", "Billable", "Rate", "Amount", ""]} testid="time-table">
            {(entries ?? []).map((e: TimeEntry) => (
              <tr key={e.id} className="hover:bg-neutral-50">
                <td className="px-6 py-3">{fmtDate(e.date)}</td>
                <td className="px-6 py-3 text-neutral-500">{(cases ?? []).find((c) => c.id === e.caseId)?.number}</td>
                <td className="px-6 py-3">{e.description}</td>
                <td className="px-6 py-3">{hours(e.minutes)}</td>
                <td className="px-6 py-3">{e.billable ? "Yes" : "No"}</td>
                <td className="px-6 py-3">{money(e.rate)}</td>
                <td className="px-6 py-3 font-semibold">{money((e.minutes / 60) * e.rate)}</td>
                <td className="px-6 py-3 text-right">
                  <button onClick={async () => { await api.deleteTimeEntry(e.id); refetch(); }} className="text-[12px] font-semibold text-red-500 hover:underline">Delete</button>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : (
        <Card>
          <Table head={["Date", "Case", "Description", "Category", "Billable", "Amount", ""]} testid="expenses-table">
            {(expenses ?? []).map((x) => (
              <tr key={x.id} className="hover:bg-neutral-50">
                <td className="px-6 py-3">{fmtDate(x.date)}</td>
                <td className="px-6 py-3 text-neutral-500">{(cases ?? []).find((c) => c.id === x.caseId)?.number}</td>
                <td className="px-6 py-3">{x.description}</td>
                <td className="px-6 py-3 capitalize">{x.category}</td>
                <td className="px-6 py-3">{x.billable ? "Yes" : "No"}</td>
                <td className="px-6 py-3 font-semibold">{money(x.amount)}</td>
                <td className="px-6 py-3 text-right">
                  <button onClick={async () => { await api.deleteExpense(x.id); refetchExp(); }} className="text-[12px] font-semibold text-red-500 hover:underline">Delete</button>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title={isTime ? "New time entry" : "New expense"} testid="time-modal">
        <div className="space-y-4">
          <Field label="Case">
            <select data-testid="time-case" className={inputCls} value={form.caseId} onChange={(e) => setForm({ ...form, caseId: e.target.value })}>
              {(cases ?? []).map((c) => <option key={c.id} value={c.id}>{c.number} — {c.title}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date"><input type="date" className={inputCls} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            {isTime
              ? <Field label="Minutes"><input data-testid="time-minutes" type="number" className={inputCls} value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} /></Field>
              : <Field label="Amount ($)"><input data-testid="expense-amount" type="number" className={inputCls} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>}
          </div>
          <Field label="Description"><input data-testid="time-description" className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          {!isTime && (
            <Field label="Category">
              <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {["filing", "travel", "copies", "expert", "other"].map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
          )}
          <button data-testid="time-save" onClick={create} className="w-full rounded-full bg-lawleit py-2.5 text-[14px] font-bold text-white hover:bg-lawleit-dark">Save</button>
        </div>
      </Modal>
    </div>
  );
}
