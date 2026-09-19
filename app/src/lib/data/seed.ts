import type {
  Case, CalendarEvent, Contact, DocumentFile, Expense, Firm, Invoice,
  Lead, MessageThread, Payment, ReportDef, Task, TimeEntry, TrustTransaction, User,
} from "./types";

/** Deterministic ids */
let seq = 100;
export const nid = (p: string) => `${p}_${++seq}`;
const d = (offset: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().slice(0, 10);
};
const dt = (offset: number, time: string) => `${d(offset)}T${time}:00`;

export const seedUsers: User[] = [
  { id: "u1", firmId: "f1", name: "Alex Reed", email: "alex@lawleit.legal", role: "owner", avatarColor: "#4B4ACF", hourlyRate: 300, active: true },
  { id: "u2", firmId: "f1", name: "Maria Ortiz", email: "maria@lawleit.legal", role: "attorney", avatarColor: "#3DBDB4", hourlyRate: 250, active: true },
  { id: "u3", firmId: "f1", name: "Sam Whitfield", email: "sam@lawleit.legal", role: "paralegal", avatarColor: "#E0876A", hourlyRate: 150, active: true },
  { id: "u4", firmId: "f1", name: "Priya Nair", email: "priya@lawleit.legal", role: "staff", avatarColor: "#8B7FD4", hourlyRate: 120, active: true },
];

export const seedFirm: Firm = {
  id: "f1",
  name: "Halloway & Pierce LLP",
  practiceAreas: ["Family Law", "Personal Injury", "Estate Planning", "Business Law"],
  phone: "(312) 555-0142",
  email: "hello@hallowaypierce.example",
  address: "233 S Wacker Dr, Suite 4100, Chicago, IL 60606",
  plan: "pro",
  trialEndsAt: d(10),
};

export const seedContacts: Contact[] = [
  { id: "c1", type: "client", name: "Barbara Jones", email: "barbara.jones@example.com", phone: "(312) 555-0134", address: "1180 N Lake Shore Dr, Chicago, IL", caseIds: ["k1", "k3"], createdAt: d(-320), notes: "Prefers afternoon calls." },
  { id: "c2", type: "client", name: "Bob Bryant", email: "bob.bryant@example.com", phone: "(773) 555-0177", address: "2045 W Belmont Ave, Chicago, IL", caseIds: ["k2"], createdAt: d(-210) },
  { id: "c3", type: "client", name: "Elena Vasquez", email: "elena.v@example.com", phone: "(872) 555-0155", address: "950 W Adams St, Chicago, IL", caseIds: ["k4"], createdAt: d(-95) },
  { id: "c4", type: "company", name: "Lakeshore Logistics Inc.", company: "Lakeshore Logistics", email: "legal@lakeshorelog.example", phone: "(312) 555-0199", address: "410 N Michigan Ave, Chicago, IL", caseIds: ["k5"], createdAt: d(-410) },
  { id: "c5", type: "opposing", name: "Marcus Webb", email: "mwebb@webbdefense.example", phone: "(312) 555-0111", address: "1 N Dearborn St, Chicago, IL", caseIds: ["k1"], createdAt: d(-300) },
  { id: "c6", type: "client", name: "Grace Kim", email: "grace.kim@example.com", phone: "(224) 555-0166", address: "1616 N Wells St, Chicago, IL", caseIds: [], createdAt: d(-12) },
];

