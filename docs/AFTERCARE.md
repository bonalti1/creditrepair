# After-care: building credit, the home-ready path, ITIN clients, graduation

Credalti does not stop at disputes. Every client, from day one, gets a short
plan to **build** credit toward their goal (most often buying a home), and
clients other companies handle poorly, especially **ITIN holders**, get a
path that fits them. Everything here is general information, free, and **not
part of the paid service** (see "Attorney questions").

Code: `src/lib/aftercare/` (plan, sources, homeReady, itin, offers, connect,
graduation, server, useAftercare), `src/app/(app)/construir` (`/construir`,
`/construir/casa`, `/construir/itin`), `src/components/aftercare/`,
`src/app/api/aftercare`, `src/app/api/staff/offers`, `src/app/equipo/ofertas`,
`src/components/staff/AftercareCard.tsx`, `src/components/partners/PartnerHomeReady.tsx`.
Database: migration `0031_aftercare.sql`. Tests:
`src/lib/__tests__/aftercare.test.ts`, `src/lib/__tests__/db/aftercare.test.ts`.

## What the client sees

| Where | What |
| --- | --- |
| Home and Más → **Construye tu crédito** (`/construir`) | Six habits, ordered by the client's own report and goal: pay on time (autopay), keep card balances low (under 30%; under 10% where possible, with the Aprende calculator), keep the oldest accounts open, add positive accounts carefully (secured card, credit-builder loan, rent and utility reporting, authorized user: how it works, pros, cons, cost, what changes with an ITIN), apply only when needed (the 45-day mortgage window), check reports regularly. Each has "Why it matters", "What to do", sources with the day checked (or "Pending review"), and **Mark as done**. Blue notes are facts from the client's report ("your open cards use $480 of $1,500: about 32%"), never a prediction. |
| `/construir` → **Partner offers** | Only when the owner turned the marketplace on. Optional, "not part of your service", listed from lowest to highest cost to the client, then by name. An affiliate offer shows "Credalti may be paid if you sign up." and the owner's disclosure **before** its link (`rel="sponsored"`). |
| **Tu camino para comprar casa** (`/construir/casa`; linked when the goal is a home) | Six milestones: documents organized, report reviewed, disputes in progress (from the case), positive accounts in place, savings plan, talk to a loan officer (the client marks them). "What lenders usually look at": DTI, payment history and recent lates, collections, minimum scores by loan type (FHA, conventional), ITIN loans; each with sources and "Requirements vary by lender. A lender decides." Nothing compares the client's score with a minimum. **Share these milestones** with a partner real estate agent or loan officer; **Connect me with a loan officer**. |
| **Guía para ITIN** (`/construir/itin`) | Credit files under an ITIN; monitoring (ask our team: not confirmed); getting reports by mail; how letters handle the number; building credit and buying a home with an ITIN; ITIN-friendly offers only. |
| Onboarding | "Do you have a Social Security number or an ITIN?" after the state. Only the kind is kept. An ITIN client sees "With your ITIN: ask our team first" on the monitoring step. |
| Mi caso | **Graduation** (below). |

## Sources and what is verified

Checked on 2026-11-24 (`src/lib/aftercare/sources.ts`). As in Aprende, the
build environment cannot open these sites. **verified** = confirmed against
the page's own text through a web search restricted to that site; a person
should still open each link once before launch. **needs review** = found only
through a general search or secondary sources; the screen says "Pending
review".

