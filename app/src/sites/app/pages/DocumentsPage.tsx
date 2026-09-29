import { useState } from "react";
import { File, FileImage, FileSpreadsheet, FileText, Star } from "lucide-react";
import { api, apiMode } from "@/lib/data";
import { useAsync, fmtDate } from "@/lib/hooks";
import { Card, Modal, NewButton, PageHeader, Field, inputCls } from "../ui";
import { cn } from "@/lib/utils";
import type { DocumentFile } from "@/lib/data";

const KIND_ICON: Record<string, typeof File> = {
  doc: FileText, pdf: File, sheet: FileSpreadsheet, image: FileImage, template: FileText, other: File,
};

export default function DocumentsPage() {
  const { data: docs, refetch } = useAsync(() => api.listDocuments(), []);
  const { data: cases } = useAsync(() => api.listCases(), []);
  const [folder, setFolder] = useState<string>("All");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", folder: "General", caseId: "", kind: "doc" });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const folders = ["All", ...new Set((docs ?? []).map((d) => d.folder))];
  const list = (docs ?? []).filter((d) => folder === "All" || d.folder === folder);

  const create = async () => {
    setError(null);
    try {
      if (file) {
        // Real upload through the seam (ticket 17): type/size rules are
        // enforced by the adapter (server-side in http mode), so a rejected
        // file surfaces here as the error message below.
        await api.uploadDocument({
          file,
          name: form.name || undefined,
          folder: form.folder,
          caseId: form.caseId || undefined,
        });
      } else {
        await api.createDocument({
          name: form.name || "Untitled.docx",
          folder: form.folder,
          caseId: form.caseId || undefined,
          kind: form.kind as DocumentFile["kind"],
          sizeKb: Math.round(20 + Math.random() * 400),
        });
      }
      setFile(null);
      setCreating(false);
      refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  };

  const download = async (id: string) => {
    const url = await api.getDocumentDownloadUrl(id);
    window.open(url, "_blank", "noopener");
  };

  return (
    <div data-testid="documents-page" className="px-8 pb-12">
      <PageHeader
        title="Documents"
        subtitle={`${(docs ?? []).length} files · folders and templates`}
        actions={<NewButton testid="document-new" label="Upload document" onClick={() => setCreating(true)} />}
      />
      <div className="flex gap-6">
        <div className="w-52 shrink-0">
          <Card className="p-2">
            {folders.map((f) => (
              <button
                key={f}
                data-testid={`folder-${f.toLowerCase().replace(/\s/g, "-")}`}
                onClick={() => setFolder(f)}
                className={cn("flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13.5px] font-medium",
                  folder === f ? "bg-[#eeedfb] text-lawleit" : "text-neutral-700 hover:bg-neutral-50")}
              >
                {f}
                <span className="text-[11px] text-neutral-400">{f === "All" ? (docs ?? []).length : (docs ?? []).filter((d) => d.folder === f).length}</span>
              </button>
            ))}
          </Card>
        </div>
        <Card className="flex-1">
          <div className="divide-y divide-neutral-100">
            {list.map((d) => {
              const Icon = KIND_ICON[d.kind] ?? File;
              return (
                <div key={d.id} data-testid="document-row" className="flex items-center gap-4 px-6 py-3.5 hover:bg-neutral-50">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#eeedfb]">
                    <Icon className="h-4.5 w-4.5 text-lawleit" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold text-neutral-900">{d.name}</p>
                    <p className="text-[12px] text-neutral-500">
                      {d.folder} · updated {fmtDate(d.updatedAt)} · {(d.sizeKb / 1024).toFixed(1)} MB
                    </p>
                  </div>
                  {d.templateFields && (
                    <span className="rounded-full bg-[#e9f5f0] px-2 py-0.5 text-[11px] font-bold text-[#1d6e63]">
                      {d.templateFields.length} merge fields
                    </span>
                  )}
                  <button
                    aria-label="Star document"
                    data-testid="document-star"
                    onClick={async () => { await api.updateDocument(d.id, { starred: !d.starred }); refetch(); }}
                    className={cn("rounded p-1", d.starred ? "text-amber-400" : "text-neutral-300 hover:text-amber-400")}
                  >
                    <Star className={cn("h-4 w-4", d.starred && "fill-current")} />
                  </button>
                  {d.hasFile && (
                    <button
                      aria-label="Download document"
                      data-testid="document-download"
                      onClick={() => download(d.id)}
                      className="text-[12px] font-semibold text-lawleit hover:underline"
                    >Download</button>
                  )}
                  <button
                    aria-label="Delete document"
                    onClick={async () => { await api.deleteDocument(d.id); refetch(); }}
                    className="text-[12px] font-semibold text-red-500 hover:underline"
                  >Delete</button>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Upload document" testid="document-modal">
        <div className="space-y-4">
          <Field label="File name"><input data-testid="document-name" className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Motion to Compel.docx" /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Folder"><input className={inputCls} value={form.folder} onChange={(e) => setForm({ ...form, folder: e.target.value })} /></Field>
            <Field label="Kind">
              <select className={inputCls} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {["doc", "pdf", "sheet", "image", "template"].map((k) => <option key={k}>{k}</option>)}
              </select>
            </Field>
            <Field label="Case">
              <select className={inputCls} value={form.caseId} onChange={(e) => setForm({ ...form, caseId: e.target.value })}>
                <option value="">None</option>
                {(cases ?? []).map((c) => <option key={c.id} value={c.id}>{c.number}</option>)}
              </select>
            </Field>
          </div>
          <label className="block cursor-pointer rounded-xl border-2 border-dashed border-neutral-300 p-6 text-center text-[13px] text-neutral-500 hover:border-lawleit/40 hover:bg-neutral-50">
            <input
              type="file"
              data-testid="document-file"
              className="hidden"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }}
            />
            {file ? (
              <span className="font-semibold text-lawleit">
                {file.name} — {(file.size / 1024).toFixed(0)} KB chosen · click to change
              </span>
            ) : (
              <>Choose a file — it uploads for real{apiMode === "mock" ? " (demo caps at 1 MB)" : ", max 25 MB"}</>
            )}
          </label>
          {error && (
            <p data-testid="document-error" role="alert" className="text-[12.5px] font-semibold text-red-500">
              {error}
            </p>
          )}
          <button data-testid="document-save" onClick={create} className="w-full rounded-full bg-lawleit py-2.5 text-[14px] font-bold text-white hover:bg-lawleit-dark">Save document</button>
        </div>
      </Modal>
    </div>
  );
}
