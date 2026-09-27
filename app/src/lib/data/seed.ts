import type {
  Case, CalendarEvent, Contact, DocumentFile, Expense, Firm, Invoice,
  Lead, MessageThread, Payment, ReportDef, Task, TimeEntry, TrustTransaction, User,
} from "./types";

/**
 * Demo Firm seed — Kaul & Bhatnagar Associates, a fictional five-lawyer firm
 * (plus paralegal and office manager) in New Delhi. Every name, company and
 * court matter is invented; all money is integer paise and the ledger must
 * reconcile (see tests/seedConsistency.test.ts).
 */

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
  { id: "u1", firmId: "f1", name: "Arjun Kaul", email: "arjun@kaulbhatnagar.example", role: "owner", avatarColor: "#4B4ACF", hourlyRate: 500000, active: true },
  { id: "u2", firmId: "f1", name: "Meera Bhatnagar", email: "meera@kaulbhatnagar.example", role: "attorney", avatarColor: "#3DBDB4", hourlyRate: 450000, active: true },
  { id: "u3", firmId: "f1", name: "Vikram Sethi", email: "vikram@kaulbhatnagar.example", role: "attorney", avatarColor: "#E0876A", hourlyRate: 300000, active: true },
  { id: "u4", firmId: "f1", name: "Anjali Deshpande", email: "anjali@kaulbhatnagar.example", role: "attorney", avatarColor: "#8B7FD4", hourlyRate: 300000, active: true },
  { id: "u5", firmId: "f1", name: "Rohan Malhotra", email: "rohan@kaulbhatnagar.example", role: "attorney", avatarColor: "#2E9E6B", hourlyRate: 200000, active: true },
  { id: "u6", firmId: "f1", name: "Sana Qureshi", email: "sana@kaulbhatnagar.example", role: "attorney", avatarColor: "#B85C38", hourlyRate: 200000, active: true },
  { id: "u7", firmId: "f1", name: "Fatima Sheikh", email: "fatima@kaulbhatnagar.example", role: "paralegal", avatarColor: "#0E7490", hourlyRate: 100000, active: true },
  { id: "u8", firmId: "f1", name: "Deepak Rana", email: "deepak@kaulbhatnagar.example", role: "staff", avatarColor: "#64748B", hourlyRate: 80000, active: true },
];

export const seedFirm: Firm = {
  id: "f1",
  name: "Kaul & Bhatnagar Associates",
  practiceAreas: ["Civil & Commercial Litigation", "Writs & Appeals", "Insolvency & Corporate Disputes", "Corporate Advisory"],
  phone: "+91 11 4355 6210",
  email: "chambers@kaulbhatnagar.example",
  address: "3rd Floor, Ashoka Chambers, 23 Barakhamba Road, Connaught Place, New Delhi 110001",
  plan: "pro",
  trialEndsAt: d(10),
};