export const seedCases: Case[] = [
  { id: "k1", number: "2025-0187", title: "Jones vs. XYZ Logistics", clientId: "c1", practiceArea: "Personal Injury", stage: "discovery", status: "open", openDate: d(-180), courtDate: d(45), leadAttorneyId: "u1", description: "Rear-end collision on I-90; client claims whiplash and lost wages. Discovery ongoing, depositions scheduled.", billableRate: 300, trustBalance: 4200 },
  { id: "k2", number: "2025-0204", title: "Bryant Estate Planning", clientId: "c2", practiceArea: "Estate Planning", stage: "consult", status: "open", openDate: d(-90), leadAttorneyId: "u2", description: "Revocable living trust, pour-over will, healthcare directives. Awaiting signed engagement documents.", billableRate: 250, trustBalance: 1500 },
  { id: "k3", number: "2026-0009", title: "Jones Custody Modification", clientId: "c1", practiceArea: "Family Law", stage: "court date pending", status: "open", openDate: d(-30), courtDate: d(12), leadAttorneyId: "u1", description: "Modification of parenting schedule following relocation of former spouse.", billableRate: 300, trustBalance: 2500 },
  { id: "k4", number: "2026-0021", title: "Vasquez Immigration Petition", clientId: "c3", practiceArea: "Immigration", stage: "intake", status: "pending", openDate: d(-14), leadAttorneyId: "u2", description: "Family-based adjustment of status. RFE response due.", billableRate: 250, trustBalance: 800 },
  { id: "k5", number: "2024-0110", title: "Lakeshore MSA Review", clientId: "c4", practiceArea: "Business Law", stage: "negotiation", status: "open", openDate: d(-260), leadAttorneyId: "u1", description: "Master services agreement renegotiation with indemnity carve-outs.", billableRate: 350, trustBalance: 6100 },
  { id: "k6", number: "2024-0033", title: "Doe Uncontested Divorce", clientId: "c6", practiceArea: "Family Law", stage: "resolved", status: "closed", openDate: d(-380), leadAttorneyId: "u2", description: "Uncontested dissolution; judgment entered.", billableRate: 250, trustBalance: 0 },
];

export const seedEvents: CalendarEvent[] = [
  { id: "e1", title: "Client Meeting", date: d(0), start: "11:00", end: "12:00", location: "Main Conference Room", caseId: "k1", attendeeIds: ["u1", "u3"], type: "meeting", color: "#4B4ACF" },
  { id: "e2", title: "Lunch with Bob Bryant", date: d(0), start: "12:00", end: "13:00", location: "Bob's Diner", caseId: "k2", attendeeIds: ["u2"], type: "personal", color: "#3DBDB4" },
  { id: "e3", title: "New Client Consultation - Family Law", date: d(0), start: "13:00", end: "14:00", location: "Main Conference Room", attendeeIds: ["u1", "u4"], type: "meeting", color: "#E0876A" },
  { id: "e4", title: "Deposition: Marcus Webb", date: d(1), start: "09:30", end: "11:30", location: "Webb Defense Offices", caseId: "k1", attendeeIds: ["u1"], type: "court", color: "#4B4ACF" },
  { id: "e5", title: "RFE Response Deadline", date: d(3), start: "17:00", end: "17:00", caseId: "k4", attendeeIds: ["u2"], type: "deadline", color: "#D64550" },
  { id: "e6", title: "Status Conference", date: d(5), start: "10:00", end: "11:00", location: "Daley Center, Room 2104", caseId: "k3", attendeeIds: ["u1", "u2"], type: "court", color: "#4B4ACF" },
  { id: "e7", title: "Draft MSA redlines", date: d(-1), start: "15:00", end: "16:00", caseId: "k5", attendeeIds: ["u1"], type: "task", color: "#8B7FD4" },
  { id: "e8", title: "Team pipeline review", date: d(2), start: "16:00", end: "16:30", attendeeIds: ["u1", "u2", "u3", "u4"], type: "meeting", color: "#3DBDB4" },
];

export const seedTasks: Task[] = [
  { id: "t1", title: "Serve discovery responses on Webb Defense", dueDate: d(2), priority: "high", status: "in_progress", caseId: "k1", assigneeId: "u3", createdAt: d(-6), description: "Interrogatories set B and RFP 12–19." },
  { id: "t2", title: "Draft revocable trust instrument", dueDate: d(4), priority: "medium", status: "todo", caseId: "k2", assigneeId: "u2", createdAt: d(-4) },
  { id: "t3", title: "File RFE response supporting exhibits", dueDate: d(3), priority: "high", status: "todo", caseId: "k4", assigneeId: "u2", createdAt: d(-2) },
  { id: "t4", title: "Redline MSA indemnity section", dueDate: d(1), priority: "high", status: "in_progress", caseId: "k5", assigneeId: "u1", createdAt: d(-8) },
  { id: "t5", title: "Prepare custody exhibit binder", dueDate: d(8), priority: "medium", status: "blocked", caseId: "k3", assigneeId: "u3", createdAt: d(-3), description: "Waiting on school records request." },
  { id: "t6", title: "Order medical records: St. Joseph ER", dueDate: d(-1), priority: "high", status: "done", caseId: "k1", assigneeId: "u3", createdAt: d(-12) },
  { id: "t7", title: "Schedule year-end CLE for team", dueDate: d(15), priority: "low", status: "todo", assigneeId: "u4", createdAt: d(-1) },
];

