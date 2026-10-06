import type {
  CalendarEvent, Case, Contact, DocumentFile, Expense, Firm, GatewayAccountStatus, ID, Invoice,
  Lead, MessageThread, Payment, PaymentLink, ReportDef, Session, Task, TimeEntry,
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
  /**
   * Invites a user (POST /users, ticket 08): owner-only — members get 403
   * "Only the firm owner can manage users"; a taken email (unique across the
   * whole backend, not just the firm) gets 409 "Email already registered";
   * a role outside owner | attorney | paralegal | staff is rejected. The
   * created user is active with no password yet — the invite link the backend
   * mails them is how they set their first password.
   */
  createUser(input: {
    name: string;
    email: string;
    role: User["role"];
    /** Integer paise (see Paise); omitted → the backend's default. */
    hourlyRate?: User["hourlyRate"];
    avatarColor?: string;
  }): Promise<User>;

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

  /**
   * V2 ticket 09 — clears the labeled sample workspace the firm was seeded
   * with (dashboard banner action). Production: soft-deletes the sample rows
   * and appends the trust reversal. 409 "No sample data to remove…" when
   * there is nothing live. The demo adapter resolves a no-op (the demo has
   * its own full seed and no sample flag).
   */
  removeSampleData(): Promise<{
    removed: true;
    contacts: number;
    case: number;
    event: number;
    task: number;
    timeEntry: number;
    invoice: number;
    payment: number;
    trustReversal: number;
  }>;

  /**
   * V2 slice 1 — collecting payments through the firm's OWN gateway account
   * (ADR-0006 bring-your-own-keys): the owner connects it once, every member
   * collects via hosted payment links, money settles to the firm's bank.
   */
  /** The firm's gateway connection status (no secrets exist in this shape). */
  getGatewayAccount(): Promise<GatewayAccountStatus>;
  /**
   * Owner-only connect/replace. Server errors pass through verbatim: 403
   * "Only the firm owner can manage the payments gateway", 400 "Key id, key
   * secret, and webhook secret are required", and — when the operator has not
   * set GATEWAY_ENCRYPTION_KEY — 503 "Payments gateway not configured — set
   * GATEWAY_ENCRYPTION_KEY (see .env.example)".
   */
  connectGatewayAccount(input: {
    provider?: string;
    keyId: string;
    keySecret: string;
    webhookSecret: string;
  }): Promise<GatewayAccountStatus>;
  disconnectGatewayAccount(): Promise<void>;
  /**
   * Collect: a hosted payment link for the invoice's outstanding paise.
   * Server errors pass through verbatim: 409 "Invoice is already paid",
   * 404 "Invoice not found", 503 the not-connected owner-step copy, 502 the
   * provider-failure copy.
   */
  createPaymentLink(invoiceId: ID): Promise<PaymentLink>;
  /** The invoice's link history, newest first. */
  listPaymentLinks(invoiceId: ID): Promise<PaymentLink[]>;
  /**
   * The cold-start self-heal: re-fetch the link from the gateway and record
   * the payment if the provider says paid and no webhook got here first.
   */
  syncPaymentLink(id: ID): Promise<{ status: PaymentLink["status"]; recorded: boolean }>;
  /**
   * Demo-only navigation helper for the simulated gateway page (ADR 0001):
   * look a link up by id to render /pay/:id. Production implementations
   * reject — the contract exposes links per invoice, never by bare id.
   */
  getPaymentLink(id: ID): Promise<PaymentLink | null>;
  /**
   * Demo-only: the simulated gateway's "client pays" action — records the
   * payment through the SAME path as a manual record (roll-up included) and
   * flips the link to paid. Production implementations reject: real money
   * moves at the provider, never inside the app.
   */
  payMockLink(id: ID, method: Payment["method"]): Promise<PaymentLink>;

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
