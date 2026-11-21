# The service agreement

Credalti now prepares and mails dispute letters for its clients. That makes it
a "credit repair organization" under the federal Credit Repair Organizations
Act (CROA, 15 U.S.C. §1679 et seq.) and a "credit services organization" under
Texas Finance Code chapter 393. Before any work can be done for a client, those
laws require a disclosure, a written contract, a signature and a right to
cancel. This is the part of the software that does that.

**Status: draft. No attorney has reviewed any of the text.** The software's
job so far is the structure and the enforcement: the right documents in the
right order, a record of exactly what was signed, and a gate that holds every
letter until the law allows work to start. With a real database configured,
nobody can sign until the steps under "Going live" are done.

*This file is not legal advice. Where something below could not be verified,
it says so.*

## What the client does

| Step | Screen | What is recorded |
| --- | --- | --- |
| 1 | `/acuerdo`: the federal disclosure, the Texas disclosure and the consent to electronic records, on their own screen. One checkbox (electronic records) and "Lo recibí y lo leí". | The time, the language, the version and a hash of the text shown. |
| 2 | `/acuerdo`: a plain-language summary, the full contract, the authorization, the notice of cancellation, the cancellation statements in bold by the signature, a typed legal name and three checkboxes, then "Firmar". | Name, time, version, language, hash of everything shown, IP address, browser, the business terms as printed, and the cancellation deadline. |
| After | `/acuerdo`: the deadline with date and hour (Texas time), "Ver o imprimir mi copia" (`/acuerdo/copia`), what happens next, and the way out. | — |
| Cancel | Inside the window: "Cancelar sin costo", then one confirmation. After it: "Terminar el servicio", then one confirmation with an optional reason. Also reachable from "Más → Mi acuerdo". | Cancellation time and "inside the window"; or the request to end and its reason. The team is notified. |

The contract is not shown until step 1 is acknowledged. There is no retention
screen and the cancel button never moves or hides.

## What is enforced, and where

`src/lib/agreement/gate.ts` → `workMayStart(agreement, now)` is false unless
the disclosure was acknowledged, the contract signed, the contract not
cancelled, the cancellation window over, and no request to end the service
pending. It is applied:

- in `POST /api/attacks/approve`, the only place letters are mailed from, when
  the service mode is full service (409 with `code: "agreement_…"`);
- in the staff console's send rules (`sendBlockReason`, `sendableRound` in
  `src/lib/staff/stage.ts`), which also decide what the print batch may print;
- in the client's journey (`src/lib/ux/journey.ts`): no step says letters were
  sent while the gate is closed.

Other rules:

- **Readiness.** `agreementReadiness()` is true only when every business term
  is set, every statutory passage is marked verified, and
  `NEXT_PUBLIC_AGREEMENT_APPROVED_VERSION` equals `AGREEMENT_VERSION`. With a
  database configured and readiness false, the acknowledge and sign endpoints
  answer 409 and the client sees "Estamos terminando tu acuerdo". Without a
  database (the demo) the flow can be signed for demonstration, on the device
  only, under a "Borrador: pendiente de revisión legal" banner.
- **Cancelling never depends on readiness.**
- **The server decides** the signing time, the deadline, the terms and the
  hash. The browser only says what it was showing; if that differs from what
  the server would show, the signature is refused and the page reloads.
- **The record cannot be edited** (migration `0010_service_agreements.sql`):
  clients and staff can only read; only the server writes; and a trigger stops
  even the server from changing an acknowledgement, a signature or a recorded
  cancellation, or deleting a row. An account cannot be deleted while it has an
  agreement row (`on delete restrict`), because the law says to keep the
  record for two years.

## The business-day rule

CROA gives the client until "midnight of the 3rd business day after the date
on which you signed" and does not define "business day".
`src/lib/agreement/businessDays.ts` takes the reading that is safest for the
client: Saturdays, Sundays and the eleven U.S. federal holidays do not count,
and a holiday that falls on a weekend also takes out the weekday it is observed
on. Holidays are computed from their rules, not from a list of years. Days are
counted on the Texas calendar (`America/Chicago`), and the deadline is
23:59:59.999 of the third business day. The team's start date shown to the
client is the first business day after that.

This makes the window longer for the client and makes us start later. Do not
shorten it without the attorney's answer to question 1.

## The documents

All text is in `src/lib/agreement/documents.ts`; passages worded by a statute
are in `src/lib/agreement/statutes.ts`. `AGREEMENT_VERSION` is
`2026-11-21-draft.1`. Every document has `reviewStatus: "attorney_pending"`.