export const seedContacts: Contact[] = [
  { id: "c1", type: "client", name: "Harish Chadha", email: "harish.chadha@example.com", phone: "+91 98110 23456", address: "C-6/12, Safdarjung Development Area, New Delhi 110016", caseIds: ["k1"], createdAt: d(-430), notes: "Retired railway officer; prefers morning calls." },
  { id: "c2", type: "client", name: "Nikhil Sabharwal", company: "Sabharwal Traders", email: "nikhil@sabharwaltraders.example", phone: "+91 98713 41028", address: "3864, Dariba Kalan, Chandni Chowk, Delhi 110006", caseIds: ["k2"], createdAt: d(-120), notes: "Proprietor, Sabharwal Traders." },
  { id: "c3", type: "client", name: "Kavita Menon", email: "kavita.menon@example.com", phone: "+91 99537 78291", address: "B-402, Palm Gardens, Sector 52, Gurugram 122003", caseIds: ["k3"], createdAt: d(-100) },
  { id: "c4", type: "client", name: "Sunita Rawat", email: "sunita.rawat@example.com", phone: "+91 98182 06735", address: "A-9/4, Paschim Vihar, New Delhi 110063", caseIds: ["k4"], createdAt: d(-160), notes: "Former branch manager, Northern Mercantile Bank." },
  { id: "c5", type: "company", name: "Meridian Logistics Pvt Ltd", company: "Meridian Logistics", email: "legal@meridianlogistics.example", phone: "+91 124 468 9100", address: "8th Floor, Vantage Tower, Udyog Vihar Phase IV, Gurugram 122015", caseIds: ["k6"], createdAt: d(-520), notes: "Legal head: Devansh Rao." },
  { id: "c6", type: "client", name: "Ishaan Roy", email: "ishaan.roy@example.com", phone: "+91 98990 33147", address: "24, Golf Links, New Delhi 110003", caseIds: ["k7"], createdAt: d(-75), notes: "Minority shareholder (11%) in Nalanda Meditech." },
  { id: "c7", type: "company", name: "Aarna Fabtech Pvt Ltd", company: "Aarna Fabtech", email: "companysecretary@aarnafabtech.example", phone: "+91 124 402 7788", address: "Plot 17, Sector 8, IMT Manesar, Gurugram 122050", caseIds: ["k5"], createdAt: d(-270) },
  { id: "c8", type: "company", name: "Bluefern Hospitality Pvt Ltd", company: "Bluefern Hospitality", email: "ananya.kapoor@bluefernhospitality.example", phone: "+91 11 2692 4451", address: "5, Community Centre, Saket, New Delhi 110017", caseIds: ["k8"], createdAt: d(-430), notes: "Legal head: Ananya Kapoor." },
  { id: "c9", type: "client", name: "Priyanka Kothari", email: "priyanka.kothari@example.com", phone: "+91 99100 55283", address: "7, Hauz Khas Village, New Delhi 110016", caseIds: ["k9"], createdAt: d(-25) },
  { id: "c10", type: "company", name: "Eastbridge Exports Pvt Ltd", company: "Eastbridge Exports", email: "hr@eastbridgeexports.example", phone: "+91 11 4055 8812", address: "Plot 44, Okhla Industrial Area Phase II, New Delhi 110020", caseIds: ["k10"], createdAt: d(-190) },
  { id: "c11", type: "client", name: "Naresh Gulati", email: "naresh.gulati@example.com", phone: "+91 98104 91260", address: "WZ-109, Janakpuri, New Delhi 110058", caseIds: ["k11"], createdAt: d(-570), notes: "Matter settled; file retained for execution queries." },
  { id: "c12", type: "opposing", name: "Dinesh Grover", company: "Grover Law Chambers", email: "dinesh@groverlawchambers.example", phone: "+91 98110 70042", address: "3, Bhagwan Das Road, New Delhi 110001", caseIds: ["k1"], createdAt: d(-420), notes: "Counsel for the Khanna defendants." },
  { id: "c13", type: "opposing", name: "Transcare Freight Solutions Pvt Ltd", company: "Transcare Freight", email: "cs@transcarefreight.example", phone: "+91 120 451 2290", address: "Sector 63, Noida 201301", caseIds: ["k6"], createdAt: d(-58), notes: "Corporate debtor in the s.9 IBC petition." },
  { id: "c14", type: "opposing", name: "Aurum Heights Developers Pvt Ltd", company: "Aurum Heights", email: "disputes@aurumheights.example", phone: "+91 124 499 3105", address: "Aurum House, Sector 44, Gurugram 122003", caseIds: ["k3"], createdAt: d(-98), notes: "Builder; delayed possession of Tower C." },
  { id: "c15", type: "opposing", name: "Sanvar Textiles Pvt Ltd", company: "Sanvar Textiles", email: "accounts@sanvartextiles.example", phone: "+91 92552 60113", address: "Bhiwani Textile Market, Bhiwani 127021", caseIds: ["k2"], createdAt: d(-115), notes: "Drawer of the dishonoured cheque." },
  { id: "c16", type: "witness", name: "Prem Lal", email: "premlal@example.com", phone: "+91 98681 44205", address: "RZ-18, Saket, New Delhi 110017", caseIds: ["k1"], createdAt: d(-380), notes: "Retired sub-registrar; attesting witness to the 2009 family settlement." },
  { id: "c17", type: "referral", name: "Rohit Bansal", company: "Bansal & Associates, Chartered Accountants", email: "rohit@bansalca.example", phone: "+91 98732 11506", address: "401, Vikas Surya Tower, Rohini, New Delhi 110085", caseIds: [], createdAt: d(-350), notes: "Chartered accountant; regular referral source." },
  { id: "c18", type: "opposing", name: "Northern Mercantile Bank", company: "Northern Mercantile Bank", email: "legal@northernmercantile.example", phone: "+91 11 2574 8800", address: "Zonal Office, Rajendra Place, New Delhi 110008", caseIds: ["k4"], createdAt: d(-155), notes: "Respondent in the service-matter writ." },
  { id: "c19", type: "opposing", name: "Nalanda Meditech Pvt Ltd", company: "Nalanda Meditech", email: "board@nalandameditech.example", phone: "+91 522 403 9911", address: "Biotech Park, Lucknow 226002", caseIds: ["k7"], createdAt: d(-72), notes: "Respondent company in the ss. 241–242 petition." },
  { id: "c20", type: "opposing", name: "Veltura Industrial Systems Pvt Ltd", company: "Veltura Industrial Systems", email: "generalcounsel@veltura.example", phone: "+91 124 479 6602", address: "Sector 3, IMT Manesar, Gurugram 122051", caseIds: ["k5"], createdAt: d(-30), notes: "Obtained the interim injunction appealed against." },
];

export const seedCases: Case[] = [
  { id: "k1", number: "2024-0110", title: "Chadha v. Khanna — Property Partition Suit", clientId: "c1", practiceArea: "Civil Litigation", stage: "trial", status: "open", openDate: d(-420), courtDate: d(9), leadAttorneyId: "u1", description: "Partition of ancestral property at Green Park; plaintiff's evidence is closed, defence evidence under way, final arguments listed.", billableRate: 500000, trustBalance: 16980000 },
  { id: "k2", number: "2025-0211", title: "Sabharwal Traders v. Sanvar Textiles — Cheque Bounce (s.138 NI Act)", clientId: "c2", practiceArea: "Cheque Bounce (s.138)", stage: "court date pending", status: "open", openDate: d(-120), courtDate: d(4), leadAttorneyId: "u3", description: "Complaint under s.138 NI Act for a dishonoured cheque of ₹4,20,000; pre-summoning evidence listed at Patiala House.", billableRate: 300000, trustBalance: 10000000 },
  { id: "k3", number: "2025-0258", title: "Menon v. Aurum Heights Developers — Consumer Complaint", clientId: "c3", practiceArea: "Consumer Law", stage: "discovery", status: "open", openDate: d(-95), courtDate: d(12), leadAttorneyId: "u3", description: "Delayed possession of Flat 1102, Tower C; complaint before the District Consumer Commission-III (South Delhi), evidence stage.", billableRate: 300000, trustBalance: 9500000 },
  { id: "k4", number: "2025-0194", title: "Rawat v. Northern Mercantile Bank — Service Law Writ", clientId: "c4", practiceArea: "Writs & Service Matters", stage: "court date pending", status: "open", openDate: d(-150), courtDate: d(2), leadAttorneyId: "u4", description: "Writ under Article 226 challenging the bank's termination order; heard in part, written submissions due.", billableRate: 300000, trustBalance: 12550000 },
  { id: "k5", number: "2025-0232", title: "Aarna Fabtech v. Veltura Industrial Systems — Commercial Appeal", clientId: "c7", practiceArea: "Commercial Appeal", stage: "court date pending", status: "open", openDate: d(-28), courtDate: d(6), leadAttorneyId: "u1", description: "Appeal against the ad-interim injunction restraining supplies under the framework agreement; listed before the Commercial Appellate Division.", billableRate: 500000, trustBalance: 30000000 },
  { id: "k6", number: "2026-0007", title: "Meridian Logistics v. Transcare Freight — CIRP (s.9 IBC)", clientId: "c5", practiceArea: "Insolvency (CIRP)", stage: "court date pending", status: "open", openDate: d(-60), courtDate: d(7), leadAttorneyId: "u2", description: "Petition under s.9 IBC for an unpaid operational debt of ₹41 lakh; objections of the corporate debtor pending at admission.", billableRate: 450000, trustBalance: 50000000 },
  { id: "k7", number: "2026-0018", title: "Roy v. Nalanda Meditech — Oppression & Mismanagement (ss. 241–242)", clientId: "c6", practiceArea: "Oppression & Mismanagement", stage: "discovery", status: "open", openDate: d(-70), courtDate: d(26), leadAttorneyId: "u2", description: "Minority-shareholder petition before NCLT Delhi; interrogatories to the board and RoC records pending.", billableRate: 450000, trustBalance: 25000000 },
  { id: "k8", number: "2023-0086", title: "Bluefern Hospitality — Corporate Advisory Retainer", clientId: "c8", practiceArea: "Corporate Advisory", stage: "negotiation", status: "open", openDate: d(-420), leadAttorneyId: "u2", description: "Ongoing retainer: vendor contract vetting, PoSH and employment advisory, and the compliance calendar for the hotel group.", billableRate: 450000, trustBalance: 8250000 },
  { id: "k9", number: "2026-0044", title: "Kothari Design Studio — LLP Incorporation", clientId: "c9", practiceArea: "LLP Incorporation", stage: "intake", status: "open", openDate: d(-20), leadAttorneyId: "u5", description: "Incorporation of a design consultancy LLP; FiLLiP and LLP agreement in draft, digital signatures awaited.", billableRate: 300000, trustBalance: 5000000 },
  { id: "k10", number: "2025-0187", title: "Eastbridge Exports — Employment Advisory", clientId: "c10", practiceArea: "Employment Advisory", stage: "consult", status: "open", openDate: d(-180), leadAttorneyId: "u4", description: "Refresh of employment contracts, handbook and PoSH documentation for the export house.", billableRate: 300000, trustBalance: 0 },
  { id: "k11", number: "2024-0033", title: "Gulati v. Nakshatra Buildcon — Recovery Suit", clientId: "c11", practiceArea: "Civil Litigation", stage: "resolved", status: "closed", openDate: d(-560), leadAttorneyId: "u1", description: "Recovery suit for ₹18,50,000; settled in court-supervised mediation and decree drawn in consent terms.", billableRate: 500000, trustBalance: 0 },
];

