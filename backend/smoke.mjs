#!/usr/bin/env node
/**
 * Smoke test for the Lawleit reference backend (backend/server.mjs).
 *
 * Exercises every endpoint group in docs/API_CONTRACT.md and asserts the
 * server-side responsibilities (number assignment, invoice roll-up, trust
 * ledger, lead conversion, auth lifecycle).
 *
 * Usage:
 *   node backend/server.mjs --reset            # terminal 1 (scratch DB fine:
 *                                              #   LAWLEIT_DB=/tmp/lawleit-smoke.json)
 *   node backend/smoke.mjs                     # terminal 2 — prints PASS/FAIL, exits 1 on failure
 *
 * Env: SMOKE_BASE (default http://127.0.0.1:8787/api/v1)
 */
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:8787/api/v1";

let pass = 0;
let failCount = 0;
const failures = [];

function ok(cond, label) {
  if (cond) { pass++; console.log(`  PASS ${label}`); }
  else { failCount++; failures.push(label); console.error(`  FAIL ${label}`); }
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : undefined };
}

const section = (name) => console.log(`\n== ${name} ==`);

// --------------------------------------------------------------------------

section("health & auth gate");
{
  // /health is served with or without the /api/v1 prefix
  const h = await req("GET", "/health");
  ok(h.status === 200 && h.data.ok === true && h.data.service === "lawleit-reference-backend", "GET /health");
  const anon = await req("GET", "/cases");
  ok(anon.status === 401, "GET /cases without token → 401");
}

let token;
section("auth");
{
  const bad = await req("POST", "/auth/login", { body: { email: "", password: "" } });
  ok(bad.status === 401, "login with empty credentials → 401");
  const login = await req("POST", "/auth/login", { body: { email: "ava@lawleit.test", password: "demo" } });
  ok(login.status === 200 && login.data.token && login.data.user?.email, "login returns token + session user");
  ok(Array.isArray(login.data.users) && login.data.firm?.name, "login returns firm + users");
  token = login.data.token;
  const session = await req("GET", "/session", { token });
  ok(session.status === 200 && session.data.user.id === login.data.user.id, "GET /session with token");
}

section("firm & users");
{
  const firm = await req("PATCH", "/firm", { token, body: { phone: "+1 555 010 2000" } });
  ok(firm.status === 200 && firm.data.phone === "+1 555 010 2000", "PATCH /firm");
  const users = await req("GET", "/users", { token });
  ok(users.status === 200 && users.data.length >= 1, "GET /users");
  const u = await req("PATCH", `/users/${users.data[0].id}`, { token, body: { hourlyRate: 333 } });
  ok(u.status === 200 && u.data.hourlyRate === 333, "PATCH /users/:id");
}

section("cases");
{
  const created = await req("POST", "/cases", { token, body: { title: "Smoke v. Demo" } });
  ok(created.status === 201 && /^2026-\d{4}$/.test(created.data.number), "POST /cases assigns 2026-XXXX number");
  const id = created.data.id;
  const one = await req("GET", `/cases/${id}`, { token });
  ok(one.status === 200 && one.data.title === "Smoke v. Demo", "GET /cases/:id");
  const patched = await req("PATCH", `/cases/${id}`, { token, body: { stage: "discovery" } });
  ok(patched.status === 200 && patched.data.stage === "discovery", "PATCH /cases/:id");
  const list = await req("GET", "/cases?status=open", { token });
  ok(list.status === 200 && list.data.some((c) => c.id === id), "GET /cases?status= filter");
  ok((await req("DELETE", `/cases/${id}`, { token })).status === 204, "DELETE /cases/:id → 204");
  ok((await req("GET", `/cases/${id}`, { token })).status === 404, "GET deleted case → 404");
}

