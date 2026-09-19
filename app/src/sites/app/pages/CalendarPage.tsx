import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/data";
import { useAsync } from "@/lib/hooks";
import { Card, Modal, NewButton, Field, inputCls } from "../ui";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@/lib/data";

const dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [view, setView] = useState<"month" | "week" | "day">("month");
  const [selected, setSelected] = useState(iso(new Date()));
  const [creating, setCreating] = useState<null | { date: string }>(null);
  const [form, setForm] = useState({ title: "", start: "10:00", end: "11:00", location: "", type: "meeting" });

  const from = monthKey(cursor) + "-01";
  const to = iso(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
  const { data: events, refetch } = useAsync(() => api.listEvents({ from, to }), [from, to]);

  const grid = useMemo(() => {
    const first = new Date(cursor);
    const startOffset = (first.getDay() + 6) % 7; // Monday-first
    const days: { date: string; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(first);
      d.setDate(1 - startOffset + i);
      days.push({ date: iso(d), inMonth: d.getMonth() === cursor.getMonth() });
    }
    return days;
  }, [cursor]);

  const eventsOn = (date: string) => (events ?? []).filter((e) => e.date === date);

  const create = async () => {
    await api.createEvent({
      title: form.title || "New event", date: creating?.date ?? selected,
      start: form.start, end: form.end, location: form.location || undefined,
      type: form.type as CalendarEvent["type"],
      color: form.type === "court" ? "#4B4ACF" : form.type === "deadline" ? "#D64550" : "#3DBDB4",
    });
    setCreating(null);
    setForm({ title: "", start: "10:00", end: "11:00", location: "", type: "meeting" });
    refetch();
  };

  const weekDays = useMemo(() => {
    const base = new Date(`${selected}T12:00:00`);
    const offset = (base.getDay() + 6) % 7;
    base.setDate(base.getDate() - offset);
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(base); d.setDate(d.getDate() + i); return iso(d); });
  }, [selected]);

  return (
    <div data-testid="calendar-page" className="px-8 pb-12">
      <div className="flex items-center justify-between pb-4 pt-6">
        <div className="flex items-center gap-4">
          <h1 className="text-[22px] font-bold tracking-tight text-neutral-900">
            {cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </h1>
          <div className="flex items-center gap-1">
            <button aria-label="Previous month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="rounded p-1.5 hover:bg-neutral-100"><ChevronLeft className="h-4 w-4" /></button>
            <button onClick={() => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)); setSelected(iso(n)); }} className="rounded-lg border border-neutral-300 px-3 py-1 text-[12.5px] font-semibold hover:bg-neutral-50">Today</button>
            <button aria-label="Next month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="rounded p-1.5 hover:bg-neutral-100"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="ml-2 flex rounded-lg border border-neutral-200 p-0.5 text-[13px] font-semibold">
            {(["month", "week", "day"] as const).map((v) => (
              <button key={v} data-testid={`calendar-view-${v}`} onClick={() => setView(v)} className={cn("rounded-md px-3 py-1 capitalize", view === v ? "bg-lawleit text-white" : "text-neutral-600 hover:bg-neutral-100")}>{v}</button>
            ))}
          </div>
        </div>
        <NewButton testid="calendar-new" label="Add event" onClick={() => setCreating({ date: selected })} />
      </div>

      {view === "month" && (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-neutral-200 bg-neutral-50/60">
            {dow.map((d) => <div key={d} className="px-3 py-2 text-[12px] font-bold text-neutral-500">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {grid.map(({ date, inMonth }, i) => (
              <div
                key={date}
                data-testid={date === selected ? "calendar-selected-day" : undefined}
                onClick={() => setSelected(date)}
                onDoubleClick={() => setCreating({ date })}
                className={cn("min-h-[104px] border-b border-r border-neutral-100 p-2", !inMonth && "bg-neutral-50/50", date === selected && "bg-[#eeedfb]", i % 7 === 6 && "border-r-0")}
              >
                <p className={cn("mb-1 text-[12px] font-semibold", inMonth ? "text-neutral-700" : "text-neutral-300")}>
                  {Number(date.slice(8))}
                </p>
                <div className="space-y-1">
                  {eventsOn(date).slice(0, 3).map((e) => (
                    <div key={e.id} data-testid="calendar-event" className="truncate rounded px-1.5 py-0.5 text-[10.5px] font-semibold text-white" style={{ background: e.color }}>
                      {e.start} {e.title}
                    </div>
                  ))}
                  {eventsOn(date).length > 3 && <p className="text-[10px] text-neutral-400">+{eventsOn(date).length - 3} more</p>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {view !== "month" && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[2fr_1fr]">
          <Card>
            <div className="divide-y divide-neutral-100">
              {(view === "week" ? weekDays : [selected]).map((d) => (
                <div key={d} className="px-6 py-4">
                  <p className="mb-2 text-[13px] font-bold text-neutral-800">
                    {new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                  </p>
                  {(events ?? []).filter((e) => e.date === d).map((e) => (
                    <div key={e.id} className="mb-1.5 flex gap-3">
                      <span className="w-14 pt-1 text-[12px] text-neutral-500">{e.start}–{e.end}</span>
                      <div className="flex-1 rounded-lg px-3 py-2" style={{ background: `${e.color}14`, borderLeft: `3px solid ${e.color}` }}>
                        <p className="text-[13.5px] font-semibold text-neutral-900">{e.title}</p>
                        {e.location && <p className="text-[12px] text-neutral-500">{e.location}</p>}
                      </div>
                    </div>
                  ))}
                  {eventsOn(d).length === 0 && <p className="text-[12.5px] text-neutral-400">No events</p>}
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-6">
            <h2 className="text-[15px] font-bold">Selected day</h2>
            <p className="mt-1 text-[13px] text-neutral-500">{selected}</p>
            <ul className="mt-4 space-y-2">
              {eventsOn(selected).map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[13.5px] font-semibold">{e.title}</p>
                    <p className="text-[12px] text-neutral-500">{e.start}–{e.end}</p>
                  </div>
                  <button data-testid="calendar-delete-event" onClick={async () => { await api.deleteEvent(e.id); refetch(); }} className="text-[12px] font-semibold text-red-500 hover:underline">Delete</button>
                </li>
              ))}
              {eventsOn(selected).length === 0 && <p className="text-[12.5px] text-neutral-400">Nothing scheduled — double-click a day to add.</p>}
            </ul>
          </Card>
        </div>
      )}

      <Modal open={!!creating} onClose={() => setCreating(null)} title="New event" testid="event-modal">
        <div className="space-y-4">
          <Field label="Title"><input data-testid="event-title" className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Date"><input type="date" className={inputCls} value={creating?.date ?? selected} readOnly /></Field>
            <Field label="Start"><input type="time" className={inputCls} value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></Field>
            <Field label="End"><input type="time" className={inputCls} value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></Field>
          </div>
          <Field label="Location"><input className={inputCls} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
          <Field label="Type">
            <select data-testid="event-type" className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {["meeting", "court", "deadline", "personal", "task"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <button data-testid="event-save" onClick={create} className="w-full rounded-full bg-lawleit py-2.5 text-[14px] font-bold text-white hover:bg-lawleit-dark">Save event</button>
        </div>
      </Modal>
    </div>
  );
}
