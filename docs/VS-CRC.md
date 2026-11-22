# Credalti vs. Credit Repair Cloud

Compared on Nov 21, 2026, against the read-only review of the MIAM Credit
account on Credit Repair Cloud (CRC), Nov 20, 2026; brought up to date on
Nov 22, 2026. Both products now do the same job: a small team runs disputes
for clients.

**Bottom line: Credalti has most of CRC's features built, and the staff
console and the client app now run on a real database, but no real client
has used them yet.** The demo shows every screen with invented clients. CRC
is live, carries 124 active clients and about $7,807 a month, and works today.
Where Credalti is meant to win is the work itself: the system follows up and
sends by itself, and one person handles only what needs a human
(`docs/AUTOPILOT.md`).

Legend: ✅ have it · 🟡 partly · ❌ missing · — not planned here

## Feature by feature

| CRC feature | Credalti today | |
| --- | --- | --- |
| Leads and clients with statuses, assignment, referrer | Stages set automatically from what the client has done; salesperson recorded on the invite. Add a prospect by hand (with the same invite message), assign to a teammate, round-robin for new clients, filters, bulk assign / send / CSV. No editing a client's details by hand | ✅ |
| Web lead form, affiliate signup, self-signup with checkout | Landing page, WhatsApp lead handoff, waitlist, invite links. No embeddable form or affiliate signup. No checkout at signup, on purpose (no charge before work) | 🟡 |
| Client portal, mobile app, Spanish | Phone-first app, Spanish first with English, chat assistant, one next step on every screen. No app-store app | ✅ |
| Agreement with e-signature record, Spanish | Disclosures, contract, cancellation notice, authorization, typed signature with a fingerprint of the exact text, printable copy, cancellation window enforced. Text pending attorney | ✅ |
| Document storage (ID, address, SSN, power of attorney) | ID, proof of address, identity theft report; staff see what is on file. No SSN card or power of attorney (a limited authorization in the contract instead, pending attorney) | 🟡 |
| Report import from 6 providers, manual paste, sample | Staff import with a "what changed" preview. Our own file format reads, and any provider's PDF or saved page reads through the AI reader (Claude, a citation per item, doubtful items marked for a person; `docs/INTAKE.md`). Not yet tried on a real provider report | 🟡 |
| Credit audit for the client | Audit page, Spanish, printable, plain words | ✅ |
| Tag items with reasons, bulk tag | The client marks each item with one of 14 reasons and confirms it. Staff cannot tag, on purpose; no bulk tag | ✅ different |
| Round 1 / Round 2+ letters | Built automatically: personal info first, then disputes, method-of-verification, furnisher and collector letters | ✅ |
| Letter library with merge fields, AI letters | 42 templates (pending attorney). Letters go out exactly as the template renders them, in one print font: AI rewording and font rotation are built but off until the attorney clears them. Staff cannot edit templates in the app | 🟡 |
| Furnisher address book | Creditor and collector dispute addresses: search, add, edit with a change history; a letter to a creditor goes only to a checked address, never the one the report printed. Bureau addresses verified | ✅ |
| Batch print, mail first class or certified, tracking | Batch print locally. Mail through Lob, first class or certified with electronic return receipt, cost shown before sending, tracking through Lob's signed webhook. "Simulado" without a Lob key; not yet tried with a live Lob account | 🟡 |
| Letters and status tracking | Each letter's mail status, tracking number and events in the console and the client app, fed by the Lob webhook; returned letters become a notice for a person. The client hears automatically when a certified letter is delivered | ✅ |
| Dispute item list and report views | Item list, per-bureau views, cross-bureau notes | ✅ |
| Calculators for clients | None | ❌ |
| Tasks, calendar, daily agenda email | Replaced by one prioritized work queue: only what needs a person, each with what the system already tried, estimated minutes, waiting time, a due time and a «Cómo se resuelve» card (steps and «Hecho cuando…»), and a "Siguiente" mode with keyboard shortcuts. Routine follow-ups are sent by the system (3 reminders, then a person). A morning summary per teammate by WhatsApp or email ("Hoy: N cosas · ~M minutos", the first three, what the system did overnight), opt-in, once a day. No calendar or appointments (`docs/STAFF.md`) | ✅ different |
| Secure messages | Client chat with the assistant; staff reply in the same thread, and promises of results are blocked before sending. A waiting question opens with a matching saved answer and an AI-drafted reply (checked against the same rules before it is shown, sent with one tap through the same checks). A library of approved answers, which the assistant also uses to answer a close match by itself; anything else still goes to a person. WhatsApp, with automatic reminders and status messages under quiet hours, a daily cap and opt-out (BAJA / STOP). Drafts not yet tried with a live key | ✅ |
| Client email and notification settings | Automatic messages by WhatsApp, then email (with unsubscribe link and postal address); never SMS. The client opts out with BAJA/STOP or the email link; staff can record it too. Email adapter not yet tried live; no settings screen for the client | 🟡 |
| Invoices, plans, refunds, pay-per-delete | Charges per mailed round at the signed price, receipts (sent to the client automatically), refunds, pause. One plan only, no invoice list, no pay-per-delete | 🟡 |
| Payment gateway and transaction log | Adapter, the charge and refund records, and the client's "Mis pagos"; no processor connected (one that accepts credit repair is the owner's to find); no CSV export | ❌ |
| Failed-payment follow-up | Retries on day 3 and 7 with a plain message, then the case pauses and resumes on payment. A missing payment method gets three automatic reminders before a person | ✅ |
| Affiliate portal, commissions, payouts | None | ❌ |
| Team members, roles, permissions | Admin, specialist and sales limit what each person sees and does, in the console, in every staff route and in the database's read policies. Team screen: add by email or phone, change role, deactivate (never delete). A new teammate gets a first-day checklist, a welcome page with the rules and a 5-minute guided tour, and «¿Qué hago aquí?» on every screen | ✅ |
| Marketing Hub (CRM, SMS, pipelines, funnels) | Not here: marketing and CRM are in HighLevel (leads, nurture, reviews). The app owns the client after signup | — |
| Business stats, activity log | Business dashboard (clients, work, money, team, sales, and the clients' «¿Cómo vamos?» pulse with recent comments) with a written definition for every number, including "Minutos de trabajo humano por cliente activo"; who-did-what log per client and for the team, with what the system did by itself | ✅ |
| Zapier / API | n8n webhooks, hourly runs (rounds, billing, autopilot) and a health endpoint; no public API | 🟡 |
| Monitoring partner and commissions | IdentityIQ link with disclosure; no commission tracking | 🟡 |

**Count:** 14 ✅ · 9 🟡 · 3 ❌ · 1 not planned, out of 27 (counted again row by row on Nov 22, with the AI report reader).

## Where Credalti is built to be better

- **Nothing slips.** Her account had 54 letters never printed, 52 overdue
  tasks, and follow-ups switched on for round 1 only. Credalti has no task list
  to fall behind on: the system reminds the client by itself (three times,
  then a person), tells them what happened, and mails every round that passes
  its gates after a review window (once the owner turns that on). One queue
  lists only what needs a person, with an estimate of the minutes it takes.
- **Billing cannot charge before the work.** CRC charges on a date rule (days
  after the plan is saved, or when letters are saved). Credalti charges only
  after a round is mailed, enforced down to the database. That is the federal
  rule that cost the largest company in the industry a multibillion-dollar
  judgment.
- **The client says what is inaccurate.** In CRC negatives come pre-checked for
  staff. In Credalti each item carries the client's own reason and
  confirmation, which is what every letter rests on.
- **No promises in writing.** Staff replies, the assistant and the marketing
  copy are checked for promises of results before they go out.
- **The cancellation window is enforced.** No letter, re-import or charge in
  the first 3 business days after signing.
- **Identity theft is held.** No identity theft letter goes out until the
  client's report is on file.
- **Spanish and phone first,** with WhatsApp and an assistant that explains
  each item. The staff console works on a phone too (a bottom tab bar, every
  screen checked at 390 px).
- **One person, not a back office.** Drafted replies, saved answers the
  assistant reuses, a card with the steps for every kind of notice and a
  morning summary keep one teammate's day to about two hours for 100 clients
  (an estimate, `docs/STAFF.md`).

None of this is proven until real clients use it.

## What it takes to run a real client

| Step | Who |
| --- | --- |
| Set up the Supabase project and apply `supabase/setup.sql` (`docs/DATABASE.md`) | Owner |
| A real saved IdentityIQ report page, so reports can be read | Owner |
| Test mail through Lob with a live key (certified mail and tracking are built) | Owner's Lob account |
| WhatsApp Business: approve the 24 message templates; an email account for automatic email (`docs/AUTOPILOT.md`) | Owner |
| Attorney answers on consent for automated messages (`docs/AUTOPILOT.md`) | Owner |
| A payment processor that accepts credit repair | Owner |
| Attorney review: agreement, payment authorization, letter library | Owner |
| Texas registration and bond; company details in the contract | Owner |

## Gaps worth building next, in order

1. Reading real provider reports (IdentityIQ first) and AI document intake.
2. Importing her clients from a CRC export.
3. A payment processor adapter for the one the owner finds.
4. Syncing opt-outs and new clients with HighLevel.
5. Affiliates (here or in HighLevel).

Done since this list was written: the one-person console (AI-drafted replies,
saved answers, playbook cards, morning summary, new-hire mode, phone layout;
`docs/STAFF.md`), team roles, a team screen, assignment, the
business dashboard, the real database behind the console and the client app,
certified mail with tracking, the furnisher address book, and the autopilot
(automatic follow-ups, status messages, automatic sending, the work queue).
