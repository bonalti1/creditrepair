# Referral partners

Realtors, loan officers and tax preparers meet people who need help with their
credit before a mortgage, a car or a tax refund. Credit Repair Cloud calls them
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

## How it works

1. **Apply** at `/socios` (Spanish, with an English toggle): name, company,
   what they do, phone, email, state, and the partner rules accepted. It becomes
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
   - **their referrals**, each with a first name, last initial, date and one of
     four statuses: *Contactado*, *Firmó*, *Activo*, *No siguió*;
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
  `partner_referrals()`: first name, last initial, date and the coarse status
  of the people they referred.
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

The statuses (the same in `src/lib/partners/rules.ts` and the SQL function):

| Status | Meaning |
| --- | --- |
| Contactado | Sales is in touch, or they have an account without a signed agreement |
| Firmó | Signed the service agreement; no round mailed yet |
| Activo | At least one round mailed and the service goes on |
| No siguió | Cancelled, asked to end the service, or sales closed them |

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
- **Escribir al equipo**: a note on the client in the staff console
  (`staff_notes`, author "Socio · <name>"), read by whoever may see the client
  (the assigned specialist); never shown to the client unless staff choose to
  reply to them. Only about a client who currently shares.

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
