# Referral partners

Realtors, loan officers and tax preparers meet people who need help with their
credit before a mortgage, a car or a tax refund. Credit Repair Cloud calls them
affiliates; we call them **socios**. A partner refers; the team does the rest.

Code: `src/lib/partners/` (rules, copy, QR, demo, metrics, server),
`src/app/socios` (public application), `src/app/socios/portal` (partner
portal), `src/app/equipo/socios` (staff), `src/app/r/[code]` (the link),
`src/app/api/partners/*`, `src/app/api/staff/partners`. Database: migration
`0017_partners_highlevel.sql`.

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
- A partner writes nothing directly; the portal's two actions go through the
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
