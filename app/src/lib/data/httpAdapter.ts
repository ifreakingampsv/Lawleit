import type { LawleitApi } from "./api";

/**
 * HTTP adapter — implementation skeleton for the real backend.
 *
 * TODO(owner): implement each method as a fetch to your API, then swap the
 * adapter in src/lib/data/index.ts. The REST mapping for every method is
 * documented in docs/API_CONTRACT.md. Shapes come from src/lib/data/types.ts —
 * keep them and TypeScript will hold the boundary for you.
 */
const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}`);
  return (res.status === 204 ? (undefined as T) : ((await res.json()) as T));
}

const qs = (params: Record<string, string | number | undefined>) => {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== undefined && u.set(k, String(v)));
  const s = u.toString();
  return s ? `?${s}` : "";
};

/**
 * Every method below intentionally throws until implemented — fail loudly in
 * dev rather than silently pretending the backend exists.
 */
class HttpAdapter implements LawleitApi {
  private todo(method: string): never {
    throw new Error(`httpAdapter.${method} not implemented — see docs/API_CONTRACT.md`);
  }
  login() { return this.todo("login"); }
  signup() { return this.todo("signup"); }
  logout() { return this.todo("logout"); }
  getSession() { return http<never>("/session").catch(() => null); }
  updateFirm() { return this.todo("updateFirm"); }
  listUsers() { return http("/users") as never; }
  updateUser() { return this.todo("updateUser"); }
  listCases() { return http("/cases") as never; }
  getCase(id: string) { return http(`/cases/${id}`) as never; }
  createCase(input: unknown) { return http("/cases", { method: "POST", body: JSON.stringify(input) }) as never; }
  updateCase(id: string, patch: unknown) { return http(`/cases/${id}`, { method: "PATCH", body: JSON.stringify(patch) }) as never; }
  deleteCase(id: string) { return http(`/cases/${id}`, { method: "DELETE" }) as never; }
  listContacts() { return http("/contacts") as never; }
  getContact(id: string) { return http(`/contacts/${id}`) as never; }
  createContact(input: unknown) { return http("/contacts", { method: "POST", body: JSON.stringify(input) }) as never; }
  updateContact(id: string, patch: unknown) { return http(`/contacts/${id}`, { method: "PATCH", body: JSON.stringify(patch) }) as never; }
  deleteContact(id: string) { return http(`/contacts/${id}`, { method: "DELETE" }) as never; }
  listEvents(range: { from: string; to: string }) { return http(`/events${qs(range)}`) as never; }
  createEvent(input: unknown) { return http("/events", { method: "POST", body: JSON.stringify(input) }) as never; }
  updateEvent(id: string, patch: unknown) { return http(`/events/${id}`, { method: "PATCH", body: JSON.stringify(patch) }) as never; }
  deleteEvent(id: string) { return http(`/events/${id}`, { method: "DELETE" }) as never; }
  listTasks() { return http("/tasks") as never; }
  createTask(input: unknown) { return http("/tasks", { method: "POST", body: JSON.stringify(input) }) as never; }
  updateTask(id: string, patch: unknown) { return http(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }) as never; }
  deleteTask(id: string) { return http(`/tasks/${id}`, { method: "DELETE" }) as never; }
  listTimeEntries() { return http("/time-entries") as never; }
  createTimeEntry(input: unknown) { return http("/time-entries", { method: "POST", body: JSON.stringify(input) }) as never; }
  updateTimeEntry(id: string, patch: unknown) { return http(`/time-entries/${id}`, { method: "PATCH", body: JSON.stringify(patch) }) as never; }
  deleteTimeEntry(id: string) { return http(`/time-entries/${id}`, { method: "DELETE" }) as never; }
  listExpenses() { return http("/expenses") as never; }
  createExpense(input: unknown) { return http("/expenses", { method: "POST", body: JSON.stringify(input) }) as never; }
  updateExpense(id: string, patch: unknown) { return http(`/expenses/${id}`, { method: "PATCH", body: JSON.stringify(patch) }) as never; }
  deleteExpense(id: string) { return http(`/expenses/${id}`, { method: "DELETE" }) as never; }
  listInvoices() { return http("/invoices") as never; }
  getInvoice(id: string) { return http(`/invoices/${id}`) as never; }
  createInvoice(input: unknown) { return http("/invoices", { method: "POST", body: JSON.stringify(input) }) as never; }
  updateInvoice(id: string, patch: unknown) { return http(`/invoices/${id}`, { method: "PATCH", body: JSON.stringify(patch) }) as never; }
  deleteInvoice(id: string) { return http(`/invoices/${id}`, { method: "DELETE" }) as never; }
  listPayments() { return http("/payments") as never; }
  recordPayment(input: unknown) { return http("/payments", { method: "POST", body: JSON.stringify(input) }) as never; }
  listTrustTransactions() { return http("/trust/transactions") as never; }
  listDocuments() { return http("/documents") as never; }
  createDocument(input: unknown) { return http("/documents", { method: "POST", body: JSON.stringify(input) }) as never; }
  updateDocument(id: string, patch: unknown) { return http(`/documents/${id}`, { method: "PATCH", body: JSON.stringify(patch) }) as never; }
  deleteDocument(id: string) { return http(`/documents/${id}`, { method: "DELETE" }) as never; }
  listThreads() { return http("/threads") as never; }
  sendMessage(threadId: string, body: string) { return http(`/threads/${threadId}/messages`, { method: "POST", body: JSON.stringify({ body }) }) as never; }
  createThread(input: unknown) { return http("/threads", { method: "POST", body: JSON.stringify(input) }) as never; }
  markThreadRead(id: string) { return http(`/threads/${id}/read`, { method: "POST" }) as never; }
  listLeads() { return http("/leads") as never; }
  createLead(input: unknown) { return http("/leads", { method: "POST", body: JSON.stringify(input) }) as never; }
  updateLead(id: string, patch: unknown) { return http(`/leads/${id}`, { method: "PATCH", body: JSON.stringify(patch) }) as never; }
  deleteLead(id: string) { return http(`/leads/${id}`, { method: "DELETE" }) as never; }
  convertLead(id: string, caseInput: unknown) { return http(`/leads/${id}/convert`, { method: "POST", body: JSON.stringify(caseInput) }) as never; }
  listReports() { return http("/reports") as never; }
  listNotifications() { return http("/notifications") as never; }
  markNotificationsRead() { return http("/notifications/read", { method: "POST" }) as never; }
}

export const httpAdapter: LawleitApi = new HttpAdapter();
