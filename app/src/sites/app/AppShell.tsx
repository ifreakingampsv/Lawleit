import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import {
  Bell, ChevronDown, ChevronRight, Clock, FileText, Folder,
  Gauge, Home, IndianRupee, LayoutGrid, LogOut, Menu, MessagesSquare, Play, Plus, RotateCcw, Search,
  Settings, Square, Users,
} from "lucide-react";
import { GemMark, Logo } from "@/lib/brand";
import { api, apiMode } from "@/lib/data";
import { startDemoSession } from "@/lib/data/demo";
import { useAsync } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { resetDemoData } from "./demoReset";
import type { TimeEntry, User } from "@/lib/data";
import type { TimerState } from "./context";

/* ---------------- run-timer store (global-ish, topbar owned) ---------------- */

const TIMER_KEY = "lawleit.timer.v1";
export function loadTimer(): TimerState {
  try {
    const raw = localStorage.getItem(TIMER_KEY);
    if (raw) return JSON.parse(raw) as TimerState;
  } catch { /* ignore */ }
  return { running: false, startedAt: 0, accrued: 0, description: "", caseId: null };
}
export function saveTimer(t: TimerState) { localStorage.setItem(TIMER_KEY, JSON.stringify(t)); }

function useTimer() {
  const [state, setState] = useState<TimerState>(loadTimer);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!state.running) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [state.running]);
  const update = (next: TimerState) => { setState(next); saveTimer(next); };
  const elapsed = state.accrued + (state.running ? Math.floor((Date.now() - state.startedAt) / 1000) : 0);
  return { state, update, elapsed };
}

