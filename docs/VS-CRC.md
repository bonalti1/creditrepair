# Credalti vs. Credit Repair Cloud

Compared on Nov 21, 2026, against the read-only review of the MIAM Credit
account on Credit Repair Cloud (CRC), Nov 20, 2026; brought up to date on
Nov 22, 2026 (after English-first, partner sharing, data checks and
zero-touch fixes). Both products now do the same job: a small team runs disputes
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
| Web lead form, affiliate signup, self-signup with checkout | HighLevel forms hand leads to the app through a secret-checked webhook (SSN/DOB dropped), with dedupe and a salesperson assigned; stages go back to HighLevel. Partner signup at `/socios`. Landing page, WhatsApp lead handoff, invite links with the client's language. No checkout at signup, on purpose (no charge before work) | ✅ different |
| Client portal, mobile app, Spanish | Phone-first app, English and Spanish (English first, one tap to Spanish), chat assistant, one next step on every screen. No app-store app | ✅ |
| Agreement with e-signature record, Spanish | Disclosures, contract, cancellation notice, authorization, typed signature with a fingerprint of the exact text, printable copy, cancellation window enforced. Text pending attorney | ✅ |
| Document storage (ID, address, SSN, power of attorney) | ID, proof of address, identity theft report; staff see what is on file. No SSN card or power of attorney (a limited authorization in the contract instead, pending attorney) | 🟡 |
| Report import from 6 providers, manual paste, sample | Staff import with a "what changed" preview. Our own file format reads, and any provider's PDF or saved page reads through the AI reader (Claude, a citation per item, doubtful items marked for a person; `docs/INTAKE.md`). Not yet tried on a real provider report | 🟡 |
| Credit audit for the client | Audit page, Spanish, printable, plain words | ✅ |
| Tag items with reasons, bulk tag | The client marks each item with one of 14 reasons and confirms it, with objective data checks shown on the item (cross-bureau mismatches, §605 age, possible re-aging, impossible values, the same debt twice). Nothing is pre-selected. Staff cannot tag, on purpose; no bulk tag | ✅ different |
| Round 1 / Round 2+ letters | Built automatically: personal info first, then disputes, method-of-verification, furnisher and collector letters | ✅ |
| Letter library with merge fields, AI letters | 42 templates with an editor (`/equipo/cartas`): protected merge chips, live preview, diff, versions sent to the attorney and approved or rejected. With a database, only approved versions are mailed. Letters go out in one print font with no AI rewording until the attorney clears them. The client's chosen report facts print on the item's line | ✅ |
| Furnisher address book | One shared book for every client: creditor and collector dispute addresses, search, add, edit with a change history; a letter to a creditor goes only to a checked address, never the one the report printed. A missing company is one queue item listing every client waiting on it, with the addresses the reports print offered as unverified suggestions (a person confirms with a source). Bureau addresses verified | ✅ |
| Batch print, mail first class or certified, tracking | Batch print locally. Mail through Lob, first class or certified with electronic return receipt, every address checked with Lob's US verification before mailing (corrections used, the client asked to confirm an address the post office does not recognise), cost shown before sending (verification included), tracking through Lob's signed webhook. "Simulado" without a Lob key; not yet tried with a live Lob account | 🟡 |
| Letters and status tracking | Each letter's mail status, tracking number and events in the console and the client app, fed by the Lob webhook. A returned letter whose address the post office's data corrects goes again once by itself (same round, no new charge); otherwise the client is asked about their address, or the creditor's address is marked bad, and only then a person. The client hears automatically when a certified letter is delivered or re-mailed | ✅ |
| Dispute item list and report views | Item list, per-bureau views, cross-bureau notes | ✅ |
| Calculators for clients | "Aprende": ten sourced lessons and two calculators (utilization; how long an item may be reported under FCRA §605). CRC has five budgeting calculators; we have fewer, focused on credit | ✅ different |
| Tasks, calendar, daily agenda email | Replaced by one prioritized work queue: only what needs a person, each with what the system already tried, estimated minutes, waiting time, a due time and a «Cómo se resuelve» card (steps and «Hecho cuando…»), and a "Siguiente" mode with keyboard shortcuts. Routine follow-ups are sent by the system (3 reminders, then a person). A morning summary per teammate by WhatsApp or email ("Hoy: N cosas · ~M minutos", the first three, what the system did overnight), opt-in, once a day. No calendar or appointments (`docs/STAFF.md`) | ✅ different |
| Secure messages | Client chat with the assistant; staff reply in the same thread, and promises of results are blocked before sending. A waiting question opens with a matching saved answer and an AI-drafted reply (checked against the same rules before it is shown, sent with one tap through the same checks). A library of approved answers, which the assistant also uses to answer a close match by itself; anything else still goes to a person. WhatsApp, with automatic reminders and status messages under quiet hours, a daily cap and opt-out (BAJA / STOP). Drafts not yet tried with a live key | ✅ |
| Client email and notification settings | Automatic messages by WhatsApp, then email (with unsubscribe link and postal address); never SMS. The client opts out with BAJA/STOP or the email link; staff can record it too. Email adapter not yet tried live; no settings screen for the client | 🟡 |
| Invoices, plans, refunds, pay-per-delete | CRC's plan types and words: Subscription (monthly), Per round, Flat fee (installments, or one charge after the last round), Pay per delete; first work fee, due date, duration, household discount, and a most-you'll-pay cap; versioned plans (draft → attorney-approved → offered → retired) in `/equipo/planes` with a payment timeline preview; the signed agreement keeps the exact version. Every charge waits for the work it pays for (CRC's "days after the plan is saved" and "when letters are saved" are shown disabled). Invoice numbers, invoice list with statuses and filters, client invoices and monthly statements, refunds and voids, pause. Pay per delete is built but off until the attorney approves it | ✅ |
| Payment gateway and transaction log | NMI and Authorize.Net adapters (hosted fields only, card and ACH, refunds and voids, signed webhooks for returns and chargebacks), selected by `BILLING_GATEWAY`; transaction CSV and a QuickBooks CSV; chargeback evidence pack in one click and the chargeback rate on the dashboard. Not yet run against either processor's sandbox: details marked UNVERIFIED in `docs/BILLING.md` | 🟡 |
| Failed-payment follow-up | Retries on day 3 and 7, each with a plain message and a one-tap «Actualizar mi tarjeta» link (saving the card retries the charge at once, under every billing rule), then the case pauses and resumes on payment. A missing payment method gets the same link and three automatic reminders before a person; the person's card shows the exact words the client got | ✅ |
| Affiliate portal, commissions, payouts | Referral partners (realtors, loan officers, tax preparers): signup, admin approval, link and QR code, send-a-referral form. With the client's consent, a partner follows that client's progress (none / progress / progress + two counts), every view logged and shown to the client; never credit data. Commissions are recorded by hand like CRC and switched off until the attorney clears referral fees | ✅ |
| Team members, roles, permissions | Admin, specialist and sales limit what each person sees and does, in the console, in every staff route and in the database's read policies. Team screen: add by email or phone, change role, deactivate (never delete). A new teammate gets a first-day checklist, a welcome page with the rules and a 5-minute guided tour, and «¿Qué hago aquí?» on every screen | ✅ |
| Marketing Hub (CRM, SMS, pipelines, funnels) | Not here: marketing and CRM are in HighLevel (leads, nurture, reviews). The app owns the client after signup | — |
| Business stats, activity log | Business dashboard (clients, work, money, team, sales, and the clients' «¿Cómo vamos?» pulse with recent comments) with a written definition for every number, including "Minutos de trabajo humano por cliente activo"; who-did-what log per client and for the team, with what the system did by itself | ✅ |
| Zapier / API | n8n webhooks, scheduled runs (rounds, billing, autopilot, HighLevel sync, partner notices, morning summary), the HighLevel webhook in and stage sync out, and a health endpoint; no public API | 🟡 |
| Monitoring partner and commissions | IdentityIQ link with disclosure; no commission tracking | 🟡 |

**Count:** 19 ✅ · 7 🟡 · 0 ❌ · 1 not planned, out of 27 (counted again row by row on Nov 22, after billing plans, ACH, the NMI and Authorize.Net adapters and chargebacks).

## Where Credalti is built to be better

- **Nothing slips.** Her account had 54 letters never printed, 52 overdue
  tasks, and follow-ups switched on for round 1 only. Credalti has no task list
  to fall behind on: the system reminds the client by itself (three times,
  then a person), tells them what happened, and mails every round that passes
  its gates after a review window (once the owner turns that on). One queue
  lists only what needs a person, with an estimate of the minutes it takes.
- **Billing cannot charge before the work.** CRC charges on a date rule (days
  after the plan is saved, or when letters are saved), and its first work fee
  can be taken at signup. Credalti offers the same plan types and options in
  the same words, but every charge waits for the work it pays for (a mailed
  round, a 30-day period with a round, a later report), the first work fee
  comes after the first round, and every plan prints the most the client can
  ever pay. Enforced down to the database. That is the federal rule that cost
  the largest company in the industry a multibillion-dollar judgment.
- **The client says what is inaccurate.** In CRC negatives come pre-checked for
  staff. In Credalti each item carries the client's own reason and
  confirmation, which is what every letter rests on.
- **No promises in writing.** Staff replies, the assistant and the marketing
  copy are checked for promises of results before they go out.
- **The cancellation window is enforced.** No letter, re-import or charge in
  the first 3 business days after signing.
- **Identity theft is held.** No identity theft letter goes out until the
  client's report is on file.
- **English and Spanish, on the phone,** English first with Spanish one tap
  away (or automatic for Spanish phones), on the client side and the staff
  console, with WhatsApp and an assistant that answers in the client's language. The staff console works on a phone too (a bottom tab bar, every
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
| WhatsApp Business: approve the 34 message templates; an email account for automatic email (`docs/AUTOPILOT.md`) | Owner |
| Attorney answers on consent for automated messages (`docs/AUTOPILOT.md`) | Owner |
| A merchant account that accepts credit repair (NMI or Authorize.Net, adapters built), tested in its sandbox | Owner |
| Attorney review: agreement, each plan version, card and ACH authorizations, letter library | Owner |
| Texas registration and bond; company details in the contract | Owner |

## Gaps worth building next, in order

1. Tuning the report reader on a real IdentityIQ report (the AI reader is built).
2. Importing her clients from a CRC export (needs one export file).
3. Running the NMI or Authorize.Net adapter against the processor's sandbox and settling every UNVERIFIED detail.
4. Syncing opt-outs with HighLevel.
5. A client settings screen for notifications.

Done since this list was written: the one-person console (AI-drafted replies,
saved answers, playbook cards, morning summary, new-hire mode, phone layout;
`docs/STAFF.md`), team roles, a team screen, assignment, the
business dashboard, the real database behind the console and the client app,
certified mail with tracking, the furnisher address book, and the autopilot
(automatic follow-ups, status messages, automatic sending, the work queue).
