import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title, subtitle, actions, testid,
}: { title: string; subtitle?: string; actions?: ReactNode; testid?: string }) {
  return (
    <div className="flex items-center justify-between px-8 pb-2 pt-6">
      <div>
        <h1 data-testid={testid} className="text-[22px] font-bold tracking-tight text-neutral-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-neutral-500">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}

export function NewButton({ onClick, label = "New", testid }: { onClick?: () => void; label?: string; testid?: string }) {
  return (
    <button
      data-testid={testid ?? "new-button"}
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg bg-lawleit px-4 py-2 text-[13.5px] font-bold text-white hover:bg-lawleit-dark"
    >
      <Plus className="h-4 w-4" /> {label}
    </button>
  );
}

export function Card({ children, className = "", testid }: { children: ReactNode; className?: string; testid?: string }) {
  return (
    <div data-testid={testid} className={cn("rounded-xl border border-neutral-200/80 bg-white shadow-[0_1px_3px_rgba(16,24,40,0.06)]", className)}>
      {children}
    </div>
  );
}

export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-6 pb-3 pt-5">
      <h2 className="text-[15px] font-bold text-neutral-900">{children}</h2>
      {right}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    open: "bg-emerald-50 text-emerald-700", pending: "bg-amber-50 text-amber-700",
    closed: "bg-neutral-100 text-neutral-500", draft: "bg-neutral-100 text-neutral-600",
    sent: "bg-blue-50 text-blue-700", overdue: "bg-red-50 text-red-700", paid: "bg-emerald-50 text-emerald-700",
    deposited: "bg-emerald-50 text-emerald-700", failed: "bg-red-50 text-red-700",
    todo: "bg-neutral-100 text-neutral-600", in_progress: "bg-blue-50 text-blue-700",
    blocked: "bg-red-50 text-red-700", done: "bg-emerald-50 text-emerald-700",
    high: "bg-red-50 text-red-700", medium: "bg-amber-50 text-amber-700", low: "bg-neutral-100 text-neutral-600",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-bold capitalize", map[status] ?? "bg-neutral-100 text-neutral-600")}>
      {status.replace("_", " ")}
    </span>
  );
}

export function Table({ head, children, testid }: { head: string[]; children: ReactNode; testid?: string }) {
  return (
    <div className="overflow-x-auto">
      <table data-testid={testid} className="w-full text-left text-[13.5px]">
        <thead>
          <tr className="border-b border-neutral-200 text-[11.5px] uppercase tracking-wide text-neutral-500">
            {head.map((h, i) => (
              <th key={h} className={cn("px-6 py-3 font-semibold", i === head.length - 1 && "text-right")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100 text-neutral-800">{children}</tbody>
      </table>
    </div>
  );
}

export function Avatar({ name, color, size = "md" }: { name: string; color?: string; size?: "sm" | "md" }) {
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white", size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-[12px]")}
      style={{ background: color ?? "#4B4ACF" }}
    >
      {initials}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-[13px] font-semibold text-neutral-700">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-[14px] outline-none focus:border-lawleit";

export function Modal({ open, onClose, title, children, testid }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; testid?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-6" onClick={onClose}>
      <div
        data-testid={testid}
        className="max-h-[85vh] w-[560px] overflow-y-auto rounded-2xl bg-white p-7 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[19px] font-bold text-neutral-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100">✕</button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}