| Fact | Source | Status |
| --- | --- | --- |
| Secured cards (deposit sets the limit; ask whether the issuer reports), credit-builder loans, authorized users as ways to build | CFPB ask-cfpb 2155 | verified |
| Credit-builder loans: $300–$1,000 held while you pay 6–24 months; helped people with no existing debt more | CFPB, Targeting credit builder loans | verified |
| Utilization = balances ÷ limits; many experts suggest under 30% | CFPB ask-cfpb 318 (as in Aprende) | verified |
| "Under 10% is often better" | common advice, no official page found | **needs review** |
| Mortgage checks within 45 days count as one inquiry | CFPB ask-cfpb 2005 | verified |
| Hard inquiries show about two years | CFPB ask-cfpb 1317 | needs review (as in Aprende) |
| An authorized user's record reflects the account's whole history | CFPB Data Point, Becoming Credit Visible (2017) | verified |
| Ask your landlord about rent reporting and its fees | CFPB Your Money, Your Goals booklet | verified |
| Utility payments usually not reported unless a service reports them | CFPB ask-cfpb 1817 | needs review |
| DTI definition | CFPB ask-cfpb 1791 (address from memory) | **needs review** |
| 43% General QM DTI limit replaced by price thresholds; planners suggest well under 43% | CFPB QM final rule page and blog | verified |
| FHA: 580+ for 3.5% down; 500–579 needs 10% | HUD Handbook 4000.1, via lender/consumer sites | **needs review** |
| Conventional: 620 for manual underwriting; DU has no fixed minimum for files from 2025-11-16 | Fannie Mae Selling Guide B3-5.1-01, via search and Orrick (2025-11-14) | **needs review** |
| ITIN mortgages: lender programs, usually non-QM, larger down payments (sources say 10–30%), some accept rent and utility history | NerdWallet and lender pages | **needs review** (no government source) |
| ITIN: IRS number for people who cannot get an SSN; 9 digits starting with 9 | IRS ITIN page, via secondary pages | **needs review** |
| SSN required to request the annual report online; without one, request in writing with ID and proof of address | Experian help, annual credit report | verified |
| Credit files can be built on name and ITIN; mail each bureau with the AnnualCreditReport.com form, DOB and two years of addresses | Experian blog, without an SSN | verified |
| AnnualCreditReport.com mail-in form; its FAQ accepts only an SSN online | annualcreditreport.com | **needs review** (site not reachable) |

## ITIN findings

- **Monitoring (IdentityIQ):** nothing public either way (searched 2026-11-24,
  as on 2026-11-19; IDIQ question 8 in `docs/IDENTITYIQ.md` is still open).
  The app never says it works: "We are still confirming whether our monitoring
  service accepts an ITIN. Ask our team before you sign up or pay." Set
  `NEXT_PUBLIC_MONITORING_ITIN=accepted` only after IDIQ confirms in writing.
  **For staff, not clients:** MyFreeScoreNow announced on 2026-04-29 (press
  release, BusinessWire) online 3-bureau reports and scores for consumers
  without an SSN; unverified, and it is not our partner, so the client copy
  says only "Some services now say they accept an ITIN. Our team checks which
  ones work." A provider is named in the app only with an agreement
  (`src/lib/monitoring/offer.ts`).
- **Reports:** a file can exist under an ITIN; AnnualCreditReport.com asks for
  an SSN online; ITIN holders mail each bureau (form, ID copy, proof of
  address). Bureau mailing addresses must be checked on each bureau's site
  before use (not hard-coded here).
- **Letters:** no letter template prints an SSN or its last four digits (a
  test renders every template for an ITIN client and checks for any 9-digit
  number or "Social Security"). The only SSN mention was an enclosure label:
  for an ITIN client an `ssn_card` upload is now "Copy of IRS letter assigning
  my ITIN" (`enclosureLabelFor`, used in `src/lib/rounds/send.ts`). If an
  identifier line is ever added to letters, it must read "ITIN ending in …"
  for ITIN clients and never print a full number.
- **Never stored:** `profiles.id_type` holds `ssn` or `itin` only. A test checks
  no table has a column for the number. Alti's replies are refused if they
  contain a 9-digit taxpayer number (`containsTaxpayerNumber`, `/api/coach`).
- **Alti:** the coach's instructions (full service) cover building credit,
  the home-ready topics and ITIN, with "requirements vary by lender", no
  recommendation of a product, no score comparison, "monitoring with ITIN is
  not confirmed: a person answers", and never ask for or repeat a number.
  Six approved saved answers (ES/EN: credit history with ITIN, reports by mail,
  letters never show the number); the monitoring question stays a person's.
- **Staff:** "ITIN client" chip on the client page and an After-care card with
  the reminder. **Partners never see the kind of number.**

## Partner offers

`/equipo/ofertas` (administrators, `partners.manage`): add or edit an offer
(name, type, provider, first-year cost to the client, cost note, https link,
ITIN-friendly yes/no, affiliate yes/no and its disclosure, active), the
**marketplace switch (off by default; append-only record)**, and which partner
loan officers **accept new clients**. Rules enforced in code and in the
database: no commission column exists; clients read offers only through
`client_offers()`, active ones while the switch is on, ordered by
`yearly_cost_cents, lower(name)`; an affiliate offer must carry its disclosure.