export const seedEvents: CalendarEvent[] = [
  { id: "e1", title: "Client conference — partition suit", date: d(0), start: "11:00", end: "12:00", location: "Chambers, Barakhamba Road", caseId: "k1", attendeeIds: ["u1", "u3"], type: "meeting", color: "#4B4ACF" },
  { id: "e2", title: "Bluefern retainer review call", date: d(0), start: "16:00", end: "17:00", caseId: "k8", attendeeIds: ["u2", "u5"], type: "meeting", color: "#3DBDB4" },
  { id: "e3", title: "Deposition of Prem Lal — partition suit", date: d(1), start: "10:30", end: "13:00", location: "Saket District Court", caseId: "k1", attendeeIds: ["u1", "u3"], type: "court", color: "#4B4ACF" },
  { id: "e4", title: "Hearing — Rawat writ, Court 5", date: d(2), start: "10:30", end: "11:30", location: "Delhi High Court", caseId: "k4", attendeeIds: ["u1", "u4"], type: "court", color: "#4B4ACF" },
  { id: "e5", title: "s.138 complaint — pre-summoning evidence", date: d(4), start: "10:00", end: "11:00", location: "Patiala House District Court", caseId: "k2", attendeeIds: ["u3"], type: "court", color: "#4B4ACF" },
  { id: "e6", title: "CAD hearing — Aarna Fabtech appeal", date: d(6), start: "14:00", end: "15:30", location: "Delhi High Court", caseId: "k5", attendeeIds: ["u1", "u4"], type: "court", color: "#4B4ACF" },
  { id: "e7", title: "NCLT listing — Meridian s.9 admission", date: d(7), start: "11:00", end: "12:00", location: "NCLT Delhi, Bench II", caseId: "k6", attendeeIds: ["u2", "u5"], type: "court", color: "#4B4ACF" },
  { id: "e8", title: "Final arguments — partition suit", date: d(9), start: "10:00", end: "13:00", location: "Saket District Court", caseId: "k1", attendeeIds: ["u1", "u3"], type: "court", color: "#4B4ACF" },
  { id: "e9", title: "Deadline: reply to Transcare objections", date: d(3), start: "17:00", end: "17:00", caseId: "k6", attendeeIds: ["u2"], type: "deadline", color: "#D64550" },
  { id: "e10", title: "Commission hearing — Menon consumer complaint", date: d(12), start: "15:00", end: "16:00", location: "District Consumer Commission-III, South Delhi", caseId: "k3", attendeeIds: ["u3"], type: "court", color: "#4B4ACF" },
  { id: "e11", title: "Team pipeline review", date: d(5), start: "16:00", end: "16:30", attendeeIds: ["u1", "u2", "u3", "u4", "u5"], type: "meeting", color: "#3DBDB4" },
  { id: "e12", title: "Draft LLP agreement — Kothari", date: d(-1), start: "15:00", end: "16:00", caseId: "k9", attendeeIds: ["u5"], type: "task", color: "#8B7FD4" },
  { id: "e13", title: "New enquiry call — cheque bounce", date: d(0), start: "09:00", end: "09:30", attendeeIds: ["u3"], type: "meeting", color: "#E0876A" },
  { id: "e14", title: "NCLT — Roy v. Nalanda Meditech, s.242 directions", date: d(26), start: "11:00", end: "12:00", location: "NCLT Delhi, Bench I", caseId: "k7", attendeeIds: ["u2", "u7"], type: "court", color: "#4B4ACF" },
  { id: "e15", title: "Lunch — CA Rohit Bansal", date: d(1), start: "13:00", end: "14:00", location: "Orient Club, Connaught Place", attendeeIds: ["u1"], type: "personal", color: "#3DBDB4" },
];

