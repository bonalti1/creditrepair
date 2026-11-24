# Referral partners

Realtors, loan officers, tax preparers, car dealers, attorneys and others meet
people who need help with their credit before a mortgage, a car, a tax refund
or a fresh start. Credit Repair Cloud calls them
affiliates; we call them **socios**. A partner refers; the team does the rest.

Code: `src/lib/partners/` (rules, copy, QR, demo, metrics, server),
`src/app/socios` (public application), `src/app/socios/portal` (partner
portal), `src/app/equipo/socios` (staff), `src/app/r/[code]` (the link),
`src/app/api/partners/*`, `src/app/api/staff/partners`. Database: migration
`0017_partners_highlevel.sql`.

Client sharing and the commission switch (below): `src/lib/partners/sharing.ts`
(levels, consent text and hash, the partner's stage and timeline),
`sharingCopy.ts`, `terms.ts`, `program.ts`, `logo.ts`, `sharingServer.ts`,
`sharingDemo.ts`; `src/app/(app)/mas/compartir` (the client's page),
`src/app/socios/portal/cliente/[id]` (a client, as the partner sees them),
`src/app/conoce/[code]` (the "Cómo funciona" page), `src/app/api/sharing`,
`src/app/api/partners/{portal,clients/[id],public}`,
`src/app/api/cron/partners`. Database: migration `0023_partner_sharing.sql`.
Tests: `src/lib/__tests__/partnerSharing.test.ts` and
`src/lib/__tests__/db/partnerSharing.test.ts` (row level security).

The partner portal's dashboard, "who is taking care of your client", "ask to
follow progress", the notes with the team, the weekly summary and the partner
kit (below, "The partner portal"): `src/lib/partners/portal.ts` (pure rules
and words), `portalCopy.ts`, `portalServer.ts`, `portalDemo.ts`,
`PartnerLocaleProvider.tsx`; `src/components/partners/PortalPipeline.tsx`,
`PartnerKit.tsx`, `PartnerFlyer.tsx`, `ShareRequestCard.tsx`,
`ReferredShareOffer.tsx`, `PartnerClientContent.tsx`;
`src/components/staff/PartnerThreadCard.tsx`; `src/app/conoce/[code]/imprimir`
(the flyer), `src/app/api/staff/partner-notes`. Database: migration
`0033_partner_portal.sql`. Tests: `src/lib/__tests__/partnerPortal.test.ts`
and `src/lib/__tests__/db/partnerPortal.test.ts`.

## How it works

1. **Apply** at `/socios` (English first, Spanish one tap away): name, company,
   what they do (real estate agent, loan officer, tax preparer, car dealer,
   attorney, or other), phone, email, state, and the partner rules accepted. It becomes
   a *pending* partner. Nothing is granted yet.
2. **An administrator approves** on `/equipo/socios`. Approval gives the
   partner a referral code (`laura-benitez`) and link (`/r/laura-benitez`), and
   the administrator sets the salesperson who follows their referrals and the
   commission terms. Sales can see the list; only an administrator approves,
   suspends, sets commissions and records payments.
3. **The partner signs in** like everyone (phone code or email link) with the
   phone or email they applied with. The first sign-in links their account to
   the approved partner. They land in the **portal** (`/socios/portal`):
   - their link, a copy button and a **QR code** (drawn as SVG in the app,
     `src/lib/partners/qr.ts`, no library; checked against an independent
     decoder during development);
   - **Enviar un referido**: first name, last name, phone, and a checkbox that
     the person agreed to be contacted on WhatsApp (stored with the prospect);
   - **their pipeline and their people** (below, "The partner portal"): each
     referral with a first name, last initial, date, the step (*Referred*,
     *Contacted*, *Signed*, *Active*, *Finished*, or *Did not continue*), who
     on the team looks after them and when sales reached out;
   - the **commission** an administrator recorded (registered, paid, balance);
   - the rules, again.
4. **Sales follows up** the referral like any prospect: it appears in `/equipo`
   with "Socio · <name>" as its source, and **Preparar su invitación** builds the
   usual link, which also carries the partner's code (`p=`).

## Attribution

A person is credited to a partner in one of four ways. **First touch always
wins**: once a prospect or a client has a partner, nothing replaces it.

| Way | How |
| --- | --- |
| The partner sends them from the portal | The prospect is created with the partner (`prospects.partner_id`) |
| A HighLevel lead carries the partner's code | The workflow sends `partnerCode` (`docs/HIGHLEVEL.md`) |
| The person opens the partner's link | `/r/<code>` sets a cookie; if they create an account in that browser, the partner is credited |
| The invitation link carries the code | `p=<code>` in the link sales sends, saved at sign-up |

When a prospect creates an account, their partner and HighLevel contact carry
over to the client (`profiles.referred_partner_id`). Only an **approved**
partner's code credits anyone. A client's own connection cannot set or change
the partner (a database trigger refuses it).

**The cookie.** `/r/<code>` sets `credalti_socio=<code>`: first-party, 60 days,
path `/`, SameSite=Lax, Secure in production. It is not HttpOnly because it
holds only the public code. It is read once, when that browser's person signs
up. Someone who opens the link and then writes on WhatsApp is not credited
automatically unless the HighLevel funnel captured the code (set
`PARTNER_LANDING_URL` to the funnel: the link lands there with `?socio=<code>`)
or the salesperson's invitation carries it. The privacy notice should mention
this cookie.

## What a partner can and cannot see

Enforced in the database (row level security, migration 0017), not only on the
screen:

- **Can:** their own partner row, their own commission records, and
  `partner_referrals()` (rebuilt in migration 0033): first name, last initial,
  date and the coarse step of the people they referred, when sales first
  reached out (the invitation), the first name and role of the teammate who
  looks after them, whether they have an account, when the partner last asked
  them to share, and the client id only while they share.
- **Cannot:** any profile, prospect row, report, report item, answer, letter,
  round, agreement, document, conversation, charge or payment method — of
  their referrals or anyone else. Not another partner. Never a client's score,
  never what a client pays. A partner is not staff: none of the staff read
  policies apply to them.
- **With the client's consent only** (migration 0023, "Client sharing" below):
  the client's name, stage, milestone dates and goal, and at the top level two
  counts, through `partner_clients()` and `partner_client_view()`. Nothing
  more, ever, and nothing at all without consent.
- A partner writes nothing directly; the portal's actions go through the
  server.
- A suspended partner loses the portal and the link stops crediting at once.
- The referral form answers the same whether the person was new or already in
  touch, so it cannot be used to learn who is a client; someone already in
  touch is not credited to the partner.

The statuses, the partner's pipeline (the same in `src/lib/partners/rules.ts`
and the SQL function of migration 0033):

| Status | Meaning |
| --- | --- |
| Referred | A lead the team has not reached yet: no invitation sent, no account |
| Contacted | Sales sent the invitation, or they have an account without a signed agreement |
| Signed | Signed the service agreement; no round mailed yet |
| Active | At least one round mailed and the service goes on |
| Finished | Finished the program (graduation, `program_completions`); after-care goes on |
| Did not continue | Cancelled, asked to end the service, or sales closed them |

Graduation also records the end of the service; the function checks it first,
so a graduate reads *Finished*, never *Did not continue*.

## Commissions

**"Comisiones a socios" is OFF** until an administrator turns it on in
`/equipo/socios`, which asks for the attorney who approved it, the date, and a
box confirming the approval in writing (RESPA Section 8, Texas Finance Code
ch. 393). Each change is a row in `partner_program_changes` (append-only, with
who and when). While it is off:

- no commission terms can be set and no amount can be recorded: the route
  refuses, and so does the database (triggers on `partners` and
  `partner_commissions`), whatever the server sends;
- partners see no commission figures; the portal, the signup page, the partner
  terms and the "Cómo funciona" page say the program pays no referral fees
  ("Por ahora, el programa de socios no paga comisiones por referir."), and the
  disclosure line ("Recibo una comisión…") is not shown;
- the business dashboard's Socios section shows no commission figures.

When it is on, the rules below apply.

Stored, not paid. An administrator sets the terms per partner
(`partners.commission_basis`, `commission_cents`):

- **Sin comisión**;
- **Por cliente que firma** su acuerdo;
- **Por cliente activo** (first round mailed).

**Never per result**: there is no option to pay for an item that leaves a
report, a score that changes or an approval, here or in the database (a check
constraint). Amounts owed or paid are **recorded by hand** in
`partner_commissions` (append-only, with who recorded them); the app does not
calculate or pay commissions. The business dashboard (`/equipo/negocio`) shows
a **Socios** section: referrals, signed, active today, commission recorded and
paid, each with its definition, all from these records.

## The rules partners accept

Shown on `/socios` and in the portal (`src/lib/partners/copy.ts`, ES and EN,
checked by the advertising claim rules in the test suite):

1. Do not promise results: no points, no dates, no credit approvals. The bureaus
   decide and results vary.
2. Do not ask for or keep Social Security numbers, dates of birth or credit
   reports. Each person gives their details in their own account.
3. Refer only people who agreed to be contacted.
4. Your commission never depends on what happens on a credit report.
5. If you promote us, say that you receive a commission for referring
   ("Recibo una comisión si te refiero a Credalti.").
6. Do not charge the person anything for the referral. The team explains the
   plan and its price, in writing.

A partner who breaks them is suspended (the record and their name stay).

## Client sharing: a partner follows a client's progress, if the client wants

Lenders and realtors want to know their client is in good hands. A client can
let the partner who referred them, or one they add by the partner's code,
follow their progress. **It is the client's choice, off by default, revocable
at any time, effective immediately.**

### The choice

Shown on the referred client's welcome (the onboarding, when the link carries a
partner's code: "Te recomendó María López, ABC Realty", with the partner's logo
once an administrator approved it) and any time later in **Más → Quién puede
ver tu progreso** (`/mas/compartir`):

