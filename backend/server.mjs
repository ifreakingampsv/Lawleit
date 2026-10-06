#!/usr/bin/env node
/**
 * Lawleit reference backend — implements docs/API_CONTRACT.md 1:1.
 *
 * Purpose: a working, runnable stand-in for the owner's real backend. It is a
 * dev/demo server, NOT a production system: JSON-file storage, demo auth, no
 * rate limiting, no TLS. Every handler is intentionally small so it can be
 * ported to the real stack (or kept as-is behind a reverse proxy) later.
 *
 * Run:            node backend/server.mjs            (Node >= 24 — imports seed.ts)
 * Reset to seed:  node backend/server.mjs --reset
 * Env:            PORT (default 8787), HOST (default 127.0.0.1),
 *                 LAWLEIT_DB (default backend/data/db.json)
 *
 * Storage: one JSON file (backend/data/db.json), written atomically on every
 * mutation. Delete the file (or --reset) to start from the demo seed.
 *
 * Auth: POST /auth/login|signup return { token, user, firm, users } and set an
 * httpOnly cookie; every other endpoint requires the token via the cookie or
 * `Authorization: Bearer`. DEMO MODE: any non-empty password is accepted and an
 * unknown email logs in as the first seeded user (same behavior as the mock
 * adapter). Replacing this with real credential checks is OWNER WORK — see
 * docs/BACKEND.md "What still needs the owner".
 *
 * Seed data: imported directly from app/src/lib/data/seed.ts — the same single
 * source of truth the mock adapter uses, so both backends demo identically.
 */
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  seedCases, seedContacts, seedDocuments, seedEvents, seedExpenses, seedFirm,
  seedInvoices, seedLeads, seedPayments, seedReports, seedTasks, seedThreads,
  seedTimeEntries, seedTrust, seedUsers, nid,
} from "../app/src/lib/data/seed.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.LAWLEIT_DB ?? path.join(__dirname, "data", "db.json");
const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 8787);
const RESET = process.argv.includes("--reset");

// ---------------------------------------------------------------- storage ---

function freshDb() {
  return {
    tokens: {},
    users: structuredClone(seedUsers),
    firm: structuredClone(seedFirm),
    cases: structuredClone(seedCases),
    contacts: structuredClone(seedContacts),
    events: structuredClone(seedEvents),
    tasks: structuredClone(seedTasks),
    timeEntries: structuredClone(seedTimeEntries),
    expenses: structuredClone(seedExpenses),
    invoices: structuredClone(seedInvoices),
    payments: structuredClone(seedPayments),
    trust: structuredClone(seedTrust),
    documents: structuredClone(seedDocuments),
    threads: structuredClone(seedThreads),
    leads: structuredClone(seedLeads),
    notifications: [
      { id: nid("n"), text: "Payment of $500.00 received from Barbara Jones", at: new Date(Date.now() - 36e5).toISOString(), read: false, kind: "payment" },
      { id: nid("n"), text: "Deposition: Marcus Webb tomorrow at 9:30 AM", at: new Date(Date.now() - 72e5).toISOString(), read: false, kind: "deadline" },
      { id: nid("n"), text: "New message from Elena Vasquez", at: new Date(Date.now() - 180e5).toISOString(), read: false, kind: "message" },
    ],
  };
}

function loadDb() {
  if (!RESET && fs.existsSync(DB_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    } catch (e) {
      console.warn(`[db] ${DB_PATH} unreadable (${e.message}) — reseeding`);
    }
  }
  const db = freshDb();
  persist(db);
  return db;
}

function persist(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

const db = loadDb();
if (RESET) console.log("[db] --reset: reseeded", DB_PATH);

// ---------------------------------------------------------------- helpers ---

const today = () => new Date().toISOString().slice(0, 10);

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}
function noContent(res) {
  res.writeHead(204);
  res.end();
}
function fail(res, status, error) {
  json(res, status, { error });
}

function currentUser(req) {
  const auth = req.headers.authorization;
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const cookieToken = /(?:^|;\s*)lawleit_session=([^;]+)/.exec(req.headers.cookie ?? "")?.[1] ?? null;
  const token = bearer ?? cookieToken;
  if (!token) return null;
  const userId = db.tokens[token];
  if (!userId) return null;
  const user = db.users.find((u) => u.id === userId);
  return user ? { user, token } : null;
}