export const seedTasks: Task[] = [
  { id: "t1", title: "Serve defence witness summons — partition suit", dueDate: d(2), priority: "high", status: "in_progress", caseId: "k1", assigneeId: "u3", createdAt: d(-6), description: "Prem Lal and the 2009 settlement record." },
  { id: "t2", title: "File written submissions — Rawat writ", dueDate: d(1), priority: "high", status: "in_progress", caseId: "k4", assigneeId: "u4", createdAt: d(-4) },
  { id: "t3", title: "Finalize reply to Transcare objections", dueDate: d(3), priority: "high", status: "todo", caseId: "k6", assigneeId: "u2", createdAt: d(-2) },
  { id: "t4", title: "Prepare CAD paperbook index — Aarna appeal", dueDate: d(5), priority: "high", status: "in_progress", caseId: "k5", assigneeId: "u1", createdAt: d(-7) },
  { id: "t5", title: "File FiLLiP and incorporator affidavits", dueDate: d(1), priority: "medium", status: "in_progress", caseId: "k9", assigneeId: "u5", createdAt: d(-3), description: "Waiting on the digital signature certificate for the second designated partner." },
  { id: "t6", title: "Compile commission paperbook with exhibits", dueDate: d(10), priority: "medium", status: "todo", caseId: "k3", assigneeId: "u3", createdAt: d(-5) },
  { id: "t7", title: "Vet remaining Bluefern vendor agreements (2 of 5)", dueDate: d(4), priority: "medium", status: "todo", caseId: "k8", assigneeId: "u5", createdAt: d(-2) },
  { id: "t8", title: "Collect bank memos returning the dishonoured cheque", dueDate: d(0), priority: "high", status: "done", caseId: "k2", assigneeId: "u3", createdAt: d(-9) },
  { id: "t9", title: "Obtain certified board minutes from RoC", dueDate: d(8), priority: "low", status: "blocked", caseId: "k7", assigneeId: "u7", createdAt: d(-4), description: "RoC portal outage; SRN refiled." },
  { id: "t10", title: "Draft updated employment contracts — Eastbridge", dueDate: d(6), priority: "medium", status: "todo", caseId: "k10", assigneeId: "u4", createdAt: d(-3) },
  { id: "t11", title: "Renew firm's professional indemnity policy", dueDate: d(7), priority: "low", status: "todo", assigneeId: "u8", createdAt: d(-1) },
  { id: "t12", title: "Bundle evidence for final arguments", dueDate: d(-1), priority: "high", status: "done", caseId: "k1", assigneeId: "u7", createdAt: d(-12) },
];

export const seedTimeEntries: TimeEntry[] = [
  { id: "te1", userId: "u1", caseId: "k1", date: d(0), minutes: 90, rate: 500000, description: "Final arguments outline — partition suit", billable: true, invoiced: false },
  { id: "te2", userId: "u3", caseId: "k2", date: d(0), minutes: 75, rate: 300000, description: "Draft rejoinder — s.138 complaint", billable: true, invoiced: false },
  { id: "te3", userId: "u4", caseId: "k4", date: d(0), minutes: 120, rate: 300000, description: "Writ hearing prep — precedent compilation", billable: true, invoiced: false },
  { id: "te4", userId: "u7", caseId: "k6", date: d(0), minutes: 180, rate: 100000, description: "Compile financial annexures for CIRP petition", billable: false, invoiced: false },
  { id: "te5", userId: "u1", caseId: "k5", date: d(-1), minutes: 60, rate: 500000, description: "Teleconference with Aarna company secretary", billable: true, invoiced: false },
  { id: "te6", userId: "u5", caseId: "k8", date: d(-1), minutes: 150, rate: 200000, description: "Vet Bluefern vendor agreements (3 of 5)", billable: true, invoiced: false },
  { id: "te7", userId: "u2", caseId: "k6", date: d(-1), minutes: 105, rate: 450000, description: "Draft reply to Transcare objections", billable: true, invoiced: false },
  { id: "te8", userId: "u4", caseId: "k10", date: d(-2), minutes: 90, rate: 300000, description: "Employment handbook review — PoSH chapter", billable: true, invoiced: false },
  { id: "te9", userId: "u3", caseId: "k1", date: d(-2), minutes: 60, rate: 300000, description: "Client call — evidence strategy", billable: true, invoiced: false },
  { id: "te10", userId: "u5", caseId: "k9", date: d(-2), minutes: 120, rate: 200000, description: "Draft LLP agreement and FiLLiP annexures", billable: true, invoiced: false },
  { id: "te11", userId: "u7", caseId: "k3", date: d(-3), minutes: 100, rate: 100000, description: "Scan and index commission paperbook", billable: false, invoiced: false },
  { id: "te12", userId: "u2", caseId: "k7", date: d(-3), minutes: 135, rate: 450000, description: "Draft interrogatories to Nalanda board", billable: true, invoiced: false },
  { id: "te13", userId: "u1", caseId: "k1", date: d(-4), minutes: 75, rate: 500000, description: "Conference with witness Prem Lal", billable: true, invoiced: false },
  { id: "te14", userId: "u3", caseId: "k2", date: d(-5), minutes: 45, rate: 300000, description: "Summons follow-up with court registry", billable: true, invoiced: false },
  { id: "te15", userId: "u6", caseId: "k5", date: d(-2), minutes: 120, rate: 200000, description: "Compile commercial appeal paperbook", billable: true, invoiced: false },
  { id: "te16", userId: "u6", caseId: "k3", date: d(-4), minutes: 90, rate: 200000, description: "Draft evidence affidavit paras — consumer complaint", billable: true, invoiced: false },
  { id: "te17", userId: "u1", caseId: "k1", date: d(-16), minutes: 360, rate: 500000, description: "Trial groundwork — partition suit", billable: true, invoiced: true },
  { id: "te18", userId: "u4", caseId: "k4", date: d(-20), minutes: 480, rate: 300000, description: "Writ petition drafting and filing", billable: true, invoiced: true },
  { id: "te19", userId: "u2", caseId: "k6", date: d(-22), minutes: 420, rate: 450000, description: "s.9 IBC petition — drafting and filings", billable: true, invoiced: true },
  { id: "te20", userId: "u5", caseId: "k8", date: d(-25), minutes: 180, rate: 200000, description: "Contract vetting — hotel management agreement", billable: true, invoiced: true },
  { id: "te21", userId: "u4", caseId: "k8", date: d(-23), minutes: 120, rate: 300000, description: "PoSH policy update", billable: true, invoiced: true },
  { id: "te22", userId: "u5", caseId: "k8", date: d(-22), minutes: 90, rate: 200000, description: "Vendor staff onboarding advisory", billable: true, invoiced: true },
  { id: "te23", userId: "u2", caseId: "k7", date: d(-30), minutes: 240, rate: 450000, description: "s.241–242 petition drafting", billable: true, invoiced: true },
  { id: "te24", userId: "u1", caseId: "k5", date: d(-26), minutes: 300, rate: 500000, description: "Appeal memorandum and synopsis", billable: true, invoiced: true },
  { id: "te25", userId: "u3", caseId: "k3", date: d(-35), minutes: 300, rate: 300000, description: "Evidence affidavit — consumer complaint", billable: true, invoiced: true },
  { id: "te26", userId: "u5", caseId: "k10", date: d(-40), minutes: 180, rate: 200000, description: "Advisory note — contractor gratuity clauses", billable: true, invoiced: true },
  { id: "te27", userId: "u4", caseId: "k10", date: d(-45), minutes: 240, rate: 300000, description: "Employment contracts review", billable: true, invoiced: true },
  { id: "te28", userId: "u3", caseId: "k2", date: d(-8), minutes: 300, rate: 300000, description: "Complaint evidence compilation", billable: true, invoiced: true },
  { id: "te29", userId: "u2", caseId: "k8", date: d(-55), minutes: 600, rate: 450000, description: "Retainer — contract vetting batch", billable: true, invoiced: true },
  { id: "te30", userId: "u2", caseId: "k8", date: d(-52), minutes: 420, rate: 450000, description: "Retainer — vendor diligence", billable: true, invoiced: true },
  { id: "te31", userId: "u2", caseId: "k8", date: d(-50), minutes: 420, rate: 450000, description: "Retainer — advisory calls", billable: true, invoiced: true },
  { id: "te32", userId: "u3", caseId: "k11", date: d(-95), minutes: 300, rate: 300000, description: "Recovery suit — trial evidence", billable: true, invoiced: true },
  { id: "te33", userId: "u1", caseId: "k11", date: d(-90), minutes: 240, rate: 500000, description: "Settlement negotiation and consent terms", billable: true, invoiced: true },
  { id: "te34", userId: "u7", caseId: "k1", date: d(-16), minutes: 120, rate: 100000, description: "Evidence bundling for trial record", billable: false, invoiced: false },
];