| Level | The partner sees |
| --- | --- |
| **No compartir** (default) | Only the coarse referral status of migration 0017 (Contactado / Firmó / Activo / No siguió) |
| **Solo el avance** | The client's full name; their stage in plain words; milestone dates (agreement signed, the day the team may start, documents complete, review finished, each round mailed, the bureaus' ~30 days to answer, the next round expected); the client's goal if they gave one ("Comprar una casa") |
| **Avance y resumen** | The above, plus two counts: items disputed in the current round, and disputed items that no longer appear on the most recent report. Counts only, never which items; never a percentage |

**Never, at any level:** credit scores, report items, creditor names, account
numbers, amounts, letters, documents, SSN or date of birth, address, payments,
chat, the client's answers or reasons.

The screen shows, for the option selected, exactly what the partner **will**
and **will never** see, and a preview of the partner's screen built from the
client's own case. A client can add a partner who did not refer them by typing
the partner's code; the same choice and text follow.

**Home-ready milestones (migration 0030, `docs/AFTERCARE.md`).** A client may
also let a real estate agent or loan officer see their home-buying milestones
(names and dates: documents, review, disputes, and the steps the client marks
themselves; graduation). It is the same consent record with `home_ready` on
and one more "will see" line, hashed with its own version; read only through
`partner_home_ready()`. "Connect me with a loan officer" sends the client's
name, phone and goal to the chosen partner with their consent
(`loan_officer_requests`, `partner_intro_requests()`).

