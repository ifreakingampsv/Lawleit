import { kindForFile, type LawleitApi } from "./api";
import type {
  CalendarEvent, Case, Contact, DocumentFile, Expense, Firm, GatewayAccountStatus, Invoice,
  Lead, MessageThread, Notification, Payment, PaymentLink, ReportDef, Session, Task,
  TimeEntry, TrustTransaction, User,
} from "./types";
import { formatINR0 } from "../money";
import {
  seedCases, seedContacts, seedDocuments, seedEvents, seedExpenses, seedFirm,
  seedInvoices, seedLeads, seedPayments, seedReports, seedTasks, seedThreads,
  seedTimeEntries, seedTrust, seedUsers, nid,
} from "./seed";

/**
 * Mock adapter — implements LawleitApi over an in-memory DB persisted to
 * localStorage. This is what ships so the whole front-end works today.
 * See docs/API_CONTRACT.md for the REST mapping a real backend should expose.
 */

// v2: money fields became integer paise — old v1 databases hold dollar-scale
// amounts, so they are discarded and the demo reseeds.
const LS_KEY = "lawleit.db.v2";
const SS_KEY = "lawleit.session.v1";

/**
 * Ticket 17 — the demo's upload cap. localStorage holds ~5 MB per origin, so
 * real production's 25 MB cannot apply; files above 1 MB are rejected with a
 * clear message (the demo must feel real, and silently dropping bytes would
 * not be real).
 */
const DEMO_MAX_UPLOAD_BYTES = 1024 * 1024;

/**
 * The avatar palette the Demo Firm seed draws from; invited users cycle
 * through it so the Settings table stays colorful without any input.
 */
const AVATAR_PALETTE = [
  "#4B4ACF", "#3DBDB4", "#E0876A", "#8B7FD4", "#2E9E6B", "#B85C38", "#0E7490", "#64748B",
];

/** The role vocabulary the backend's POST /users accepts (docs/API_CONTRACT.md). */
const ROLES = ["owner", "attorney", "paralegal", "staff"] as const;

interface DB {
  users: User[];
  firm: Firm;
  cases: Case[];
  contacts: Contact[];
  events: CalendarEvent[];
  tasks: Task[];
  timeEntries: TimeEntry[];
  expenses: Expense[];
  invoices: Invoice[];
  payments: Payment[];
  trust: TrustTransaction[];
  documents: DocumentFile[];
  /** Ticket 17: document id → base64 data URL of the uploaded bytes. */
  fileBlobs: Record<string, string>;
  threads: MessageThread[];
  leads: Lead[];
  notifications: Notification[];
  /** V2 slice 1: the firm's hosted payment links (the simulated gateway). */
  paymentLinks: PaymentLink[];
  /** V2 slice 1: the demo gateway connection (secrets are never stored). */
  gatewayAccount: GatewayAccountStatus | null;
}

function freshDb(): DB {
  return {
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
    fileBlobs: {},
    threads: structuredClone(seedThreads),
    leads: structuredClone(seedLeads),
    notifications: [
      { id: nid("n"), text: `Payment of ${formatINR0(500000)} received from Kavita Menon`, at: new Date(Date.now() - 36e5).toISOString(), read: false, kind: "payment" },
      { id: nid("n"), text: "Deposition: Prem Lal tomorrow at 10:30 AM", at: new Date(Date.now() - 72e5).toISOString(), read: false, kind: "deadline" },
      { id: nid("n"), text: "New message from Harish Chadha", at: new Date(Date.now() - 180e5).toISOString(), read: false, kind: "message" },
    ],
    paymentLinks: [],
    gatewayAccount: null,
  };
}

function loadDb(): DB {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const db = JSON.parse(raw) as DB;
      // Databases persisted before ticket 17 predate the file-blob store.
      db.fileBlobs ??= {};
      // Databases persisted before V2 slice 1 predate the gateway simulation.
      db.paymentLinks ??= [];
      db.gatewayAccount ??= null;
      return db;
    }
  } catch { /* corrupt or unavailable storage — reseed */ }
  const db = freshDb();
  persist(db);
  return db;
}

function persist(db: DB) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch { /* quota — ignore */ }
}

const latency = (ms = 60) => new Promise<void>((r) => setTimeout(r, ms));

