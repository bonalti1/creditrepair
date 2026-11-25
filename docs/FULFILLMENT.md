# Fulfillment: how a client goes through Credalti

This is the page a new hire reads first. It follows one client from the first
message to graduation: who does what, what the system does by itself, and
which screen each step happens on. It also covers what was added for launch on
Nov 25, 2026 (notification settings, credit monitoring tracking and its
commissions, document review, the import from Credit Repair Cloud) and the
end-to-end walkthrough of the demo that found the problems fixed here.

The rules that never bend, whatever a screen seems to allow: no charge before
the work (the database refuses it), the client decides what is inaccurate
(nobody on the team marks an item), no promises, no score pictures, never
"free", never SMS for follow-ups, quiet hours 9 p.m.–8 a.m. Texas time, the
3-business-day cancellation window, letters only from attorney-approved
templates, no Social Security number or date of birth kept from an import,
only Texas open (Georgia never).

## The journey, step by step

Every client page in the console now opens with the **journey strip**
(Lead → Account → Agreement → Documents → Report → Their review → Round 1 →
Rounds 2+ → Finished): the current step in navy, the ones done in green.

| # | Step | Who does it | What the system does by itself | Where |
| --- | --- | --- | --- | --- |
| 1 | **Lead** | Sales answers the conversation (✨ Suggest reply, saved answers), qualifies, moves the stage | The lead autopilot greets and answers FAQs word for word, when an administrator turns it on. Leads arrive from WhatsApp, HighLevel (SSN/DOB dropped), partners, the chat signup, a CRC import, or by hand | `/equipo/leads` (3 Lead Manager) |
| 2 | **Invite** | Sales prepares the invitation (client's language) and sends it on WhatsApp | "Invited" sets itself on the lead | `/equipo/invitar`, or «Prepare their invite» on the client page |
| 3 | **Account and onboarding** | The client opens the link, verifies their phone, answers goal, state (Texas only), SSN-or-ITIN kind (never the number) | The prospect becomes a client; the salesperson and partner carry over | Client app `/onboarding` |
| 4 | **Agreement** | The client reads the statement of rights and signs (typed signature) | Reminders day 1 · 3 · 5, then a call card for a person. The cancellation window starts; **nothing** is mailed, pulled or charged inside it | Client `/acuerdo`; staff: Agreement card |
| 5 | **ID and documents** | The client uploads photo ID and proof of address (and other documents if they want: proof for a disputed item, a creditor's letter, court papers) | The AI's first look accepts what passes every check; the rest goes to a person. Reminders day 0 · 2 · 5 from the first working day | Client `/documentos` (Más → Mis documentos); staff: **Documents** card |
| 5b | **Document review** | Specialist or admin opens the file, **Accept**, or **Not accepted…** with a reason (the client reads it in their language) and "ask for another" | A required document not accepted counts as missing: no round goes with it, and the documents reminder starts again from the review | Staff client page → Documents |
| 6 | **Credit monitoring** | The client enrolls (IdentityIQ link with the commission disclosure). The team records what it saw: enrolled through our link, active / cancelled / unknown, the day and how | A report that arrives proves the monitoring was working. If the team found it **cancelled** and a report is due within 7 days, the monitoring reminder starts early with its own first message | Client onboarding step; staff: **Credit monitoring** card |
| 7 | **Report import** | A specialist imports the report (PDF or saved page through the AI reader, with a "what changed" preview) | Re-pulls after each round, when the provider allows it | Client page → Import report; Reports tab |
| 8 | **The client marks items** | **Only the client**: each item correct or inaccurate, with one of 14 reasons and a confirmation | Data checks shown as facts; reminders day 2 · 5 · 8 if the review stalls | Client `/items`, `/audit` |
| 9 | **Audit** | — | The audit page in plain words, printable | Client `/audit` |
| 10 | **Round 1 built** | — | Letters built from approved templates: personal info first, then disputes, with the client's reasons | Client page → Rounds and letters |
| 11 | **Review and send** | The team reviews «Ready to send» and sends (or lets automatic sending do it after the review window) | Every gate checked again on the server: agreement, window, attestation, addresses (Lob verification), documents, current report, billing | `/equipo/enviar` (send screen), `/equipo/imprimir` |
| 12 | **Mailed and tracked** | — | Lob (simulated without a key), first class or certified; tracking events; a returned letter is re-mailed once when the post office corrects the address; the client hears "letters mailed" and "delivered" | Client `/rounds`, `/caso`; staff letter timeline |
| 13 | **Results / next report** | — | The next report is due from the evidence (receipt + 30 + 5 days, at most 45 from mailing); what a later report no longer shows is recorded on the round | Client page; Reports tab |
| 14 | **Round 2+** | The client answers the new items; the team sends | Method-of-verification, furnisher and collector letters; same gates | Same as 10–12 |
| 15 | **Billing after the work** | Nobody charges by hand | Charges only for work recorded as done (a mailed round, a period with a round, a later report), after the window; retries day 3 and 7 with the «Update my card» link | Client `/pagos`; staff Billing card, `/equipo/cobros` |
| 16 | **Aftercare** | The client follows their build-your-credit plan | Plan from their own report, home-ready path, ITIN path; partner offers only if the owner turned them on | Client `/construir` |
| 17 | **Graduation** | The client chooses "Finish my program" | The service ends, billing stops (the database refuses a new charge), letters stop. The console shows the stage **Finished the program**, with nothing to do | Client `/caso`; staff stage chip |

### Who is who in the console

- **Administrator** (the owner): everything, including the import, the
  monitoring commissions and Accounting.
- **Specialist**: their assigned clients: reports, letters, replies, document
  review, monitoring checks. No billing changes, no import, no commissions.
- **Sales**: leads and invitations; sees the clients they brought in without
  the case (no report, letters or document review). May record a monitoring
  check for a client they brought in (they often help with the enrollment).

## Messages: what the client chooses

`src/lib/fulfillment/notifications.ts`, client screen **Más → Avisos**
(`/mas/avisos`), route `/api/notifications`, table `notification_settings`
(migration 0041). Staff see the same settings, read-only, in the
**Client's notifications** card on the client page.

| The client chooses | Effect |
| --- | --- |
| WhatsApp on / off, email on / off (at least one) | The autopilot uses only the channels the client kept (`channelsFor`), still WhatsApp first, still never SMS. If no kept channel can carry a message (e.g. WhatsApp only and the template is not approved outside the 24-hour window), the follow-up goes to a person, exactly as with no channel before |
| Progress updates on / off | Off: a queued "certified letter delivered", "new report", "next round ready" or review request is closed unsent (`client_settings`) |
| Reminders on / off | Off: no follow-up goes; the situation becomes a person's ("Turned reminders off in their notification settings: a person writes or calls instead") |
| Language | The language of every automatic message (the profile's `locale`, as before) |
| Stop all automatic messages | An opt-out record (`message_opt_outs`, channel `app`), the same as replying STOP; "Turn automatic messages back on" records START |

**Required notices** (cannot be turned off one by one): a payment receipt, a
declined payment, a missing payment method, letters mailed in the client's
name, and a letter re-mailed. They are what the client needs to know about
their money and the work done in their name. They still respect quiet hours,
the daily cap, dedupe and the channels the client kept.

**An opt-out wins over everything.** BAJA / STOP / the email link / a
teammate's note / «Stop all» stop every automatic message, required ones
included: the law gives the client that right (TCPA revocation). Those
notices then stay in the app (Mi caso, Mis pagos), and a person reaches the
client when something needs them. Question for the attorney below.

## Credit monitoring

`src/lib/fulfillment/monitoring.ts`, staff card **Credit monitoring** on the
client page, route `/api/staff/monitoring` (`action: "check"`), table
`monitoring_checks` (append-only).

- IdentityIQ gives us no status call (`docs/IDENTITYIQ.md`), so the status is
  evidence: the newest of **a person's check** (provider; enrolled through our
  link yes / no / unknown; active / cancelled / unknown; the day; how: the
  client said, the provider's partner portal, the commission statement, a new
  report, other) and **a report that arrived**. A report after the last check
  proves it was working that day.
- **The reminder rule.** When the newest evidence says *cancelled* and the
  next report is due within 7 days (after a mailed round: its re-pull date;
  otherwise the report's 45th day), the autopilot's existing
  `monitoring_inactive` reminder starts early, under the same key, with one new
  first message, `credalti_monitoreo_previo` ("your next credit report is
  needed around {date}, and our records show your credit monitoring as
  cancelled…"). Later steps are the usual ones. Same channels, quiet hours,
  daily cap, opt-out, holds and notification settings as every reminder.
  *Unknown* never messages anyone: the card says "check it" instead.

### Monitoring commissions (5 · Payments & Accounting → Monitoring)

`/equipo/monitoreo` (administrators, capability `monitoring.commissions`),
`src/lib/fulfillment/commissions.ts`, tables `monitoring_commissions` and
`monitoring_commission_imports`.

- Record a line by hand, or import the provider's statement CSV (columns
  detected by name and editable: IDIQ's statement format is not public, so
  **UNVERIFIED**). A file is imported once; the same line never twice; an
  SSN-like member id is never kept.
- **Reconcile per client and month**: *Paid*, *Expected, not paid* (the team
  recorded enrollment through our link and active monitoring), *Paid, no link
  enrollment on record* (update the client's monitoring), *Reversed*; lines
  without a client get a suggested match (same email or same full name) a
  person confirms.
- **The money rule** (`src/lib/accounting/ledger.ts`) counts money from
  elsewhere on the day it moved, from `other_income`. Automatic posting could
  count the same money twice (Accounting already lets a person type or import
  monitoring income), so posting is an explicit **reconciliation step**: "Post
  $X" adds ONE `other_income` row (kind `monitoring_commission`) for the month's
  unposted lines, dated the day the provider paid, and warns when Accounting
  already has monitoring income that month. A closed month refuses it (record
  an adjustment in Accounting). A posted line cannot be voided or re-matched.
- Amounts are read by administrators only (row level security): never a
  client, a partner, a specialist or sales. The commission disclosure on the
  client's monitoring step is unchanged.

## Documents

`src/lib/fulfillment/documents.ts`; client `/documentos` ("My documents" under
More, and the screen the documents reminder now opens); staff **Documents**
card; routes `/api/documents` (client) and `/api/staff/documents` (capability
`documents.review`); tables `client_files`, `document_reviews`, bucket
`client-files` (server only).

| Document | State |
| --- | --- |
| Photo ID, proof of address (every letter) | As before (`identity_documents`), now with a person's review |
| Identity theft report | As before, reviewable |
| **Proof for a disputed item**, **letter from a creditor or collector**, **court papers** | New: several of each, PDF/JPG/PNG checked by their first bytes. For the team's file; never put in a letter unless a person decides |
| **Power of attorney / authorization** | A slot that stays **off** until the attorney approves its text: `POA_VERSION` must equal `NEXT_PUBLIC_POA_APPROVED_VERSION` (the `docs/AGREEMENT.md` pattern). Off, the client is never offered it and the route refuses it |
| Social Security card | **Never stored.** The database refuses a new `ssn_card` row; no screen asks for one |
| A note that the team "saw proof of the SSN" | **Attorney-pending, off.** Nothing records it |

**Review.** Accept, or *Not accepted* with a reason (blurry, cut off, expired,
name or address doesn't match, too old, wrong document, unreadable, other with
words), an optional note in the client's language (checked by the same promise
rules as a staff reply; no SSN-like numbers) and "ask them to upload another".
Append-only. The client sees "Accepted" or the reason and an upload button.
A newer upload makes the old review out of date.

## Moving from Credit Repair Cloud

`/equipo/importar` (administrators, capability `clients.import`; section
4 Fulfillment & Clients), `src/lib/fulfillment/crcImport.ts`, route
`/api/staff/import`, tables `crc_import_batches`, `crc_import_rows`,
`crc_affiliate_invites`, `prospects.import_batch_id`.

1. In CRC: **Clients → the arrows icon → Export CSV** (the file is named
   `my_clients_<date>` even when filtered to leads). Affiliates: **Affiliates →
   Export**.
2. Upload it under Clients, Leads or Affiliates. **SSN, ITIN and date-of-birth
   columns are removed in the browser** before anything else (the same name
   rule as the HighLevel webhook) and again on the server; any SSN-like number
   in another column is blanked. The screen lists what was removed.
3. Check the columns. CRC's help center could not be reached from the build
   environment, so the names (First Name, Last Name, Email, Phone (Mobile),
   Phone (Home), State, Status, Assigned To, Referred By, Date Added…) are
   **not verified against a real export**: every field can be pointed at
   another column, and a column nobody maps is never stored.
4. The **dry run**: what will be created, **duplicates** (same phone or email
   as a lead, a client, a partner, or another row), **problems** (no name, no or
   non-US phone, no state, outside Texas, Georgia), **skipped** (inactive or
   cancelled in CRC unless you tick to include them).
5. Import. Clients and leads become **prospects** (source "Imported from Credit
   Repair Cloud", the CRC status kept as a note) assigned to the salesperson
   CRC named, or the importer. The log lists each person with **Send on
   WhatsApp** (the usual invitation message in the language chosen) and
   **Prepare invite**. They create their account, sign **Credalti's**
   agreement and go through the journey above. **Nothing is charged**: no
   charge can exist without a mailed round. Nobody is messaged until someone
   sends the invitation.
6. **Undo** removes the batch's people who were not invited and have no
   account; the rest stay, and the log says how many.

Affiliates become an invitation to apply as a Credalti partner: they must
accept Credalti's partner rules themselves (a partner row needs that), so the
import never creates an approved partner.

## The walkthrough (Nov 25, 2026)

Every role (administrator, specialist, sales, through "View as") and the
client, through the demo, at 1440 px and 390 px, English and Spanish.
Screenshots: `/tmp/claude-0/-home-user-creditrepair/0263697e-b2e8-52e9-8702-3c226fe16634/scratchpad/launch-ready/fulfillment/`.
No console errors and no sideways scroll on any screen visited, before or
after. What was found, and what was done:

| # | Where | Found | Fixed |
| --- | --- | --- | --- |
| 1 | Client page, every stage | No sense of where the client is in the whole journey; the page is long | The **journey strip** on top (the current step centred on a phone) |
| 2 | Client page, "Where they are" | "Needs to upload their ID and proof of address" when only one was missing | Names exactly what is missing or was not accepted |
| 3 | Clients list and client page | Signed clients with **nobody working the case** (e.g. a round 4 ready and unassigned) looked like any other row: a slip waiting to happen | "Unassigned: needs someone" in the list; a note with what to do on the client page |
| 4 | A graduated client | Graduation records the end of the service, so the console showed a high-severity "Asked to end the service… confirm it with the client" and the next step "Confirm with the client that the service is ending": a false alarm for every graduate | New stage **Finished the program** (nothing to do), the agreement line "Finished the program on…", no automatic step; a demo graduate (Imelda R.) |
| 5 | Client page, report missing / monitoring | "Turn on their credit monitoring" / "Check their monitoring" with no information about the monitoring at all | The **Credit monitoring** card (status, how checked, next report due, record a check) and the early reminder |
| 6 | Client page, documents | A list of "On file / Missing" with no way to look at a file, accept it or ask for another; an SSN card listed as a document | The **Documents** card with Open, Accept, Not accepted… (reason the client reads), the other documents, and "never collected"; the SSN card removed from the demo and refused by the database |
| 7 | Client app | `/documentos` existed only as the "upload again" screen; no place listed the client's documents; the documents reminder opened the agreement page, which cannot show why a document was not accepted (a dead end) | "My documents" under More; `/documentos` lists every document with what the team said and upload buttons; the reminder opens it; the agreement page links to it |
| 8 | Client app, More | No notification settings (CRC row 🟡) | **Notifications** (`/mas/avisos`) |
| 9 | Monitoring commissions | No place to record or reconcile them (CRC row 🟡) | `/equipo/monitoreo` |
| 10 | Moving from CRC | No import (gap #2 in `docs/VS-CRC.md`) | `/equipo/importar` |
| 11 | Monitoring card | A report date already past read "Next report due" | "Report expected since" |
| 12 | Document review form | The note's language was not said, so a note could be written in the member's language for a client who reads the other | The form shows the client's language and the preview is in it |

Checked and fine as they were: the send screen (every gate shown), the print
screen, autopilot settings, invoices, the client's agreement, review, audit,
letters, rounds, case and payments screens; specialist and sales see only
their clients ("We couldn't find this client" for the others) and the pages
their role may open.

## What needs the owner

- Export the CRC clients, leads and affiliates and run the import once in a
  test project; confirm the detected columns and tell us the real header row
  so the aliases can be marked verified.
- An IdentityIQ partner statement (CSV) to confirm its columns and how
  reversals are written.
- Approve the WhatsApp template `credalti_monitoreo_previo` (en_US and es_MX)
  in Meta along with the others (`docs/AUTOPILOT.md`).
- Apply migration `0041_fulfillment.sql` (or `supabase/setup.sql`); the bucket
  `client-files` is created by it.

## Questions for the attorney

1. **Required notices after an opt-out.** We stop every automatic message
   after STOP / BAJA, required ones included, and keep them in the app. Is
   that right, or must a receipt or a notice about a charge still be sent
   (and by which channel) after a revocation?
2. **Which notices may a client turn off?** We treat receipts, payment
   notices and "letters mailed in your name" as required, and progress
   updates and reminders as optional. Confirm the split.
3. **Power of attorney / authorization.** Draft the text (version
   `POA_VERSION`); confirm whether a Texas CSO may hold one and what the
   bureaus accept. The slot is off until then.
4. **Proof of SSN.** May the team record that it saw a document proving the
   SSN (without keeping it)? Off until answered; we never keep an SSN card.
5. **Imported CRC clients.** They signed CRC-era agreements with the owner's
   other company; we treat them as new prospects who sign Credalti's agreement
   and pay nothing until new work is done. Confirm nothing from the old
   agreement carries over, and whether a notice to them is needed.
6. **Monitoring referral fees** (`docs/IDENTITYIQ.md`): the disclosure wording
   on the monitoring step.

## Not done

- Nothing here has run against a real CRC export or a real IDIQ statement;
  both column lists are UNVERIFIED and editable on screen.
- In the demo, a commission "post" marks the lines but does not change
  Accounting's example books (they are a separate demo store); with a
  database it writes the `other_income` row.
- Staff do not change a client's notification settings (by design: the client
  decides); a teammate can still record an opt-out on the autopilot card.
- The send route (`rounds/send.ts`) was not changed: it still checks that the
  two documents are on file. A document a person did not accept is held by
  the console's and the autopilot's own rule (`missingDocuments`), which
  decides what is offered for sending and what goes by itself.