function sessionPayload(user) {
  return { user, firm: db.firm, users: db.users };
}

function issueToken(userId) {
  const token = crypto.randomUUID();
  db.tokens[token] = userId;
  return token;
}

function sessionCookie(token) {
  return `lawleit_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`;
}
const CLEAR_COOKIE = "lawleit_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0";

/** Trusted-client ledger: running balanceAfter per client (contract §trust). */
function appendTrust({ clientId, caseId, description, amount }) {
  const prev = [...db.trust].reverse().find((t) => t.clientId === clientId);
  const tx = {
    id: nid("tt"), clientId, caseId, date: today(), description,
    amount, balanceAfter: (prev?.balanceAfter ?? 0) + amount,
  };
  db.trust.push(tx);
  return tx;
}

/** Invoice status roll-up (contract §server-side responsibilities). */
function rollUpInvoice(invoiceId) {
  const iv = db.invoices.find((i) => i.id === invoiceId);
  if (!iv) return;
  const total = iv.lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  const paid = db.payments
    .filter((p) => p.invoiceId === iv.id && p.status !== "failed")
    .reduce((s, p) => s + p.amount, 0);
  iv.status = paid >= total ? "paid" : iv.status === "draft" ? "draft" : "sent";
}

const assignCaseNumber = () => `2026-${String(db.cases.length + 50).padStart(4, "0")}`;
const assignInvoiceNumber = () => `INV-${String(1044 + db.invoices.length).padStart(4, "0")}`;

// ------------------------------------------------------------------ router ---

// [method, pattern, handler(ctx)] — pattern may contain :params.
// Public (no-auth) routes are marked public: true.
const routes = [];
const route = (method, pattern, handler, opts = {}) =>
  routes.push({ method, segments: pattern.split("/").filter(Boolean), handler, public: !!opts.public });

function match(routeDef, method, segments) {
  if (routeDef.method !== method) return null;
  if (routeDef.segments.length !== segments.length) return null;
  const params = {};
  for (let i = 0; i < segments.length; i++) {
    const seg = routeDef.segments[i];
    if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(segments[i]);
    else if (seg !== segments[i]) return null;
  }
  return params;
}

const find = (list, id) => list.find((x) => x.id === id);
const byIdOr404 = (res, list, id, label) => {
  const item = find(list, id);
  if (!item) fail(res, 404, `${label} not found`);
  return item;
};

// ---- auth (public) ----
route("POST", "/auth/login", (ctx) => {
  const email = String(ctx.body.email ?? "");
  if (!email || !ctx.body.password) return fail(ctx.res, 401, "Email and password required");
  const user = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? db.users[0];
  const token = issueToken(user.id);
  ctx.res.setHeader("Set-Cookie", sessionCookie(token));
  json(ctx.res, 200, { token, ...sessionPayload(user) });
}, { public: true });

route("POST", "/auth/signup", (ctx) => {
  const b = ctx.body ?? {};
  const user = {
    id: nid("u"), firmId: db.firm.id,
    name: `${b.firstName ?? ""} ${b.lastName ?? ""}`.trim() || "Firm Owner",
    email: b.email ?? "", role: "owner", avatarColor: "#4B4ACF",
    hourlyRate: 300, active: true,
  };
  db.users = [user, ...db.users.filter((u) => u.role !== "owner")];
  db.firm = {
    ...db.firm,
    name: b.firmName || db.firm.name,
    phone: b.phone || db.firm.phone,
    address: b.zip
      ? `${db.firm.address.split(", ").slice(0, -1).join(", ")}, ${b.zip}`
      : db.firm.address,
    trialEndsAt: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10),
  };
  const token = issueToken(user.id);
  persist(db);
  ctx.res.setHeader("Set-Cookie", sessionCookie(token));
  json(ctx.res, 201, { token, ...sessionPayload(user) });
}, { public: true });

route("POST", "/auth/logout", (ctx) => {
  delete db.tokens[ctx.session.token];
  persist(db);
  ctx.res.setHeader("Set-Cookie", CLEAR_COOKIE);
  noContent(ctx.res);
});