class MockAdapter implements LawleitApi {
  private db: DB = loadDb();
  private session: Session | null = (() => {
    try {
      const raw = sessionStorage.getItem(SS_KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch { return null; }
  })();

  private save() { persist(this.db); }
  private requireSession(): Session {
    if (!this.session) throw new Error("Not signed in");
    return this.session;
  }
  private withSession(): Session {
    const s = this.requireSession();
    this.save();
    return s;
  }

  // ---- auth ----
  async login(email: string, _password: string): Promise<Session> {
    await latency(250);
    const user =
      this.db.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? this.db.users[0];
    this.session = { user, firm: this.db.firm, users: this.db.users };
    sessionStorage.setItem(SS_KEY, JSON.stringify(this.session));
    return this.session;
  }

  async signup(input: {
    firstName: string; lastName: string; email: string; firmName: string;
    zip: string; employees: number; phone: string;
  }): Promise<Session> {
    await latency(400);
    const user: User = {
      id: nid("u"), firmId: "f1", name: `${input.firstName} ${input.lastName}`.trim() || "Firm Owner",
      email: input.email, role: "owner", avatarColor: "#4B4ACF", hourlyRate: 300000, active: true,
    };
    this.db.users = [user, ...this.db.users.filter((u) => u.role !== "owner")];
    this.db.firm = {
      ...this.db.firm,
      name: input.firmName || this.db.firm.name,
      phone: input.phone || this.db.firm.phone,
      address: input.zip ? `${this.db.firm.address.split(", ").slice(0, -1).join(", ")}, ${input.zip}` : this.db.firm.address,
      trialEndsAt: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10),
    };
    this.save();
    this.session = { user, firm: this.db.firm, users: this.db.users };
    sessionStorage.setItem(SS_KEY, JSON.stringify(this.session));
    return this.session;
  }

  async logout(): Promise<void> {
    await latency(100);
    this.session = null;
    sessionStorage.removeItem(SS_KEY);
  }

  async getSession(): Promise<Session | null> {
    await latency(30);
    return this.session;
  }

  /**
   * The "Reset demo data" action: discard every local edit, re-seed the
   * pristine Demo Firm, and re-establish the session against the fresh DB so
   * the visitor stays signed in (ADR 0001).
   */
  async resetDemoData(): Promise<Session> {
    this.db = freshDb();
    this.save();
    this.session = { user: this.db.users[0], firm: this.db.firm, users: this.db.users };
    sessionStorage.setItem(SS_KEY, JSON.stringify(this.session));
    return this.session;
  }

  // ---- firm & users ----
  async updateFirm(patch: Partial<Firm>): Promise<Firm> {
    this.withSession();
    this.db.firm = { ...this.db.firm, ...patch };
    this.save();
    return this.db.firm;
  }
  async listUsers(): Promise<User[]> { this.withSession(); return this.db.users; }
  async updateUser(id: string, patch: Partial<User>): Promise<User> {
    this.withSession();
    const u = this.db.users.find((x) => x.id === id);
    if (!u) throw new Error("User not found");
    Object.assign(u, patch);
    this.save();
    return u;
  }

  /**
   * Invite a user (POST /users parity): owner-only, emails unique across the
   * db (the backend enforces global uniqueness), role vocabulary enforced.
   * Mock invite semantics: the User model holds no password at all — seeded
   * users have none either, and login matches by email alone (any password),
   * so an invited demo user signs in exactly like a seeded one.
   */
  async createUser(input: {
    name: string; email: string; role: User["role"]; hourlyRate?: number; avatarColor?: string;
  }): Promise<User> {
    const s = this.withSession();
    if (s.user.role !== "owner") {
      throw new Error("Only the firm owner can manage users");
    }
    if (!ROLES.includes(input.role)) {
      throw new Error("Invalid role");
    }
    const email = input.email.trim();
    if (this.db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      throw new Error("Email already registered");
    }
    const u: User = {
      id: nid("u"), firmId: s.firm.id, name: input.name.trim(), email,
      role: input.role,
      avatarColor: input.avatarColor ?? AVATAR_PALETTE[this.db.users.length % AVATAR_PALETTE.length],
      hourlyRate: input.hourlyRate ?? 0, active: true,
    };
    // Push (not reassign) so session snapshots sharing the array stay in sync.
    this.db.users.push(u);
    this.save();
    return u;
  }

  // ---- cases ----
  async listCases() { this.withSession(); return this.db.cases; }
  async getCase(id: string) { this.withSession(); return this.db.cases.find((c) => c.id === id) ?? null; }
  async createCase(input: Partial<Case>) {
    this.withSession();
    const num = `2026-${String(this.db.cases.length + 50).padStart(4, "0")}`;
    const c: Case = {
      id: nid("k"), number: num, title: input.title ?? "New matter",
      clientId: input.clientId ?? "", practiceArea: input.practiceArea ?? "General",
      stage: input.stage ?? "intake", status: input.status ?? "open",
      openDate: new Date().toISOString().slice(0, 10),
      leadAttorneyId: input.leadAttorneyId ?? this.db.users[0].id,
      description: input.description ?? "", billableRate: input.billableRate ?? 300000, trustBalance: 0,
    };
    this.db.cases.unshift(c);
    this.save();
    return c;
  }
  async updateCase(id: string, patch: Partial<Case>) {
    this.withSession();
    const c = this.db.cases.find((x) => x.id === id);
    if (!c) throw new Error("Case not found");
    Object.assign(c, patch);
    this.save();
    return c;
  }
  async deleteCase(id: string) {
    this.withSession();
    this.db.cases = this.db.cases.filter((c) => c.id !== id);
    this.save();
  }

  // ---- contacts ----
  async listContacts() { this.withSession(); return this.db.contacts; }
  async getContact(id: string) { this.withSession(); return this.db.contacts.find((c) => c.id === id) ?? null; }
  async createContact(input: Partial<Contact>) {
    this.withSession();
    const c: Contact = {
      id: nid("c"), type: input.type ?? "client", name: input.name ?? "New contact",
      email: input.email ?? "", phone: input.phone ?? "", address: input.address ?? "",
      caseIds: input.caseIds ?? [], createdAt: new Date().toISOString().slice(0, 10),
      notes: input.notes,
    };
    this.db.contacts.unshift(c);
    this.save();
    return c;
  }
  async conflictCheck(name: string) {
    this.withSession();
    // Mirrors the production service's token overlap (service.ts
    // conflictTokens): lowercase, split on non-alphanumerics, ≥ 3 chars.
    const tokens = name.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
    if (tokens.length === 0) return { query: name, matches: [] };
    const matches = this.db.contacts.filter((c) => {
      const candidate = c.name.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
      return candidate.some((t) => tokens.includes(t));
    });
    return {
      query: name,
      matches: matches.map((c) => ({
        id: c.id, name: c.name, type: c.type,
        caseNumbers: this.db.cases
          .filter((k) => k.clientId === c.id || c.caseIds.includes(k.id))
          .map((k) => k.number),
      })),
    };
  }
  async updateContact(id: string, patch: Partial<Contact>) {
    this.withSession();
    const c = this.db.contacts.find((x) => x.id === id);
    if (!c) throw new Error("Contact not found");
    Object.assign(c, patch);
    this.save();
    return c;
  }
  async deleteContact(id: string) {
    this.withSession();
    this.db.contacts = this.db.contacts.filter((c) => c.id !== id);
    this.save();
  }

  // ---- calendar ----
  async listEvents(range: { from: string; to: string }) {
    this.withSession();
    return this.db.events.filter((e) => e.date >= range.from && e.date <= range.to);
  }
  async createEvent(input: Partial<CalendarEvent>) {
    this.withSession();
    const e: CalendarEvent = {
      id: nid("e"), title: input.title ?? "New event", date: input.date ?? new Date().toISOString().slice(0, 10),
      start: input.start ?? "09:00", end: input.end ?? "10:00", location: input.location,
      caseId: input.caseId, attendeeIds: input.attendeeIds ?? [], type: input.type ?? "meeting",
      color: input.color ?? "#4B4ACF",
    };
    this.db.events.push(e);
    this.save();
    return e;
  }
  async updateEvent(id: string, patch: Partial<CalendarEvent>) {
    this.withSession();
    const e = this.db.events.find((x) => x.id === id);
    if (!e) throw new Error("Event not found");
    Object.assign(e, patch);
    this.save();
    return e;
  }
  async deleteEvent(id: string) {
    this.withSession();
    this.db.events = this.db.events.filter((e) => e.id !== id);
    this.save();
  }

  // ---- tasks ----
  async listTasks() { this.withSession(); return this.db.tasks; }
  async createTask(input: Partial<Task>) {
    this.withSession();
    const t: Task = {
      id: nid("t"), title: input.title ?? "New task",
      dueDate: input.dueDate ?? new Date().toISOString().slice(0, 10),
      priority: input.priority ?? "medium", status: input.status ?? "todo",
      caseId: input.caseId, assigneeId: input.assigneeId ?? this.db.users[0].id,
      createdAt: new Date().toISOString().slice(0, 10), description: input.description,
    };
    this.db.tasks.unshift(t);
    this.save();
    return t;
  }
  async updateTask(id: string, patch: Partial<Task>) {
    this.withSession();
    const t = this.db.tasks.find((x) => x.id === id);
    if (!t) throw new Error("Task not found");
    Object.assign(t, patch);
    this.save();
    return t;
  }
  async deleteTask(id: string) {
    this.withSession();
    this.db.tasks = this.db.tasks.filter((t) => t.id !== id);
    this.save();
  }

  // ---- time & expenses ----
  async listTimeEntries() { this.withSession(); return this.db.timeEntries; }
  async createTimeEntry(input: Partial<TimeEntry>) {
    this.withSession();
    const t: TimeEntry = {
      id: nid("te"), userId: input.userId ?? this.db.users[0].id,
      caseId: input.caseId ?? this.db.cases[0]?.id ?? "k1",
      date: input.date ?? new Date().toISOString().slice(0, 10),
      minutes: input.minutes ?? 0, rate: input.rate ?? 300000,
      description: input.description ?? "", billable: input.billable ?? true, invoiced: false,
    };
    this.db.timeEntries.unshift(t);
    this.save();
    return t;
  }
  async updateTimeEntry(id: string, patch: Partial<TimeEntry>) {
    this.withSession();
    const t = this.db.timeEntries.find((x) => x.id === id);
    if (!t) throw new Error("Entry not found");
    Object.assign(t, patch);
    this.save();
    return t;
  }
  async deleteTimeEntry(id: string) {
    this.withSession();
    this.db.timeEntries = this.db.timeEntries.filter((t) => t.id !== id);
    this.save();
  }
  async listExpenses() { this.withSession(); return this.db.expenses; }
  async createExpense(input: Partial<Expense>) {
    this.withSession();
    const x: Expense = {
      id: nid("x"), caseId: input.caseId ?? this.db.cases[0]?.id ?? "k1",
      date: input.date ?? new Date().toISOString().slice(0, 10),
      description: input.description ?? "", amount: input.amount ?? 0,
      billable: input.billable ?? true, invoiced: false, category: input.category ?? "other",
    };
    this.db.expenses.unshift(x);
    this.save();
    return x;
  }
  async updateExpense(id: string, patch: Partial<Expense>) {
    this.withSession();
    const x = this.db.expenses.find((e) => e.id === id);
    if (!x) throw new Error("Expense not found");
    Object.assign(x, patch);
    this.save();
    return x;
  }
  async deleteExpense(id: string) {
    this.withSession();
    this.db.expenses = this.db.expenses.filter((e) => e.id !== id);
    this.save();
  }

  // ---- billing ----
  async listInvoices() { this.withSession(); return this.db.invoices; }
  async getInvoice(id: string) { this.withSession(); return this.db.invoices.find((i) => i.id === id) ?? null; }
  async createInvoice(input: Partial<Invoice>) {
    this.withSession();
    const num = `INV-${String(1044 + this.db.invoices.length).padStart(4, "0")}`;
    const today = new Date();
    const due = new Date(today.getTime() + 30 * 864e5);
    const iv: Invoice = {
      id: nid("iv"), number: input.number ?? num, clientId: input.clientId ?? "",
      caseId: input.caseId ?? "", issued: today.toISOString().slice(0, 10),
      due: due.toISOString().slice(0, 10), status: input.status ?? "draft",
      lines: input.lines ?? [], notes: input.notes,
    };
    this.db.invoices.unshift(iv);
    this.save();
    return iv;
  }
  async updateInvoice(id: string, patch: Partial<Invoice>) {
    this.withSession();
    const iv = this.db.invoices.find((x) => x.id === id);
    if (!iv) throw new Error("Invoice not found");
    Object.assign(iv, patch);
    this.save();
    return iv;
  }
  async deleteInvoice(id: string) {
    this.withSession();
    this.db.invoices = this.db.invoices.filter((i) => i.id !== id);
    this.save();
  }
  async listPayments() { this.withSession(); return this.db.payments; }
  async recordPayment(input: Partial<Payment>) {
    this.withSession();
    const p: Payment = {
      id: nid("p"), invoiceId: input.invoiceId ?? "", clientId: input.clientId ?? "",
      date: new Date().toISOString().slice(0, 10), amount: input.amount ?? 0,
      method: input.method ?? "card", status: "deposited", trustAccount: input.trustAccount ?? false,
    };
    this.db.payments.unshift(p);
    const iv = this.db.invoices.find((i) => i.id === p.invoiceId);
    if (iv) {
      const total = iv.lines.reduce((s, l) => s + l.quantity * l.rate, 0);
      const paid = this.db.payments.filter((x) => x.invoiceId === iv.id && x.status !== "failed")
        .reduce((s, x) => s + x.amount, 0);
      iv.status = paid >= total ? "paid" : iv.status === "draft" ? "draft" : "sent";
    }
    // Parity with the reference backend (POST /payments, contract §trust):
    // a trust-account payment appends a ledger entry with a running balance.
    if (p.trustAccount) {
      const prev = [...this.db.trust].reverse().find((t) => t.clientId === p.clientId);
      this.db.trust.push({
        id: nid("tt"), clientId: p.clientId, caseId: iv?.caseId ?? "",
        date: p.date,
        description: `Trust deposit — invoice ${iv?.number ?? "(unlinked)"}`,
        amount: p.amount, balanceAfter: (prev?.balanceAfter ?? 0) + p.amount,
      });
    }
    this.save();
    return p;
  }
  async listTrustTransactions() { this.withSession(); return this.db.trust; }
  // V2 ticket 09: the Demo Version ships its own full seed and has no sample
  // flag — the dashboard banner never shows here, so removal is a no-op.
  async removeSampleData() {
    this.withSession();
    return {
      removed: true as const, contacts: 0, case: 0, event: 0, task: 0,
      timeEntry: 0, invoice: 0, payment: 0, trustReversal: 0,
    };
  }

  // ---- gateway (V2 slice 1: the SIMULATED gateway, ADR-0006) ----
  // The demo stores the connection status only — secret material typed into
  // the demo's connect form is never persisted anywhere (demo or not).
  async getGatewayAccount() {
    this.withSession();
    return this.db.gatewayAccount
      ?? { connected: false, provider: null, keyId: null, enabled: false, connectedAt: null };
  }
  async connectGatewayAccount(input: { provider?: string; keyId: string; keySecret: string; webhookSecret: string }) {
    this.withSession();
    void input.keySecret;
    void input.webhookSecret;
    this.db.gatewayAccount = {
      connected: true,
      provider: input.provider ?? "razorpay",
      keyId: input.keyId,
      enabled: true,
      connectedAt: new Date().toISOString(),
    };
    this.save();
    return this.db.gatewayAccount;
  }
  async disconnectGatewayAccount() {
    this.withSession();
    this.db.gatewayAccount = null;
    this.save();
  }
  async createPaymentLink(invoiceId: string): Promise<PaymentLink> {
    this.withSession();
    const iv = this.db.invoices.find((i) => i.id === invoiceId);
    if (!iv) throw new Error("Invoice not found");
    if (iv.status === "paid") throw new Error("Invoice is already paid");
    if (!this.db.gatewayAccount?.connected) {
      throw new Error("No payment gateway connected — the firm owner must connect one in Settings");
    }
    const total = iv.lines.reduce((s, l) => s + l.quantity * l.rate, 0);
    const paid = this.db.payments
      .filter((x) => x.invoiceId === iv.id && x.status !== "failed")
      .reduce((s, x) => s + x.amount, 0);
    const outstanding = total - paid;
    if (outstanding <= 0) throw new Error("Invoice is already paid");

    const id = nid("pl");
    const link: PaymentLink = {
      id,
      invoiceId,
      provider: this.db.gatewayAccount.provider ?? "razorpay",
      providerLinkId: nid("link"),
      // The demo's short URL opens the simulated gateway page (the router
      // mounts /pay/:id in mock mode only).
      shortUrl: `${window.location.origin}/pay/${id}`,
      amount: outstanding,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    this.db.paymentLinks.unshift(link);
    this.save();
    return link;
  }
  async listPaymentLinks(invoiceId: string) {
    this.withSession();
    // unshift keeps the store newest-first.
    return this.db.paymentLinks.filter((l) => l.invoiceId === invoiceId);
  }
  async syncPaymentLink(id: string) {
    this.withSession();
    const link = this.db.paymentLinks.find((l) => l.id === id);
    if (!link) throw new Error("Payment link not found");
    // In the simulation the client "pays" on the /pay page itself (which
    // records and flips the link), so a sync never discovers anything new.
    return { status: link.status as PaymentLink["status"], recorded: false };
  }
  async getPaymentLink(id: string) {
    this.withSession();
    return this.db.paymentLinks.find((l) => l.id === id) ?? null;
  }
  async payMockLink(id: string, method: Payment["method"]) {
    this.withSession();
    const link = this.db.paymentLinks.find((l) => l.id === id);
    if (!link || link.status !== "active") throw new Error("Payment link not found");
    // The SAME record path a manual record uses — roll-up and trust
    // semantics identical, trustAccount hard-wired false (gateway money
    // never touches trust, spec Q12).
    await this.recordPayment({
      invoiceId: link.invoiceId, amount: link.amount, method, trustAccount: false,
    });
    link.status = "paid";
    this.save();
    return link;
  }

  // ---- documents ----
  async listDocuments() { this.withSession(); return this.db.documents; }
  async createDocument(input: Partial<DocumentFile>) {
    this.withSession();
    const f: DocumentFile = {
      id: nid("f"), name: input.name ?? "Untitled.docx", folder: input.folder ?? "General",
      caseId: input.caseId, sizeKb: input.sizeKb ?? 42,
      updatedAt: new Date().toISOString().slice(0, 10), kind: input.kind ?? "doc",
      templateFields: input.templateFields,
    };
    this.db.documents.unshift(f);
    this.save();
    return f;
  }
  async updateDocument(id: string, patch: Partial<DocumentFile>) {
    this.withSession();
    const f = this.db.documents.find((x) => x.id === id);
    if (!f) throw new Error("Document not found");
    Object.assign(f, patch);
    this.save();
    return f;
  }
  async deleteDocument(id: string) {
    this.withSession();
    this.db.documents = this.db.documents.filter((d) => d.id !== id);
    // The bytes die with the row (production drops the object best-effort).
    delete this.db.fileBlobs[id];
    this.save();
  }

  /**
   * Ticket 17, demo flow: the browser reads the file as a base64 data URL
   * and the adapter stores it in the local DB beside the metadata row —
   * no network, and downloads open the very bytes that were uploaded.
   * Capped at 1 MB/file (localStorage quota); the message names the gap
   * against production's 25 MB instead of silently failing.
   */
  async uploadDocument(input: { file: File; name?: string; folder?: string; caseId?: string }) {
    this.withSession();
    if (input.file.size > DEMO_MAX_UPLOAD_BYTES) {
      throw new Error(
        "File is too large for the demo — the limit is 1 MB (production allows 25 MB)",
      );
    }
    const contentType = input.file.type || "application/octet-stream";
    const fileName = (input.name ?? input.file.name).trim() || "Untitled.docx";
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not read the file"));
      reader.readAsDataURL(input.file);
    });
    const f: DocumentFile = {
      id: nid("f"), name: fileName, folder: input.folder ?? "General",
      caseId: input.caseId, sizeKb: Math.max(1, Math.round(input.file.size / 1024)),
      updatedAt: new Date().toISOString().slice(0, 10),
      kind: kindForFile(contentType, fileName), hasFile: true,
    };
    this.db.documents.unshift(f);
    this.db.fileBlobs[f.id] = dataUrl;
    this.save();
    return f;
  }