export const seedTimeEntries: TimeEntry[] = [
  { id: "te1", userId: "u1", caseId: "k1", date: d(0), minutes: 82, rate: 300, description: "Deposition prep and outline", billable: true, invoiced: false },
  { id: "te2", userId: "u1", caseId: "k5", date: d(0), minutes: 64, rate: 350, description: "MSA redlines", billable: true, invoiced: false },
  { id: "te3", userId: "u2", caseId: "k4", date: d(0), minutes: 95, rate: 250, description: "RFE response drafting", billable: true, invoiced: false },
  { id: "te4", userId: "u3", caseId: "k1", date: d(0), minutes: 120, rate: 150, description: "Records retrieval and organization", billable: false, invoiced: false },
  { id: "te5", userId: "u1", caseId: "k1", date: d(-1), minutes: 110, rate: 300, description: "Client call and strategy", billable: true, invoiced: false },
  { id: "te6", userId: "u2", caseId: "k2", date: d(-1), minutes: 75, rate: 250, description: "Estate questionnaire review", billable: true, invoiced: false },
  { id: "te7", userId: "u1", caseId: "k3", date: d(-2), minutes: 130, rate: 300, description: "Motion drafting", billable: true, invoiced: false },
  { id: "te8", userId: "u3", caseId: "k1", date: d(-2), minutes: 180, rate: 150, description: "Exhibit scanning", billable: false, invoiced: false },
  { id: "te9", userId: "u1", caseId: "k1", date: d(-3), minutes: 95, rate: 300, description: "Meet with client", billable: true, invoiced: false },
  { id: "te10", userId: "u2", caseId: "k4", date: d(-3), minutes: 60, rate: 250, description: "USCIS portal upload", billable: true, invoiced: false },
  // Older invoiced entries for reports
  { id: "te11", userId: "u1", caseId: "k1", date: d(-12), minutes: 240, rate: 300, description: "Discovery round 1", billable: true, invoiced: true },
  { id: "te12", userId: "u2", caseId: "k2", date: d(-14), minutes: 180, rate: 250, description: "Trust drafting", billable: true, invoiced: true },
  { id: "te13", userId: "u1", caseId: "k5", date: d(-16), minutes: 300, rate: 350, description: "MSA negotiation session", billable: true, invoiced: true },
];

export const seedExpenses: Expense[] = [
  { id: "x1", caseId: "k1", date: d(-2), description: "Court filing fee — motion", amount: 212, billable: true, invoiced: false, category: "filing" },
  { id: "x2", caseId: "k4", date: d(-4), description: "USCIS premium processing", amount: 1685, billable: true, invoiced: false, category: "filing" },
  { id: "x3", caseId: "k1", date: d(-9), description: "Courier — deposition exhibits", amount: 48, billable: true, invoiced: false, category: "copies" },
  { id: "x4", caseId: "k5", date: d(-11), description: "Expert consult (2h)", amount: 900, billable: true, invoiced: false, category: "expert" },
  { id: "x5", caseId: "k3", date: d(-15), description: "Mileage — Daley Center", amount: 16, billable: true, invoiced: true, category: "travel" },
];

export const seedInvoices: Invoice[] = [
  {
    id: "iv1", number: "INV-1041", clientId: "c1", caseId: "k1",
    issued: d(-20), due: d(10), status: "sent",
    lines: [
      { id: "l1", description: "Discovery round 1 — attorney time (4.0 hrs)", quantity: 4, rate: 300, kind: "time" },
      { id: "l2", description: "Records retrieval — paralegal (2.5 hrs)", quantity: 2.5, rate: 150, kind: "time" },
      { id: "l3", description: "Court filing fee", quantity: 1, rate: 188, kind: "expense" },
    ],
    notes: "Thank you for your business.",
  },
  {
    id: "iv2", number: "INV-1042", clientId: "c4", caseId: "k5",
    issued: d(-35), due: d(-5), status: "overdue",
    lines: [
      { id: "l4", description: "MSA negotiation session (5.0 hrs)", quantity: 5, rate: 350, kind: "time" },
    ],
  },
  {
    id: "iv3", number: "INV-1043", clientId: "c2", caseId: "k2",
    issued: d(-40), due: d(-10), status: "paid",
    lines: [
      { id: "l5", description: "Trust drafting (3.0 hrs)", quantity: 3, rate: 250, kind: "time" },
    ],
  },
  {
    id: "iv4", number: "INV-1044", clientId: "c3", caseId: "k4",
    issued: d(-2), due: d(28), status: "draft",
    lines: [
      { id: "l6", description: "RFE response drafting (1.6 hrs)", quantity: 1.6, rate: 250, kind: "time" },
    ],
  },
];

