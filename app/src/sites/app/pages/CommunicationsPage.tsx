import { useState } from "react";
import { api } from "@/lib/data";
import { useAsync } from "@/lib/hooks";
import { Card, Modal, NewButton, PageHeader, Field, inputCls, Avatar } from "../ui";
import { cn } from "@/lib/utils";
import type { MessageThread } from "@/lib/data";

const CHANNEL_BADGE: Record<string, { label: string; cls: string }> = {
  secure: { label: "Secure portal", cls: "bg-[#eeedfb] text-lawleit" },
  email: { label: "Email", cls: "bg-blue-50 text-blue-700" },
  sms: { label: "Text", cls: "bg-emerald-50 text-emerald-700" },
};

export default function CommunicationsPage() {
  const { data: threads, refetch } = useAsync(() => api.listThreads(), []);
  const { data: contacts } = useAsync(() => api.listContacts(), []);
  const [openId, setOpenId] = useState<string | null>((threads ?? [])[0]?.id ?? null);
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ subject: "", clientId: "", channel: "secure" });

  const open = (threads ?? []).find((t) => t.id === openId) ?? null;
  const client = open ? (contacts ?? []).find((c) => c.id === open.clientId) : null;

  const send = async () => {
    if (!open || !draft.trim()) return;
    await api.sendMessage(open.id, draft.trim());
    setDraft("");
    refetch();
  };

  const create = async () => {
    const th = await api.createThread({
      subject: form.subject || "(no subject)",
      clientId: form.clientId || (contacts ?? [])[0]?.id,
      channel: form.channel as MessageThread["channel"],
      messages: [],
    });
    setCreating(false);
    setOpenId(th.id);
    refetch();
  };

  return (
    <div data-testid="communications-page" className="flex h-[calc(100vh-56px)]">
      {/* thread list */}
      <div className="w-[340px] shrink-0 border-r border-neutral-200 bg-white">
        <div className="px-6 pb-2 pt-6">
          <PageHeaderNoMargin />
          <NewButton testid="thread-new" label="New message" onClick={() => setCreating(true)} />
        </div>
        <div className="mt-3 max-h-[calc(100%-100px)] overflow-y-auto px-3 pb-4">
          {(threads ?? []).map((t) => {
            const last = t.messages[t.messages.length - 1];
            const badge = CHANNEL_BADGE[t.channel] ?? CHANNEL_BADGE.secure!;
            return (
              <button
                key={t.id}
                data-testid="thread-row"
                onClick={async () => { setOpenId(t.id); if (t.unread) { await api.markThreadRead(t.id); refetch(); } }}
                className={cn("mb-1 w-full rounded-xl px-3.5 py-3 text-left hover:bg-neutral-50", openId === t.id && "bg-[#eeedfb]")}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className={cn("truncate text-[13.5px]", t.unread ? "font-extrabold text-neutral-900" : "font-semibold text-neutral-700")}>
                    {t.subject}
                  </p>
                  {t.unread && <span data-testid="thread-unread" className="h-2 w-2 shrink-0 rounded-full bg-lawleit" />}
                </div>
                <p className="mt-0.5 truncate text-[12px] text-neutral-500">
                  {(contacts ?? []).find((c) => c.id === t.clientId)?.name} · {last?.body}
                </p>
                <span className={cn("mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold", badge.cls)}>{badge.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* conversation */}
      <div className="flex min-w-0 flex-1 flex-col">
        {open ? (
          <>
            <div className="border-b border-neutral-200 bg-white px-8 py-4">
              <h1 className="text-[17px] font-bold text-neutral-900">{open.subject}</h1>
              <p className="text-[12.5px] text-neutral-500">with {client?.name} · case {(open.caseId ?? "—").slice(0, 8)}</p>
            </div>
            <div data-testid="thread-messages" className="flex-1 space-y-4 overflow-y-auto bg-[#f4f5f7] p-8">
              {open.messages.map((m) => (
                <div key={m.id} className={cn("flex", m.from === "firm" ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[520px] rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed",
                    m.from === "firm" ? "rounded-br-sm bg-lawleit text-white" : "rounded-bl-sm bg-white text-neutral-800 shadow-sm")}>
                    {m.from === "client" && <p className="mb-1 text-[11px] font-bold text-neutral-500">{m.authorName}</p>}
                    {m.body}
                    <p className={cn("mt-1.5 text-[10.5px]", m.from === "firm" ? "text-white/70" : "text-neutral-400")}>
                      {new Date(m.at).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-end gap-3 border-t border-neutral-200 bg-white p-4">
              <textarea
                data-testid="thread-draft"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type a reply… (secure portal message)"
                rows={2}
                className="flex-1 resize-none rounded-xl border border-neutral-300 px-4 py-2.5 text-[13.5px] outline-none focus:border-lawleit"
              />
              <button data-testid="thread-send" onClick={send} className="rounded-xl bg-lawleit px-6 py-3 text-[14px] font-bold text-white hover:bg-lawleit-dark">
                Send
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-neutral-400">Select a conversation</div>
        )}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="New message" testid="thread-modal">
        <div className="space-y-4">
          <Field label="Subject"><input data-testid="thread-subject" className={inputCls} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
          <Field label="Client">
            <select className={inputCls} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
              {(contacts ?? []).filter((c) => c.type === "client").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Channel">
            <select className={inputCls} value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
              <option value="secure">Secure portal</option><option value="email">Email</option><option value="sms">Text (SMS)</option>
            </select>
          </Field>
          <button data-testid="thread-save" onClick={create} className="w-full rounded-full bg-lawleit py-2.5 text-[14px] font-bold text-white hover:bg-lawleit-dark">Start conversation</button>
        </div>
      </Modal>
    </div>
  );
}

function PageHeaderNoMargin() {
  return (
    <div className="pb-3">
      <h1 className="text-[20px] font-bold tracking-tight text-neutral-900">Communications</h1>
      <p className="text-[12.5px] text-neutral-500">Portal · email · text — one inbox</p>
    </div>
  );
}

// Avatar imported for parity with other pages (used by drawer when extended)
export { Avatar };