### How consent is recorded

Like the service agreement (`src/lib/agreement`): the consent text is
versioned (`SHARING_CONSENT_VERSION`) and the browser sends the SHA-256 of the
words on screen (version, language, level, and the text with the partner's
name). The server recomputes it from the partner's name in the database and
refuses a choice made on other words. A **revocation** always goes through (the
server words it), so stopping is never blocked by a stale screen.

Every grant, change and revocation is a row in `partner_share_consents`:
append-only, with the level, the previous level and the kind of change (filled
in by a trigger, never trusted from the caller), how the partner is connected
(`referred`, checked against the profile by the database; or `added_by_code`),
the text's version and hash, the language and the partner's name as shown. The
current level is the newest row; there is no second copy to disagree with it.
The database refuses a grant to a partner who is not approved, the same level
twice, and any edit or delete.

### Enforced in the database

A partner reads a client only through two functions (migration 0023), on their
own connection:

- `partner_clients()`: the clients whose newest record is not "none", for
  "Mis clientes";
- `partner_client_view(client)`: one client's page, and it **writes the view to
  `partner_view_log` in the same call**: a page that is returned is a page that
  is logged.

Both return only the columns above (the counts only at "Avance y resumen") and
nothing at all unless the partner is approved and accepted the current partner
terms. A partner has no read policy on any table of the case, the consent
records or the view log. The internal function behind both is not granted to
anyone. Suspending a partner cuts everything at once (`partner_id()` is null
for a partner who is not approved). The PGlite tests prove each of these,
including crafted queries on every case table.