export const seedPayments: Payment[] = [
  { id: "p1", invoiceId: "iv3", clientId: "c2", date: d(-12), amount: 750, method: "card", status: "deposited", trustAccount: false },
  { id: "p2", invoiceId: "iv1", clientId: "c1", date: d(-3), amount: 500, method: "echeck", status: "pending", trustAccount: true },
  { id: "p3", invoiceId: "iv2", clientId: "c4", date: d(-30), amount: 700, method: "card", status: "deposited", trustAccount: false },
];

export const seedTrust: TrustTransaction[] = [
  { id: "tt1", clientId: "c1", caseId: "k1", date: d(-170), description: "Retainer deposit", amount: 5000, balanceAfter: 5000 },
  { id: "tt2", clientId: "c1", caseId: "k1", date: d(-20), description: "Fees transferred — INV-1040", amount: -800, balanceAfter: 4200 },
  { id: "tt3", clientId: "c2", caseId: "k2", date: d(-60), description: "Retainer deposit", amount: 1500, balanceAfter: 1500 },
  { id: "tt4", clientId: "c3", caseId: "k4", date: d(-14), description: "Filing costs deposit", amount: 800, balanceAfter: 800 },
  { id: "tt5", clientId: "c4", caseId: "k5", date: d(-230), description: "Retainer deposit", amount: 7500, balanceAfter: 7500 },
  { id: "tt6", clientId: "c4", caseId: "k5", date: d(-25), description: "Fees transferred — INV-1039", amount: -1400, balanceAfter: 6100 },
];

export const seedDocuments: DocumentFile[] = [
  { id: "f1", name: "Retainer Agreement — Jones.docx", folder: "Engagement", caseId: "k1", sizeKb: 84, updatedAt: d(-170), kind: "doc", starred: true, templateFields: ["client.name", "case.number", "firm.name", "rate"] },
  { id: "f2", name: "Complaint — Jones v XYZ.pdf", folder: "Pleadings", caseId: "k1", sizeKb: 1240, updatedAt: d(-160), kind: "pdf" },
  { id: "f3", name: "Discovery Responses Set B.docx", folder: "Discovery", caseId: "k1", sizeKb: 310, updatedAt: d(-2), kind: "doc" },
  { id: "f4", name: "Trust Instrument Draft.docx", folder: "Drafts", caseId: "k2", sizeKb: 96, updatedAt: d(-4), kind: "doc", templateFields: ["client.name", "date.today"] },
  { id: "f5", name: "RFE Response Exhibits.pdf", folder: "USCIS", caseId: "k4", sizeKb: 5210, updatedAt: d(-1), kind: "pdf" },
  { id: "f6", name: "MSA — Lakeshore v3.docx", folder: "Contracts", caseId: "k5", sizeKb: 205, updatedAt: d(0), kind: "doc", starred: true },
  { id: "f7", name: "Invoice INV-1041.pdf", folder: "Invoices", caseId: "k1", sizeKb: 58, updatedAt: d(-20), kind: "pdf" },
  { id: "f8", name: "Custody Exhibit Binder.pdf", folder: "Evidence", caseId: "k3", sizeKb: 8810, updatedAt: d(-3), kind: "pdf" },
  { id: "f9", name: "Firm Letterhead.template.docx", folder: "Templates", sizeKb: 44, updatedAt: d(-90), kind: "template", templateFields: ["firm.name", "firm.address", "date.today"] },
  { id: "f10", name: "Engagement Letter.template.docx", folder: "Templates", sizeKb: 51, updatedAt: d(-90), kind: "template", templateFields: ["client.name", "case.number", "rate", "firm.name"] },
];