  async getDocumentDownloadUrl(id: string) {
    this.withSession();
    const f = this.db.documents.find((x) => x.id === id);
    if (!f) throw new Error("Document not found");
    const url = this.db.fileBlobs[id];
    if (!url) {
      throw new Error("Document file not found — no bytes stored for this document");
    }
    return url;
  }

  // ---- communications ----
  async listThreads() { this.withSession(); return this.db.threads; }
  async sendMessage(threadId: string, body: string) {
    const s = this.withSession();
    const th = this.db.threads.find((t) => t.id === threadId);
    if (!th) throw new Error("Thread not found");
    th.messages.push({
      id: nid("m"), from: "firm", authorName: s.user.name, body,
      at: new Date().toISOString(),
    });
    this.save();
    return th;
  }
  async createThread(input: Partial<MessageThread>) {
    this.withSession();
    const th: MessageThread = {
      id: nid("th"), subject: input.subject ?? "(no subject)",
      clientId: input.clientId ?? "", caseId: input.caseId,
      channel: input.channel ?? "secure", unread: false, messages: input.messages ?? [],
    };
    this.db.threads.unshift(th);
    this.save();
    return th;
  }
  async markThreadRead(id: string) {
    this.withSession();
    const th = this.db.threads.find((t) => t.id === id);
    if (th) th.unread = false;
    this.save();
  }

