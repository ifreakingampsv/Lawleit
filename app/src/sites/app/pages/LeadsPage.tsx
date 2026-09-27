import { useState } from "react";
import { api } from "@/lib/data";
import { useAsync, fmtDate } from "@/lib/hooks";
import { formatINR0, rupeesToPaise } from "@/lib/money";
import { Card, Modal, NewButton, PageHeader, Field, inputCls, Table, StatusPill } from "../ui";
import type { Lead, LeadStage } from "@/lib/data";

const STAGES: { key: LeadStage; label: string }[] = [
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "consult scheduled", label: "Consult scheduled" },
  { key: "fee agreement", label: "Fee agreement" },
  { key: "converted", label: "Converted" },
  { key: "lost", label: "Lost" },
];

export default function LeadsPage() {
  const { data: leads, refetch } = useAsync(() => api.listLeads(), []);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", source: "website", practiceArea: "Family Law", value: "25000" });
  const [drag, setDrag] = useState<string | null>(null);

  const create = async () => {
    await api.createLead({ ...form, value: rupeesToPaise(Number(form.value)) || 0, source: form.source as Lead["source"] });
    setCreating(false);
    refetch();
  };

  const move = async (id: string, stage: LeadStage) => {
    await api.updateLead(id, { stage, activity: [{ at: new Date().toISOString(), text: `Moved to ${stage}` }] });
    refetch();
  };

  const convert = async (lead: Lead) => {
    await api.convertLead(lead.id, { title: `${lead.name} — ${lead.practiceArea}` });
    refetch();
  };

  const pipelineValue = (leads ?? []).filter((l) => !["converted", "lost"].includes(l.stage)).reduce((s, l) => s + l.value, 0);

  return (
    <div data-testid="leads-page" className="px-8 pb-12">
      <PageHeader
        title="Lead pipeline"
        subtitle={`${formatINR0(pipelineValue)} in open pipeline · ${(leads ?? []).length} leads`}
        actions={<NewButton testid="lead-new" label="Add lead" onClick={() => setCreating(true)} />}
      />
      <div className="flex gap-4 overflow-x-auto pb-2">
        {STAGES.map((stage) => {
          const list = (leads ?? []).filter((l) => l.stage === stage.key);
          return (
            <div
              key={stage.key}
              data-testid={`lead-column-${stage.key.replace(/\s/g, "-")}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (drag) { move(drag, stage.key); setDrag(null); } }}
              className="min-w-[240px] flex-1"
            >
              <div className="mb-3 flex items-center justify-between px-1">
                <h2 className="text-[13.5px] font-bold text-neutral-800">{stage.label}</h2>
                <span className="rounded-full bg-neutral-200/70 px-2 py-0.5 text-[11px] font-bold text-neutral-600">{list.length}</span>
              </div>
              <div className="min-h-[120px] space-y-3 rounded-xl bg-neutral-100/70 p-2.5">
                {list.map((l) => (
                  <Card
                    key={l.id}
                    testid="lead-card"
                    className="cursor-grab p-3.5 active:cursor-grabbing"
                  >
                    <div draggable onDragStart={() => setDrag(l.id)}>
                      <p className="text-[13.5px] font-bold text-neutral-900">{l.name}</p>
                      <p className="mt-0.5 text-[12px] text-neutral-500">{l.practiceArea} · {l.source}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[13px] font-extrabold text-[#4c4cb8]">{formatINR0(l.value)}</span>
                        <span className="text-[11px] text-neutral-400">{fmtDate(l.createdAt)}</span>
                      </div>
                      {stage.key !== "converted" && stage.key !== "lost" && (
                        <div className="mt-2.5 flex gap-2">
                          <button
                            data-testid="lead-convert"
                            onClick={() => convert(l)}
                            className="rounded-md bg-lawleit/10 px-2 py-1 text-[11px] font-bold text-lawleit hover:bg-lawleit/20"
                          >Convert</button>
                          <button
                            onClick={() => move(l.id, "lost")}
                            className="rounded-md bg-neutral-100 px-2 py-1 text-[11px] font-semibold text-neutral-500 hover:bg-neutral-200"
                          >Mark lost</button>
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
                {list.length === 0 && <p className="px-2 py-4 text-[12px] text-neutral-400">Drag cards here</p>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-10">
        <h2 className="mb-3 text-[15px] font-bold text-neutral-900">All leads</h2>
        <Card>
          <Table head={["Lead", "Contact", "Source", "Stage", "Value", "Created"]} testid="leads-table">
            {(leads ?? []).map((l) => (
              <tr key={l.id} className="hover:bg-neutral-50">
                <td className="px-6 py-3 font-medium">{l.name}</td>
                <td className="px-6 py-3 text-neutral-500">{l.email} · {l.phone}</td>
                <td className="px-6 py-3 capitalize">{l.source}</td>
                <td className="px-6 py-3">
                  <select value={l.stage} onChange={(e) => move(l.id, e.target.value as LeadStage)}
                    className="rounded-md border border-neutral-200 px-2 py-1 text-[12px] capitalize">
                    {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </td>
                <td className="px-6 py-3 font-semibold">{formatINR0(l.value)}</td>
                <td className="px-6 py-3 text-neutral-500">{fmtDate(l.createdAt)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Add lead" testid="lead-modal">
        <div className="space-y-4">
          <Field label="Name"><input data-testid="lead-name" className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email"><input className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Phone"><input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Source">
              <select className={inputCls} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                {["website", "referral", "call", "ads", "walk-in"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Practice area">
              <select className={inputCls} value={form.practiceArea} onChange={(e) => setForm({ ...form, practiceArea: e.target.value })}>
                {["Family Law", "Personal Injury", "Estate Planning", "Business Law", "Immigration"].map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Est. value (₹)"><input type="number" className={inputCls} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></Field>
          </div>
          <button data-testid="lead-save" onClick={create} className="w-full rounded-full bg-lawleit py-2.5 text-[14px] font-bold text-white hover:bg-lawleit-dark">Save lead</button>
        </div>
      </Modal>
    </div>
  );
}