route("GET", "/session", (ctx) => json(ctx.res, 200, sessionPayload(ctx.session.user)));

// ---- firm & users ----
route("PATCH", "/firm", (ctx) => {
  db.firm = { ...db.firm, ...ctx.body };
  persist(db);
  json(ctx.res, 200, db.firm);
});

route("GET", "/users", (ctx) => json(ctx.res, 200, db.users));

route("PATCH", "/users/:id", (ctx) => {
  const user = byIdOr404(ctx.res, db.users, ctx.params.id, "User");
  if (!user) return;
  Object.assign(user, ctx.body);
  persist(db);
  json(ctx.res, 200, user);
});

// ---- cases ----
route("GET", "/cases", (ctx) => {
  let rows = db.cases;
  if (ctx.query.status) rows = rows.filter((c) => c.status === ctx.query.status);
  if (ctx.query.q) {
    const q = ctx.query.q.toLowerCase();
    rows = rows.filter((c) => `${c.number} ${c.title}`.toLowerCase().includes(q));
  }
  json(ctx.res, 200, rows);
});

route("GET", "/cases/:id", (ctx) => {
  const c = byIdOr404(ctx.res, db.cases, ctx.params.id, "Case");
  if (c) json(ctx.res, 200, c);
});

route("POST", "/cases", (ctx) => {
  const b = ctx.body ?? {};
  const c = {
    id: nid("k"), number: assignCaseNumber(), title: b.title ?? "New matter",
    clientId: b.clientId ?? "", practiceArea: b.practiceArea ?? "General",
    stage: b.stage ?? "intake", status: b.status ?? "open", openDate: today(),
    leadAttorneyId: b.leadAttorneyId ?? db.users[0].id,
    description: b.description ?? "", billableRate: b.billableRate ?? 300, trustBalance: 0,
  };
  db.cases.unshift(c);
  persist(db);
  json(ctx.res, 201, c);
});

route("PATCH", "/cases/:id", (ctx) => {
  const c = byIdOr404(ctx.res, db.cases, ctx.params.id, "Case");
  if (!c) return;
  Object.assign(c, ctx.body);
  persist(db);
  json(ctx.res, 200, c);
});

route("DELETE", "/cases/:id", (ctx) => {
  const before = db.cases.length;
  db.cases = db.cases.filter((c) => c.id !== ctx.params.id);
  if (db.cases.length === before) return fail(ctx.res, 404, "Case not found");
  persist(db);
  noContent(ctx.res);
});

// ---- contacts ----
route("GET", "/contacts", (ctx) => json(ctx.res, 200, db.contacts));

route("GET", "/contacts/:id", (ctx) => {
  const c = byIdOr404(ctx.res, db.contacts, ctx.params.id, "Contact");
  if (c) json(ctx.res, 200, c);
});

route("POST", "/contacts", (ctx) => {
  const b = ctx.body ?? {};
  const c = {
    id: nid("c"), type: b.type ?? "client", name: b.name ?? "New contact",
    email: b.email ?? "", phone: b.phone ?? "", address: b.address ?? "",
    caseIds: b.caseIds ?? [], createdAt: today(), notes: b.notes,
  };
  db.contacts.unshift(c);
  persist(db);
  json(ctx.res, 201, c);
});

route("PATCH", "/contacts/:id", (ctx) => {
  const c = byIdOr404(ctx.res, db.contacts, ctx.params.id, "Contact");
  if (!c) return;
  Object.assign(c, ctx.body);
  persist(db);
  json(ctx.res, 200, c);
});

route("DELETE", "/contacts/:id", (ctx) => {
  const before = db.contacts.length;
  db.contacts = db.contacts.filter((c) => c.id !== ctx.params.id);
  if (db.contacts.length === before) return fail(ctx.res, 404, "Contact not found");
  persist(db);
  noContent(ctx.res);
});

// ---- calendar ----
route("GET", "/events", (ctx) => {
  const { from, to } = ctx.query;
  const rows = db.events.filter((e) => (!from || e.date >= from) && (!to || e.date <= to));
  json(ctx.res, 200, rows);
});

