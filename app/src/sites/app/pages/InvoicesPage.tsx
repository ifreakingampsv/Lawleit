import { useState } from "react";
import { api } from "@/lib/data";
import { useAsync, fmtDate } from "@/lib/hooks";
import { formatINR, paiseToRupees, rupeesToPaise } from "@/lib/money";
import { Card, Modal, NewButton, PageHeader, Field, inputCls, StatusPill, Table } from "../ui";
import type { InvoiceLine } from "@/lib/data";

const lineTotal = (l: InvoiceLine) => l.quantity * l.rate;

export default function InvoicesPage() {
  const { data: invoices, refetch } = useAsync(() => api.listInvoices(), []);
  const { data: contacts } = useAsync(() => api.listContacts(), []);
  const { data: cases } = useAsync(() => api.listCases(), []);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ clientId: "", caseId: "", notes: "" });
  const [lines, setLines] = useState<InvoiceLine[]>([
    { id: "l1", description: "Professional services", quantity: 1, rate: 500000, kind: "flat" },
  ]);

  const create = async () => {
    await api.createInvoice({ ...form, lines });
    setCreating(false);
    setLines([{ id: "l1", description: "Professional services", quantity: 1, rate: 500, kind: "flat" }]);
    refetch();
  };

  const total = (iv: { lines: InvoiceLine[] }) => iv.lines.reduce((s, l) => s + lineTotal(l), 0);
  const selected = (invoices ?? []).find((i) => i.id === open);

  return (
    <div data-testid="invoices-page" className="px-8 pb-12">
      <PageHeader
        title="Invoices"
        subtitle={`${(invoices ?? []).filter((i) => i.status === "overdue").length} overdue · ${(invoices ?? []).filter((i) => i.status === "draft").length} drafts`}
        actions={<NewButton testid="invoice-new" label="New invoice" onClick={() => setCreating(true)} />}
      />
      <Card>
        <Table head={["Invoice", "Client", "Issued", "Due", "Status", "Total", ""]} testid="invoices-table">
          {(invoices ?? []).map((iv) => {
            const client = (contacts ?? []).find((c) => c.id === iv.clientId);
            return (
              <tr key={iv.id} className="hover:bg-neutral-50">
                <td className="px-6 py-3.5">
                  <button data-testid="invoice-open" onClick={() => setOpen(iv.id)} className="font-semibold text-lawleit hover:underline">{iv.number}</button>
                </td>
                <td className="px-6 py-3.5">{client?.name}</td>
                <td className="px-6 py-3.5">{fmtDate(iv.issued)}</td>
                <td className="px-6 py-3.5">{fmtDate(iv.due)}</td>
                <td className="px-6 py-3.5"><StatusPill status={iv.status} /></td>
                <td className="px-6 py-3.5 font-bold">{formatINR(total(iv))}</td>
                <td className="px-6 py-3.5 text-right">
                  {iv.status === "draft" && (
                    <button data-testid="invoice-send" onClick={async () => { await api.updateInvoice(iv.id, { status: "sent" }); refetch(); }}
                      className="rounded-md bg-lawleit/10 px-2.5 py-1 text-[12px] font-bold text-lawleit hover:bg-lawleit/20">Send</button>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>

      {/* invoice preview */}
      <Modal open={!!selected} onClose={() => setOpen(null)} title={`Invoice ${selected?.number ?? ""}`} testid="invoice-modal">
        {selected && (
          <div>
            <div className="rounded-xl border border-neutral-200 p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-lg font-extrabold text-neutral-900">Lawleit Invoice</p>
                  <p className="text-[12px] text-neutral-500">{selected.notes}</p>
                </div>
                <div className="text-right text-[12px] text-neutral-500">
                  <p>Issued {fmtDate(selected.issued)}</p>
                  <p>Due {fmtDate(selected.due)}</p>
                  <p className="mt-1"><StatusPill status={selected.status} /></p>
                </div>
              </div>
              <table className="mt-5 w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-neutral-200 text-[11px] uppercase text-neutral-500">
                    <th className="py-2">Description</th><th className="py-2 text-right">Qty</th>
                    <th className="py-2 text-right">Rate</th><th className="py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {selected.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2.5">{l.description}</td>
                      <td className="py-2.5 text-right">{l.quantity}</td>
                      <td className="py-2.5 text-right">{formatINR(l.rate)}</td>
                      <td className="py-2.5 text-right font-semibold">{formatINR(lineTotal(l))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 flex justify-between border-t-2 border-neutral-800 pt-3 text-[15px] font-extrabold">
                <span>Total</span><span>{formatINR(total(selected))}</span>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              {selected.status !== "paid" && (
                <button data-testid="invoice-mark-paid" onClick={async () => { await api.updateInvoice(selected.id, { status: "paid" }); refetch(); setOpen(null); }}
                  className="flex-1 rounded-full bg-emerald-600 py-2.5 text-[14px] font-bold text-white hover:bg-emerald-700">Mark as paid</button>
              )}
              {selected.status === "draft" && (
                <button onClick={async () => { await api.updateInvoice(selected.id, { status: "sent" }); refetch(); setOpen(null); }}
                  className="flex-1 rounded-full bg-lawleit py-2.5 text-[14px] font-bold text-white hover:bg-lawleit-dark">Send invoice</button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* create */}
      <Modal open={creating} onClose={() => setCreating(false)} title="New invoice" testid="invoice-create-modal">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Client">
              <select data-testid="invoice-client" className={inputCls} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
                <option value="">Select client…</option>
                {(contacts ?? []).filter((c) => c.type === "client").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Case">
              <select data-testid="invoice-case" className={inputCls} value={form.caseId} onChange={(e) => setForm({ ...form, caseId: e.target.value })}>
                <option value="">None</option>
                {(cases ?? []).map((c) => <option key={c.id} value={c.id}>{c.number}</option>)}
              </select>
            </Field>
          </div>
          <div className="rounded-xl border border-neutral-200 p-4">
            <p className="mb-3 text-[13px] font-bold text-neutral-800">Line items</p>
            {lines.map((l, i) => (
              <div key={l.id} className="mb-2 grid grid-cols-[1fr_70px_90px_24px] items-center gap-2">
                <input className={inputCls} value={l.description}
                  onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                <input type="number" step="0.1" className={inputCls} value={l.quantity}
                  onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} />
                <input type="number" className={inputCls} value={paiseToRupees(l.rate)}
                  onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, rate: rupeesToPaise(Number(e.target.value)) } : x)))} />
                <button aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))} className="text-neutral-400 hover:text-red-500">✕</button>
              </div>
            ))}
            <button data-testid="invoice-add-line" onClick={() => setLines([...lines, { id: `l${Date.now()}`, description: "", quantity: 1, rate: 0, kind: "flat" }])}
              className="mt-1 text-[13px] font-bold text-lawleit hover:underline">+ Add line</button>
            <p className="mt-3 text-right text-[14px] font-bold">Total: {formatINR(lines.reduce((s, l) => s + lineTotal(l), 0))}</p>
          </div>
          <button data-testid="invoice-save" onClick={create} className="w-full rounded-full bg-lawleit py-2.5 text-[14px] font-bold text-white hover:bg-lawleit-dark">Create invoice</button>
        </div>
      </Modal>
    </div>
  );
}