| # | Document | Required by | What is statute and what is our draft |
| --- | --- | --- | --- |
| 1 | **Federal disclosure**, "Consumer Credit File Rights Under State and Federal Law" | 15 U.S.C. §1679c(a); separate document before the contract, §1679c(b); signed acknowledgement kept 2 years, §1679c(c) | English: the statute's text, meant to be verbatim (see "Verification"). Spanish: our translation, labelled as a translation, with the English controlling. |
| 2 | **Texas disclosure statement** | Tex. Fin. Code §393.105; signed copy kept 2 years, §393.106 | All our draft, built on the topics the statute lists. Every passage is marked Texas-specific. |
| 3 | **Consent to electronic records and signature** | E-SIGN Act, 15 U.S.C. §7001(c) | Our draft. |
| 4 | **Service contract** | 15 U.S.C. §1679d(b); Tex. Fin. Code §393.201 | Our draft, except the two cancellation statements placed by the signature: CROA §1679d(b)(4) and Tex. Fin. Code §393.202(a), each in English as the statute words it, with a Spanish translation. |
| 5 | **Limited authorization** to prepare and mail letters | No statute words it | Our draft. |
| 6 | **Notice of cancellation** | 15 U.S.C. §1679e(b) (in duplicate); Tex. Fin. Code §393.202(b) (two detachable copies) | The two statutory forms in English, with the company name, address and deadline filled in, each with a Spanish translation. The printable copy prints the notice twice. |

On screen, while the version is not approved, Texas-specific passages carry a
gold line on the left, and any business fact not yet set shows as a gold
`[PENDIENTE: …]` placeholder.

In Spanish, a statutory passage is shown as translation first and the official
English second. That is a choice made for the reader; see question 4.

## Verification of the statutory text