### Partner terms

On first opening the portal (and again for a new `PARTNER_CLIENT_TERMS_VERSION`,
which the database also knows) a partner accepts short terms, an
**attorney-pending draft** (`src/lib/partners/terms.ts`): confidentiality of
client information, no promises of results, no collecting SSNs or reports, no
pressuring clients, the fee clause (per signed/active client only; or, while
commissions are off, that the program pays no referral fees and that they
accept nothing of value for a referral), and that sharing is the client's
choice and may be revoked. Recorded in `partner_terms_acceptances` with the
version, language and hash of the text shown.

### The view log

Each view of a client's page: who (the partner and their sign-in) and when.
The client sees it on their page ("Laura vio tu avance el 3 de diciembre");
administrators see it on `/equipo/socios`. Nobody else, and not the partner.

### Mis clientes, notices and "Escribir al equipo"

- **Mis clientes** (portal): each consenting client with the one-line status and
  the next date; the client page shows "Compartido por el cliente el …", the
  level, the stage, the timeline, and the counts at "Avance y resumen".
- **Notices** (opt-in, the partner's choice), in the partner's language
  (`partners.locale`, migration 0024: the language of the page they applied
  on, then of their portal; English unless Spanish): WhatsApp (approved
  template `credalti_socio_avance`, en_US "Hi, {{1}}. {{2}} More details in
  your Credalti partner portal." and es_MX "Hola, {{1}}. {{2}} Más detalles en
  tu portal de socios de Credalti.") or email (the portal is the unsubscribe link); never
  SMS; never in quiet hours (21:00–8:00 where the partner works); each
  milestone of each client once (`partner_notices`, unique dedupe key claimed
  before sending); only milestones from the last 3 days and after sharing
  began; the words carry only what the partner may see anyway. Run by
  `POST /api/cron/partners` with the shared secret.
- **Write to the team**: since migration 0033, a two-way thread on the
  client's page (below, "Notes with the team"). It used to be a one-way note in
  `staff_notes`; notes written before stay there.

### Co-branding

The referred client's welcome shows the partner's name and company, and their
logo once an administrator approved it (`/equipo/socios` → Logos por revisar).
The logo is a small PNG, JPEG or WebP the partner uploads, checked by its
bytes (no SVG) and kept as a data URL, so the client's page never loads
anything from another server. The partner also gets a shareable one-page
**"Cómo funciona Credalti"** (`/conoce/<code>`, ES/EN) with their name; its
copy passes `checkMarketingCopy` and says plainly whether the partner is paid
for the referral.

### Staff

`/equipo/socios` shows which clients share with which partner, at what level
and since when (administrators and sales), the view log (administrators), the
logos to review, the "Comisiones a socios" switch, and suspension, which cuts
all of a partner's access at once.

## The partner portal (migration 0033)

The owner's goal: partners (realtors, lenders, anyone who refers) feel their
clients are in good hands and see their status. Built on everything above; the
consent model, the levels and the "never" list are unchanged.

### English first

`/socios`, the portal, a client's page, `/conoce` and the flyer start in
English and are fully in Spanish one tap away (the site's locale system,
`src/lib/i18n`). A signed-in partner's own pages start in the language they
saved (`partners.locale`) unless this device chose one: `PartnerLocaleProvider`
passes it as the first render's language (`detect.ts` keeps a server choice
read from a saved language). Their notices, summaries and the consent text
stored with a referral are in that language. The copy files list English
first (`copy.ts`, `sharingCopy.ts`, `portalCopy.ts`; a test checks).

### The dashboard

`/socios/portal`, phone first, two columns on a wide screen:

- **Your pipeline**: five tiles, Referred → Contacted → Signed → Active →
  Finished, with counts; "N did not continue" beside them. A tile is a toggle
  button (`aria-pressed`) that filters the list.
- **Your people**: each referral, and each client who added the partner by
  code. Per row, only what that person's consent allows:
  - *Don't share* (default): first name and last initial, the step and its
    words. Never more.
  - *Progress only* / *Progress and summary*: their full name, their stage in a
    sentence and the next date, and a link to their page.
  - Always (the team's own facts, not the client's): **who is taking care of
    them** ("Ana · Credit specialist, Credalti team": the assigned specialist,
    else the teammate the lead was given to, else their salesperson; first name
    and role only), "Referred Nov 24" and **"Contacted Nov 24, 3:03 PM"** (the
    first time sales sent the invitation, `prospects.invited_at`), or "The team
    reaches out within 1 business day" while nobody has yet.
  - **Ask to follow progress** (below), or "Requested on <date>", or "They can
    choose to share once they create their account".
- **How the team takes care of your clients**: the team's promise in process
  words (`TEAM_PROMISE`, `portal.ts`): a person reaches out to each new
  referral and answers the client's questions within 1 business day, the client
  decides what to dispute, nobody can promise results.
- **Share Credalti** (the partner kit), the referral form, notices and the
  weekly summary, the logo, commissions or "no referral fees", the rules.

### Who is taking care of your client

On the client's page, from `partner_client_care(client)`: the assigned
teammate's first name and role, only while the client shares, only for an
approved partner with current terms. Role words: Team lead, Credit specialist,
Enrollment advisor (`CARE_ROLE_LABEL`). Two lines of the promise under it.

### Ask to follow progress

A partner asks a person they referred, who has an account and does not share,
to share their progress:

- The partner sees what the person will receive and confirms; then only
  "Requested on <date>".
- The client gets **a card on their home** ("Laura asked to follow your
  progress. It is your choice…", *See what they would see* / *Not now*) and
  **one message**: WhatsApp (approved template `credalti_socio_pide_avance`,
  en_US "Hi {{1}}, {{2}} asked to follow your progress with Credalti. It is
  your choice: nothing is shared unless you turn it on, and you can stop any
  time. To decide, open your app: More, then Who can see your progress." and
  the same in es_MX) or email (with the signed unsubscribe link); never SMS.
  Not to a client who opted out (skipped; the card still shows), never in quiet
  hours on the client's clock (it waits for the hourly partner cron), sent once
  (claimed queued → sending before sending).
- The client decides on **More → Who can see your progress**, which says
  "Laura asked on November 24…" and opens that partner's choice, off by
  default, with the consent of migration 0023 (versioned text, hash,
  append-only record). The card goes away once they choose, tap *Not now*
  (recorded), or after 14 days.
- **Rules held by the database** (`partner_share_requests`): only the partner
  who referred the client, only while approved, never to a client who already
  shares, at most one request per client every 14 days, never edited or
  deleted (only *Not now* once, and the message's delivery forward). The client
  reads their own requests; staff by the client's scope; a partner never reads
  the table.

**In the signup flows:** `/onboarding` with a partner's code already offered
the choice. `/registro` (the chat) now does too: once the person is signed in,
before their documents, `ReferredShareOffer` shows the same `ShareChoice` with
*Don't share* selected, the consent text and the preview; a choice is
recorded through `/api/sharing` like any other; *I'll decide later* moves on.

### Notes with the team

On a client who shares, the partner's page has **Notes with the team**: the
partner writes, the team answers, both see the thread. In the console, the
client's page has **Notes with the partner** (`PartnerThreadCard`, any role
that follows up the client: `clients.followup`, and only for clients the
member may see), with a reply box.

- `partner_team_notes`, append-only. The database refuses a note while the
  client does not share with that partner, from anyone but the partner's own
  sign-in or an active teammate in the role written, and any edit.
- Read by staff under the client's scope; by the partner only through
  `partner_team_thread(client)` (only while sharing; revoked, the thread is
  gone at once and comes back if they share again); **never by the client**.
  To tell the client something, staff write in the client's conversation.
- Both sides pass the same checks before sending, on the screen and again on
  the server (`teamNoteProblems`): the staff reply claim rules (no promises of
  results, points, dates or approvals) and no credit data (scores, amounts,
  account or long numbers, Social Security numbers, dates of birth).

### Weekly summary (opt-in)

In **Progress notices**: *Weekly summary* Off / WhatsApp / Email
(`partners.digest_channel`, off by default; never SMS). On Mondays from 9:00
on the partner's clock, outside quiet hours, once per partner and ISO week
(`partner_digests`, claimed before sending), only weeks with news: the last 7
days' milestones of clients who share, since they began sharing, in the same
words as the milestone notices. WhatsApp template `credalti_socio_resumen`
(en_US "Hi, {{1}}. Your weekly Credalti summary: {{2}} More details in your
Credalti partner portal.", es_MX likewise) or email with the portal as the
unsubscribe link. Run by the same `POST /api/cron/partners` (hourly is
enough), which also sends share-request messages that waited for quiet hours.

### The partner kit

**Share Credalti** on the portal: the link and its QR code; **ready-to-send
messages** (a WhatsApp text, an email and a social post, in English and in
Spanish, each with the link and the fee line: "I receive no payment for
recommending Credalti." while commissions are off, the commission disclosure
when on; worded for the partner's kind, never realtor-only; every line passes
`checkMarketingCopy`, no "free", no outcome); the **printable flyer**
(`/conoce/<code>/imprimir`: their name and approved logo, Alti in the
thumbs-up pose labelled "Alti · AI assistant", the QR code, the process and
the fee line; print styles fit one Letter page; AltiBot never appears); and
the "How Credalti works" page.

### Partner types

`realtor`, `loan_officer`, `tax_preparer`, `car_dealer`, `attorney`, `other`
(the database check, the application form, the labels and the kit). The
website's partner page names all of them. Home-ready milestones remain only for
real estate agents and loan officers (migration 0030).

### Demo

Without a database the portal shows the invented partner Laura: her pipeline,
who looks after each person (the demo team), contact times, an example thread
with Marta, and "you" (this device's own demo case, which Laura referred):
asking on the portal puts the card on this device's home, and a choice made on
`/mas/compartir` shows on the portal at once. Requests and notes are kept in
this browser, shared by the portal, the client app and the staff console.

### For the owner

1. Confirm the promise "within 1 business day" (`TEAM_RESPONSE_BUSINESS_DAYS`
   in `portal.ts`), or change it there; it is shown to every partner.
2. Approve the WhatsApp templates `credalti_socio_pide_avance` and
   `credalti_socio_resumen` in Meta (en_US and es_MX) and add them to
   `WHATSAPP_APPROVED_TEMPLATES`; until then those messages go by email or are
   skipped (the client's card still shows).
3. The partner cron (`/api/cron/partners`) should run hourly for the summary.
4. "Contacted" is the invitation time. If sales first reaches out another way
   (a call, a HighLevel message), record it with *Sent the invitation* or the
   partner sees "The team reaches out within 1 business day".

## Questions for the attorney

- **RESPA Section 8** (12 U.S.C. § 2607): whether paying a real estate agent or
  a loan officer for a referral is a prohibited kickback when the person is (or
  will be) in a federally related mortgage transaction, and whether paying only
  per signed client, a flat fee, or nothing at all to those two kinds of
  partner is the safe course. Until answered, consider "Sin comisión" for
  realtors and loan officers.
- **Texas credit services organizations** (Finance Code ch. 393): whether a
  referral fee to a partner is allowed, whether the partner then acts as a CSO
  or must be disclosed in the client's contract, and whether any part of the
  fee must be disclosed to the client.
- **CROA**: that no partner is paid in a way that amounts to charging the client
  before the service is performed, and that partners say nothing misleading.
- **FTC Endorsement Guides** (16 CFR Part 255): the wording and placement of the
  commission disclosure for partners who promote Credalti, and our duty to
  monitor what they post.
- Licensing rules of each kind of partner (real estate commission, NMLS, tax
  preparer standards) on accepting referral fees.
- The consent checkbox partners tick for a referral, and whether we must
  re-confirm consent with the person on the first WhatsApp message.

About client sharing (migration 0023):

- **GLBA / privacy** (Gramm-Leach-Bliley Act, Regulation P, the FTC Privacy
  Rule): showing a client's name, stage, dates, goal and counts to a partner is
  sharing nonpublic personal information with a nonaffiliated third party.
  We rely on the client's explicit, revocable opt-in consent. Confirm that the
  consent wording in `src/lib/partners/sharing.ts` (`consentText`) is enough,
  whether our privacy notice must describe it, and whether partners need a
  written confidentiality agreement beyond the partner terms (re-use limits,
  16 CFR 313.11).
- **FCRA**: we believe this is not a consumer report: we are not a consumer
  reporting agency, nothing from the credit file is shared, and the two
  counts (items disputed in the current round; disputed items no longer on the
  most recent report) describe our service's activity, not the consumer's
  creditworthiness. Confirm that the counts do not make what a partner sees a
  consumer report, especially for a loan officer who might weigh it in a
  credit decision; consider limiting "Avance y resumen" for loan officers, or
  adding to the partner terms that they may not use it for any credit
  decision (the terms already say "no lo uses para tomar decisiones sobre el
  cliente").
- **CROA and Texas CSO** (Finance Code ch. 393): that partner sharing and the
  partner's page contain no representation about results; that no partner
  acts as a credit services organization by following a client; whether the
  client's contract or disclosures must mention the partner relationship.
- **RESPA Section 8** for lenders and realtors: the program pays no referral
  fees until the attorney approves ("Comisiones a socios" off). Confirm also
  that the portal itself, milestone notices and co-branding are not a "thing of
  value" given to a settlement service provider in exchange for referrals, and
  whether a realtor or loan officer may give us anything (marketing, events)
  without crossing Section 8.
- **State privacy laws**: Texas (TDPSA, which exempts GLBA-covered data) and
  the other states we may serve (for example California's CCPA/CPRA and
  CalFIPA, which can require opt-in consent for sharing financial
  information); whether the consent and the view log satisfy them.
- **Partner terms** (`src/lib/partners/terms.ts`, attorney-pending draft): the
  confidentiality, no-promises, no-SSN, no-pressure and fee clauses, and
  whether an electronic acceptance with the text's hash is enough.

About the partner portal (migration 0033):

- **The request to share** (a partner asks their client): is one message on
  the client's channel, plus a card in the app, consistent with "no pressure"
  and with TCPA/CAN-SPAM for an existing client (it goes as a service message,
  honours opt-outs and quiet hours)? Is once every 14 days the right limit?
- **The team's name and role, and the contact time, at the default level**:
  we treat who on our team looks after a person and when we reached out as our
  own facts, shown even when the client shares nothing. Confirm this is not
  nonpublic personal information that needs the client's opt-in (GLBA), or
  hide it behind consent.
- **Notes with the team**: a channel between a partner and the team about a
  client who shares. Any duty to keep or disclose them, and whether staff may
  answer a loan officer's questions there without the client's further consent.
- **The partner kit and the flyer**: FTC Endorsement Guides wording of the fee
  line ("I receive no payment for recommending Credalti"), and whether partners
  who are attorneys or car dealers raise state rules on referral relationships.
- **RESPA Section 8**: the kit, the flyer and the weekly summary are given to
  every partner at no charge; confirm they are not a thing of value exchanged
  for referrals.