export const seedExpenses: Expense[] = [
  { id: "x1", caseId: "k1", date: d(-16), description: "Court filing fee — interrogatories", amount: 20000, billable: true, invoiced: true, category: "filing" },
  { id: "x2", caseId: "k4", date: d(-19), description: "Filing fee — Delhi High Court", amount: 50000, billable: true, invoiced: true, category: "filing" },
  { id: "x3", caseId: "k3", date: d(-31), description: "Consumer commission filing fee", amount: 50000, billable: true, invoiced: true, category: "filing" },
  { id: "x4", caseId: "k10", date: d(-40), description: "Courier and notary charges", amount: 35000, billable: true, invoiced: true, category: "other" },
  { id: "x5", caseId: "k11", date: d(-90), description: "Court fees — recovery suit", amount: 75000, billable: true, invoiced: true, category: "filing" },
  { id: "x6", caseId: "k2", date: d(-8), description: "Court fee — complaint filing", amount: 20000, billable: true, invoiced: true, category: "filing" },
  { id: "x7", caseId: "k5", date: d(-11), description: "Court fees and printing — appeal", amount: 150000, billable: true, invoiced: true, category: "filing" },
  { id: "x8", caseId: "k6", date: d(-23), description: "NCLT e-filing charges", amount: 60000, billable: true, invoiced: false, category: "filing" },
  { id: "x9", caseId: "k8", date: d(-52), description: "Stamp duty — agreement registration", amount: 600000, billable: true, invoiced: true, category: "other" },
  { id: "x10", caseId: "k7", date: d(-32), description: "NCLT filing fee — s.241 petition", amount: 250000, billable: true, invoiced: false, category: "filing" },
  { id: "x11", caseId: "k3", date: d(-2), description: "Certified copies — commission record", amount: 15000, billable: false, invoiced: false, category: "copies" },
  { id: "x12", caseId: "k1", date: d(-6), description: "Process server charges", amount: 9000, billable: true, invoiced: false, category: "other" },
];

