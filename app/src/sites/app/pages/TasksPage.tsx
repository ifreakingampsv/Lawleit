import { useState } from "react";
import { api } from "@/lib/data";
import { useAsync, fmtDate } from "@/lib/hooks";
import { Card, Modal, NewButton, PageHeader, Field, inputCls, StatusPill, Table } from "../ui";
import type { Task } from "@/lib/data";

const COLUMNS: { key: Task["status"]; label: string }[] = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
];

export default function TasksPage() {
  const { data: tasks, refetch } = useAsync(() => api.listTasks(), []);
  const { data: cases } = useAsync(() => api.listCases(), []);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", dueDate: "", priority: "medium", caseId: "" });

  const create = async () => {
    await api.createTask({
      title: form.title || "New task",
      dueDate: form.dueDate || new Date().toISOString().slice(0, 10),
      priority: form.priority as Task["priority"],
      caseId: form.caseId || undefined,
    });
    setCreating(false);
    setForm({ title: "", dueDate: "", priority: "medium", caseId: "" });
    refetch();
  };

  const setStage = async (id: string, status: Task["status"]) => {
    await api.updateTask(id, { status });
    refetch();
  };

  return (
    <div data-testid="tasks-page" className="px-8 pb-12">
      <PageHeader
        title="Tasks"
        subtitle="Track firm work in one board"
        actions={<NewButton testid="task-new" label="Add task" onClick={() => setCreating(true)} />}
      />
      <div className="grid grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const list = (tasks ?? []).filter((t) => t.status === col.key);
          return (
            <div key={col.key}>
              <div className="mb-3 flex items-center justify-between px-1">
                <h2 className="text-[14px] font-bold text-neutral-800">{col.label}</h2>
                <span className="rounded-full bg-neutral-200/70 px-2 py-0.5 text-[11.5px] font-bold text-neutral-600">{list.length}</span>
              </div>
              <div className="space-y-3" data-testid={`task-column-${col.key}`}>
                {list.map((t) => {
                  const kase = (cases ?? []).find((c) => c.id === t.caseId);
                  return (
                    <Card key={t.id} className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[13.5px] font-semibold leading-snug text-neutral-900">{t.title}</p>
                        <StatusPill status={t.priority} />
                      </div>
                      {kase && <p className="mt-1 text-[12px] text-neutral-500">{kase.number} · {kase.title}</p>}
                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-[12px] text-neutral-500">Due {fmtDate(t.dueDate)}</span>
                        <select
                          aria-label="Move task"
                          value={t.status}
                          onChange={(e) => setStage(t.id, e.target.value as Task["status"])}
                          className="rounded-md border border-neutral-200 px-1.5 py-1 text-[11.5px] text-neutral-600"
                        >
                          {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </select>
                      </div>
                    </Card>
                  );
                })}
                {list.length === 0 && <p className="px-1 text-[12.5px] text-neutral-400">Nothing here</p>}
              </div>
            </div>
          );
        })}
      </div>

      {/* list view below for table parity with MyCase */}
      <div className="mt-10">
        <h2 className="mb-3 text-[15px] font-bold text-neutral-900">All tasks</h2>
        <Card>
          <Table head={["Task", "Case", "Assignee", "Due", "Priority", "Status"]} testid="tasks-table">
            {(tasks ?? []).map((t) => (
              <tr key={t.id} className="hover:bg-neutral-50">
                <td className="px-6 py-3 font-medium">{t.title}</td>
                <td className="px-6 py-3 text-neutral-500">{(cases ?? []).find((c) => c.id === t.caseId)?.number ?? "—"}</td>
                <td className="px-6 py-3">{t.assigneeId}</td>
                <td className="px-6 py-3">{fmtDate(t.dueDate)}</td>
                <td className="px-6 py-3"><StatusPill status={t.priority} /></td>
                <td className="px-6 py-3"><StatusPill status={t.status} /></td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="New task" testid="task-modal">
        <div className="space-y-4">
          <Field label="Title"><input data-testid="task-title" className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Due date"><input type="date" className={inputCls} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
            <Field label="Priority">
              <select className={inputCls} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {["low", "medium", "high"].map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Case">
              <select className={inputCls} value={form.caseId} onChange={(e) => setForm({ ...form, caseId: e.target.value })}>
                <option value="">None</option>
                {(cases ?? []).map((c) => <option key={c.id} value={c.id}>{c.number}</option>)}
              </select>
            </Field>
          </div>
          <button data-testid="task-save" onClick={create} className="w-full rounded-full bg-lawleit py-2.5 text-[14px] font-bold text-white hover:bg-lawleit-dark">Save task</button>
        </div>
      </Modal>
    </div>
  );
}