## Home-ready sharing and "Connect me with a loan officer"

- **Sharing** extends the 0023 consent, it does not fork it:
  `partner_share_consents.home_ready`. The client sees the same will / never
  text plus one line ("Your home-buying milestones and their dates … Never
  amounts, account details or scores."), hashed with its own version
  (`HOME_READY_CONSENT_VERSION`); the base text and hash are unchanged for
  everyone else. Only to a real estate agent or a loan officer (database
  check). A level change made on a screen that does not show the line records
  it off. A partner reads milestones only through `partner_home_ready()`:
  milestone names and dates, only while the newest record shares them, only
  approved partners with current terms; the client page logs the view first.
- **Introduction:** to the referring partner when they are a loan officer or a
  real estate agent, otherwise to a loan officer an administrator marked as
  accepting new clients (listed by name). The client reads what is sent (name,
  phone, goal; nothing from the credit file) and the disclosure (Credalti is
  not a lender; no obligation to use this loan officer; Credalti is not paid
  for the introduction; withdraw any time). Recorded in
  `loan_officer_requests` with the text's version and hash; one open request;
  the partner sees it in the portal through `partner_intro_requests()`.

## Graduation and billing

Mi caso offers **"Your disputes look done"** when the review is finished and
either nothing was marked or the latest round's response window passed with
no marked item still on the report; otherwise a quiet **"Finish your
program"** below the timeline (after the cancellation window only; before it,
the client cancels). Finishing shows the facts on record (agreement, review,
rounds and letters, answers), the plan going forward, a free-tips choice, and
sharing with a loan officer.

**Billing stops at graduation.** Inserting `program_completions` sets
`service_end_requested_at` on the agreement in the same transaction. From then
the letter gate holds every letter, `chargeEligibility` returns
`service_end_requested`, and the database's charges trigger refuses any new
charge. Work already mailed and unbilled is never charged automatically; a
person decides (`BILL_PERFORMED_WORK_AFTER_END_REQUEST`, `docs/BILLING.md`
question 3). Tested in `aftercare.test.ts` for no plan, per round,
subscription and flat fee over 120 days after graduating, and in PGlite (a
charge insert after graduation fails; the same dates without graduation
succeed).

## Attorney questions

1. **CROA and the contract.** Is after-care (the plan, tips, home-ready
   milestones, introductions) part of the "services" of the CROA contract
   (15 U.S.C. § 1679d) and Texas Finance Code ch. 393? We built it as free
   general education outside the paid service, available from day one and
   after graduation, so it never adds paid work and never delays billing's
   end. Must the contract or disclosures say so? Do free tips after
   graduation need their own consent (TCPA/CAN-SPAM)?
2. **Selling or referring other products.** May a credit repair organization
   show affiliate credit-building offers to its clients (CROA § 1679b(a)
   misrepresentation, Texas CSO rules on other services and fees)? Is an
   affiliate fee a payment "for" credit repair? Does showing offers make us a
   lead generator or broker under state law?
3. **UDAAP.** Is ranking by cost then name, the "optional, not part of your
   service" text and "never ranked by commission" enough to avoid an unfair
   or deceptive practice? Must we disclose the amount we are paid?
4. **Affiliate disclosures.** FTC Endorsement Guides (16 CFR Part 255): is
   "Credalti may be paid if you sign up" plus the owner's text, shown before
   the link, clear and conspicuous? Same question in Spanish.
5. **ITIN.** Anything specific to serving ITIN holders (fair lending
   references in our lender information, immigration-status sensitivity,
   ECOA/Reg B language)? Is "ITIN loans … often ask for a larger down payment"
   acceptable general information?
6. **Lender information.** Are the FHA/conventional minimums, stated as
   program rules with "requirements vary by lender", acceptable for a CSO to
   publish, or do they read as a representation about the client's
   creditworthiness?
7. **Home-ready sharing and introductions.** GLBA/Reg P and state privacy:
   sharing self-reported milestones and dates, and name/phone/goal for an
   introduction, with opt-in consent. RESPA § 8: the introduction and the
   portal must not be a thing of value exchanged for referrals; confirm that
   "Credalti is not paid for this introduction" must stay true (partner
   commissions remain off) and whether realtors may receive introductions.
8. **Graduation.** Is recording graduation as the end of the service (the same
   field as a requested end) correct for CROA and Texas, and should unbilled
   performed work after graduation ever be charged?
