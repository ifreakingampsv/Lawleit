/**
 * Lawleit domain models — the single source of truth for the data layer.
 * The UI only imports from here; swapping the mock adapter for a real
 * backend means implementing `LawleitApi` (see api.ts) against real endpoints.
 *
 * Money fields are integer paise (see `Paise`); field names are unchanged,
 * so the REST contract and existing call sites stay compatible.
 */

import type { Paise } from "../money";
export type { Paise };

export type ID = string;

export interface User {
  id: ID;
  firmId: ID;
  name: string;
  email: string;
  role: "owner" | "attorney" | "paralegal" | "staff";
  avatarColor: string;
  hourlyRate: Paise; // per hour
  active: boolean;
}

export interface Firm {
  id: ID;
  name: string;
  practiceAreas: string[];
  phone: string;
  email: string;
  address: string;
  plan: "basic" | "pro" | "advanced";
  trialEndsAt: string; // ISO date
}

export type CaseStatus = "open" | "pending" | "closed";
export type CaseStage =
  | "intake"
  | "discovery"
  | "consult"
  | "court date pending"
  | "negotiation"
  | "trial"
  | "resolved";

export interface Case {
  id: ID;
  number: string; // e.g. "2026-0042"
  title: string;
  clientId: ID;
  practiceArea: string;
  stage: CaseStage;
  status: CaseStatus;
  openDate: string;
  courtDate?: string;
  statute?: string;
  leadAttorneyId: ID;
  description: string;
  billableRate: Paise; // per hour
  trustBalance: Paise;
}

export interface Contact {
  id: ID;
  type: "client" | "company" | "opposing" | "witness" | "referral";
  name: string;
  company?: string;
  email: string;
  phone: string;
  address: string;
  caseIds: ID[];
  notes?: string;
  createdAt: string;
}

export interface CalendarEvent {
  id: ID;
  title: string;
  date: string; // ISO date
  start: string; // "11:00"
  end: string; // "12:00"
  allDay?: boolean;
  location?: string;
  caseId?: ID;
  attendeeIds: ID[];
  type: "meeting" | "court" | "deadline" | "personal" | "task";
  color: string;
  reminders?: string[];
}

export interface Task {
  id: ID;
  title: string;
  dueDate: string;
  priority: "low" | "medium" | "high";
  status: "todo" | "in_progress" | "blocked" | "done";
  caseId?: ID;
  assigneeId: ID;
  createdAt: string;
  description?: string;
}

export interface TimeEntry {
  id: ID;
  userId: ID;
  caseId: ID;
  date: string;
  minutes: number;
  rate: Paise; // per hour
  description: string;
  billable: boolean;
  invoiced: boolean;
}

export interface Expense {
  id: ID;
  caseId: ID;
  date: string;
  description: string;
  amount: Paise;
  billable: boolean;
  invoiced: boolean;
  category: "filing" | "travel" | "copies" | "expert" | "other";
}

export type InvoiceStatus = "draft" | "sent" | "overdue" | "paid";

export interface InvoiceLine {
  id: ID;
  description: string;
  quantity: number; // hours for time lines, units otherwise
  rate: Paise; // per hour / per unit
  kind: "time" | "expense" | "flat";
}

export interface Invoice {
  id: ID;
  number: string;
  clientId: ID;
  caseId: ID;
  issued: string;
  due: string;
  status: InvoiceStatus;
  lines: InvoiceLine[];
  notes?: string;
}

export interface Payment {
  id: ID;
  invoiceId: ID;
  clientId: ID;
  date: string;
  amount: Paise;
  method: "card" | "echeck" | "wallet";
  status: "pending" | "deposited" | "failed";
  trustAccount: boolean;
}

export interface TrustTransaction {
  id: ID;
  clientId: ID;
  caseId: ID;
  date: string;
  description: string;
  amount: Paise; // + in, - out
  balanceAfter: Paise;
}

export interface DocumentFile {
  id: ID;
  name: string;
  folder: string;
  caseId?: ID;
  sizeKb: number;
  updatedAt: string;
  kind: "doc" | "pdf" | "sheet" | "image" | "template" | "other";
  starred?: boolean;
  templateFields?: string[]; // merge fields for template docs
  /**
   * Ticket 17: real bytes back this row (uploaded through `uploadDocument` —
   * signed-URL flow in http mode, local blob in demo mode). Absent/false for
   * metadata-only documents (seeded rows, bare creates), which have nothing
   * to download.
   */
  hasFile?: boolean;
}

export interface MessageThread {
  id: ID;
  subject: string;
  clientId: ID;
  caseId?: ID;
  channel: "secure" | "email" | "sms";
  unread: boolean;
  messages: {
    id: ID;
    from: "firm" | "client";
    authorName: string;
    body: string;
    at: string;
  }[];
}

export type LeadStage = "new" | "consult scheduled" | "contacted" | "fee agreement" | "converted" | "lost";

export interface Lead {
  id: ID;
  name: string;
  email: string;
  phone: string;
  source: "website" | "referral" | "call" | "ads" | "walk-in";
  stage: LeadStage;
  practiceArea: string;
  value: Paise; // estimated matter value
  createdAt: string;
  notes?: string;
  activity: { at: string; text: string }[];
}

export interface ReportDef {
  id: ID;
  title: string;
  kind: "revenue" | "hours" | "cases-by-stage" | "ar-aging" | "lead-source" | "expenses" | "productivity";
  description: string;
}

export interface Notification {
  id: ID;
  text: string;
  at: string;
  read: boolean;
  kind: "info" | "payment" | "deadline" | "message";
}

export interface Session {
  user: User;
  firm: Firm;
  users: User[];
}