route("POST", "/events", (ctx) => {
  const b = ctx.body ?? {};
  const e = {
    id: nid("e"), title: b.title ?? "New event", date: b.date ?? today(),
    start: b.start ?? "09:00", end: b.end ?? "10:00", location: b.location,
    caseId: b.caseId, attendeeIds: b.attendeeIds ?? [], type: b.type ?? "meeting",
    color: b.color ?? "#4B4ACF", reminders: b.reminders, allDay: b.allDay,
  };
  db.events.push(e);
  persist(db);
  json(ctx.res, 201, e);
});

route("PATCH", "/events/:id", (ctx) => {
  const e = byIdOr404(ctx.res, db.events, ctx.params.id, "Event");
  if (!e) return;
  Object.assign(e, ctx.body);
  persist(db);
  json(ctx.res, 200, e);
});

route("DELETE", "/events/:id", (ctx) => {
  const before = db.events.length;
  db.events = db.events.filter((e) => e.id !== ctx.params.id);
  if (db.events.length === before) return fail(ctx.res, 404, "Event not found");
  persist(db);
  noContent(ctx.res);
});

// ---- tasks ----
route("GET", "/tasks", (ctx) => json(ctx.res, 200, db.tasks));

route("POST", "/tasks", (ctx) => {
  const b = ctx.body ?? {};
  const t = {
    id: nid("t"), title: b.title ?? "New task", dueDate: b.dueDate ?? today(),
    priority: b.priority ?? "medium", status: b.status ?? "todo",
    caseId: b.caseId, assigneeId: b.assigneeId ?? db.users[0].id,
    createdAt: today(), description: b.description,
  };
  db.tasks.unshift(t);
  persist(db);
  json(ctx.res, 201, t);
});

route("PATCH", "/tasks/:id", (ctx) => {
  const t = byIdOr404(ctx.res, db.tasks, ctx.params.id, "Task");
  if (!t) return;
  Object.assign(t, ctx.body);
  persist(db);
  json(ctx.res, 200, t);
});

route("DELETE", "/tasks/:id", (ctx) => {
  const before = db.tasks.length;
  db.tasks = db.tasks.filter((t) => t.id !== ctx.params.id);
  if (db.tasks.length === before) return fail(ctx.res, 404, "Task not found");
  persist(db);
  noContent(ctx.res);
});

// ---- time & expenses ----
route("GET", "/time-entries", (ctx) => json(ctx.res, 200, db.timeEntries));

route("POST", "/time-entries", (ctx) => {
  const b = ctx.body ?? {};
  const t = {
    id: nid("te"), userId: b.userId ?? db.users[0].id,
    caseId: b.caseId ?? db.cases[0]?.id ?? "k1", date: b.date ?? today(),
    minutes: b.minutes ?? 0, rate: b.rate ?? 300, description: b.description ?? "",
    billable: b.billable ?? true, invoiced: false,
  };
  db.timeEntries.unshift(t);
  persist(db);
  json(ctx.res, 201, t);
});

route("PATCH", "/time-entries/:id", (ctx) => {
  const t = byIdOr404(ctx.res, db.timeEntries, ctx.params.id, "Time entry");
  if (!t) return;
  Object.assign(t, ctx.body);
  persist(db);
  json(ctx.res, 200, t);
});

route("DELETE", "/time-entries/:id", (ctx) => {
  const before = db.timeEntries.length;
  db.timeEntries = db.timeEntries.filter((t) => t.id !== ctx.params.id);
  if (db.timeEntries.length === before) return fail(ctx.res, 404, "Time entry not found");
  persist(db);
  noContent(ctx.res);
});

route("GET", "/expenses", (ctx) => json(ctx.res, 200, db.expenses));

route("POST", "/expenses", (ctx) => {
  const b = ctx.body ?? {};
  const x = {
    id: nid("x"), caseId: b.caseId ?? db.cases[0]?.id ?? "k1", date: b.date ?? today(),
    description: b.description ?? "", amount: b.amount ?? 0,
    billable: b.billable ?? true, invoiced: false, category: b.category ?? "other",
  };
  db.expenses.unshift(x);
  persist(db);
  json(ctx.res, 201, x);
});