  // ---- leads ----
  async listLeads() { this.withSession(); return this.db.leads; }
  async createLead(input: Partial<Lead>) {
    this.withSession();
    const l: Lead = {
      id: nid("ld"), name: input.name ?? "New lead", email: input.email ?? "",
      phone: input.phone ?? "", source: input.source ?? "website",
      stage: input.stage ?? "new", practiceArea: input.practiceArea ?? "General",
      value: input.value ?? 0, createdAt: new Date().toISOString().slice(0, 10),
      notes: input.notes, activity: input.activity ?? [{ at: new Date().toISOString(), text: "Lead created" }],
    };
    this.db.leads.unshift(l);
    this.save();
    return l;
  }
  async updateLead(id: string, patch: Partial<Lead>) {
    this.withSession();
    const l = this.db.leads.find((x) => x.id === id);
    if (!l) throw new Error("Lead not found");
    Object.assign(l, patch);
    this.save();
    return l;
  }
  async deleteLead(id: string) {
    this.withSession();
    this.db.leads = this.db.leads.filter((l) => l.id !== id);
    this.save();
  }
  async convertLead(id: string, caseInput: Partial<Case>) {
    this.withSession();
    const l = this.db.leads.find((x) => x.id === id);
    if (!l) throw new Error("Lead not found");
    // Parity with the reference backend (POST /leads/:id/convert): converting
    // twice is a conflict, not a second case.
    if (l.stage === "converted") throw new Error("Lead already converted");
    const contact: Contact = {
      id: nid("c"), type: "client", name: l.name, email: l.email, phone: l.phone,
      address: "", caseIds: [], createdAt: new Date().toISOString().slice(0, 10),
    };
    this.db.contacts.unshift(contact);
    const k: Case = {
      id: nid("k"), number: `2026-${String(this.db.cases.length + 50).padStart(4, "0")}`,
      title: caseInput.title ?? `${l.name} — ${l.practiceArea}`, clientId: contact.id,
      practiceArea: l.practiceArea, stage: "intake", status: "open",
      openDate: new Date().toISOString().slice(0, 10),
      leadAttorneyId: this.db.users[0].id, description: caseInput.description ?? "",
      billableRate: 300000, trustBalance: 0,
    };
    this.db.cases.unshift(k);
    contact.caseIds.push(k.id);
    l.stage = "converted";
    l.activity.unshift({ at: new Date().toISOString(), text: `Converted to case ${k.number}` });
    this.save();
    return { lead: l, contact, case: k };
  }

  // ---- reports ----
  async listReports() { this.withSession(); return structuredClone(seedReports) as ReportDef[]; }

  // ---- notifications ----
  async listNotifications() { this.withSession(); return this.db.notifications; }
  async markNotificationsRead() {
    this.withSession();
    this.db.notifications.forEach((n) => (n.read = true));
    this.save();
  }
}

export const mockAdapter: LawleitApi = new MockAdapter();
