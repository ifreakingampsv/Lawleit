#!/usr/bin/env node
/**
 * Smoke test for ANY Lawleit API claiming docs/API_CONTRACT.md — the
 * reference backend (backend/server.mjs) AND a real deployment (e.g. the
 * production API) alike. The harness is seed-independent: it registers its
 * own fresh firm through the contract's POST /auth/signup flow and runs
 * every assertion inside that firm, so it certifies an empty database too.
 *
 * Exercises every endpoint group in docs/API_CONTRACT.md and asserts the
 * server-side responsibilities (number assignment, invoice roll-up incl.
 * draft-stays-draft on partial payment, trust ledger, lead conversion, auth
 * lifecycle). Endpoint groups the target has not implemented (404) are
 * reported as SKIPped instead of failing the run — a server claiming the
 * full contract implements all of them.
 *
 * Usage:
 *   npm run smoke:api                        # from app/ — zero setup: if no
 *                                            # server is listening locally, a
 *                                            # reference one is spawned on a
 *                                            # scratch DB and torn down at exit.
 *   node backend/server.mjs --reset          # or the classic two-terminal flow:
 *   node backend/smoke.mjs                   #   start the server yourself, then run
 *                                            #   against it (scratch DB fine:
 *                                            #   LAWLEIT_DB=/tmp/lawleit-smoke.json)
 *   SMOKE_BASE=https://lawleit-api.onrender.com/api/v1 npm run smoke:api
 *                                            # against a remote deployment —
 *                                            # /health is polled up to 90s for
 *                                            # cold starts; creates a smoke firm.
 *
 * Env: SMOKE_BASE (default http://127.0.0.1:8787/api/v1)
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:8787/api/v1";
const base = new URL(BASE);
const IS_LOCAL = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(base.hostname);
/** Remote targets ride shared/free infrastructure — the first request can
 * easily be a 50s cold start, so every request gets a generous timeout. */
const REQ_TIMEOUT_MS = IS_LOCAL ? 15_000 : 120_000;
const COLD_START_BUDGET_MS = 90_000;