const hhmmss = (s: number) =>
  [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");

/* ---------------- shell ---------------- */

const NAV = [
  { to: "/app", label: "Home", icon: Home, end: true },
  { to: "/app/calendar", label: "Calendar", icon: Clock },
  { to: "/app/tasks", label: "Tasks", icon: Square },
  { to: "/app/cases", label: "Cases", icon: Folder },
  { to: "/app/contacts", label: "Contacts", icon: Users },
  { to: "/app/reports", label: "Reports", icon: Gauge },
];
const MODULES = [
  { to: "/app/billing/invoices", label: "Billing", icon: FileText },
  { to: "/app/payments", label: "Payments", icon: IndianRupee },
  { to: "/app/accounting", label: "Accounting", icon: IndianRupee },
  { to: "/app/documents", label: "Documents", icon: FileText },
  { to: "/app/communications", label: "Communications", icon: MessagesSquare },
  { to: "/app/leads", label: "Leads", icon: LayoutGrid },
];

export default function AppShell() {
  const { data: session, loading: sessionLoading, refetch: refetchSession } = useAsync(() => api.getSession(), []);
  const navigate = useNavigate();
  const { state: timer, update: setTimer, elapsed } = useTimer();
  const { data: notifications, refetch: refetchNotifs } = useAsync(() => api.listNotifications(), []);
  const [notifOpen, setNotifOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    if (sessionLoading || session) return;
    if (apiMode === "mock") {
      // Demo Version: deep links never hit a login wall — the local session
      // establishes itself (ADR 0001). Production keeps the auth gate.
      startDemoSession().then(refetchSession);
    } else {
      navigate("/login");
    }
  }, [sessionLoading, session, navigate, refetchSession]);

  const unread = (notifications ?? []).filter((n) => !n.read).length;

  const toggleTimer = async () => {
    if (timer.running) {
      const minutes = Math.max(1, Math.round(elapsed / 60));
      const entry = await api.createTimeEntry({
        minutes,
        description: timer.description || "Timer entry",
        billable: true,
        date: new Date().toISOString().slice(0, 10),
      });
      setTimer({ running: false, startedAt: 0, accrued: 0, description: "", caseId: null });
      window.dispatchEvent(new CustomEvent("lawleit:time-logged", { detail: entry }));
    } else {
      setTimer({ ...timer, running: true, startedAt: Date.now() });
    }
  };

  const logout = async () => { await api.logout(); navigate("/login"); };

  return (
    <div className="flex min-h-screen bg-[#f4f5f7]">
      {/* [S34] dark sidebar */}
      <aside data-testid="app-sidebar" className="sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-[#232233] text-[#c9c8dc]">
        <div className="px-5 py-5"><Logo light size="sm" /></div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 text-[14px]">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to} to={to} end={end}
              className={({ isActive }) =>
                cn("flex items-center gap-3 rounded-lg px-3 py-2.5 font-medium hover:bg-white/5",
                  isActive && "bg-white/10 text-white")}
            >
              <Icon className="h-4 w-4" /> {label}
            </NavLink>
          ))}
          <p className="px-3 pb-2 pt-6 text-[11px] font-bold uppercase tracking-wider text-white/35">Modules</p>
          {MODULES.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to} to={to}
              className={({ isActive }) =>
                cn("flex items-center gap-3 rounded-lg px-3 py-2.5 font-medium hover:bg-white/5",
                  isActive && "bg-white/10 text-white")}
            >
              <Icon className="h-4 w-4" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <NavLink to="/app/settings" className={({ isActive }) => cn("flex items-center gap-3 rounded-lg px-3 py-2.5 font-medium hover:bg-white/5", isActive && "bg-white/10 text-white")}>
            <Settings className="h-4 w-4" /> Settings
          </NavLink>
          <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 font-medium hover:bg-white/5">
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* top bar */}
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-neutral-200 bg-white px-4">
          <button aria-label="Toggle sidebar" className="rounded p-1.5 text-neutral-500 hover:bg-neutral-100"><Menu className="h-5 w-5" /></button>
          <div className="relative w-[330px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              data-testid="global-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)}
              placeholder="Search"
              className="h-9 w-full rounded-lg bg-neutral-100 pl-9 pr-3 text-[14px] outline-none placeholder:text-neutral-400 focus:bg-white focus:ring-1 focus:ring-lawleit"
            />
            {searchOpen && search.length > 1 && <GlobalSearch query={search} onDone={() => setSearch("")} />}
          </div>
          {/* run timer */}
          <div className="ml-2 flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-1.5">
            <button data-testid="timer-toggle" onClick={toggleTimer} aria-label={timer.running ? "Stop timer" : "Start timer"}
              className={cn("rounded p-0.5", timer.running ? "text-red-500" : "text-emerald-600 hover:bg-neutral-100")}>
              {timer.running ? <Square className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
            </button>
            <span data-testid="timer-readout" className="font-mono text-[14px] font-semibold text-neutral-800">{hhmmss(elapsed)}</span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button aria-label="Print" className="rounded p-2 text-neutral-500 hover:bg-neutral-100"><FileText className="h-4.5 w-4.5" /></button>
            <button aria-label="Apps" className="rounded p-2 text-neutral-500 hover:bg-neutral-100"><LayoutGrid className="h-4.5 w-4.5" /></button>
            <button
              data-testid="notifications-button"
              aria-label="Notifications"
              onClick={() => { setNotifOpen((o) => !o); if (unread) { api.markNotificationsRead().then(refetchNotifs); } }}
              className="relative rounded p-2 text-neutral-500 hover:bg-neutral-100"
            >
              <Bell className="h-4.5 w-4.5" />
              {unread > 0 && (
                <span data-testid="notifications-badge" className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </button>
            {notifOpen && (
              <div data-testid="notifications-drawer" className="absolute right-40 top-12 z-50 w-80 rounded-xl border border-neutral-200 bg-white p-2 shadow-2xl">
                <p className="px-3 py-2 text-[13px] font-bold text-neutral-800">Notifications</p>
                {(notifications ?? []).map((n) => (
                  <div key={n.id} className="flex gap-2.5 rounded-lg px-3 py-2.5 hover:bg-neutral-50">
                    <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", n.kind === "payment" ? "bg-emerald-500" : n.kind === "deadline" ? "bg-red-500" : "bg-lawleit")} />
                    <div>
                      <p className="text-[13px] text-neutral-800">{n.text}</p>
                      <p className="text-[11px] text-neutral-400">{new Date(n.at).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button aria-label="Messages" className="rounded p-2 text-neutral-500 hover:bg-neutral-100"><MessagesSquare className="h-4.5 w-4.5" /></button>
            <button aria-label="Lawleit AI" className="rounded p-2 text-neutral-500 hover:bg-neutral-100">
              <GemMark size={18} className="text-lawleit" />
            </button>
            <button
              data-testid="quick-add"
              aria-label="Quick add"
              onClick={() => navigate("/app/cases?new=1")}
              className="ml-1 rounded-lg bg-lawleit p-2 text-white hover:bg-lawleit-dark"
            >
              <Plus className="h-4.5 w-4.5" />
            </button>
            {apiMode === "mock" && (
              <span data-testid="demo-badge" title="Demo Version — your edits stay in this browser" className="mr-1 rounded-full bg-lawleit/10 px-2.5 py-1 text-[11px] font-bold text-lawleit">
                Demo
              </span>
            )}
            <button
              data-testid="account-button"
              aria-label="Account"
              onClick={() => setAccountOpen((o) => !o)}
              className="ml-2 flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-100"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-lawleit text-[12px] font-bold text-white">
                {(session?.user.name ?? "AL").split(" ").map((p) => p[0]).slice(0, 2).join("")}
              </span>
            </button>
            {accountOpen && (
              <div data-testid="account-menu" className="absolute right-4 top-12 z-50 w-64 rounded-xl border border-neutral-200 bg-white p-2 shadow-2xl">
                <div className="px-3 py-2">
                  <p className="text-[13px] font-bold text-neutral-800">{session?.user.name}</p>
                  <p className="truncate text-[11px] text-neutral-400">{session?.user.email}</p>
                </div>
                <div className="my-1 h-px bg-neutral-100" />
                {apiMode === "mock" && (
                  <button
                    data-testid="reset-demo"
                    onClick={() => {
                      setAccountOpen(false);
                      if (!window.confirm("Reset demo data? This wipes every change you made in this browser and restores the seeded Demo Firm.")) return;
                      void resetDemoData();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-neutral-800 hover:bg-neutral-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5 text-neutral-400" /> Reset demo data
                  </button>
                )}
                <button onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-neutral-800 hover:bg-neutral-50">
                  <LogOut className="h-3.5 w-3.5 text-neutral-400" /> Log out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="min-w-0 flex-1">
          <Outlet context={{ session, timer, setTimer }} />
        </main>
      </div>
    </div>
  );
}

/** Lightweight global search across cases/contacts (mock, client-side). */
function GlobalSearch({ query, onDone }: { query: string; onDone: () => void }) {
  const navigate = useNavigate();
  const { data: cases } = useAsync(() => api.listCases(), []);
  const { data: contacts } = useAsync(() => api.listContacts(), []);
  const q = query.toLowerCase();
  const caseHits = (cases ?? []).filter((c) => `${c.title} ${c.number}`.toLowerCase().includes(q)).slice(0, 4);
  const contactHits = (contacts ?? []).filter((c) => c.name.toLowerCase().includes(q)).slice(0, 3);
  if (!caseHits.length && !contactHits.length) return null;
  return (
    <div className="absolute left-0 top-10 z-50 w-full rounded-xl border border-neutral-200 bg-white p-2 shadow-2xl">
      {caseHits.map((c) => (
        <button key={c.id} onClick={() => { navigate(`/app/cases/${c.id}`); onDone(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-neutral-50">
          <Folder className="h-3.5 w-3.5 text-neutral-400" /> {c.title} <span className="text-neutral-400">{c.number}</span>
        </button>
      ))}
      {contactHits.map((c) => (
        <button key={c.id} onClick={() => { navigate("/app/contacts"); onDone(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-neutral-50">
          <Users className="h-3.5 w-3.5 text-neutral-400" /> {c.name}
        </button>
      ))}
    </div>
  );
}

export { hhmmss };