**None of the statutory text has been compared word for word with an official
source.** When this was written (2026-11-21) the machine could not open
uscode.house.gov, law.cornell.edu, govinfo.gov or statutes.capitol.texas.gov
(they were outside the session's network allow-list). The texts were written
from the statutes as known and checked only against fragments returned by a
web search. Every text in `statutes.ts` therefore has `verified: false`, and
readiness stays false while any of them does.

| Text | Section | What search fragments confirmed | Not confirmed |
| --- | --- | --- | --- |
| Federal disclosure | 15 U.S.C. §1679c(a) | The heading; the opening words; "You have a right to obtain a copy of your credit report from a credit bureau."; "You have a right to sue a credit repair organization that violates the Credit Repair Organization Act."; the Federal Trade Commission sentence and address block | Every other sentence, word for word |
| Contract cancellation sentence | 15 U.S.C. §1679d(b)(4) | Given in the build brief; matches the statute as known | Not compared with the official page |
| Notice of cancellation form | 15 U.S.C. §1679e(b) | The heading; "3rd day which begins after the date the contract is signed by you"; "or any other written notice to [ name of credit repair organization ] at [ address of credit repair organization ] before midnight on [ date ]"; "I hereby cancel this transaction" | Punctuation and line layout |
| Texas contract cancellation sentence | Tex. Fin. Code §393.202(a) | The first sentence, from a republication of the code | The second sentence; whether it is the current text |
| Texas notice of cancellation | Tex. Fin. Code §393.202(b) | "two easily detachable copies"; "within three days after the date the contract is signed"; "within 10 days after the date of receipt by the seller" | The layout of the name, address and date lines |
| Texas disclosure topics | Tex. Fin. Code §393.105 | That it is given before a contract or payment; the last topic (nonprofit credit counseling); that an earlier topic concerns obsolete information; the 2-year retention in §393.106 | Topics 1 to 7 |
| Texas contract contents | Tex. Fin. Code §393.201(b) | "in writing, dated, and signed by the consumer"; "payment terms, including the total payments" | That the estimated period may "not exceed 180 days"; the agent for service of process requirement. Both are in the draft because they are believed to be there. |

To verify: open the page named in each text's `compareWith`, compare, correct
any difference, set `verified: true`, bump `AGREEMENT_VERSION` if a word
changed, and update the test in `src/lib/__tests__/agreement.test.ts` that
expects all of them to be unverified.

## What the owner fills in

Set in the hosting settings. They are `NEXT_PUBLIC_` because the client's
screen prints them in the contract.

| Variable | What it is | Shown as, when missing |
| --- | --- | --- |
| `NEXT_PUBLIC_COMPANY_LEGAL_NAME` | The company's legal name, as registered | `[PENDIENTE: nombre legal de la empresa]` |
| `NEXT_PUBLIC_COMPANY_ADDRESS` | Principal business address, one line | `[PENDIENTE: domicilio principal de la empresa]` |
| `NEXT_PUBLIC_COMPANY_EMAIL` | Where a client writes to cancel, ask for paper, or withdraw consent | `[PENDIENTE: correo electrónico de la empresa]` |
| `NEXT_PUBLIC_COMPANY_PHONE` | Optional | not shown |
| `NEXT_PUBLIC_PLAN_MONTHLY_FEE` | Monthly fee in dollars, for example `89` | `[PENDIENTE: cuota mensual]` |
| `NEXT_PUBLIC_PLAN_ESTIMATED_MONTHS` | Estimated length of the service in whole months | `[PENDIENTE: duración estimada en meses]` and `[PENDIENTE: total estimado]` |
| `NEXT_PUBLIC_TX_CSO_REGISTRATION_NUMBER` | Texas registration number (Secretary of State) | `[PENDIENTE: número de registro en Texas]` |
| `NEXT_PUBLIC_TX_BOND_SURETY_NAME` | The surety company that issued the bond | `[PENDIENTE: nombre de la afianzadora]` |
| `NEXT_PUBLIC_TX_BOND_SURETY_ADDRESS` | Its address | `[PENDIENTE: domicilio de la afianzadora]` |
| `NEXT_PUBLIC_TX_AGENT_NAME` | The agent in Texas authorized to receive service of process | `[PENDIENTE: nombre del agente registrado en Texas]` |
| `NEXT_PUBLIC_TX_AGENT_ADDRESS` | Its address | `[PENDIENTE: domicilio del agente registrado en Texas]` |
| `NEXT_PUBLIC_AGREEMENT_APPROVED_VERSION` | Set to `AGREEMENT_VERSION` only after the attorney approves that version | — |
| `NEXT_PUBLIC_SERVICE_MODE` | Empty = full service. `self_serve` = the client sends their own letters | — |
| `TEAM_WEBHOOK_URL` | Optional. Told when a client cancels or asks to end the service (falls back to `SALES_WEBHOOK_URL`) | — |

The monitoring price and provider printed in the contract come from
`NEXT_PUBLIC_MONITORING_PRICE` and `NEXT_PUBLIC_MONITORING_SIGNUP_URL`
(`src/lib/monitoring/offer.ts`).

Decisions the draft makes for the business, which the owner should confirm or
change (each is a sentence in the contract):

1. One fee, monthly, charged only after that period's round of letters has
   been prepared and mailed. No enrollment fee, no cancellation fee, no
   mailing charge.
2. The total is the monthly fee times the estimated months.
3. Ending the service after the window costs nothing; the client pays only for
   work already fully performed.
4. A charge made by mistake is returned within 10 days.
5. The service may be ended by the company if the client asks for a letter
   about information they said is accurate, or gives false information.
6. Personal information is used only for the service and is not sold.

## Going live

1. The attorney reviews the documents (print `/acuerdo/copia` in both
   languages) and answers the questions below. Edit the text in
   `documents.ts` and `statutes.ts` as instructed.
2. Compare every statutory passage with its official page and set
   `verified: true`.
3. Change `AGREEMENT_VERSION` to a non-draft value.
4. Apply migration `0010_service_agreements.sql` (it is in `supabase/setup.sql`).
5. Set every variable in the table above, and set
   `NEXT_PUBLIC_AGREEMENT_APPROVED_VERSION` to the new version.
6. `GET /api/health` (with the shared secret) reports "Service agreement" as
   ready, or says what is missing.

Any later change to the text needs a new version and a new approval. Clients
who signed an earlier version keep their record of that version (the version
and hash are on the row); the app does not yet keep old versions of the text
to redisplay (see "Not done").

## Questions for the attorney

1. **Business days.** CROA does not define "business day". We exclude
   Saturdays, Sundays and federal holidays (and the observed weekday). Is that
   acceptable, and is anything shorter permitted? Whose midnight applies when
   the client is outside Texas? The Texas statute says "third day", not
   business day: is applying the longer CROA period to both correct?
2. **The cancellation form's date.** The CROA form reads "3rd day" where the
   rest of the Act reads "3rd business day". We write the business-day
   deadline into the form. Is that right? If a client mails the notice on the
   last day, it arrives after we may have started: must we wait for the mail
   before beginning work, and how long?
3. **What counts as "services" during the window.** No letter is prepared or
   mailed, and the team does nothing, until the window ends. The app does let
   the client upload documents, connect monitoring and review their report
   during it. Is importing the report or guiding the review a "service" that
   must also wait?
4. **Spanish.** The sale is conducted in Spanish. Must the contract and the
   disclosures be given in Spanish, by federal or Texas law? Is a courtesy
   translation with "the English controls" acceptable, or must one language be
   the contract? In Spanish we show the translation first and the statutory
   English second: must the English come first? Are our translations of the
   statutory statements acceptable?
5. **Electronic signature.** Does a typed name with checkboxes, under E-SIGN
   and the Texas UETA, satisfy "a written and dated contract … signed by the
   consumer" (CROA §1679d) and Tex. Fin. Code §393.201? Is our consent step
   enough for §7001(c), including showing that the client can open the
   electronic documents? Does a separate screen, acknowledged with its own
   timestamp before the contract is shown, satisfy "a document which is
   separate" (§1679c(b))? Does a printable page that prints the notice twice
   satisfy "in duplicate" and "two easily detachable copies"? Does bold text
   on a screen satisfy "bold face type"? Is the acknowledgement record
   (timestamp, version, hash) the "signed" copy the law says to keep for two
   years?
6. **The authorization.** Is its scope right and narrow enough? Letters go out
   in the client's name and do not mention Credalti: is that permitted, or
   must a letter say who prepared it? May the client's typed name appear as
   the signature on each letter? We understand that a furnisher need not
   investigate a direct dispute prepared or submitted by a credit repair
   organization (Regulation V, 12 C.F.R. §1022.43(b)(2); not verified): how
   should that change the letters to furnishers and what we tell clients?
7. **Estimated length of performance.** We understand Texas requires the
   contract to state the estimated period for performing the services, "not to
   exceed 180 days" (§393.201(b)(2); not verified). The service is rounds
   about every 40 days for as long as the client wants. How should the term be
   written: a fixed term of up to 6 months with a new contract after, or
   something else?
8. **Billing after each round.** CROA §1679b(b) forbids charging before a
   service is "fully performed". Does a monthly charge made after that
   period's round has been prepared and mailed satisfy it? When is a round
   fully performed: at mailing, after the 30-day response period, or after the
   new report is imported? If a salesperson ever speaks to a prospect by
   phone, does the Telemarketing Sales Rule (16 C.F.R. §310.4(a)(2)) delay
   payment further?
9. **Texas registration and bond.** Confirm what must be in place before the
   first client signs (registration with the Secretary of State, a $10,000
   surety bond), and the wording for: the right to proceed against the bond,
   the surety's name and address, the registration number, the agent for
   service of process, and the client's right to inspect the registration
   statement. Is our list of what §393.105 requires complete?
10. **The Texas disclosure's wording.** Topic 5 uses the statute's "30th day"
    and a "minimal charge"; federal law today gives 60 days and free annual
    reports. We state both. Is that right? Is our statement about nonprofit
    credit counseling adequate?
11. **The monitoring subscription.** The client pays a third party for credit
    monitoring, and we earn a commission. Must that cost be in the contract's
    "total payments … whether to the organization or to another person"? Does
    requiring it before any letter is mailed amount to a payment before
    performance?
12. **Refunds and guarantees.** Texas requires the contract to state each
    guarantee and each promise of a full or partial refund. We state that
    there is no guarantee and nothing prepaid to refund. Is that sufficient?
13. **The two notices.** We print both statutory cancellation notices, federal
    and Texas, and accept cancellation in the app as well as by mail. Is
    printing both right, or should there be one? Is in-app cancellation a
    valid "written notice"?
14. **Ending after the window.** A request to end the service is recorded,
    stops all letters at once, and a person confirms it. What must we send the
    client in writing, and may any charge follow for a round already mailed?
15. **Records.** We keep the signer's IP address and browser with the
    signature, never delete an agreement row, and block deleting the account
    while one exists. Is two years the right retention, and how does that sit
    with a client's request to delete their data?
16. **When the text changes.** Must existing clients sign the new version, and
    does a new signature start a new cancellation window?
17. **Anything missing.** Clauses we did not include and you would want
    (governing law, dispute resolution, privacy notice, limits on what the
    company may say to a bureau), and anything we included that you would
    remove.

## Not done

- The staff console still runs on demo data; its database implementation
  (`src/lib/staff/data.ts`) must read `service_agreements` and apply the gate
  on the server when it marks a round as sent.
- No staff action closes a case after a request to end the service. The
  request is an exception a person handles on WhatsApp; billing is a
  placeholder. The table can record a late cancellation
  (`cancelled_within_window = false`), but nothing writes it yet.
- Old versions of the text are not kept in the app. A signed row records the
  version and the hash; the printable copy warns when the signed version is
  not the current one. Keep each approved version's PDF outside the app, or
  add versioned text before the first change.
- `/api/cron/rounds` re-imports reports for mailed rounds without looking at
  the agreement; it should skip a client who cancelled or asked to end.
- Cancellation by mail (the paper notice) has no screen: the team must record
  it by hand in the database until one exists.
- The identity-document upload on `/acuerdo` is the existing component and
  only works for a signed-in client.
