import { useState } from "react";
import { api } from "@/lib/data";
import { useAsync, money, fmtDate } from "@/lib/hooks";
import { Card, Modal, NewButton, PageHeader, Field, inputCls, StatusPill, Table } from "../ui";

export default function PaymentsPage() {
  const { data: payments, refetch } = useAsync(() => api.listPayments(), []);
  const { data: invoices } = useAsync(() => api.listInvoices(), []);
  const { data: contacts } = useAsync(() => api.listContacts(), []);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ invoiceId: "", amount: "", method: "card", trustAccount: false });

  const record = async () => {
    const iv = (invoices ?? []).find((i) => i.id === form.invoiceId);
    await api.recordPayment({
      invoiceId: form.invoiceId,
      clientId: iv?.clientId,
      amount: Number(form.amount) || 0,
      method: form.method as "card" | "echeck" | "wallet",
      trustAccount: form.trustAccount,
    });
    setCreating(false);
    refetch();
  };

  const totalThisMonth = (payments ?? [])
    .filter((p) => p.date >= new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10))
    .reduce((s, p) => s + p.amount, 0);

  return (
    <div data-testid="payments-page" className="px-8 pb-12">
      <PageHeader
        title="Payments"
        subtitle={`${money(totalThisMonth)} collected in the last 30 days — via LawleitPay`}
        actions={<NewButton testid="payment-new" label="Record payment" onClick={() => setCreating(true)} />}
      />
      <Card>
        <Table head={["Date", "Invoice", "Client", "Method", "Trust", "Status", "Amount"]} testid="payments-table">
          {(payments ?? []).map((p) => {
            const iv = (invoices ?? []).find((i) => i.id === p.invoiceId);
            const client = (contacts ?? []).find((c) => c.id === p.clientId);
            return (
              <tr key={p.id} className="hover:bg-neutral-50">
                <td className="px-6 py-3.5">{fmtDate(p.date)}</td>
                <td className="px-6 py-3.5 font-semibold text-lawleit">{iv?.number}</td>
                <td className="px-6 py-3.5">{client?.name}</td>
                <td className="px-6 py-3.5 capitalize">{p.method}</td>
                <td className="px-6 py-3.5">{p.trustAccount ? "Yes" : "No"}</td>
                <td className="px-6 py-3.5"><StatusPill status={p.status} /></td>
                <td className="px-6 py-3.5 text-right font-bold">{money(p.amount)}</td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Modal open={creating} onClose={() => setCreating(false)} title="Record payment" testid="payment-modal">
        <div className="space-y-4">
          <Field label="Invoice">
            <select data-testid="payment-invoice" className={inputCls} value={form.invoiceId} onChange={(e) => {
              const iv = (invoices ?? []).find((i) => i.id === e.target.value);
              setForm({ ...form, invoiceId: e.target.value, amount: iv ? String(iv.lines.reduce((s, l) => s + l.quantity * l.rate, 0)) : "" });
            }}>
              <option value="">Select invoice…</option>
              {(invoices ?? []).filter((i) => i.status !== "paid").map((i) => <option key={i.id} value={i.id}>{i.number}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount ($)"><input data-testid="payment-amount" type="number" className={inputCls} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
            <Field label="Method">
              <select data-testid="payment-method" className={inputCls} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                {["card", "echeck", "wallet"].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-[13.5px] font-semibold text-neutral-700">
            <input type="checkbox" checked={form.trustAccount} onChange={(e) => setForm({ ...form, trustAccount: e.target.checked })} className="h-4 w-4 accent-lawleit" />
            Deposit into trust account
          </label>
          <button data-testid="payment-save" onClick={record} className="w-full rounded-full bg-lawleit py-2.5 text-[14px] font-bold text-white hover:bg-lawleit-dark">Record payment</button>
        </div>
      </Modal>
    </div>
  );
}
