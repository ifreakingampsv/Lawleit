# Lawleit

Lawleit is a legal practice management product (MyCase-adapted) for small to
mid-tier Indian law firms. One codebase ships two versions; this glossary defines
the vocabulary used across specs, tickets, and code.

## Language

**Demo Version**:
The public, portfolio build: full access to every feature, entered with one click,
no signup and no payment info. Visitor edits are private to their own browser.
_Avoid_: trial, playground, staging

**Production Version**:
The real product that law firms use with real data, real authentication, and real
record-keeping.
_Avoid_: live version, real version, prod build

**V1**:
The first shippable scope: the 15 core modules (dashboard, cases, contacts,
calendar, tasks, time, expenses, invoices, payments, trust, documents, comms,
leads, reports, settings) plus real file uploads, minimal email, and INR money.
_Avoid_: MVP, phase 1

**V2**:
The deferred India-localization scope: GST/TDS invoicing, Indian payment gateway
rails, stage-based billing, retainer trust model, WhatsApp channel, and court
cause-list calendars.
_Avoid_: later, backlog

**Firm**:
A law practice that signs up as one tenant; every piece of data in the system
belongs to a Firm.
_Avoid_: company, organization, workspace, account

**Demo Firm**:
The fictional seeded Indian firm portrayed by the Demo Version (Indian names,
courts, rupees) — deliberately believable, never a real firm.
_Avoid_: sample data, test account

**Record** (a payment):
A manual money-received entry made by a firm user against an invoice or as a
trust deposit — the V1 flow. The user asserts money arrived; nothing is charged.
_Avoid_: add payment, log payment

**Collect** (a payment):
Generating a payment link so the CLIENT pays through the firm's gateway — the
V2 flow. The gateway page charges the client; a webhook records the result.
_Avoid_: charge (Lawleit never charges — the firm's gateway does), request money

**Payment Link**:
A hosted gateway checkout URL for one invoice, created through the firm's own
connected gateway account. Paying it records a payment through the same rules
as a manual record.
_Avoid_: invoice URL, pay button

**Gateway Account**:
A firm's own payment-gateway account (Razorpay), connected to Lawleit by the
firm owner pasting its API keys. Money settles to the firm's bank; Lawleit
never touches it. One per firm.
_Avoid_: payment integration, Lawleit payments account
