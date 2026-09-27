import { useState } from "react";
import { api } from "@/lib/data";
import { useAsync } from "@/lib/hooks";
import { formatINR0 } from "@/lib/money";
import { Card, CardTitle, Field, inputCls, Avatar } from "../ui";

export default function SettingsPage() {
  const { data: session, refetch: refetchSession } = useAsync(() => api.getSession(), []);
  const { data: users, refetch: refetchUsers } = useAsync(() => api.listUsers(), []);
  const [firm, setFirm] = useState(session?.firm);
  const [saved, setSaved] = useState(false);

  if (!firm && session?.firm) setFirm(session.firm);
  if (!firm) return null;

  const saveFirm = async () => {
    await api.updateFirm(firm);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
    refetchSession();
  };

  return (
    <div data-testid="settings-page" className="mx-auto max-w-[900px] px-8 pb-12">
      <div className="pb-2 pt-6">
        <h1 className="text-[22px] font-bold tracking-tight text-neutral-900">Settings</h1>
        <p className="mt-0.5 text-[13px] text-neutral-500">Firm profile, users, and plan</p>
      </div>

      <div className="space-y-5">
        <Card className="p-6">
          <CardTitle>Firm profile</CardTitle>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Firm name"><input data-testid="firm-name" className={inputCls} value={firm.name} onChange={(e) => setFirm({ ...firm, name: e.target.value })} /></Field>
            <Field label="Phone"><input className={inputCls} value={firm.phone} onChange={(e) => setFirm({ ...firm, phone: e.target.value })} /></Field>
            <Field label="Email"><input className={inputCls} value={firm.email} onChange={(e) => setFirm({ ...firm, email: e.target.value })} /></Field>
            <Field label="Address"><input className={inputCls} value={firm.address} onChange={(e) => setFirm({ ...firm, address: e.target.value })} /></Field>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button data-testid="firm-save" onClick={saveFirm} className="rounded-full bg-lawleit px-6 py-2.5 text-[14px] font-bold text-white hover:bg-lawleit-dark">Save changes</button>
            {saved && <span data-testid="firm-saved" className="text-[13px] font-semibold text-emerald-600">Saved ✓</span>}
          </div>
        </Card>

        <Card className="p-6">
          <CardTitle>Firm users ({(users ?? []).length})</CardTitle>
          <table className="w-full text-left text-[13.5px]">
            <thead><tr className="border-b border-neutral-200 text-[11.5px] uppercase text-neutral-500">
              <th className="py-2">User</th><th className="py-2">Role</th><th className="py-2 text-right">Hourly rate</th>
            </tr></thead>
            <tbody className="divide-y divide-neutral-100">
              {(users ?? []).map((u) => (
                <tr key={u.id}>
                  <td className="py-3">
                    <span className="flex items-center gap-3">
                      <Avatar name={u.name} color={u.avatarColor} size="sm" />
                      <span>
                        <span className="font-semibold">{u.name}</span>
                        <span className="block text-[12px] text-neutral-500">{u.email}</span>
                      </span>
                    </span>
                  </td>
                  <td className="py-3 capitalize">{u.role}</td>
                  <td className="py-3 text-right font-semibold">{formatINR0(u.hourlyRate)}/hr</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="p-6">
          <CardTitle>Plan &amp; billing</CardTitle>
          <div className="flex items-center justify-between rounded-xl border border-neutral-200 p-5">
            <div>
              <p className="text-[15px] font-bold capitalize text-neutral-900">Lawleit {firm.plan} — trial</p>
              <p className="text-[13px] text-neutral-500">Trial ends {new Date(`${firm.trialEndsAt}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
            </div>
            <button className="rounded-full bg-lawleit px-5 py-2.5 text-[13.5px] font-bold text-white hover:bg-lawleit-dark">Upgrade plan</button>
          </div>
          <div className="mt-4 rounded-xl border border-dashed border-neutral-300 p-5">
            <p className="text-[13.5px] font-bold text-neutral-800">Connect your backend</p>
            <p className="mt-1 text-[13px] leading-relaxed text-neutral-500">
              This build ships with a mock adapter (localStorage). To go live, implement
              <code className="mx-1 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[12px]">src/lib/data/httpAdapter.ts</code>
              against <code className="mx-1 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[12px]">docs/API_CONTRACT.md</code>
              and flip the adapter in <code className="mx-1 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[12px]">src/lib/data/index.ts</code>.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