section("contacts");
{
  const c = await req("POST", "/contacts", { token, body: { name: "Smoke Contact", email: "smoke@x.test" } });
  ok(c.status === 201 && c.data.type === "client", "POST /contacts");
  ok((await req("PATCH", `/contacts/${c.data.id}`, { token, body: { phone: "555-1234" } })).data.phone === "555-1234", "PATCH /contacts/:id");
  ok((await req("DELETE", `/contacts/${c.data.id}`, { token })).status === 204, "DELETE /contacts/:id");
}

const today = new Date().toISOString().slice(0, 10);

section("calendar");
{
  const e = await req("POST", "/events", { token, body: { title: "Smoke hearing", date: today, type: "court" } });
  ok(e.status === 201, "POST /events");
  const range = await req("GET", `/events?from=${today}&to=${today}`, { token });
  ok(range.data.some((ev) => ev.id === e.data.id), "GET /events?from=&to= inclusive filter");
  ok((await req("PATCH", `/events/${e.data.id}`, { token, body: { start: "14:00" } })).data.start === "14:00", "PATCH /events/:id");
  ok((await req("DELETE", `/events/${e.data.id}`, { token })).status === 204, "DELETE /events/:id");
}

section("tasks");
{
  const t = await req("POST", "/tasks", { token, body: { title: "Smoke task", dueDate: today } });
  ok(t.status === 201 && t.data.status === "todo", "POST /tasks defaults status=todo");
  ok((await req("PATCH", `/tasks/${t.data.id}`, { token, body: { status: "in_progress" } })).data.status === "in_progress", "PATCH /tasks/:id status flow");
  ok((await req("DELETE", `/tasks/${t.data.id}`, { token })).status === 204, "DELETE /tasks/:id");
}

section("time & expenses");
{
  const te = await req("POST", "/time-entries", { token, body: { minutes: 90, description: "Smoke work" } });
  ok(te.status === 201 && te.data.invoiced === false, "POST /time-entries");
  ok((await req("PATCH", `/time-entries/${te.data.id}`, { token, body: { billable: false } })).data.billable === false, "PATCH /time-entries/:id");
  ok((await req("DELETE", `/time-entries/${te.data.id}`, { token })).status === 204, "DELETE /time-entries/:id");
  const x = await req("POST", "/expenses", { token, body: { description: "Filing fee", amount: 55, category: "filing" } });
  ok(x.status === 201 && x.data.amount === 55, "POST /expenses");
  ok((await req("DELETE", `/expenses/${x.data.id}`, { token })).status === 204, "DELETE /expenses/:id");
}

let invoiceId, invoiceClientId;
section("billing — invoices, payment roll-up, trust ledger");
{
  const contact = await req("POST", "/contacts", { token, body: { name: "Invoice Client" } });
  invoiceClientId = contact.data.id;
  const iv = await req("POST", "/invoices", { token, body: {
    clientId: invoiceClientId,
    lines: [
      { id: "l1", description: "Consult", quantity: 2, rate: 150, kind: "time" },
      { id: "l2", description: "Copies", quantity: 1, rate: 100, kind: "flat" },
    ],
  } });
  invoiceId = iv.data.id;
  ok(iv.status === 201 && /^INV-\d{4}$/.test(iv.data.number), "POST /invoices assigns INV-XXXX");
  ok((await req("PATCH", `/invoices/${invoiceId}`, { token, body: { status: "sent" } })).data.status === "sent", "PATCH /invoices/:id status");

  await req("POST", "/payments", { token, body: { invoiceId, amount: 250, method: "card" } });
  let afterPartial = await req("GET", `/invoices/${invoiceId}`, { token });
  ok(afterPartial.data.status === "sent", "partial payment keeps invoice sent (400 total, 250 paid)");

  await req("POST", "/payments", { token, body: { invoiceId, amount: 150, method: "echeck" } });
  afterPartial = await req("GET", `/invoices/${invoiceId}`, { token });
  ok(afterPartial.data.status === "paid", "full payment rolls invoice up to paid");

  const trustPay = await req("POST", "/payments", { token, body: {
    invoiceId, amount: 500, trustAccount: true, clientId: invoiceClientId,
  } });
  ok(trustPay.status === 201 && trustPay.data.trustAccount === true, "POST /payments trustAccount");
  const trust = await req("GET", "/trust/transactions", { token });
  const mine = trust.data.filter((t) => t.clientId === invoiceClientId);
  const last = mine[mine.length - 1];
  ok(last && last.amount === 500 && last.balanceAfter === 500, "trust ledger appends running balanceAfter for new client");
}

