import { useEffect, useState } from "react";
import { api } from "@/lib/data";
import { useAsync, fmtDate } from "@/lib/hooks";
import { Card, Modal, NewButton, PageHeader, Field, inputCls, Avatar, Table } from "../ui";
import type { Contact } from "@/lib/data";

const TYPES = ["client", "company", "opposing", "witness", "referral"] as const;

export default function ContactsPage() {
  const { data: contacts, refetch } = useAsync(() => api.listContacts(), []);
  const { data: cases } = useAsync(() => api.listCases(), []);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | Contact["type"]>("all");
  const [selected, setSelected] = useState<Contact | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", type: "client", email: "", phone: "", address: "" });

  const create = async () => {
    await api.createContact({ ...form, type: form.type as Contact["type"] });
    setCreating(false);
    setForm({ name: "", type: "client", email: "", phone: "", address: "" });
    refetch();
  };

  const list = (contacts ?? []).filter((c) =>
    (typeFilter === "all" || c.type === typeFilter) &&
    c.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div data-testid="contacts-page" className="px-8 pb-12">
      <PageHeader
        title="Contacts"
        subtitle={`${(contacts ?? []).length} people and companies`}
        actions={<NewButton testid="contact-new" label="New contact" onClick={() => setCreating(true)} />}
      />
      <div className="flex items-center gap-3 pb-4">
        <input
          data-testid="contacts-search"
          value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search contacts"
          className="h-9 w-[300px] rounded-lg bg-neutral-200/60 px-3.5 text-[13.5px] outline-none placeholder:text-neutral-400 focus:bg-white focus:ring-1 focus:ring-lawleit"
        />
        <select
          data-testid="contacts-type-filter"
          value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
          className="h-9 rounded-lg border border-neutral-200 bg-white px-3 text-[13px] font-semibold text-neutral-700"
        >
          <option value="all">All types</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <Card>
        <Table head={["Name", "Type", "Email", "Phone", "Cases", "Added"]} testid="contacts-table">
          {list.map((c) => (
            <tr key={c.id} data-testid="contact-row" onClick={() => setSelected(c)} className="cursor-pointer hover:bg-neutral-50">
              <td className="px-6 py-3.5">
                <span className="flex items-center gap-3">
                  <Avatar name={c.name} size="sm" color={c.type === "company" ? "#3DBDB4" : "#4B4ACF"} />
                  <span className="font-semibold">{c.name}</span>
                </span>
              </td>
              <td className="px-6 py-3.5 capitalize text-neutral-500">{c.type}</td>
              <td className="px-6 py-3.5 text-[#4c4cb8]">{c.email}</td>
              <td className="px-6 py-3.5">{c.phone}</td>
              <td className="px-6 py-3.5">{c.caseIds.length}</td>
              <td className="px-6 py-3.5 text-neutral-500">{fmtDate(c.createdAt)}</td>
            </tr>
          ))}
        </Table>
      </Card>

      {/* detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-neutral-900/30" onClick={() => setSelected(null)}>
          <div data-testid="contact-drawer" className="w-[440px] overflow-y-auto bg-white p-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-4">
              <Avatar name={selected.name} color={selected.type === "company" ? "#3DBDB4" : "#4B4ACF"} />
              <div>
                <h2 className="text-[19px] font-bold text-neutral-900">{selected.name}</h2>
                <p className="text-[13px] capitalize text-neutral-500">{selected.type}</p>
              </div>
            </div>
            <dl className="mt-6 space-y-3 text-[13.5px]">
              <div><dt className="text-neutral-500">Email</dt><dd className="font-medium text-[#4c4cb8]">{selected.email}</dd></div>
              <div><dt className="text-neutral-500">Phone</dt><dd className="font-medium">{selected.phone}</dd></div>
              <div><dt className="text-neutral-500">Address</dt><dd className="font-medium">{selected.address}</dd></div>
              {selected.notes && <div><dt className="text-neutral-500">Notes</dt><dd>{selected.notes}</dd></div>}
            </dl>
            <h3 className="mt-7 text-[14px] font-bold text-neutral-900">Cases</h3>
            <ul className="mt-2 space-y-2">
              {selected.caseIds.map((cid) => {
                const k = (cases ?? []).find((c) => c.id === cid);
                return k ? (
                  <li key={cid} className="rounded-lg border border-neutral-100 px-3.5 py-2.5 text-[13.5px]">
                    <span className="font-semibold text-lawleit">{k.number}</span> <span className="text-neutral-700">{k.title}</span>
                  </li>
                ) : null;
              })}
              {selected.caseIds.length === 0 && <li className="text-[13px] text-neutral-400">No cases linked.</li>}
            </ul>
            <button
              data-testid="contact-delete"
              onClick={async () => { await api.deleteContact(selected.id); setSelected(null); refetch(); }}
              className="mt-8 w-full rounded-lg border border-red-200 py-2.5 text-[13.5px] font-bold text-red-600 hover:bg-red-50"
            >Delete contact</button>
          </div>
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="New contact" testid="contact-modal">
        <div className="space-y-4">
          <Field label="Full name"><input data-testid="contact-name" className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <ConflictWarning name={form.name} />
          <Field label="Type">
            <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email"><input type="email" className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Phone"><input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          </div>
          <Field label="Address"><input className={inputCls} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          <button data-testid="contact-save" onClick={create} className="w-full rounded-full bg-lawleit py-2.5 text-[14px] font-bold text-white hover:bg-lawleit-dark">Save contact</button>
        </div>
      </Modal>
    </div>
  );
}

/**
 * V2 ticket 10 — the conflict screen: as the party's name is typed, a
 * debounced check against the firm's existing contacts surfaces possible
 * conflicts (name overlap + the matters they appear on). NON-BLOCKING by
 * decision: the Bar Council conflict judgment stays the lawyer's — the tool
 * just makes sure it's an informed one.
 */
function ConflictWarning({ name }: { name: string }) {
  const [warning, setWarning] = useState<{ id: string; name: string; type: string; caseNumbers: string[] }[]>([]);

  useEffect(() => {
    const trimmed = name.trim();
    if (trimmed.length < 3) {
      setWarning([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .conflictCheck(trimmed)
        .then((out) => setWarning(out.matches))
        .catch(() => setWarning([]));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [name]);

  if (warning.length === 0) return null;
  return (
    <div data-testid="conflict-warning" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-[12.5px] font-bold text-amber-900">⚠ Possible conflict — check before saving</p>
      <ul className="mt-1.5 space-y-1">
        {warning.map((m) => (
          <li key={m.id} className="text-[12.5px] text-amber-900">
            <span className="font-semibold">{m.name}</span>
            <span className="capitalize"> ({m.type})</span>
            {m.caseNumbers.length > 0 && <span> — on {m.caseNumbers.join(", ")}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
