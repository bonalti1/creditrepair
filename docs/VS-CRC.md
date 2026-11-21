# Credalti vs. Credit Repair Cloud

Compared on Nov 21, 2026, against the read-only review of the MIAM Credit
account on Credit Repair Cloud (CRC), Nov 20, 2026. Both products now do the
same job: a small team runs disputes for clients.

**Bottom line: Credalti has most of CRC's features designed and built, but
none of them run for a real client yet.** Everything runs on demo data. CRC is
live, carries 124 active clients and about $7,807 a month, and works today.

Legend: ✅ have it · 🟡 partly · ❌ missing · — not planned here

## Feature by feature

| CRC feature | Credalti today | |
| --- | --- | --- |
| Leads and clients with statuses, assignment, referrer | Stages set automatically from what the client has done; salesperson recorded on the invite. No adding or editing clients by hand, no assigning to a team member | 🟡 |
| Web lead form, affiliate signup, self-signup with checkout | Landing page, WhatsApp lead handoff, waitlist, invite links. No embeddable form or affiliate signup. No checkout at signup, on purpose (no charge before work) | 🟡 |
| Client portal, mobile app, Spanish | Phone-first app, Spanish first with English, chat assistant, one next step on every screen. No app-store app | ✅ |
| Agreement with e-signature record, Spanish | Disclosures, contract, cancellation notice, authorization, typed signature with a fingerprint of the exact text, printable copy, cancellation window enforced. Text pending attorney | ✅ |
| Document storage (ID, address, SSN, power of attorney) | ID, proof of address, identity theft report; staff see what is on file. No SSN card or power of attorney (a limited authorization in the contract instead, pending attorney) | 🟡 |
| Report import from 6 providers, manual paste, sample | Staff import with a "what changed" preview, but only our own file format reads. IdentityIQ and the other 5 need a real saved report page to build | ❌ |
| Credit audit for the client | Audit page, Spanish, printable, plain words | ✅ |
| Tag items with reasons, bulk tag | The client marks each item with one of 14 reasons and confirms it. Staff cannot tag, on purpose; no bulk tag | ✅ different |
| Round 1 / Round 2+ letters | Built automatically: personal info first, then disputes, method-of-verification, furnisher and collector letters | ✅ |
| Letter library with merge fields, AI letters | 42 templates (pending attorney), AI rewording with a safety check. Staff cannot edit templates in the app | 🟡 |
| Furnisher address book | Bureau addresses verified; no furnisher address book | ❌ |
| Batch print, mail first class or certified, tracking | Batch print locally works. Mail through Lob written but never tested; no certified mail, no tracking | 🟡 |
| Letters and status tracking | Each letter has a mail status in the staff console; nothing feeds it real data yet | 🟡 |
| Dispute item list and report views | Item list, per-bureau views, cross-bureau notes | ✅ |
| Calculators for clients | None | ❌ |
| Tasks, calendar, daily agenda email | Replaced by the "needs a person" list: the system creates and clears alerts itself. No calendar or appointments | ✅ different |
| Secure messages | Client chat with the assistant; staff reply in the same thread, and promises of results are blocked before sending; WhatsApp | ✅ |
| Client email and notification settings | WhatsApp messages only; no email to clients; no settings screen | 🟡 |
| Invoices, plans, refunds, pay-per-delete | Charges per mailed round at the signed price, receipts, refunds, pause. One plan only, no invoice list, no pay-per-delete | 🟡 |
| Payment gateway and transaction log | Adapter only; no processor connected; no CSV export | ❌ |
| Failed-payment follow-up | Retries on day 3 and 7 with a plain message, then the case pauses and resumes on payment | ✅ |
| Affiliate portal, commissions, payouts | None | ❌ |
| Team members, roles, permissions | Roles stored (admin, specialist, sales) but not yet limiting what each person sees; no team screen | 🟡 |
| Marketing Hub (CRM, SMS, pipelines, funnels) | Not here; planned for ALTO Control | — |
| Business stats, activity log | Staff home counts by stage, per-client history. No business dashboard (next on the list) | 🟡 |
| Zapier / API | n8n webhooks and a health endpoint; no public API | 🟡 |
| Monitoring partner and commissions | IdentityIQ link with disclosure; no commission tracking | 🟡 |

**Count:** 11 ✅ · 10 🟡 · 5 ❌ · 1 not planned, out of 27.

## Where Credalti is built to be better

- **Nothing slips.** Her account had 54 letters never printed, 52 overdue
  tasks, and follow-ups switched on for round 1 only. Credalti has no task list
  to fall behind on: the system moves each client forward and lists only what
  needs a person.
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
  each item.

None of this is proven until real clients use it.

## What it takes to run a real client

| Step | Who |
| --- | --- |
| Connect a real database and wire the staff console and client app to it (both run on demo data today) | Build |
| A real saved IdentityIQ report page, so reports can be read | Owner |
| Test mail through Lob; add certified mail and tracking | Build + owner's Lob account |
| A payment processor that accepts credit repair | Owner |
| Attorney review: agreement, payment authorization, letter library | Owner |
| Texas registration and bond; company details in the contract | Owner |

## Gaps worth building next, in order

1. Real database behind the staff console and client app.
2. Certified mail with tracking.
3. Importing her clients from a CRC export.
4. Team roles that limit what each person sees, and a team screen.
5. Business dashboard.
6. Furnisher address book.
7. Affiliates (here or in ALTO Control).