export const seedThreads: MessageThread[] = [
  {
    id: "th1", subject: "Deposition schedule", clientId: "c1", caseId: "k1", channel: "secure", unread: true,
    messages: [
      { id: "m1", from: "client", authorName: "Barbara Jones", body: "Good morning — any update on the deposition date?", at: dt(-1, "09:12") },
      { id: "m2", from: "firm", authorName: "Alex Reed", body: "We've proposed the 14th and are waiting on defense counsel to confirm. I'll keep you posted.", at: dt(-1, "10:02") },
      { id: "m3", from: "client", authorName: "Barbara Jones", body: "Thank you! The 14th works for me.", at: dt(0, "08:40") },
    ],
  },
  {
    id: "th2", subject: "Trust questionnaire received", clientId: "c2", caseId: "k2", channel: "email", unread: false,
    messages: [
      { id: "m4", from: "firm", authorName: "Maria Ortiz", body: "Hi Bob, attaching the questionnaire we discussed.", at: dt(-3, "14:20") },
      { id: "m5", from: "client", authorName: "Bob Bryant", body: "Completed and signed — let me know next steps.", at: dt(-2, "11:05") },
    ],
  },
  {
    id: "th3", subject: "Text: appointment reminder", clientId: "c3", caseId: "k4", channel: "sms", unread: true,
    messages: [
      { id: "m6", from: "firm", authorName: "Lawleit Reminder", body: "Reminder: RFE response is due Friday. Reply HELP for help.", at: dt(0, "09:00") },
      { id: "m7", from: "client", authorName: "Elena Vasquez", body: "Thank you — I sent the last document yesterday.", at: dt(0, "09:31") },
    ],
  },
];

export const seedLeads: Lead[] = [
  { id: "ld1", name: "Grace Kim", email: "grace.kim@example.com", phone: "(224) 555-0166", source: "website", stage: "converted", practiceArea: "Family Law", value: 4500, createdAt: d(-12), activity: [{ at: dt(-12, "10:00"), text: "Intake form submitted via website" }, { at: dt(-10, "09:30"), text: "Consult held — fee agreement signed" }] },
  { id: "ld2", name: "Tomás Rivera", email: "t.rivera@example.com", phone: "(312) 555-0187", source: "referral", stage: "consult scheduled", practiceArea: "Personal Injury", value: 12000, createdAt: d(-5), notes: "Referred by Barbara Jones.", activity: [{ at: dt(-5, "13:15"), text: "Called back, consult booked" }] },
  { id: "ld3", name: "Ashley Monroe", email: "a.monroe@example.com", phone: "(847) 555-0122", source: "ads", stage: "new", practiceArea: "Estate Planning", value: 2000, createdAt: d(-2), activity: [{ at: dt(-2, "16:45"), text: "Landing page form filled" }] },
  { id: "ld4", name: "Derek Coleman", email: "d.coleman@example.com", phone: "(630) 555-0143", source: "call", stage: "contacted", practiceArea: "Business Law", value: 8000, createdAt: d(-7), activity: [{ at: dt(-7, "11:20"), text: "Inbound call — MSA question" }, { at: dt(-6, "09:00"), text: "Emailed intake packet" }] },
  { id: "ld5", name: "Nina Petrov", email: "n.petrov@example.com", phone: "(773) 555-0198", source: "website", stage: "fee agreement", practiceArea: "Immigration", value: 3500, createdAt: d(-9), activity: [{ at: dt(-9, "15:00"), text: "Intake form submitted" }, { at: dt(-8, "10:30"), text: "Fee agreement sent for e-signature" }] },
  { id: "ld6", name: "Owen Gallagher", email: "o.gallagher@example.com", phone: "(312) 555-0110", source: "walk-in", stage: "lost", practiceArea: "Personal Injury", value: 5000, createdAt: d(-20), notes: "Out of state — referred elsewhere.", activity: [{ at: dt(-20, "12:00"), text: "Walk-in consult" }, { at: dt(-19, "09:15"), text: "Referred to Ohio counsel" }] },
];

export const seedReports: ReportDef[] = [
  { id: "r1", title: "Revenue by month", kind: "revenue", description: "Collected and planned revenue across the firm" },
  { id: "r2", title: "Hours by timekeeper", kind: "hours", description: "Billable vs non-billable hours per user" },
  { id: "r3", title: "Cases by stage", kind: "cases-by-stage", description: "Open matters across pipeline stages" },
  { id: "r4", title: "AR aging", kind: "ar-aging", description: "Outstanding client balances by age" },
  { id: "r5", title: "Leads by source", kind: "lead-source", description: "Where new business comes from" },
  { id: "r6", title: "Expenses by case", kind: "expenses", description: "Advanced costs per matter" },
];