// ---- ensure a server is reachable (spawn one on a scratch DB if local) ----
async function healthy() {
  try {
    const res = await fetch(`${BASE}/health`, {
      signal: AbortSignal.timeout(IS_LOCAL ? 2_000 : 30_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

let spawned = null;
if (!(await healthy())) {
  if (IS_LOCAL) {
    const port = base.port || "80";
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lawleit-smoke-"));
    spawned = spawn(process.execPath, [path.join(import.meta.dirname, "server.mjs")], {
      env: { ...process.env, PORT: port, LAWLEIT_DB: path.join(scratch, "db.json") },
      stdio: "inherit",
    });
    // Without unref the running child keeps this process alive forever — and the
    // teardown below only fires at exit. unref lets the script end; the exit
    // hook then reaps the server.
    spawned.unref();
    const teardown = () => spawned?.kill();
    process.on("exit", teardown);
    process.on("SIGINT", () => { teardown(); process.exit(130); });
    const deadline = Date.now() + 10_000;
    while (!(await healthy())) {
      if (Date.now() > deadline) {
        console.error(`[smoke] spawned reference backend never became healthy on :${port}`);
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    console.log(`[smoke] spawned reference backend on :${port} (scratch DB: ${scratch})`);
  } else {
    // Remote target: never spawn anything — poll through the cold start.
    console.log(`[smoke] ${BASE} not responding — polling for cold start (up to ${COLD_START_BUDGET_MS / 1000}s)…`);
    const deadline = Date.now() + COLD_START_BUDGET_MS;
    while (!(await healthy())) {
      if (Date.now() > deadline) {
        console.error(`[smoke] ${BASE}/health never became healthy within ${COLD_START_BUDGET_MS / 1000}s — is the service deployed?`);
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 3_000));
    }
    console.log(`[smoke] ${BASE} is up`);
  }
}

let pass = 0;
let failCount = 0;
const failures = [];
const skipped = [];

function ok(cond, label) {
  if (cond) { pass++; console.log(`  PASS ${label}`); }
  else {
    failCount++;
    failures.push(label + (lastProbe && lastProbe.status !== undefined
      ? `  [${lastProbe.method} ${lastProbe.path} → ${lastProbe.status}${lastProbe.body ? ` ${lastProbe.body}` : ""}]`
      : ""));
    console.error(`  FAIL ${label}`);
  }
}

/** Context of the most recent request — attached to failures so a red run
 * always says WHICH endpoint failed and what the server answered. */
let lastProbe = null;

async function req(method, path, { token, body } = {}) {
  let res;
  let text = "";
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        // Only advertise a JSON body when there IS one — a bodiless DELETE or
        // POST carrying `Content-Type: application/json` is rejected by
        // strict servers (Fastify: 400 "Body cannot be empty…"), and the
        // contract means what it says.
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
    });
    text = await res.text();
  } catch (e) {
    const reason = String(e?.cause?.message ?? e?.message ?? e);
    lastProbe = { method, path, status: "network-error", body: reason };
    return { status: 0, data: undefined, body: reason };
  }
  let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
  lastProbe = { method, path, status: res.status, body: text.slice(0, 300) };
  return { status: res.status, data, body: text };
}

/** Capability probe: contract groups the target has not implemented answer
 * 404; those sections are skipped (and reported) instead of failing the run. */
async function implemented(path, token) {
  return (await req("GET", path, { token })).status !== 404;
}

const section = (name) => console.log(`\n== ${name} ==`);

// -------------------------------------------------------------- run setup --

// A unique identity per run: the harness creates its OWN firm via the
// contract signup (works on an empty production DB; the random email avoids
// 409 collisions with previous runs). zip is STRING, employees is NUMBER.
const RUN = Date.now().toString(36);
const EMAIL = `smoke-${RUN}@example.test`;
const FIRM_NAME = `Smoke Harness ${RUN}`;
const PHONE = "+91 90000 00000";

console.log(`[smoke] target: ${BASE} (${IS_LOCAL ? "local" : "remote"})`);
// Printed so a remote run leaves the created firm's identity in the log —
// the signup firm persists in the target's database.
console.log(`[smoke] run identity: ${FIRM_NAME} <${EMAIL}>`);

let token;
let ownerId;

// --------------------------------------------------------------------------

section("health & auth gate");
{
  // Service-agnostic: any contract server answers { ok: true }; the service
  // NAME is the deployment's own business (reference: "lawleit-reference-
  // backend", production: "lawleit-api").
  const h = await req("GET", "/health");
  ok(h.status === 200 && h.data?.ok === true, "GET /health returns { ok: true }");
  ok(!("db" in (h.data ?? {})) || h.data.db === "ok", "GET /health db field, when present, reports ok");
  const anon = await req("GET", "/cases");
  ok(anon.status === 401, "GET /cases without token → 401");
}

section("auth — signup creates the session");
{
  const su = await req("POST", "/auth/signup", { body: {
    firstName: "Smoke", lastName: "Harness", email: EMAIL,
    firmName: FIRM_NAME, zip: "560001", employees: 4, phone: PHONE,
  } });
  ok(su.status === 201 && !!su.data?.token && su.data.user?.email === EMAIL,
    "POST /auth/signup → 201 + token + session user (random email, zip STRING, employees NUMBER)");
  ok(su.data?.firm?.name === FIRM_NAME, "signup creates the firm (name echoed)");
  ok(Array.isArray(su.data?.users) && su.data.users.some((u) => u.id === su.data.user?.id),
    "signup returns firm users incl. the registered owner");
  token = su.data?.token;
  ownerId = su.data?.user?.id;

  const bad = await req("POST", "/auth/login", { body: { email: "", password: "" } });
  ok(bad.status === 401, "login with empty credentials → 401");

  const session = await req("GET", "/session", { token });
  ok(session.status === 200 && session.data?.user?.id === ownerId, "GET /session with the signup token");
}

section("auth — login (mode-aware)");
{
  // The reference backend ships demo auth (any password logs in, seeded users
  // survive the harness signup) — a real backend must reject unknown
  // credentials. The branch asserts whichever behavior the target claims.
  const demo = await req("POST", "/auth/login", { body: { email: "ava@lawleit.test", password: "demo" } });
  if (demo.status === 200) {
    ok(!!demo.data.token && !!demo.data.user?.email, "login (demo-auth reference) returns token + session user");
    ok(Array.isArray(demo.data.users) && !!demo.data.firm?.name, "login (demo-auth reference) returns firm + users");
  } else {
    ok(demo.status === 401, "login with unknown credentials → 401 (real auth)");
    const wrongPw = await req("POST", "/auth/login", { body: { email: EMAIL, password: `wrong-${RUN}` } });
    ok(wrongPw.status === 401, "login with wrong password → 401 (real auth)");
  }
}

section("firm & users");
{
  const firm = await req("PATCH", "/firm", { token, body: { phone: "+91 90000 00001" } });
  ok(firm.status === 200 && firm.data?.phone === "+91 90000 00001", "PATCH /firm");
  const users = await req("GET", "/users", { token });
  ok(users.status === 200 && Array.isArray(users.data) && users.data.some((u) => u.id === ownerId),
    "GET /users contains the registered owner");
  const u = await req("PATCH", `/users/${ownerId}`, { token, body: { hourlyRate: 333 } });
  ok(u.status === 200 && u.data?.hourlyRate === 333, "PATCH /users/:id (registered owner's hourlyRate)");
  ok((await req("PATCH", "/users/00000000-0000-0000-0000-000000000000", { token, body: { hourlyRate: 1 } })).status === 404,
    "PATCH /users/:id unknown id → 404");
}

section("cases");
{
  // Server-assigned number, format 2026-XXXX. The production backend keeps a
  // PER-FIRM counter, so a fresh firm's first case is 2026-0001 there; the
  // reference/mock demo counters are global (seeded cases consume low
  // numbers), so the harness asserts format + monotonicity — never 0001.
  const created = await req("POST", "/cases", { token, body: { title: `Smoke v. Demo ${RUN}` } });
  ok(created.status === 201 && /^2026-\d{4}$/.test(created.data?.number ?? ""),
    "POST /cases assigns a server-side 2026-XXXX number");
  const caseId = created.data?.id;

  const second = await req("POST", "/cases", { token, body: { title: `Smoke second matter Q${RUN}` } });
  ok(second.status === 201
    && Number.parseInt(second.data?.number?.slice(5), 10) > Number.parseInt(created.data?.number?.slice(5), 10),
    "case numbering is a strictly increasing server counter");

  ok((await req("GET", `/cases/${caseId}`, { token })).data?.title === `Smoke v. Demo ${RUN}`, "GET /cases/:id");
  ok((await req("PATCH", `/cases/${caseId}`, { token, body: { stage: "discovery" } })).data?.stage === "discovery",
    "PATCH /cases/:id");
  const byStatus = await req("GET", "/cases?status=open", { token });
  ok(byStatus.status === 200 && byStatus.data?.some((c) => c.id === caseId), "GET /cases?status= filter");
  const byQ = await req("GET", `/cases?q=${encodeURIComponent(`Q${RUN}`)}`, { token });
  ok(byQ.status === 200 && byQ.data?.some((c) => c.id === second.data?.id), "GET /cases?q= title/number search");
  ok((await req("DELETE", `/cases/${second.data?.id}`, { token })).status === 204, "DELETE /cases/:id → 204");
  ok((await req("GET", `/cases/${second.data?.id}`, { token })).status === 404, "GET deleted case → 404");
}

section("contacts");
{
  const c = await req("POST", "/contacts", { token, body: { name: `Smoke Contact ${RUN}`, email: `contact-${EMAIL}` } });
  ok(c.status === 201 && c.data?.type === "client", "POST /contacts defaults type=client");
  ok((await req("PATCH", `/contacts/${c.data?.id}`, { token, body: { phone: "555-1234" } }))?.data?.phone === "555-1234",
    "PATCH /contacts/:id");
  ok((await req("DELETE", `/contacts/${c.data?.id}`, { token })).status === 204, "DELETE /contacts/:id");
}

const today = new Date().toISOString().slice(0, 10);

section("calendar");
{
  const e = await req("POST", "/events", { token, body: { title: `Smoke hearing ${RUN}`, date: today, type: "court" } });
  ok(e.status === 201, "POST /events");
  const range = await req("GET", `/events?from=${today}&to=${today}`, { token });
  ok(range.data?.some((ev) => ev.id === e.data?.id), "GET /events?from=&to= inclusive filter");
  ok((await req("PATCH", `/events/${e.data?.id}`, { token, body: { start: "14:00" } }))?.data?.start === "14:00",
    "PATCH /events/:id");
  ok((await req("DELETE", `/events/${e.data?.id}`, { token })).status === 204, "DELETE /events/:id");
}

section("tasks");
{
  const t = await req("POST", "/tasks", { token, body: { title: `Smoke task ${RUN}`, dueDate: today } });
  ok(t.status === 201 && t.data?.status === "todo", "POST /tasks defaults status=todo");
  ok((await req("PATCH", `/tasks/${t.data?.id}`, { token, body: { status: "in_progress" } }))?.data?.status === "in_progress",
    "PATCH /tasks/:id status flow");
  ok((await req("DELETE", `/tasks/${t.data?.id}`, { token })).status === 204, "DELETE /tasks/:id");
}

section("time & expenses");
{
  const te = await req("POST", "/time-entries", { token, body: { minutes: 90, description: "Smoke work" } });
  ok(te.status === 201 && te.data?.invoiced === false, "POST /time-entries");
  ok((await req("PATCH", `/time-entries/${te.data?.id}`, { token, body: { billable: false } }))?.data?.billable === false,
    "PATCH /time-entries/:id");
  ok((await req("DELETE", `/time-entries/${te.data?.id}`, { token })).status === 204, "DELETE /time-entries/:id");
  const x = await req("POST", "/expenses", { token, body: { description: "Filing fee", amount: 55, category: "filing" } });
  ok(x.status === 201 && x.data?.amount === 55, "POST /expenses");
  ok((await req("DELETE", `/expenses/${x.data?.id}`, { token })).status === 204, "DELETE /expenses/:id");
}

let invoiceClientId;
section("billing — invoices, payment roll-up, trust ledger");
{
  const contact = await req("POST", "/contacts", { token, body: { name: "Invoice Client" } });
  invoiceClientId = contact.data?.id;
  const iv = await req("POST", "/invoices", { token, body: {
    clientId: invoiceClientId,
    lines: [
      { description: "Consult", quantity: 2, rate: 150, kind: "time" },
      { description: "Copies", quantity: 1, rate: 100, kind: "flat" },
    ],
  } });
  const invoiceId = iv.data?.id;
  ok(iv.status === 201 && /^INV-\d{4}$/.test(iv.data?.number ?? ""), "POST /invoices assigns INV-XXXX");
  ok(iv.data?.status === "draft", "new invoice starts draft");
  ok(Array.isArray(iv.data?.lines)
    && iv.data.lines.every((l) => l.amount === undefined || l.amount === l.quantity * l.rate),
    "invoice line amounts are server-computed (quantity × rate)");

  await req("POST", "/payments", { token, body: { invoiceId, amount: 250, method: "card" } });
  ok((await req("GET", `/invoices/${invoiceId}`, { token })).data?.status === "draft",
    "partial payment keeps a draft invoice draft (400 total, 250 paid)");

  ok((await req("PATCH", `/invoices/${invoiceId}`, { token, body: { status: "sent" } }))?.data?.status === "sent",
    "PATCH /invoices/:id status");

  await req("POST", "/payments", { token, body: { invoiceId, amount: 100, method: "echeck" } });
  ok((await req("GET", `/invoices/${invoiceId}`, { token })).data?.status === "sent",
    "partial payment keeps invoice sent (350 of 400 paid)");

  await req("POST", "/payments", { token, body: { invoiceId, amount: 50, method: "card" } });
  ok((await req("GET", `/invoices/${invoiceId}`, { token })).data?.status === "paid",
    "payment at the server-computed total rolls the invoice up to paid");

  const trustPay = await req("POST", "/payments", { token, body: {
    invoiceId, amount: 500, trustAccount: true, clientId: invoiceClientId,
  } });
  ok(trustPay.status === 201 && trustPay.data?.trustAccount === true, "POST /payments trustAccount");
  const trust = await req("GET", "/trust/transactions", { token });
  const mine = (trust.data ?? []).filter((t) => t.clientId === invoiceClientId);
  const last = mine[mine.length - 1];
  ok(last && last.amount === 500 && last.balanceAfter === 500,
    "trust ledger appends running balanceAfter for a new client");
}

section("documents");
{
  const d = await req("POST", "/documents", { token, body: { name: "Smoke.docx", folder: "General" } });
  ok(d.status === 201 && d.data?.kind === "doc", "POST /documents");
  ok((await req("PATCH", `/documents/${d.data?.id}`, { token, body: { starred: true } }))?.data?.starred === true,
    "PATCH /documents/:id");
  ok((await req("DELETE", `/documents/${d.data?.id}`, { token })).status === 204, "DELETE /documents/:id");
}

section("communications");
if (await implemented("/threads", token)) {
  const th = await req("POST", "/threads", { token, body: { subject: `Smoke thread ${RUN}`, clientId: invoiceClientId } });
  ok(th.status === 201, "POST /threads");
  const sent = await req("POST", `/threads/${th.data?.id}/messages`, { token, body: { body: "Hello from smoke" } });
  ok(sent.status === 200 && sent.data?.messages?.at(-1)?.body === "Hello from smoke", "POST /threads/:id/messages appends");
  await req("POST", `/threads/${th.data?.id}/read`, { token });
  const listed = await req("GET", "/threads", { token });
  ok(listed.data?.find((t) => t.id === th.data?.id)?.unread === false, "POST /threads/:id/read clears unread");
} else {
  skipped.push("communications (GET /threads → 404)");
  console.log("  SKIP — target does not implement /threads (404)");
}

section("leads & conversion");
{
  const l = await req("POST", "/leads", { token, body: { name: `Smoke Lead ${RUN}`, practiceArea: "Family" } });
  ok(l.status === 201 && l.data?.stage === "new", "POST /leads defaults stage=new");
  ok((await req("PATCH", `/leads/${l.data?.id}`, { token, body: { stage: "contacted" } }))?.data?.stage === "contacted",
    "PATCH /leads/:id stage");
  const conv = await req("POST", `/leads/${l.data?.id}/convert`, { token, body: { title: `Smoke Lead — converted ${RUN}` } });
  ok(conv.status === 201 && conv.data?.lead?.stage === "converted", "POST /leads/:id/convert marks lead converted");
  ok(conv.data?.contact?.type === "client" && /^2026-\d{4}$/.test(conv.data?.case?.number ?? ""),
    "conversion creates contact + numbered case");
  ok(conv.data?.contact?.caseIds?.includes(conv.data?.case?.id), "converted contact links the new case");
  const again = await req("POST", `/leads/${l.data?.id}/convert`, { token, body: {} });
  ok(again.status === 409, "double conversion → 409");
  ok((await req("DELETE", `/leads/${l.data?.id}`, { token })).status === 204, "DELETE /leads/:id");
}

section("reports & notifications");
if (await implemented("/reports", token) && await implemented("/notifications", token)) {
  const reports = await req("GET", "/reports", { token });
  ok(reports.status === 200 && reports.data?.length >= 1, "GET /reports");
  const notes = await req("GET", "/notifications", { token });
  // Shape-based: neither backend generates notifications at runtime (the
  // reference's rows are seed data), so a freshly registered firm has none.
  ok(notes.status === 200 && Array.isArray(notes.data), "GET /notifications");
  ok((await req("POST", "/notifications/read", { token })).status === 204, "POST /notifications/read → 204");
  const after = await req("GET", "/notifications", { token });
  ok(after.data?.every((n) => n.read === true), "all notifications read after POST /notifications/read");
} else {
  skipped.push("reports & notifications (404)");
  console.log("  SKIP — target does not implement /reports and/or /notifications (404)");
}

section("logout");
{
  ok((await req("POST", "/auth/logout", { token })).status === 204, "POST /auth/logout → 204");
  ok((await req("GET", "/session", { token })).status === 401, "session invalid after logout");
}

// --------------------------------------------------------------------------

console.log(`\n${pass} passed, ${failCount} failed`
  + (skipped.length ? `, skipped: ${skipped.join(" · ")}` : ""));
if (failCount) {
  console.error("FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("SMOKE OK");
