import type {
  CalendarEvent, Case, Contact, DocumentFile, Expense, Firm, ID, Invoice,
  Lead, MessageThread, Payment, ReportDef, Session, Task, TimeEntry,
  TrustTransaction, User,
} from "./types";

/**
 * LawleitApi — THE seam between UI and backend.
 *
 * The UI imports `api` from "@/lib/data" and codes ONLY against this interface.
 * `mockAdapter` implements it with localStorage persistence (ships working).
 * To go live, implement `httpAdapter` against your real backend and flip one
 * line in index.ts. Endpoint mapping suggestions live in docs/API_CONTRACT.md.
 */
export interface LawleitApi {
  // auth / session
  login(email: string, password: string): Promise<Session>;
  signup(input: {
    firstName: string; lastName: string; email: string; firmName: string;
    zip: string; employees: number; phone: string;
  }): Promise<Session>;
  logout(): Promise<void>;
  getSession(): Promise<Session | null>;
  /**
   * Demo Version only: wipe the persisted local DB and re-seed the pristine
   * Demo Firm, returning a fresh session (ADR 0001). Production
   * implementations reject — real firm data is never wiped from the client.
   */
  resetDemoData(): Promise<Session>;

  // firm & users
  updateFirm(patch: Partial<Firm>): Promise<Firm>;
  listUsers(): Promise<User[]>;
  updateUser(id: string, patch: Partial<User>): Promise<User>;

  // cases
  listCases(): Promise<Case[]>;
  getCase(id: string): Promise<Case | null>;
  createCase(input: Partial<Case>): Promise<Case>;
  updateCase(id: string, patch: Partial<Case>): Promise<Case>;
  deleteCase(id: string): Promise<void>;

  // contacts
  listContacts(): Promise<Contact[]>;
  getContact(id: string): Promise<Contact | null>;
  createContact(input: Partial<Contact>): Promise<Contact>;
  updateContact(id: string, patch: Partial<Contact>): Promise<Contact>;
  deleteContact(id: string): Promise<void>;

  // calendar
  listEvents(range: { from: string; to: string }): Promise<CalendarEvent[]>;
  createEvent(input: Partial<CalendarEvent>): Promise<CalendarEvent>;
  updateEvent(id: string, patch: Partial<CalendarEvent>): Promise<CalendarEvent>;
  deleteEvent(id: string): Promise<void>;

  // tasks
  listTasks(): Promise<Task[]>;
  createTask(input: Partial<Task>): Promise<Task>;
  updateTask(id: string, patch: Partial<Task>): Promise<Task>;
  deleteTask(id: string): Promise<void>;

  // time & expenses
  listTimeEntries(): Promise<TimeEntry[]>;
  createTimeEntry(input: Partial<TimeEntry>): Promise<TimeEntry>;
  updateTimeEntry(id: string, patch: Partial<TimeEntry>): Promise<TimeEntry>;
  deleteTimeEntry(id: string): Promise<void>;
  listExpenses(): Promise<Expense[]>;
  createExpense(input: Partial<Expense>): Promise<Expense>;
  updateExpense(id: string, patch: Partial<Expense>): Promise<Expense>;
  deleteExpense(id: string): Promise<void>;

  // billing
  listInvoices(): Promise<Invoice[]>;
  getInvoice(id: string): Promise<Invoice | null>;
  createInvoice(input: Partial<Invoice>): Promise<Invoice>;
  updateInvoice(id: string, patch: Partial<Invoice>): Promise<Invoice>;
  deleteInvoice(id: string): Promise<void>;
  listPayments(): Promise<Payment[]>;
  recordPayment(input: Partial<Payment>): Promise<Payment>;
  listTrustTransactions(): Promise<TrustTransaction[]>;

  // documents
  listDocuments(): Promise<DocumentFile[]>;
  createDocument(input: Partial<DocumentFile>): Promise<DocumentFile>;
  updateDocument(id: string, patch: Partial<DocumentFile>): Promise<DocumentFile>;
  deleteDocument(id: string): Promise<void>;
  /**
   * Ticket 17: uploads a REAL file through the adapter's flow — production:
   * sign-upload → direct PUT to object storage → metadata record; demo: the
   * bytes are stored in the local DB (capped at 1 MB/file). Returns the new
   * DocumentFile with `hasFile: true`.
   */
  uploadDocument(input: {
    file: File;
    /** Defaults to file.name (keep the extension — it picks the icon). */
    name?: string;
    /** Target folder; defaults to "General". */
    folder?: string;
    /** The linked case, if any. */
    caseId?: ID;
  }): Promise<DocumentFile>;
  /**
   * Ticket 17: a URL serving the document's bytes — a short-lived signed URL
   * in http mode, a data: URL in demo mode. Rejects for metadata-only
   * documents (no bytes) and unknown ids.
   */
  getDocumentDownloadUrl(id: ID): Promise<string>;

  // communications
  listThreads(): Promise<MessageThread[]>;
  sendMessage(threadId: string, body: string): Promise<MessageThread>;
  createThread(input: Partial<MessageThread>): Promise<MessageThread>;
  markThreadRead(id: string): Promise<void>;

  // leads
  listLeads(): Promise<Lead[]>;
  createLead(input: Partial<Lead>): Promise<Lead>;
  updateLead(id: string, patch: Partial<Lead>): Promise<Lead>;
  deleteLead(id: string): Promise<void>;
  convertLead(id: string, caseInput: Partial<Case>): Promise<{ lead: Lead; contact: Contact; case: Case }>;

  // reports
  listReports(): Promise<ReportDef[]>;

  // notifications
  listNotifications(): Promise<import("./types").Notification[]>;
  markNotificationsRead(): Promise<void>;
}

/**
 * Ticket 17 — the ONE mime/name → `DocumentFile["kind"]` rule both adapters
 * share, so an uploaded file carries the same icon in either mode. Order
 * matters: pdf and images before the office/text catch-alls, extension
 * fallback for browsers that report no content type.
 */
export function kindForFile(contentType: string, name: string): DocumentFile["kind"] {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (contentType === "application/pdf" || extension === "pdf") return "pdf";
  if (contentType.startsWith("image/")) return "image";
  if (
    contentType.includes("spreadsheet") || contentType === "text/csv" ||
    ["xls", "xlsx", "csv"].includes(extension)
  ) {
    return "sheet";
  }
  if (
    contentType === "application/msword" || contentType.includes("wordprocessing") ||
    contentType.startsWith("text/") || contentType === "application/rtf" ||
    ["doc", "docx", "rtf", "txt", "md", "dotx"].includes(extension)
  ) {
    return "doc";
  }
  return "other";
}
