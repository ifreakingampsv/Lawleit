import { kindForFile, type LawleitApi } from "./api";
import type {
  CalendarEvent, Case, Contact, DocumentFile, Expense, Firm, GatewayAccountStatus, Invoice,
  Lead, MessageThread, Notification, Payment, PaymentLink, ReportDef, Session, Task,
  TimeEntry, TrustTransaction, User,
} from "./types";

/**
 * HTTP adapter — full implementation of LawleitApi over REST.
 *
 * Endpoint mapping: docs/API_CONTRACT.md (1:1). Works with the bundled
 * reference backend (`backend/server.mjs` at the repo root) and with any
 * backend that conforms to the contract.
 *
 * Auth: the server issues a session token on login/signup; it is sent as
 * `Authorization: Bearer <token>` AND left to cookies (`credentials: include`)
 * so either mechanism works. The token lives in sessionStorage for the tab's
 * lifetime, mirroring the mock adapter's session scope.
 */
const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";
const TOKEN_KEY = "lawleit.auth.token";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

let token: string | null = (() => {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
})();

function setToken(next: string | null) {
  token = next;
  try {
    if (next) sessionStorage.setItem(TOKEN_KEY, next);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable — token stays in memory */ }
}

async function http<T>(
  method: string,
  path: string,
  opts: { body?: unknown; query?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  Object.entries(opts.query ?? {}).forEach(([k, v]) => {
    if (v !== undefined) url.searchParams.set(k, String(v));
  });

  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    let message = `${method} ${path} → ${res.status}`;
    try {
      const err = (await res.json()) as { error?: string; message?: string };
      if (err.error ?? err.message) message = (err.error ?? err.message) as string;
    } catch { /* non-JSON error body — keep the generic message */ }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

/** GET /:id endpoints 404 for a missing entity; the API contract models that as null. */
async function getOrNull<T>(path: string): Promise<T | null> {
  try {
    return await http<T>("GET", path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

class HttpAdapter implements LawleitApi {
  // ---- auth ----
  async login(email: string, password: string): Promise<Session> {
    const res = await http<Session & { token: string }>("POST", "/auth/login", {
      body: { email, password },
    });
    setToken(res.token);
    return { user: res.user, firm: res.firm, users: res.users };
  }

  async signup(input: {
    firstName: string; lastName: string; email: string; firmName: string;
    zip: string; employees: number; phone: string;
  }): Promise<Session> {
    const res = await http<Session & { token: string }>("POST", "/auth/signup", { body: input });
    setToken(res.token);
    return { user: res.user, firm: res.firm, users: res.users };
  }

  async logout(): Promise<void> {
    try {
      await http<void>("POST", "/auth/logout");
    } finally {
      setToken(null);
    }
  }

  async getSession(): Promise<Session | null> {
    if (!token) return null;
    try {
      return await http<Session>("GET", "/session");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setToken(null);
        return null;
      }
      throw e;
    }
  }

  async resetDemoData(): Promise<Session> {
    throw new Error("Reset demo data is a Demo Version action — production data is never wiped from the client");
  }

  // ---- firm & users ----
  updateFirm(patch: Partial<Firm>) { return http<Firm>("PATCH", "/firm", { body: patch }); }
  listUsers() { return http<User[]>("GET", "/users"); }
  updateUser(id: string, patch: Partial<User>) { return http<User>("PATCH", `/users/${id}`, { body: patch }); }
  /**
   * POST /users (docs/API_CONTRACT.md): body { name, email, role, hourlyRate?,
   * avatarColor? } → 201 ApiUser. hourlyRate is already integer paise and
   * undefined keys drop out of the JSON body, so the input maps 1:1. Server
   * errors surface as ApiError with the message verbatim (403 owner-only,
   * 409 "Email already registered").
   */
  createUser(input: {
    name: string; email: string; role: User["role"]; hourlyRate?: number; avatarColor?: string;
  }) {
    return http<User>("POST", "/users", { body: input });
  }

  // ---- cases ----
  listCases() { return http<Case[]>("GET", "/cases"); }
  getCase(id: string) { return getOrNull<Case>(`/cases/${id}`); }
  createCase(input: Partial<Case>) { return http<Case>("POST", "/cases", { body: input }); }
  updateCase(id: string, patch: Partial<Case>) { return http<Case>("PATCH", `/cases/${id}`, { body: patch }); }
  deleteCase(id: string) { return http<void>("DELETE", `/cases/${id}`); }

  // ---- contacts ----
  listContacts() { return http<Contact[]>("GET", "/contacts"); }
  getContact(id: string) { return getOrNull<Contact>(`/contacts/${id}`); }
  createContact(input: Partial<Contact>) { return http<Contact>("POST", "/contacts", { body: input }); }
  updateContact(id: string, patch: Partial<Contact>) { return http<Contact>("PATCH", `/contacts/${id}`, { body: patch }); }
  deleteContact(id: string) { return http<void>("DELETE", `/contacts/${id}`); }

  // ---- calendar ----
  listEvents(range: { from: string; to: string }) {
    return http<CalendarEvent[]>("GET", "/events", { query: { from: range.from, to: range.to } });
  }
  createEvent(input: Partial<CalendarEvent>) { return http<CalendarEvent>("POST", "/events", { body: input }); }
  updateEvent(id: string, patch: Partial<CalendarEvent>) { return http<CalendarEvent>("PATCH", `/events/${id}`, { body: patch }); }
  deleteEvent(id: string) { return http<void>("DELETE", `/events/${id}`); }

  // ---- tasks ----
  listTasks() { return http<Task[]>("GET", "/tasks"); }
  createTask(input: Partial<Task>) { return http<Task>("POST", "/tasks", { body: input }); }
  updateTask(id: string, patch: Partial<Task>) { return http<Task>("PATCH", `/tasks/${id}`, { body: patch }); }
  deleteTask(id: string) { return http<void>("DELETE", `/tasks/${id}`); }

  // ---- time & expenses ----
  listTimeEntries() { return http<TimeEntry[]>("GET", "/time-entries"); }
  createTimeEntry(input: Partial<TimeEntry>) { return http<TimeEntry>("POST", "/time-entries", { body: input }); }
  updateTimeEntry(id: string, patch: Partial<TimeEntry>) { return http<TimeEntry>("PATCH", `/time-entries/${id}`, { body: patch }); }
  deleteTimeEntry(id: string) { return http<void>("DELETE", `/time-entries/${id}`); }
  listExpenses() { return http<Expense[]>("GET", "/expenses"); }
  createExpense(input: Partial<Expense>) { return http<Expense>("POST", "/expenses", { body: input }); }
  updateExpense(id: string, patch: Partial<Expense>) { return http<Expense>("PATCH", `/expenses/${id}`, { body: patch }); }
  deleteExpense(id: string) { return http<void>("DELETE", `/expenses/${id}`); }

  // ---- billing ----
  listInvoices() { return http<Invoice[]>("GET", "/invoices"); }
  getInvoice(id: string) { return getOrNull<Invoice>(`/invoices/${id}`); }
  createInvoice(input: Partial<Invoice>) { return http<Invoice>("POST", "/invoices", { body: input }); }
  updateInvoice(id: string, patch: Partial<Invoice>) { return http<Invoice>("PATCH", `/invoices/${id}`, { body: patch }); }
  deleteInvoice(id: string) { return http<void>("DELETE", `/invoices/${id}`); }
  listPayments() { return http<Payment[]>("GET", "/payments"); }
  recordPayment(input: Partial<Payment>) { return http<Payment>("POST", "/payments", { body: input }); }
  listTrustTransactions() { return http<TrustTransaction[]>("GET", "/trust/transactions"); }
  removeSampleData() {
    return http<{
      removed: true;
      contacts: number;
      case: number;
      event: number;
      task: number;
      timeEntry: number;
      invoice: number;
      payment: number;
      trustReversal: number;
    }>("POST", "/firm/sample-data/remove");
  }

  // ---- gateway (V2 slice 1: collecting payments, ADR-0006) ----
  getGatewayAccount() { return http<GatewayAccountStatus>("GET", "/gateway/account"); }
  connectGatewayAccount(input: { provider?: string; keyId: string; keySecret: string; webhookSecret: string }) {
    return http<GatewayAccountStatus>("PUT", "/gateway/account", { body: input });
  }
  disconnectGatewayAccount() { return http<void>("DELETE", "/gateway/account"); }
  createPaymentLink(invoiceId: string) {
    return http<PaymentLink>("POST", `/invoices/${invoiceId}/payment-link`);
  }
  listPaymentLinks(invoiceId: string) {
    return http<PaymentLink[]>("GET", `/invoices/${invoiceId}/payment-links`);
  }
  syncPaymentLink(id: string) {
    return http<{ status: PaymentLink["status"]; recorded: boolean }>("POST", `/payment-links/${id}/sync`);
  }
  // The bare-id lookup and the simulated pay exist in demo mode only: the
  // contract exposes links per invoice, and real money moves at the provider.
  getPaymentLink(): Promise<PaymentLink | null> {
    return Promise.reject(new Error("Direct link lookup exists in demo mode only"));
  }
  payMockLink(): Promise<PaymentLink> {
    return Promise.reject(new Error("The simulated gateway exists in demo mode only"));
  }

  // ---- documents ----
  listDocuments() { return http<DocumentFile[]>("GET", "/documents"); }
  createDocument(input: Partial<DocumentFile>) { return http<DocumentFile>("POST", "/documents", { body: input }); }
  updateDocument(id: string, patch: Partial<DocumentFile>) { return http<DocumentFile>("PATCH", `/documents/${id}`, { body: patch }); }
  deleteDocument(id: string) { return http<void>("DELETE", `/documents/${id}`); }

  /**
   * Ticket 17's real-file flow, three steps: (1) sign-upload validates
   * server-side (type allowlist, size cap, case link) and returns a
   * short-lived signed PUT plus the storage key, (2) the browser PUTs the
   * bytes straight to object storage — the API server never proxies file
   * bodies, (3) the metadata record is created echoing that key, yielding
   * the DocumentFile (hasFile comes back from the server). The PUT carries
   * the exact content type that was signed.
   */
  async uploadDocument(input: { file: File; name?: string; folder?: string; caseId?: string }) {
    const contentType = input.file.type || "application/octet-stream";
    const fileName = (input.name ?? input.file.name).trim() || "Untitled.docx";
    const signed = await http<{
      storageKey: string; url: string; method: "PUT"; expiresIn: number;
    }>("POST", "/documents/sign-upload", {
      body: {
        caseId: input.caseId ?? null,
        name: fileName,
        contentType,
        sizeBytes: input.file.size,
      },
    });
    const put = await fetch(signed.url, {
      method: signed.method,
      headers: { "Content-Type": contentType },
      body: input.file,
    });
    if (!put.ok) {
      let message = "Upload to storage failed";
      try {
        const err = (await put.json()) as { error?: string };
        if (err.error) message = err.error;
      } catch { /* non-JSON body — keep the generic message */ }
      throw new ApiError(put.status, message);
    }
    return http<DocumentFile>("POST", "/documents", {
      body: {
        name: fileName,
        folder: input.folder ?? "General",
        caseId: input.caseId ?? null,
        kind: kindForFile(contentType, fileName),
        sizeBytes: input.file.size,
        storageKey: signed.storageKey,
        mimeType: contentType,
      },
    });
  }

  /** The signed GET is minted per click — it expires, so it is never cached. */
  async getDocumentDownloadUrl(id: string) {
    const res = await http<{ url: string; expiresIn: number }>("GET", `/documents/${id}/download`);
    return res.url;
  }

  // ---- communications ----
  listThreads() { return http<MessageThread[]>("GET", "/threads"); }
  sendMessage(threadId: string, body: string) {
    return http<MessageThread>("POST", `/threads/${threadId}/messages`, { body: { body } });
  }
  createThread(input: Partial<MessageThread>) { return http<MessageThread>("POST", "/threads", { body: input }); }
  markThreadRead(id: string) { return http<void>("POST", `/threads/${id}/read`); }

  // ---- leads ----
  listLeads() { return http<Lead[]>("GET", "/leads"); }
  createLead(input: Partial<Lead>) { return http<Lead>("POST", "/leads", { body: input }); }
  updateLead(id: string, patch: Partial<Lead>) { return http<Lead>("PATCH", `/leads/${id}`, { body: patch }); }
  deleteLead(id: string) { return http<void>("DELETE", `/leads/${id}`); }
  convertLead(id: string, caseInput: Partial<Case>) {
    return http<{ lead: Lead; contact: Contact; case: Case }>("POST", `/leads/${id}/convert`, { body: caseInput });
  }

  // ---- reports & notifications ----
  listReports() { return http<ReportDef[]>("GET", "/reports"); }
  listNotifications() { return http<Notification[]>("GET", "/notifications"); }
  markNotificationsRead() { return http<void>("POST", "/notifications/read"); }
}

export const httpAdapter: LawleitApi = new HttpAdapter();