export const seedInvoices: Invoice[] = [
  {
    id: "iv1", number: "INV-1047", clientId: "c1", caseId: "k1",
    issued: d(-15), due: d(15), status: "paid",
    lines: [
      { id: "l1", description: "Trial groundwork — partition suit (6.0 hrs)", quantity: 6, rate: 500000, kind: "time" },
      { id: "l2", description: "Court filing fee — interrogatories", quantity: 1, rate: 20000, kind: "expense" },
    ],
    notes: "Paid from client trust.",
  },
  {
    id: "iv2", number: "INV-1044", clientId: "c4", caseId: "k4",
    issued: d(-18), due: d(12), status: "paid",
    lines: [
      { id: "l3", description: "Writ petition drafting and filing (8.0 hrs)", quantity: 8, rate: 300000, kind: "time" },
      { id: "l4", description: "Filing fee — Delhi High Court", quantity: 1, rate: 50000, kind: "expense" },
    ],
  },
  {
    id: "iv3", number: "INV-1042", clientId: "c5", caseId: "k6",
    issued: d(-20), due: d(10), status: "paid",
    lines: [
      { id: "l5", description: "s.9 IBC petition — drafting and filings (7.0 hrs)", quantity: 7, rate: 450000, kind: "time" },
    ],
  },
  {
    id: "iv4", number: "INV-1040", clientId: "c8", caseId: "k8",
    issued: d(-21), due: d(9), status: "paid",
    lines: [
      { id: "l6", description: "Contract vetting — hotel management agreement (3.0 hrs)", quantity: 3, rate: 200000, kind: "time" },
      { id: "l7", description: "PoSH policy update (2.0 hrs)", quantity: 2, rate: 300000, kind: "time" },
      { id: "l8", description: "Vendor staff onboarding advisory (1.5 hrs)", quantity: 1.5, rate: 200000, kind: "time" },
      { id: "l9", description: "Compliance calendar setup", quantity: 1, rate: 250000, kind: "flat" },
    ],
  },
  {
    id: "iv5", number: "INV-1039", clientId: "c6", caseId: "k7",
    issued: d(-28), due: d(2), status: "overdue",
    lines: [
      { id: "l10", description: "s.241–242 petition drafting (4.0 hrs)", quantity: 4, rate: 450000, kind: "time" },
    ],
  },
  {
    id: "iv6", number: "INV-1045", clientId: "c7", caseId: "k5",
    issued: d(-10), due: d(20), status: "sent",
    lines: [
      { id: "l11", description: "Appeal memorandum and synopsis (5.0 hrs)", quantity: 5, rate: 500000, kind: "time" },
      { id: "l12", description: "Court fees and printing — appeal", quantity: 1, rate: 150000, kind: "expense" },
    ],
  },
  {
    id: "iv7", number: "INV-1041", clientId: "c3", caseId: "k3",
    issued: d(-30), due: d(0), status: "overdue",
    lines: [
      { id: "l13", description: "Evidence affidavit — consumer complaint (5.0 hrs)", quantity: 5, rate: 300000, kind: "time" },
      { id: "l14", description: "Consumer commission filing fee", quantity: 1, rate: 50000, kind: "expense" },
    ],
  },
  {
    id: "iv8", number: "INV-1043", clientId: "c10", caseId: "k10",
    issued: d(-33), due: d(-3), status: "overdue",
    lines: [
      { id: "l15", description: "Employment contracts review (4.0 hrs)", quantity: 4, rate: 300000, kind: "time" },
      { id: "l16", description: "Advisory note — contractor gratuity clauses (3.0 hrs)", quantity: 3, rate: 200000, kind: "time" },
      { id: "l17", description: "Courier and notary charges", quantity: 1, rate: 35000, kind: "expense" },
    ],
  },
  {
    id: "iv9", number: "INV-1046", clientId: "c9", caseId: "k9",
    issued: d(-6), due: d(24), status: "draft",
    lines: [
      { id: "l18", description: "Incorporation package — drafting, filings and liaison (advance)", quantity: 1, rate: 2500000, kind: "flat" },
    ],
  },
  {
    id: "iv10", number: "INV-1038", clientId: "c11", caseId: "k11",
    issued: d(-85), due: d(-55), status: "paid",
    lines: [
      { id: "l19", description: "Recovery suit — trial evidence (5.0 hrs)", quantity: 5, rate: 300000, kind: "time" },
      { id: "l20", description: "Settlement negotiation and consent terms (4.0 hrs)", quantity: 4, rate: 500000, kind: "time" },
      { id: "l21", description: "Court fees — recovery suit", quantity: 1, rate: 75000, kind: "expense" },
    ],
  },
  {
    id: "iv11", number: "INV-1048", clientId: "c2", caseId: "k2",
    issued: d(-1), due: d(29), status: "sent",
    lines: [
      { id: "l22", description: "Complaint evidence compilation (5.0 hrs)", quantity: 5, rate: 300000, kind: "time" },
      { id: "l23", description: "Court fee — complaint filing", quantity: 1, rate: 20000, kind: "expense" },
    ],
  },
  {
    id: "iv12", number: "INV-1037", clientId: "c8", caseId: "k8",
    issued: d(-50), due: d(-20), status: "paid",
    lines: [
      { id: "l24", description: "Monthly retainer — contract vetting and advisory (24.0 hrs)", quantity: 24, rate: 450000, kind: "time" },
      { id: "l25", description: "Stamp duty — agreement registration", quantity: 1, rate: 600000, kind: "expense" },
    ],
    notes: "April retainer cycle.",
  },
];

export const seedPayments: Payment[] = [
  { id: "p1", invoiceId: "iv10", clientId: "c11", date: d(-84), amount: 3575000, method: "echeck", status: "deposited", trustAccount: true },
  { id: "p2", invoiceId: "iv7", clientId: "c3", date: d(-5), amount: 500000, method: "card", status: "deposited", trustAccount: true },
  { id: "p3", invoiceId: "iv3", clientId: "c5", date: d(-12), amount: 3150000, method: "echeck", status: "deposited", trustAccount: false },
  { id: "p4", invoiceId: "iv8", clientId: "c10", date: d(-4), amount: 600000, method: "echeck", status: "pending", trustAccount: false },
  { id: "p5", invoiceId: "iv4", clientId: "c8", date: d(-20), amount: 1750000, method: "echeck", status: "deposited", trustAccount: true },
  { id: "p6", invoiceId: "iv1", clientId: "c1", date: d(-14), amount: 3020000, method: "echeck", status: "deposited", trustAccount: true },
  { id: "p7", invoiceId: "iv2", clientId: "c4", date: d(-17), amount: 2450000, method: "card", status: "deposited", trustAccount: true },
  { id: "p8", invoiceId: "iv12", clientId: "c8", date: d(-48), amount: 11400000, method: "echeck", status: "deposited", trustAccount: false },
];