route("PATCH", "/expenses/:id", (ctx) => {
  const x = byIdOr404(ctx.res, db.expenses, ctx.params.id, "Expense");
  if (!x) return;
  Object.assign(x, ctx.body);
  persist(db);
  json(ctx.res, 200, x);
});

route("DELETE", "/expenses/:id", (ctx) => {
  const before = db.expenses.length;
  db.expenses = db.expenses.filter((e) => e.id !== ctx.params.id);
  if (db.expenses.length === before) return fail(ctx.res, 404, "Expense not found");
  persist(db);
  noContent(ctx.res);
});

// ---- billing ----
route("GET", "/invoices", (ctx) => json(ctx.res, 200, db.invoices));

route("GET", "/invoices/:id", (ctx) => {
  const iv = byIdOr404(ctx.res, db.invoices, ctx.params.id, "Invoice");
  if (iv) json(ctx.res, 200, iv);
});

route("POST", "/invoices", (ctx) => {
  const b = ctx.body ?? {};
  const due = new Date(Date.now() + 30 * 864e5);
  const iv = {
    id: nid("iv"), number: assignInvoiceNumber(), clientId: b.clientId ?? "",
    caseId: b.caseId ?? "", issued: today(), due: due.toISOString().slice(0, 10),
    status: b.status ?? "draft", lines: b.lines ?? [], notes: b.notes,
  };
  db.invoices.unshift(iv);
  persist(db);
  json(ctx.res, 201, iv);
});

route("PATCH", "/invoices/:id", (ctx) => {
  const iv = byIdOr404(ctx.res, db.invoices, ctx.params.id, "Invoice");
  if (!iv) return;
  Object.assign(iv, ctx.body);
  persist(db);
  json(ctx.res, 200, iv);
});

route("DELETE", "/invoices/:id", (ctx) => {
  const before = db.invoices.length;
  db.invoices = db.invoices.filter((i) => i.id !== ctx.params.id);
  if (db.invoices.length === before) return fail(ctx.res, 404, "Invoice not found");
  persist(db);
  noContent(ctx.res);
});

route("GET", "/payments", (ctx) => json(ctx.res, 200, db.payments));

route("POST", "/payments", (ctx) => {
  const b = ctx.body ?? {};
  const invoice = find(db.invoices, b.invoiceId ?? "");
  const p = {
    id: nid("p"), invoiceId: b.invoiceId ?? "",
    clientId: b.clientId ?? invoice?.clientId ?? "",
    date: today(), amount: b.amount ?? 0, method: b.method ?? "card",
    status: "deposited", trustAccount: b.trustAccount ?? false,
  };
  db.payments.unshift(p);
  if (invoice) rollUpInvoice(invoice.id);
  if (p.trustAccount) {
    appendTrust({
      clientId: p.clientId, caseId: invoice?.caseId ?? "",
      description: `Trust deposit — invoice ${invoice?.number ?? "(unlinked)"}`,
      amount: p.amount,
    });
  }
  persist(db);
  json(ctx.res, 201, p);
});

route("GET", "/trust/transactions", (ctx) => json(ctx.res, 200, db.trust));

// ---- documents ----
route("GET", "/documents", (ctx) => json(ctx.res, 200, db.documents));

route("POST", "/documents", (ctx) => {
  const b = ctx.body ?? {};
  const f = {
    id: nid("f"), name: b.name ?? "Untitled.docx", folder: b.folder ?? "General",
    caseId: b.caseId, sizeKb: b.sizeKb ?? 42, updatedAt: today(),
    kind: b.kind ?? "doc", starred: b.starred, templateFields: b.templateFields,
  };
  db.documents.unshift(f);
  persist(db);
  json(ctx.res, 201, f);
});

route("PATCH", "/documents/:id", (ctx) => {
  const f = byIdOr404(ctx.res, db.documents, ctx.params.id, "Document");
  if (!f) return;
  Object.assign(f, ctx.body);
  persist(db);
  json(ctx.res, 200, f);
});

route("DELETE", "/documents/:id", (ctx) => {
  const before = db.documents.length;
  db.documents = db.documents.filter((d) => d.id !== ctx.params.id);
  if (db.documents.length === before) return fail(ctx.res, 404, "Document not found");
  persist(db);
  noContent(ctx.res);
});

