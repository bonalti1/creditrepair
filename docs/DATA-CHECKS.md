# Data checks: what a report's own data shows

Code: `src/lib/domain/checks.ts` (pure), shown by `src/components/DataChecks.tsx`,
offered as an opt-in by `src/components/DisputeFields.tsx`, learned from in
`src/lib/staff/learning.ts`. Tests: `src/lib/__tests__/dataChecks.test.ts`,
`src/lib/__tests__/outcomesLearning.test.ts`, `src/lib/__tests__/db/dataChecks.test.ts`.

## Why

A bureau answers a vague dispute ("this is inaccurate") with "verified" or
"frivolous". A specific dispute ("Equifax reports a balance of $1,250 and
Experian reports $900 for the same account") is harder to set aside, because
the bureau's own file shows the conflict.

Credit Repair Cloud shops pre-check every negative item and mail generic
letters. Credalti's rule is the opposite and does not change here: **the client
decides what is inaccurate and why** (one of 14 reasons, plus the
attestation). The software and the team never decide for them. Data checks
help the client *look*; they never answer.

## The rule, as code enforces it

- A check says what the data shows ("Equifax muestra $1,250 y Experian muestra
  $900"). It never says an item "is wrong". Every check box on screen ends with
  "Solo tú sabes si es correcto. Tú decides: si se ve bien, responde «Se ve
  correcto»."
- A check is shown on the item it is about, with the reasons that "have to do
  with" it as **plain text**. The box has no button, link or input
  (`DataChecks.tsx`; a test scans for `<button`, `<input`, `onClick`, `onChange`).
- In the reason picker, a related reason gets a small tag ("Tiene que ver con lo
  que notamos"). Nothing is pre-selected; every reason is still offered in the
  catalogue's order; "Se ve correcto" is still the first button.
- Only after the client picks a reason that a check relates to does an
  **unticked** box appear: "Incluir en mi carta lo que muestran mis datos", with
  the exact English sentence the letter would add. Unticked, the letter carries
  only the reason, as before.
- An item the client marks correct, or flags without confirming, gets nothing.
  Facts print only for an attested item, for the reason the client picked, and
  only the checks the client ticked (`letterFacts`). Tests prove each case,
  and that with checks on every item and no answers the plan has no letters.
- The server never takes the fact text from a browser. The client's answer
  stores only check ids (`item_flags.check_ids`, migration 0021, format-checked
  by the database); `/api/flags` recomputes the checks from the client's own
  report and keeps an id only if the check is on that item and relates to the
  reason picked. The letter sentence is recomputed from report rows
  (`rounds/plan.ts: itemDetailsFromRows`). Staff can read the ids and cannot
  write them (no staff write policy on `item_flags`; tested on PGlite).
- Staff see the checks per item on the client page, read-only, headed "Solo
  para responder preguntas. Nadie del equipo puede aplicarlo".

## The checks

`strength`: **objective** = the data itself shows it (two figures that cannot
both be right, an impossible date order). **worth_checking** = a common
pattern that also has innocent explanations (reporting lag, a legitimate
second address).

Metro 2 names below are the **industry reporting format** (CDIA's Credit
Reporting Resource Guide), not law. They are given so the team can talk to
furnishers in their terms.

### Same account across bureaus

Matched by creditor + masked account number (the same key the review's
"also appears on Experian" note uses).

| Kind | Fields (Metro 2 name) | Strength | Related reasons |
|---|---|---|---|
| `balance_mismatch` | balance (Current Balance) | objective if every copy is closed, paid, in collection or charged off; else worth_checking when the bureaus last reported on different dates | wrong_balance |
| `limit_mismatch` | creditLimit (Credit Limit), highCredit (Highest Credit or Original Loan Amount) | objective; worth_checking when last-reported dates differ | wrong_balance |
| `past_due_mismatch` | pastDue (Amount Past Due) | as balance | wrong_balance, never_late |
| `status_mismatch` | status / paymentStatus (Account Status, Payment Rating) | objective; worth_checking when last-reported dates differ | never_late / paid_or_settled / closed_by_me, by the words used; else other |
| `date_mismatch` | openedAt (Date Opened), closedAt (Date Closed): objective. lastPaymentAt (Date of Last Payment): worth_checking when last-reported dates differ | | wrong_dates |
| `possible_reaging` | firstDelinquencyAt (Date of First Delinquency) | objective | wrong_dates |
| `payment_history_mismatch` | paymentHistory (Payment History Profile): a month one bureau shows late and another on time | objective | never_late |
| `account_type_mismatch` | accountType (Portfolio Type / Account Type) | objective | other |
| `ownership_mismatch` | ownership (ECOA Code: individual, joint, authorized user) | objective | other |

Law behind it: **FCRA § 607(b)** (reasonable procedures to assure maximum
possible accuracy) and **§ 623(a)(1)–(2)** (furnishers must not report what
they know is inaccurate, and must correct it). Two bureaus cannot both be
reporting one account's balance accurately on the same date. **§ 611** is the
reinvestigation the letter asks for. Re-aging: **§ 623(a)(5)** requires a
furnisher of an account placed for collection or charged off to report the
month and year of the delinquency that preceded it; **§ 605(c)** measures the
reporting period from that date, so a later date keeps the item reported longer.

### One item by itself

| Kind | What | Strength | Related reasons | Basis |
|---|---|---|---|---|
| `obsolete` | By the reported date of first delinquency (or filing date for a bankruptcy), the reporting period ended before the report's date. Collections and charge-offs: 7 years from 180 days after the delinquency; other late payments: 7 years; bankruptcy: 10 years from filing. Reuses `learn/calculators.ts dropOffDate` (the Aprende calculator). | objective | obsolete | FCRA § 605(a), (c) |
| `missing_first_delinquency` | A collection or charge-off without a date of first delinquency (and, if so, which other bureau shows one) | worth_checking: consumer disclosures do not always print the field even when it is furnished | wrong_dates, obsolete | § 623(a)(5); Metro 2 "Date of First Delinquency" |
| `impossible_dates` | Last payment, first delinquency, closing or last report before the date opened (original creditors only: a collector's "opened" is when it got the debt); a collection opened before the first delinquency; first delinquency after the last report | objective | wrong_dates | § 607(b), § 623(a)(1) |
| `future_date` | Any date after the report's own date (one day of slack) | objective | wrong_dates (inquiry: other) | § 607(b) |
| `balance_on_paid` | Status, payment status or a remark says paid/settled, and a balance above $0. A **closed** account with a balance is not flagged: that can be correct | objective | paid_or_settled, wrong_balance | § 623(a)(2) |
| `past_due_over_balance` | Amount past due greater than the balance | objective | wrong_balance | § 607(b) |

### Items read together on one bureau

| Kind | What | Strength | Related reasons |
|---|---|---|---|
| `duplicate_debt` | A collection whose "original creditor" matches another account on the same bureau, both with a balance; or two collectors for the same debt (same original creditor, or same first delinquency and same balance) | worth_checking | duplicate, wrong_balance |

An original creditor's account and a collector's account for the same debt are
normally two legitimate entries (`letters/library.ts`, duplicate letter). The
check is about **both showing a balance**: once a debt is sold or assigned, the
original account normally shows $0 (Metro 2 guidance: industry format, not
law). The double balance is the fact, not the two entries.

### Personal information (extends the existing review questions)

The review already asks per field ("¿Has vivido alguna vez en esta
dirección?"). The checks add only what comparing the whole report shows:

| Kind | What | Strength | Related reasons |
|---|---|---|---|
| `personal_info_variants` | The report shows more than one version of a name, address, employer, date of birth or SSN; each version lists the others and the bureaus it is on | worth_checking; objective for date of birth and SSN (a person has one) | wrong_personal_info, mixed_file |
| `name_suffix` | A name with JR, SR, II, III or IV: possible mixed file with a relative | worth_checking | wrong_personal_info, mixed_file |

## What the data cannot support today (not built)

The parser now accepts these optional fields when a partner sends them:
`closedAt`, `pastDue`, `highCredit`, `ownership`, `originalCreditor`,
`paymentHistory`. The report readers (`reports/readers.ts`, the IdentityIQ
reader, AI intake) do **not** fill them yet, so the checks that need them stay
silent until a reader maps them. Not checked at all:

- Metro 2 Account Status codes, Special Comment codes and Compliance Condition
  codes (e.g. "XB" disputed, "XH" dispute resolved): the format carries only
  plain status words.
- "Disputed" flags (§ 623(a)(3)): not in the data.
- Date closed vs. status "open" on the same copy; scheduled payment; terms.
- Inquiry age (the "2 years" is bureau practice, not law; the review already
  asks) and inquiry permissible purpose (§ 604: only the client knows).
- Judgments and tax liens: their period depends on state law and payment date.
- Medical debt rules (bureau policy changes, CFPB rule litigation): left out.
- Statute of limitations (state law; not a reporting rule).
- A second report from the same bureau over time (re-aging within one bureau):
  needs report history per item; `diffReports` keeps only the newest.

## How a fact reaches the letter

`{detalles}` was checked first, as asked. It is **not** a path to the round's
letters:

- `{detalles}` (`LetterContext.details`, `detailsParagraph`) exists only in
  library templates (`bureauTemplates.ts`: `bureau_wrong_balance`, …).
- The round engine (`domain/attack.ts`) mails `dispute_611_accounts`,
  `dispute_611_inquiries`, `dispute_611_public_records`, `mov_request`,
  `furnisher_direct`, `debt_validation`, `personal_info_cleanup` and
  `secondary_bureau_request`. None has a `{detalles}` paragraph, and the editor
  cannot add one (`{detalles}` is not an optional chip).
- `staffLetterText` and `rounds/send.ts` never pass `details`.

So the facts travel the other existing path, the item line (`{partidas}`),
right after the reason sentence, through a new optional
`LetterContext.itemDetails` next to `itemReasons`:

```
- Midland Credit Management (****8821 · collection): The balance or credit limit
  reported for this account does not match my records and is not accurate. The
  balance reported for this account is not the same at every credit bureau:
  Equifax reports $1,250 and Experian reports $900.
```

No approved letter text changed: every template and every stored version reads
exactly as before; without `itemDetails` the output is byte-for-byte the same
(tested). Facts never print without a reason, never add a line, and are
stripped with the reasons from the letters that print none
(`TEMPLATES_WITHOUT_REASONS`: debt validation, collector letters, goodwill…).
The `{partidas}` chip's help and attorney label now say so.

**One step left for the team that owns `rounds/send.ts`** (not touched here,
by agreement): pass the facts to the mailed letter, as the preview already does.

```ts
// rounds/send.ts, where the letter is rendered (two lines):
const itemDetails = itemDetailsFromRows(items, flagRows, itemIdToFp, reportPulledAt);
const baseBody = renderResolved(version, { ...ctx, itemReasons, itemDetails });
```

Until then, the client's letter preview and the team's preview of the next
round show the facts the client chose, and the mailed body does not.

## Outcomes learning loop (internal only)

`staff/learning.ts`, shown as "Qué está funcionando" on `/equipo/negocio`
(administrators). One row per bureau / company / client reason / letter and
stage / data check; columns: disputes, deleted, updated, verified, other answer,
no answer, waiting, median days. Rows under 10 disputes show only the count.
Definitions are on the page. Results come from the round's own record, the next
round's letter, `intake/outcomes.ts roundOutcomes()` on the newest report, and
bureau letters read by AI intake.

It is internal operations data: never shown to clients, never in messages,
never in marketing. A test scans the client app, public pages, client copy,
the coach, sales, autopilot and the content pipeline for any percentage of
removals, and for any import of the learning module.

`escalationOrder(rows, candidates)` ranks options by the share of recorded
results that were deleted or updated, with the same minimum sample. It is not
used: `domain/attack.ts` is unchanged (a test checks it does not read outcomes).

## Questions for the attorney

1. **Does showing related reasons from data checks fit "the client decides"?**
   The reasons appear as plain text and a tag in the picker; none is selected;
   "Se ve correcto" stays first. Is a tag on a reason a recommendation under
   CROA § 1679b(a) or the Texas Credit Services Organizations Act? Should the
   tag go, leaving only the facts?
2. **Wording of the explanations.** They say what the data shows and close
   with "Solo tú sabes si es correcto. Tú decides". Is "Se ve en los datos" /
   "Vale la pena revisarlo" acceptable, or does "objective" language read as a
   conclusion that the item is inaccurate?
3. **Facts in the client's letter.** The client ticks a box to include a
   sentence of report facts after their reason. The letter is in the client's
   first person; the facts are about the report, not the client's records. Is
   that acceptable in a § 611 dispute and a § 623 direct dispute? Should the
   attested text cover the included facts explicitly?
4. **The item line.** The facts print inside `{partidas}` (after the reason
   sentence), not in a new paragraph. Is a change in what `{partidas}` prints
   a change to approved letter text that needs re-approval of each version?
5. **Obsolescence statements.** The `obsolete` fact states when the § 605
   period ended "counted from that date". Is it acceptable to state the
   computed end date in a letter, given § 605(b) exceptions?
6. **Duplicate debt.** Is "the same debt is reported with a balance twice" a
   fair statement when an original creditor still shows a balance after
   assignment, or should it stay a question?
7. **Learning loop.** Internal outcome statistics by furnisher and reason: any
   record-keeping, discovery or advertising-substantiation concern (FTC Act § 5,
   CROA § 1679b(a)(3)) with keeping them, as long as they are never published?