export const seedTrust: TrustTransaction[] = [
  { id: "tt1", clientId: "c1", caseId: "k1", date: d(-120), description: "Retainer deposit — partition suit", amount: 20000000, balanceAfter: 20000000 },
  { id: "tt2", clientId: "c1", caseId: "k1", date: d(-14), description: "Fees transferred — INV-1047", amount: -3020000, balanceAfter: 16980000 },
  { id: "tt3", clientId: "c2", caseId: "k2", date: d(-45), description: "Retainer deposit — cheque bounce matter", amount: 10000000, balanceAfter: 10000000 },
  { id: "tt4", clientId: "c3", caseId: "k3", date: d(-30), description: "Advance deposit — consumer complaint", amount: 10000000, balanceAfter: 10000000 },
  { id: "tt5", clientId: "c3", caseId: "k3", date: d(-5), description: "Part fees transferred — INV-1041", amount: -500000, balanceAfter: 9500000 },
  { id: "tt6", clientId: "c4", caseId: "k4", date: d(-40), description: "Retainer deposit — service writ", amount: 15000000, balanceAfter: 15000000 },
  { id: "tt7", clientId: "c4", caseId: "k4", date: d(-17), description: "Fees transferred — INV-1044", amount: -2450000, balanceAfter: 12550000 },
  { id: "tt8", clientId: "c5", caseId: "k6", date: d(-60), description: "Retainer deposit — CIRP petition", amount: 50000000, balanceAfter: 50000000 },
  { id: "tt9", clientId: "c6", caseId: "k7", date: d(-35), description: "Retainer deposit — oppression & mismanagement", amount: 25000000, balanceAfter: 25000000 },
  { id: "tt10", clientId: "c7", caseId: "k5", date: d(-25), description: "Retainer deposit — commercial appeal", amount: 30000000, balanceAfter: 30000000 },
  { id: "tt11", clientId: "c8", caseId: "k8", date: d(-75), description: "Retainer top-up — corporate advisory", amount: 10000000, balanceAfter: 10000000 },
  { id: "tt12", clientId: "c8", caseId: "k8", date: d(-20), description: "Fees transferred — INV-1040", amount: -1750000, balanceAfter: 8250000 },
  { id: "tt13", clientId: "c9", caseId: "k9", date: d(-18), description: "Advance deposit — LLP incorporation", amount: 5000000, balanceAfter: 5000000 },
  { id: "tt14", clientId: "c11", caseId: "k11", date: d(-200), description: "Retainer deposit — recovery suit", amount: 10000000, balanceAfter: 10000000 },
  { id: "tt15", clientId: "c11", caseId: "k11", date: d(-84), description: "Fees transferred — INV-1038", amount: -3575000, balanceAfter: 6425000 },
  { id: "tt16", clientId: "c11", caseId: "k11", date: d(-80), description: "Refund of unspent retainer to client", amount: -6425000, balanceAfter: 0 },
];

export const seedDocuments: DocumentFile[] = [
  { id: "f1", name: "Retainer Agreement — Chadha.docx", folder: "Engagement", caseId: "k1", sizeKb: 84, updatedAt: d(-420), kind: "doc", starred: true, templateFields: ["client.name", "case.number", "firm.name", "rate"] },
  { id: "f2", name: "Plaint — Partition Suit (Chadha v. Khanna).pdf", folder: "Pleadings", caseId: "k1", sizeKb: 1240, updatedAt: d(-415), kind: "pdf" },
  { id: "f3", name: "Written Statement — Khanna.pdf", folder: "Pleadings", caseId: "k1", sizeKb: 1180, updatedAt: d(-300), kind: "pdf" },
  { id: "f4", name: "Evidence Bundle — Final Arguments.pdf", folder: "Evidence", caseId: "k1", sizeKb: 8810, updatedAt: d(-1), kind: "pdf" },
  { id: "f5", name: "Legal Notice — s.138 NI Act.pdf", folder: "Notices", caseId: "k2", sizeKb: 210, updatedAt: d(-40), kind: "pdf" },
  { id: "f6", name: "Consumer Complaint — Menon v. Aurum Heights.pdf", folder: "Pleadings", caseId: "k3", sizeKb: 3210, updatedAt: d(-90), kind: "pdf" },
  { id: "f7", name: "Writ Petition — Rawat v. Northern Mercantile Bank.pdf", folder: "Pleadings", caseId: "k4", sizeKb: 4210, updatedAt: d(-19), kind: "pdf" },
  { id: "f8", name: "Rejoinder — Meridian s.9 Petition.docx", folder: "Drafts", caseId: "k6", sizeKb: 96, updatedAt: d(-1), kind: "doc" },
  { id: "f9", name: "s.241 Petition — Roy v. Nalanda Meditech.pdf", folder: "Pleadings", caseId: "k7", sizeKb: 5210, updatedAt: d(-29), kind: "pdf" },
  { id: "f10", name: "Vendor Agreement — Bluefern (vetted).docx", folder: "Contracts", caseId: "k8", sizeKb: 205, updatedAt: d(0), kind: "doc", starred: true },
  { id: "f11", name: "LLP Agreement — Kothari Design Studio.docx", folder: "Drafts", caseId: "k9", sizeKb: 110, updatedAt: d(-2), kind: "doc" },
  { id: "f12", name: "Employment Contracts — Eastbridge (mark-up).docx", folder: "Contracts", caseId: "k10", sizeKb: 190, updatedAt: d(-3), kind: "doc" },
  { id: "f13", name: "Settlement Consent Terms — Gulati.pdf", folder: "Pleadings", caseId: "k11", sizeKb: 340, updatedAt: d(-84), kind: "pdf" },
  { id: "f14", name: "Invoice INV-1047.pdf", folder: "Invoices", caseId: "k1", sizeKb: 58, updatedAt: d(-15), kind: "pdf" },
  { id: "f15", name: "Firm Letterhead.template.docx", folder: "Templates", sizeKb: 44, updatedAt: d(-90), kind: "template", templateFields: ["firm.name", "firm.address", "date.today"] },
  { id: "f16", name: "Engagement Letter.template.docx", folder: "Templates", sizeKb: 51, updatedAt: d(-90), kind: "template", templateFields: ["client.name", "case.number", "rate", "firm.name"] },
];