// ---- communications ----
route("GET", "/threads", (ctx) => json(ctx.res, 200, db.threads));

route("POST", "/threads", (ctx) => {
  const b = ctx.body ?? {};
  const th = {
    id: nid("th"), subject: b.subject ?? "(no subject)", clientId: b.clientId ?? "",
    caseId: b.caseId, channel: b.channel ?? "secure", unread: false, messages: b.messages ?? [],
  };
  db.threads.unshift(th);
  persist(db);
  json(ctx.res, 201, th);
});

route("POST", "/threads/:id/messages", (ctx) => {
  const th = byIdOr404(ctx.res, db.threads, ctx.params.id, "Thread");
  if (!th) return;
  th.messages.push({
    id: nid("m"), from: "firm", authorName: ctx.session.user.name,
    body: ctx.body?.body ?? "", at: new Date().toISOString(),
  });
  persist(db);
  json(ctx.res, 200, th);
});

route("POST", "/threads/:id/read", (ctx) => {
  const th = find(db.threads, ctx.params.id);
  if (!th) return fail(ctx.res, 404, "Thread not found");
  th.unread = false;
  persist(db);
  noContent(ctx.res);
});

// ---- leads ----
route("GET", "/leads", (ctx) => json(ctx.res, 200, db.leads));

route("POST", "/leads", (ctx) => {
  const b = ctx.body ?? {};
  const l = {
    id: nid("ld"), name: b.name ?? "New lead", email: b.email ?? "",
    phone: b.phone ?? "", source: b.source ?? "website", stage: b.stage ?? "new",
    practiceArea: b.practiceArea ?? "General", value: b.value ?? 0,
    createdAt: today(), notes: b.notes,
    activity: b.activity ?? [{ at: new Date().toISOString(), text: "Lead created" }],
  };
  db.leads.unshift(l);
  persist(db);
  json(ctx.res, 201, l);
});

route("PATCH", "/leads/:id", (ctx) => {
  const l = byIdOr404(ctx.res, db.leads, ctx.params.id, "Lead");
  if (!l) return;
  Object.assign(l, ctx.body);
  persist(db);
  json(ctx.res, 200, l);
});

route("DELETE", "/leads/:id", (ctx) => {
  const before = db.leads.length;
  db.leads = db.leads.filter((l) => l.id !== ctx.params.id);
  if (db.leads.length === before) return fail(ctx.res, 404, "Lead not found");
  persist(db);
  noContent(ctx.res);
});

route("POST", "/leads/:id/convert", (ctx) => {
  const l = byIdOr404(ctx.res, db.leads, ctx.params.id, "Lead");
  if (!l) return;
  if (l.stage === "converted") return fail(ctx.res, 409, "Lead already converted");
  const contact = {
    id: nid("c"), type: "client", name: l.name, email: l.email, phone: l.phone,
    address: "", caseIds: [], createdAt: today(),
  };
  db.contacts.unshift(contact);
  const k = {
    id: nid("k"), number: assignCaseNumber(),
    title: ctx.body?.title ?? `${l.name} — ${l.practiceArea}`, clientId: contact.id,
    practiceArea: l.practiceArea, stage: "intake", status: "open", openDate: today(),
    leadAttorneyId: db.users[0].id, description: ctx.body?.description ?? "",
    billableRate: 300, trustBalance: 0,
  };
  db.cases.unshift(k);
  contact.caseIds.push(k.id);
  l.stage = "converted";
  l.activity.unshift({ at: new Date().toISOString(), text: `Converted to case ${k.number}` });
  persist(db);
  json(ctx.res, 201, { lead: l, contact, case: k });
});

// ---- reports & notifications ----
route("GET", "/reports", (ctx) => json(ctx.res, 200, structuredClone(seedReports)));

route("GET", "/notifications", (ctx) => json(ctx.res, 200, db.notifications));

route("POST", "/notifications/read", (ctx) => {
  db.notifications.forEach((n) => (n.read = true));
  persist(db);
  noContent(ctx.res);
});