section("documents");
{
  const d = await req("POST", "/documents", { token, body: { name: "Smoke.docx", folder: "General" } });
  ok(d.status === 201 && d.data.kind === "doc", "POST /documents");
  ok((await req("PATCH", `/documents/${d.data.id}`, { token, body: { starred: true } })).data.starred === true, "PATCH /documents/:id");
  ok((await req("DELETE", `/documents/${d.data.id}`, { token })).status === 204, "DELETE /documents/:id");
}

section("communications");
{
  const th = await req("POST", "/threads", { token, body: { subject: "Smoke thread", clientId: invoiceClientId } });
  ok(th.status === 201, "POST /threads");
  const sent = await req("POST", `/threads/${th.data.id}/messages`, { token, body: { body: "Hello from smoke" } });
  ok(sent.status === 200 && sent.data.messages.at(-1).body === "Hello from smoke", "POST /threads/:id/messages appends");
  await req("POST", `/threads/${th.data.id}/read`, { token });
  const listed = await req("GET", "/threads", { token });
  ok(listed.data.find((t) => t.id === th.data.id)?.unread === false, "POST /threads/:id/read clears unread");
}

section("leads & conversion");
{
  const l = await req("POST", "/leads", { token, body: { name: "Smoke Lead", practiceArea: "Family" } });
  ok(l.status === 201 && l.data.stage === "new", "POST /leads");
  ok((await req("PATCH", `/leads/${l.data.id}`, { token, body: { stage: "contacted" } })).data.stage === "contacted", "PATCH /leads/:id stage");
  const conv = await req("POST", `/leads/${l.data.id}/convert`, { token, body: { title: "Smoke Lead — converted" } });
  ok(conv.status === 201 && conv.data.lead.stage === "converted", "POST /leads/:id/convert marks lead converted");
  ok(conv.data.contact?.type === "client" && /^2026-\d{4}$/.test(conv.data.case?.number ?? ""), "conversion creates contact + numbered case");
  ok(conv.data.contact.caseIds.includes(conv.data.case.id), "converted contact links the new case");
  const again = await req("POST", `/leads/${l.data.id}/convert`, { token, body: {} });
  ok(again.status === 409, "double conversion → 409");
  ok((await req("DELETE", `/leads/${l.data.id}`, { token })).status === 204, "DELETE /leads/:id");
}

section("reports & notifications");
{
  const reports = await req("GET", "/reports", { token });
  ok(reports.status === 200 && reports.data.length >= 1, "GET /reports");
  const notes = await req("GET", "/notifications", { token });
  ok(notes.status === 200 && Array.isArray(notes.data) && notes.data.length >= 1, "GET /notifications");
  ok((await req("POST", "/notifications/read", { token })).status === 204, "POST /notifications/read → 204");
  const after = await req("GET", "/notifications", { token });
  ok(after.data.every((n) => n.read === true), "all notifications read after POST /notifications/read");
}

section("logout");
{
  ok((await req("POST", "/auth/logout", { token })).status === 204, "POST /auth/logout → 204");
  ok((await req("GET", "/session", { token })).status === 401, "session invalid after logout");
}

// --------------------------------------------------------------------------

console.log(`\n${pass} passed, ${failCount} failed`);
if (failCount) {
  console.error("FAILED:", failures.join(" · "));
  process.exit(1);
}
console.log("SMOKE OK");