export const seedThreads: MessageThread[] = [
  {
    id: "th1", subject: "Final arguments date confirmed", clientId: "c1", caseId: "k1", channel: "secure", unread: true,
    messages: [
      { id: "m1", from: "client", authorName: "Harish Chadha", body: "Good morning — is the 9th confirmed for final arguments?", at: dt(-1, "09:12") },
      { id: "m2", from: "firm", authorName: "Arjun Kaul", body: "Yes — Saket District Court at 10:00 AM. Prem Lal's deposition is listed first tomorrow.", at: dt(-1, "10:02") },
      { id: "m3", from: "client", authorName: "Harish Chadha", body: "Thank you. I'll ask Prem to be available both days.", at: dt(0, "08:40") },
    ],
  },
  {
    id: "th2", subject: "Vendor agreements — round 2", clientId: "c8", caseId: "k8", channel: "email", unread: false,
    messages: [
      { id: "m4", from: "firm", authorName: "Meera Bhatnagar", body: "Hi Ananya, two of the five vendor agreements are back with mark-ups; indemnity caps remain open.", at: dt(-3, "14:20") },
      { id: "m5", from: "client", authorName: "Ananya Kapoor", body: "Received — signing authority will revert on the caps by Thursday.", at: dt(-2, "11:05") },
    ],
  },
  {
    id: "th3", subject: "Possession letter received", clientId: "c3", caseId: "k3", channel: "email", unread: true,
    messages: [
      { id: "m6", from: "client", authorName: "Kavita Menon", body: "The builder's lawyer has sent another 'offer of possession' letter today.", at: dt(0, "09:31") },
      { id: "m7", from: "firm", authorName: "Vikram Sethi", body: "Please don't accept possession — it is an attempt to moot the complaint. We will place this on record before the Commission on the 12th.", at: dt(0, "10:15") },
    ],
  },
  {
    id: "th4", subject: "SMS: hearing reminder — Patiala House", clientId: "c2", caseId: "k2", channel: "sms", unread: true,
    messages: [
      { id: "m8", from: "firm", authorName: "Firm Reminders", body: "Reminder: pre-summoning evidence listed Thursday, 10:00 AM, Patiala House. Please carry the original cheque and return memos.", at: dt(0, "09:00") },
      { id: "m9", from: "client", authorName: "Nikhil Sabharwal", body: "Noted — I have both with me.", at: dt(0, "09:31") },
    ],
  },
  {
    id: "th5", subject: "CIRP hearing logistics", clientId: "c5", caseId: "k6", channel: "secure", unread: false,
    messages: [
      { id: "m10", from: "firm", authorName: "Meera Bhatnagar", body: "The admission listing is on the 7th before Bench II; our counsel will appear with the rejoinder.", at: dt(-2, "16:00") },
      { id: "m11", from: "client", authorName: "Devansh Rao", body: "Confirmed — finance will keep the demand annexures ready.", at: dt(-2, "17:05") },
    ],
  },
];

export const seedLeads: Lead[] = [
  { id: "ld1", name: "Devika Pillai", email: "devika.pillai@example.com", phone: "+91 98203 77146", source: "website", stage: "consult scheduled", practiceArea: "Consumer Law", value: 80000000, createdAt: d(-3), activity: [{ at: dt(-3, "18:40"), text: "Intake form submitted via website" }, { at: dt(-2, "10:15"), text: "Called back — consult booked for Friday" }] },
  { id: "ld2", name: "Farhan Qureshi", email: "farhan.qureshi@example.com", phone: "+91 99107 26480", source: "referral", stage: "fee agreement", practiceArea: "Cheque Bounce (s.138)", value: 15000000, createdAt: d(-9), notes: "Referred by CA Rohit Bansal.", activity: [{ at: dt(-9, "12:00"), text: "Inbound call — dishonoured cheque of ₹4.2 lakh" }, { at: dt(-7, "15:30"), text: "Fee note shared for e-signature" }] },
  { id: "ld3", name: "Aditi Sengupta", email: "aditi.sengupta@example.com", phone: "+91 98301 44972", source: "website", stage: "new", practiceArea: "Insolvency (CIRP)", value: 35000000, createdAt: d(-1), activity: [{ at: dt(-1, "20:05"), text: "Landing page form filled" }] },
  { id: "ld4", name: "Prakash Bedekar", email: "prakash.bedekar@example.com", phone: "+91 97173 90218", source: "call", stage: "contacted", practiceArea: "Writs & Service Matters", value: 9000000, createdAt: d(-6), activity: [{ at: dt(-6, "11:20"), text: "Inbound call — pension grievance against a PSU" }, { at: dt(-5, "09:00"), text: "Emailed intake packet" }] },
  { id: "ld5", name: "Meher Contractor", email: "meher.contractor@example.com", phone: "+91 98200 63154", source: "walk-in", stage: "lost", practiceArea: "Civil Litigation", value: 40000000, createdAt: d(-25), notes: "Property in Gurugram — referred to local counsel.", activity: [{ at: dt(-25, "12:00"), text: "Walk-in consult" }, { at: dt(-24, "10:00"), text: "Referred to Gurugram counsel" }] },
  { id: "ld6", name: "Priyanka Kothari", email: "priyanka.kothari@example.com", phone: "+91 99100 55283", source: "website", stage: "converted", practiceArea: "LLP Incorporation", value: 5000000, createdAt: d(-25), notes: "Converted — matter 2026-0044.", activity: [{ at: dt(-25, "17:45"), text: "Intake form submitted via website" }, { at: dt(-21, "11:00"), text: "Consult held — engagement letter signed" }, { at: dt(-20, "09:30"), text: "Converted to case 2026-0044" }] },
];

export const seedReports: ReportDef[] = [
  { id: "r1", title: "Revenue by month", kind: "revenue", description: "Collected and planned revenue across the firm" },
  { id: "r2", title: "Hours by timekeeper", kind: "hours", description: "Billable vs non-billable hours per user" },
  { id: "r3", title: "Cases by stage", kind: "cases-by-stage", description: "Open matters across pipeline stages" },
  { id: "r4", title: "AR aging", kind: "ar-aging", description: "Outstanding client balances by age" },
  { id: "r5", title: "Leads by source", kind: "lead-source", description: "Where new business comes from" },
  { id: "r6", title: "Expenses by case", kind: "expenses", description: "Advanced costs per matter" },
];