// ---- gateway (V2 slice 1 — the not-connected surface, ADR-0006) ----
// The reference has no per-firm gateway accounts and no encryption key, so
// the status read answers the all-null shape, every gateway write answers the
// operator 503 (the same copy production answers without
// GATEWAY_ENCRYPTION_KEY), and collecting/syncing answer the owner 503. The
// smoke suite pins this surface on BOTH servers, which keeps the reference
// contract-honest without a gateway implementation.

route("GET", "/gateway/account", (ctx) =>
  json(ctx.res, 200, { connected: false, provider: null, keyId: null, enabled: false, connectedAt: null }));

route("PUT", "/gateway/account", (ctx) => {
  fail(ctx.res, 503, "Payments gateway not configured — set GATEWAY_ENCRYPTION_KEY (see .env.example)");
});

route("DELETE", "/gateway/account", (ctx) => {
  fail(ctx.res, 503, "Payments gateway not configured — set GATEWAY_ENCRYPTION_KEY (see .env.example)");
});

route("POST", "/invoices/:id/payment-link", (ctx) => {
  const invoice = find(db.invoices, ctx.params.id);
  if (!invoice) return fail(ctx.res, 404, "Invoice not found");
  if (invoice.status === "paid") return fail(ctx.res, 409, "Invoice is already paid");
  fail(ctx.res, 503, "No payment gateway connected — the firm owner must connect one in Settings");
});

route("GET", "/invoices/:id/payment-links", (ctx) => {
  if (!find(db.invoices, ctx.params.id)) return fail(ctx.res, 404, "Invoice not found");
  json(ctx.res, 200, []);
});

route("POST", "/payment-links/:id/sync", (ctx) => {
  fail(ctx.res, 503, "No payment gateway connected — the firm owner must connect one in Settings");
});

route("POST", "/webhooks/razorpay/:firmId", (ctx) => {
  fail(ctx.res, 404, "Gateway account not connected");
}, { public: true });

// ---- misc ----
route("GET", "/health", (ctx) => json(ctx.res, 200, {
  ok: true, service: "lawleit-reference-backend", seeded: true, now: new Date().toISOString(),
}), { public: true });

// ------------------------------------------------------------- http server ---

const PREFIX = "/api/v1"; // accepted (and stripped) so both proxied and direct base URLs work

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 1_048_576) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const started = performance.now();
  const origin = req.headers.origin;

  // CORS: reflect the origin so the dev front-end (and any allowed host) can call
  // the API directly with credentials instead of going through the vite proxy.
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  let pathname = req.url.split("?")[0];
  const query = Object.fromEntries(new URLSearchParams(req.url.split("?")[1] ?? ""));
  if (pathname.startsWith(PREFIX + "/")) pathname = pathname.slice(PREFIX.length);
  else if (pathname === PREFIX) pathname = "/";

  const log = (status) =>
    console.log(
      `[${new Date().toTimeString().slice(0, 8)}] ${req.method} ${pathname}` +
      ` ${status} ${Math.round(performance.now() - started)}ms`,
    );

  try {
    const segments = pathname.split("/").filter(Boolean);
    let params = null;
    let routeDef = null;
    for (const r of routes) {
      const p = match(r, req.method, segments);
      if (p) { params = p; routeDef = r; break; }
    }
    if (!routeDef) {
      fail(res, 404, `No route: ${req.method} ${pathname}`);
      log(404);
      return;
    }
    const session = currentUser(req);
    if (!routeDef.public && !session) {
      fail(res, 401, "Not signed in");
      log(401);
      return;
    }
    const body = ["POST", "PATCH", "PUT"].includes(req.method) ? await readBody(req) : undefined;
    await routeDef.handler({ req, res, params, query, body, session });
    log(res.statusCode);
  } catch (e) {
    fail(res, 400, e.message === "Invalid JSON body" || e.message === "Body too large"
      ? e.message : "Internal error");
    console.error(`[error] ${req.method} ${pathname}:`, e.message);
    log(res.statusCode);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[lawleit] reference backend on http://${HOST}:${PORT}`);
  console.log(`[lawleit] routes: ${routes.length} · db: ${DB_PATH} · demo auth: any non-empty password`);
  console.log(`[lawleit] base path: ${PREFIX}/… (also serves prefixless paths)`);
});
