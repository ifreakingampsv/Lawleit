import { Link, useParams } from "react-router";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/data";
import { useAsync, money, hours, fmtDate } from "@/lib/hooks";
import { Card, CardTitle, StatusPill, Avatar, Modal, Field, inputCls, Table } from "../ui";
import type { CaseStage } from "@/lib/data";

const TABS = ["Overview", "Documents", "Time", "Tasks", "Billing"] as const;

export default function CaseDetail() {
  const { id } = useParams();
  const { data: kase, refetch: refetchCase } = useAsync(() => api.getCase(id ?? ""), [id]);
  const { data: contacts } = useAsync(() => api.listContacts(), []);
  const { data: entries, refetch: refetchEntries } = useAsync(() => api.listTimeEntries(), [id]);
  const { data: docs } = useAsync(() => api.listDocuments(), []);
  const { data: tasks, refetch: refetchTasks } = useAsync(() => api.listTasks(), []);
  const { data: invoices, refetch: refetchInv } = useAsync(() => api.listInvoices(), []);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [logging, setLogging] = useState(false);
  const [entry, setEntry] = useState({ minutes: "60", description: "", billable: true });

  if (!kase) return <div className="p-10 text-neutral-500">Case not found.</div>;
  const client = (contacts ?? []).find((c) => c.id === kase.clientId);
  const caseDocs = (docs ?? []).filter((d) => d.caseId === kase.id);
  const caseEntries = (entries ?? []).filter((e) => e.caseId === kase.id);
  const caseTasks = (tasks ?? []).filter((t) => t.caseId === kase.id);
  const caseInvoices = (invoices ?? []).filter((i) => i.caseId === kase.id);

  const stages: CaseStage[] = ["intake", "consult", "discovery", "court date pending", "negotiation", "trial", "resolved"];
  const setStage = async (stage: CaseStage) => { await api.updateCase(kase.id, { stage }); refetchCase(); };

  const logTime = async () => {
    await api.createTimeEntry({
      caseId: kase.id, minutes: Number(entry.minutes) || 30, rate: kase.billableRate,
      description: entry.description || "Work on matter", billable: entry.billable,
    });
    setLogging(false);
    setEntry({ minutes: "60", description: "", billable: true });
    refetchEntries();
  };

  return (
    <div data-testid="case-detail" className="px-8 pb-12">
      <div className="flex items-center justify-between pb-3 pt-6">
        <div className="flex items-center gap-4">
          <Link to="/app/cases" className="flex items-center gap-1.5 text-[13.5px] font-semibold text-neutral-500 hover:text-neutral-800">
            <ArrowLeft className="h-4 w-4" /> Cases
          </Link>
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-neutral-900">{kase.title}</h1>
            <p className="text-[13px] text-neutral-500">{kase.number} · {kase.practiceArea}</p>
          </div>
          <StatusPill status={kase.status} />
        </div>
        <div className="flex gap-2">
          <button onClick={() => setLogging(true)} data-testid="case-log-time" className="rounded-lg bg-lawleit px-4 py-2 text-[13.5px] font-bold text-white hover:bg-lawleit-dark">Log time</button>
          <button
            onClick={async () => { await api.updateCase(kase.id, { status: kase.status === "open" ? "closed" : "open" }); refetchCase(); }}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-[13.5px] font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            {kase.status === "open" ? "Close case" : "Reopen case"}
          </button>
        </div>
      </div>

      {/* stage pipeline */}
      <div className="flex items-center gap-1.5 pb-5">
        {stages.map((s) => (
          <button
            key={s}
            data-testid="case-stage-step"
            onClick={() => setStage(s)}
            className={`rounded-full px-3 py-1 text-[12px] font-semibold capitalize ${s === kase.stage ? "bg-lawleit text-white" : "bg-neutral-200/70 text-neutral-600 hover:bg-neutral-300/70"}`}
          >{s}</button>
        ))}
      </div>

      {/* tabs */}
      <div className="flex gap-1 border-b border-neutral-200">
        {TABS.map((t) => (
          <button
            key={t}
            data-testid={`case-tab-${t.toLowerCase()}`}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-[14px] font-semibold ${tab === t ? "border-b-2 border-lawleit text-lawleit" : "text-neutral-500 hover:text-neutral-800"}`}
          >{t}</button>
        ))}
      </div>

      <div className="pt-5">
        {tab === "Overview" && (
          <div className="grid grid-cols-[1.5fr_1fr] gap-5">
            <Card className="p-6">
              <h2 className="text-[15px] font-bold">Case details</h2>
              <p className="mt-3 text-[14px] leading-relaxed text-neutral-700">{kase.description}</p>
              <dl className="mt-6 grid grid-cols-2 gap-y-4 text-[13.5px]">
                <div><dt className="text-neutral-500">Open date</dt><dd className="mt-0.5 font-semibold">{fmtDate(kase.openDate)}</dd></div>
                <div><dt className="text-neutral-500">Court date</dt><dd className="mt-0.5 font-semibold">{kase.courtDate ? fmtDate(kase.courtDate) : "—"}</dd></div>
                <div><dt className="text-neutral-500">Billable rate</dt><dd className="mt-0.5 font-semibold">{money(kase.billableRate)}/hr</dd></div>
                <div><dt className="text-neutral-500">Trust balance</dt><dd className="mt-0.5 font-semibold">{money(kase.trustBalance)}</dd></div>
              </dl>
            </Card>
            <Card className="p-6">
              <h2 className="text-[15px] font-bold">Client</h2>
              {client ? (
                <div className="mt-4 flex items-center gap-3">
                  <Avatar name={client.name} />
                  <div>
                    <p className="text-[14.5px] font-bold text-neutral-900">{client.name}</p>
                    <p className="text-[12.5px] text-neutral-500">{client.email}</p>
                    <p className="text-[12.5px] text-neutral-500">{client.phone}</p>
                  </div>
                </div>
              ) : <p className="mt-3 text-[13px] text-neutral-400">No client linked.</p>}
              <div className="mt-6 rounded-xl bg-neutral-50 p-4">
                <p className="text-[12px] font-semibold text-neutral-500">Billable to date</p>
                <p className="text-[22px] font-extrabold">
                  {money(caseEntries.filter((e) => e.billable).reduce((s, e) => s + (e.minutes / 60) * e.rate, 0))}
                </p>
              </div>
            </Card>
          </div>
        )}

        {tab === "Documents" && (
          <Card>
            <Table head={["Document", "Folder", "Updated", "Size"]} testid="case-docs-table">
              {caseDocs.map((d) => (
                <tr key={d.id} className="hover:bg-neutral-50">
                  <td className="px-6 py-3 font-medium text-[#4c4cb8]">{d.name}</td>
                  <td className="px-6 py-3 text-neutral-500">{d.folder}</td>
                  <td className="px-6 py-3">{fmtDate(d.updatedAt)}</td>
                  <td className="px-6 py-3 text-right">{d.sizeKb} KB</td>
                </tr>
              ))}
              {caseDocs.length === 0 && <tr><td colSpan={4} className="px-6 py-8 text-center text-neutral-400">No documents on this case yet.</td></tr>}
            </Table>
          </Card>
        )}

        {tab === "Time" && (
          <Card>
            <Table head={["Date", "Description", "Hours", "Billable", "Amount"]}>
              {caseEntries.map((e) => (
                <tr key={e.id} className="hover:bg-neutral-50">
                  <td className="px-6 py-3">{fmtDate(e.date)}</td>
                  <td className="px-6 py-3">{e.description}</td>
                  <td className="px-6 py-3">{hours(e.minutes)}</td>
                  <td className="px-6 py-3">{e.billable ? "Yes" : "No"}</td>
                  <td className="px-6 py-3 text-right font-semibold">{money((e.minutes / 60) * e.rate)}</td>
                </tr>
              ))}
              {caseEntries.length === 0 && <tr><td colSpan={5} className="px-6 py-8 text-center text-neutral-400">No time logged.</td></tr>}
            </Table>
          </Card>
        )}

        {tab === "Tasks" && (
          <Card>
            <Table head={["Task", "Due", "Priority", "Status"]}>
              {caseTasks.map((t) => (
                <tr key={t.id} className="hover:bg-neutral-50">
                  <td className="px-6 py-3 font-medium">{t.title}</td>
                  <td className="px-6 py-3">{fmtDate(t.dueDate)}</td>
                  <td className="px-6 py-3"><StatusPill status={t.priority} /></td>
                  <td className="px-6 py-3">
                    <select value={t.status} onChange={async (e) => { await api.updateTask(t.id, { status: e.target.value as never }); refetchTasks(); }}
                      className="rounded-md border border-neutral-200 px-2 py-1 text-[12px]">
                      {["todo", "in_progress", "blocked", "done"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {caseTasks.length === 0 && <tr><td colSpan={4} className="px-6 py-8 text-center text-neutral-400">No tasks on this case.</td></tr>}
            </Table>
          </Card>
        )}

        {tab === "Billing" && (
          <Card>
            <Table head={["Invoice", "Issued", "Due", "Status", "Total"]}>
              {caseInvoices.map((iv) => (
                <tr key={iv.id} className="hover:bg-neutral-50">
                  <td className="px-6 py-3 font-semibold">{iv.number}</td>
                  <td className="px-6 py-3">{fmtDate(iv.issued)}</td>
                  <td className="px-6 py-3">{fmtDate(iv.due)}</td>
                  <td className="px-6 py-3"><StatusPill status={iv.status} /></td>
                  <td className="px-6 py-3 text-right font-semibold">
                    {money(iv.lines.reduce((s, l) => s + l.quantity * l.rate, 0))}
                  </td>
                </tr>
              ))}
              {caseInvoices.length === 0 && <tr><td colSpan={5} className="px-6 py-8 text-center text-neutral-400">No invoices for this case.</td></tr>}
            </Table>
          </Card>
        )}
      </div>

      <Modal open={logging} onClose={() => setLogging(false)} title="Log time" testid="log-time-modal">
        <div className="space-y-4">
          <Field label="Description"><input data-testid="log-description" className={inputCls} value={entry.description} onChange={(e) => setEntry({ ...entry, description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Minutes"><input data-testid="log-minutes" type="number" className={inputCls} value={entry.minutes} onChange={(e) => setEntry({ ...entry, minutes: e.target.value })} /></Field>
            <Field label="Billable">
              <select className={inputCls} value={entry.billable ? "yes" : "no"} onChange={(e) => setEntry({ ...entry, billable: e.target.value === "yes" })}>
                <option value="yes">Billable</option><option value="no">Non-billable</option>
              </select>
            </Field>
          </div>
          <button data-testid="log-save" onClick={logTime} className="w-full rounded-full bg-lawleit py-2.5 text-[14px] font-bold text-white hover:bg-lawleit-dark">Save entry</button>
        </div>
      </Modal>
    </div>
  );
}
