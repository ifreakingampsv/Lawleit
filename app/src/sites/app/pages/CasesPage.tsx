import { Link, useSearchParams } from "react-router";
import { useState } from "react";
import { api } from "@/lib/data";
import { useAsync, money, fmtDate } from "@/lib/hooks";
import { Card, Modal, NewButton, PageHeader, Field, inputCls, StatusPill, Avatar, Table } from "../ui";
import type { Case } from "@/lib/data";

export default function CasesPage() {
  const { data: cases, refetch } = useAsync(() => api.listCases(), []);
  const { data: contacts } = useAsync(() => api.listContacts(), []);
  const [params] = useSearchParams();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | Case["status"]>("all");
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [form, setForm] = useState({ title: "", clientId: "", practiceArea: "Family Law", billableRate: "300", description: "" });

  const create = async () => {
    await api.createCase({
      title: form.title || "New matter",
      clientId: form.clientId || (contacts ?? [])[0]?.id,
      practiceArea: form.practiceArea,
      billableRate: Number(form.billableRate) || 300,
      description: form.description,
    });
    setCreating(false);
    refetch();
  };

  const list = (cases ?? []).filter((c) =>
    (statusFilter === "all" || c.status === statusFilter) &&
    `${c.title} ${c.number}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div data-testid="cases-page" className="px-8 pb-12">
      <PageHeader
        title="Cases"
        subtitle={`${(cases ?? []).filter((c) => c.status === "open").length} open · ${(cases ?? []).length} total`}
        actions={<NewButton testid="case-new" label="New case" onClick={() => setCreating(true)} />}
      />
      <div className="flex items-center gap-3 pb-4">
        <input
          data-testid="cases-search"
          value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search cases"
          className="h-9 w-[300px] rounded-lg bg-neutral-200/60 px-3.5 text-[13.5px] outline-none placeholder:text-neutral-400 focus:bg-white focus:ring-1 focus:ring-lawleit"
        />
        <select
          data-testid="cases-status-filter"
          value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="h-9 rounded-lg border border-neutral-200 bg-white px-3 text-[13px] font-semibold text-neutral-700"
        >
          {(["all", "open", "pending", "closed"] as const).map((s) => <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>)}
        </select>
      </div>
      <Card>
        <Table head={["Case", "Client", "Stage", "Status", "Open date", "Trust", "Rate"]} testid="cases-table">
          {list.map((c) => {
            const client = (contacts ?? []).find((x) => x.id === c.clientId);
            return (
              <tr key={c.id} className="hover:bg-neutral-50">
                <td className="px-6 py-3.5">
                  <Link data-testid="case-link" to={`/app/cases/${c.id}`} className="font-semibold text-lawleit hover:underline">
                    {c.number}
                  </Link>
                  <p className="text-neutral-800">{c.title}</p>
                </td>
                <td className="px-6 py-3.5">
                  <span className="flex items-center gap-2.5">
                    <Avatar name={client?.name ?? "?"} size="sm" />
                    {client?.name ?? "—"}
                  </span>
                </td>
                <td className="px-6 py-3.5 capitalize">{c.stage}</td>
                <td className="px-6 py-3.5"><StatusPill status={c.status} /></td>
                <td className="px-6 py-3.5">{fmtDate(c.openDate)}</td>
                <td className="px-6 py-3.5">{money(c.trustBalance)}</td>
                <td className="px-6 py-3.5">{money(c.billableRate)}/hr</td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Modal open={creating} onClose={() => setCreating(false)} title="New case" testid="case-modal">
        <div className="space-y-4">
          <Field label="Case title"><input data-testid="case-title" className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Client">
              <select data-testid="case-client" className={inputCls} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
                {(contacts ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Practice area">
              <select className={inputCls} value={form.practiceArea} onChange={(e) => setForm({ ...form, practiceArea: e.target.value })}>
                {["Family Law", "Personal Injury", "Estate Planning", "Business Law", "Immigration", "Criminal Defense"].map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Billable rate ($/hr)"><input type="number" className={inputCls} value={form.billableRate} onChange={(e) => setForm({ ...form, billableRate: e.target.value })} /></Field>
          <Field label="Description"><textarea className={inputCls} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <button data-testid="case-save" onClick={create} className="w-full rounded-full bg-lawleit py-2.5 text-[14px] font-bold text-white hover:bg-lawleit-dark">Create case</button>
        </div>
      </Modal>
    </div>
  );
}
