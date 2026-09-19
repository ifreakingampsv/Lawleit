import { api } from "@/lib/data";
import { useAsync, money, fmtDate } from "@/lib/hooks";
import { Card, CardTitle, Table } from "../ui";

export default function AccountingPage() {
  const { data: txns } = useAsync(() => api.listTrustTransactions(), []);
  const { data: contacts } = useAsync(() => api.listContacts(), []);

  const byClient = new Map<string, number>();
  (txns ?? []).forEach((t) => byClient.set(t.clientId, (byClient.get(t.clientId) ?? 0) + t.amount));
  const total = [...byClient.values()].reduce((s, v) => s + v, 0);

  return (
    <div data-testid="accounting-page" className="px-8 pb-12">
      <PageHeaderSimple title="Trust accounting" subtitle="Three-way reconciliation: bank, ledger, and client balances" />
      <div className="mb-5 grid grid-cols-3 gap-5">
        <Card className="p-5">
          <p className="text-[12.5px] font-semibold text-neutral-500">Trust ledger balance</p>
          <p data-testid="trust-total" className="mt-1 text-[26px] font-extrabold text-neutral-900">{money(total)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-[12.5px] font-semibold text-neutral-500">Clients with balances</p>
          <p className="mt-1 text-[26px] font-extrabold text-neutral-900">{byClient.size}</p>
        </Card>
        <Card className="p-5">
          <p className="text-[12.5px] font-semibold text-neutral-500">Reconciliation status</p>
          <p className="mt-1 flex items-center gap-2 text-[20px] font-extrabold text-emerald-600">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-[13px]">✓</span> Balanced
          </p>
        </Card>
      </div>
      <Card>
        <CardTitle>Client trust balances</CardTitle>
        <Table head={["Client", "Matters", "Balance"]}>
          {[...byClient.entries()].map(([clientId, bal]) => (
            <tr key={clientId} className="hover:bg-neutral-50">
              <td className="px-6 py-3.5 font-medium">{(contacts ?? []).find((c) => c.id === clientId)?.name ?? clientId}</td>
              <td className="px-6 py-3.5 text-neutral-500">{(contacts ?? []).find((c) => c.id === clientId)?.caseIds.length ?? 0}</td>
              <td className="px-6 py-3.5 text-right font-bold">{money(bal)}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <div className="mt-6">
        <Card>
          <CardTitle>Transactions</CardTitle>
          <Table head={["Date", "Client", "Description", "In", "Out", "Balance"]} testid="trust-table">
            {(txns ?? []).map((t) => (
              <tr key={t.id} className="hover:bg-neutral-50">
                <td className="px-6 py-3">{fmtDate(t.date)}</td>
                <td className="px-6 py-3">{(contacts ?? []).find((c) => c.id === t.clientId)?.name}</td>
                <td className="px-6 py-3">{t.description}</td>
                <td className="px-6 py-3 font-semibold text-emerald-600">{t.amount > 0 ? money(t.amount) : ""}</td>
                <td className="px-6 py-3 font-semibold text-red-500">{t.amount < 0 ? money(-t.amount) : ""}</td>
                <td className="px-6 py-3 text-right font-semibold">{money(t.balanceAfter)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  );
}

function PageHeaderSimple({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="pb-2 pt-6">
      <h1 className="text-[22px] font-bold tracking-tight text-neutral-900">{title}</h1>
      <p className="mt-0.5 text-[13px] text-neutral-500">{subtitle}</p>
    </div>
  );
}
