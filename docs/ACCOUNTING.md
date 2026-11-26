# Accounting

`/equipo/contabilidad` ("Accounting" / «Contabilidad») is the accounting
department of the staff console: the business in numbers, from the billing
records and from what the team enters. It is for the owner and
administrators only (the `accounting` capability; see «Who can open it»).

Nothing here is tax, legal or accounting advice, and nothing has been
reviewed by a CPA. Every tax figure is labelled "estimate; confirm with your
CPA". The open questions are at the end.

Code: `src/lib/accounting/` (pure rules, the demo, the client data layer and
the server store), `src/components/staff/accounting/`, the pages
`src/app/equipo/contabilidad/page.tsx` and `…/informe/page.tsx`, the routes
`src/app/api/staff/accounting/route.ts` and `…/receipt/route.ts`, migration
`supabase/migrations/0036_accounting.sql`. Tests:
`src/lib/__tests__/accounting.test.ts` (rules) and
`src/lib/__tests__/db/accounting.test.ts` (PGlite: row level security,
triggers, both routes).

## Real numbers only: the one money rule

Learned from the owner's other business ("Books"): a refunded or test charge
was once counted as a sale. Here there is one rule, in one place
(`ledger.ts`), and every screen, report and file reads it:

- **Revenue** is money a processor actually took for a **real** charge: the
  charge's collected amount (the amount less any referral credit) on the day
  it was taken (`charged_at`).
- A **test charge** is never revenue: one taken by the demo gateway
  (`charges.gateway` is `demo`, `test` or `sandbox`; `BILLING_GATEWAY=demo`
  moves no money). The screens say how many were left out.
- A **refund or void** counts against revenue on the day the processor
  confirmed it. One still being sent counts nothing yet (it is listed).
- A **chargeback** counts against revenue when it is lost or accepted, on the
  day it was received. An open one is shown "at risk" but not subtracted; a
  won one counts nothing.
- A **declined payment** or an **ACH return** is never revenue; it is listed
  with amount 0 (the amount involved in brackets), so failed attempts are
  visible.
- **Money in whole cents**, integers everywhere (TypeScript and SQL). Typed or
  imported amounts come in through `parseMoney` only.
- **Cash basis, Texas calendar**: everything on the day money moved, in
  America/Chicago months.
- **No data, no number**: a figure with nothing behind it reads "No data yet",
  never a made-up $0 (`MonthTotals.hasData`, `economics.ts` `Figure.missing`).
- **Processing fees: measured beats estimated.** For a month with the
  processor's statement entered (an expense in "Card and ACH processing
  fees"), that is the fee; otherwise the estimate from
  `NEXT_PUBLIC_BILLING_FEE_*` (the same estimate `/equipo/cobros` shows),
  labelled "estimate". Never both.

Income is **read** from billing (charges, refunds, chargebacks, returns),
never copied, so the books can never disagree with billing. Nothing in the
accounting department creates, changes, retries or refunds a charge, and
migration 0036 alters no billing table, trigger or function (a test checks).

## The screens

| Tab | What it shows |
| --- | --- |
| **Dashboard** | This month, last month and year to date: revenue collected, refunds, chargebacks lost, net revenue, monitoring commissions, expenses, processing fees, partner commissions paid (when on), net profit, cash in and out. Tiles: net profit, accounts receivable, failed payments, partner commissions payable (or "Off"). Expenses by category. Every line has its definition ("?"). |
| **Income** | The ledger built from billing: each payment, refund, void, chargeback, declined attempt and ACH return, with client (masked by default: "M•••• G••••••"; "Show client names" reveals), invoice, plan, round, processor and method. Filters, CSV. Below it: **monitoring commissions and other income**, entered by hand or imported from the provider's CSV (a date and an amount per line; the same date, amount and source is skipped). |
| **Expenses** | Entry form (date, amount, category, vendor, description, paid with), the month's list with receipts (attach, view), edit and void (void keeps the record, with a reason), **adjustments** to a closed month, CSV, and **monthly expenses** (rules with a day of the month; "Post N monthly expenses" adds the ones due, once per rule and month). |
| **Bank import** | A bank statement CSV: choose the file, the **mapping step** (header row; date, description, one amount column or debits/credits; "this bank writes money out as positive"), then every line with what it would do, a suggested category per line, then import. |
| **Reconciliation** | The processor's export (NMI or Authorize.Net CSV) against the app's charges: matched, amounts differ, only in the processor, only in the app, probable matches to confirm, explained; fees; expected deposits by day and batch. |
| **Collections** | Payments that did not go through, aged, with a plain workflow (below). |
| **Unit economics** | Ad spend, leads, signed clients, cost per lead, cost per signed client, average revenue per client, revenue per client per month, months active, monthly churn, lifetime value, payback months; last 30/90/365 days. Each one "No data yet" with the reason when the data is missing. |
| **Commissions** | When "Partner commissions" is on: owed, paid and balance per partner. Always: the **1099-NEC summary** for a calendar year (partners paid $600 or more in recorded payments, with W-9 status), CSV, and each partner's W-9 details. |
| **Reports** | The monthly report (P&L, cash flow, receivables, expenses by category), the **printable report** (`/equipo/contabilidad/informe?mes=YYYY-MM`, "Print or save as PDF"), files (P&L CSV, income ledger CSV, expenses CSV, the **QuickBooks / Xero CSV**), **month close** with its checklist, and the audit trail. |
| **Taxes** | Profit so far this year, the owner's set-aside percentage and the amount to put aside (estimate), and the federal and Texas dates of the next 12 months. |

English first, Spanish with the console's switch. Phone-friendly: the tab
bar and wide tables scroll inside their own box; the page never scrolls
sideways at 390 px (checked by the screenshot script). No score visuals.

## Expenses

Categories (`categories.ts`, seeded in `expense_categories`; a test keeps
the two equal), each with the account name used in the accountant's file:
Advertising (Meta, Google, TikTok, other); Software and subscriptions;
Postage (Lob, certified mail); Credit monitoring; Payroll; Contractors; Legal
and compliance (attorney, **Texas CSO registration**, the **$10,000 surety
bond** premium); Insurance; Office and rent; Bank fees; Card and ACH
processing fees; Phone and WhatsApp; Taxes and licenses; Other. Bank lines
get a suggested category from their words (FACEBK → Meta, LOB.COM →
Postage…); the person can always change it.

**Receipts** follow the intake upload pattern (`intake/files.ts`): the type
is decided from the file's first bytes, never its name: JPG, PNG or PDF, up
to 10 MB (HEIC is refused with a way out). They go to the private bucket
`accounting-receipts` (no storage policy: only the server reads and writes)
at `<expense id>/<uuid>.<ext>`, and are opened with a link that works for two
minutes. A receipt can be attached to an expense of a closed month (it changes
no number). In the demo a receipt up to 1.5 MB is kept in this browser.

**Duplicates** in a bank import: the same date, amount and first words twice
in the file; a line whose fingerprint is already in the books (the unique
index `expenses_one_per_bank_line`); or an expense entered by hand of the same
amount within 3 days whose vendor or category matches. Such a line starts
unticked; a person may still tick a near match. The same file twice
(SHA-256) is refused. Money in is never an expense. A monthly rule is not
posted for a month in which the bank import already brought the same vendor
and amount.

**Bank feeds** (`bankFeeds.ts`): the provider interface for later (e.g.
Plaid). Off: the only provider is "none", and the Plaid entry is a
placeholder that refuses to run and makes no call. Turning one on needs the
provider's agreement and keys (server only), a read-only scope, and its lines
going through the same import plan as a CSV.

## Reconciliation

Each processor line is matched to a charge by the processor's transaction id
(`charges.gateway_reference`), else by our key for the attempt (NMI `orderid`
= `<charge id>:<attempt>`; Authorize.Net `invoiceNumber` = the first 20 hex of
its SHA-256, as `gateways/shared.ts` makes it), else, as a **suggestion** to
confirm, by the same amount within two days for a charge with no reference on
record. A sale is compared with what the app says was collected; a refund,
void, return or chargeback with the app's record of it. Declined and pending
lines move no money and are not compared. The app side is compared only
inside the days the file covers. A person can **confirm** a suggested match or
**explain** a difference (with a note); both are append-only decisions
(`reconciliation_matches`). Fees: the file's fee column and fee lines.
Deposits: sales − refunds − chargebacks − fees per settlement day and batch,
to compare with the bank statement.

**UNVERIFIED**: the column names of NMI's transaction report and of
Authorize.Net's transaction / settlement downloads (`reconcile.ts` ALIASES),
and how each writes a refund (some exports write a negative sale; that is
handled). The mapping step lets a person point at the right columns; update
the aliases once a real export is in hand.

## Collections

Only charges that exist are listed, and the database lets a charge exist only
after the cancellation window: under Credalti Complete for work already
done, under Credalti DIY for the period's subscription or the letters we
mailed (BILLING.md). Nothing is
ever asked for work not yet done; upcoming charges are not receivable.

- The system already retries a declined card on day 3 and 7 and tells the
  client each time with the "Update my card" link (`billing/dunning.ts`). The
  card shows "The system will retry" or "Retries used up: needs a person".
- **Reminders: WhatsApp or email only, sent by the person** (a wa.me link or
  an email draft, in the **client's** language, with the same plain words as
  the automatic notice). **Never SMS**: there is no SMS kind in the code, the
  API schema or the database.
- Blocked, with the reason on screen: the client asked for no messages (STOP;
  the database refuses it too, from `message_opt_outs`), quiet hours on the
  client's clock (9 p.m.–8 a.m.), a reminder in the last 3 days, a cancelled
  agreement or a request to end the service (an administrator decides), no
  email on file.
- **A person decides any next step**, recorded with a note: called, wait,
  pause billing (done on the client's billing card), write off (stop asking;
  the charge leaves receivables, the charge itself is untouched). No late
  fees, no threats, no collection agency, nothing reported anywhere.

## Month close

"Close the month" (Reports) keeps the month's figures as they were that day
(`month_closes.totals`). The database then refuses any new expense or other
income dated in it, and any change or void of one
(`accounting_closed_month_guard`), except an **adjustment**: a new row marked
as one, dated in that month, which can never change afterwards (correct it
with another adjustment). The report of a closed month shows how much the
adjustments moved it ("drift"). A month can be closed only after it is over
(Texas calendar), once; there is no reopen. The checklist (monthly expenses
posted, bank statement imported, export reconciled, fees from the statement,
receipts) is advice, not a lock. Billing records are never locked by a close:
a refund of a closed month's charge is dated the day it happens.

## Partner commissions and the 1099-NEC

While "Partner commissions" (`/equipo/socios`) is **off**, nothing can be
recorded (the database refuses it, PARTNERS.md) and the books show **no**
commission figures: no payable, no "partner commissions paid" line. When it is
on, the amounts an administrator recorded (`partner_commissions`, owed and
paid) are added up per partner; paid amounts are a cash-out line in the P&L.
The app never computes or pays a commission.

The 1099-NEC list reads recorded **payments** in the calendar year (they
count even if the switch was turned off later), ≥ $600, with the W-9 status.
The tax id itself is never stored: `partner_tax_info` keeps the legal name,
the day the W-9 arrived and whether it says the partner is exempt, and refuses
a legal name that looks like an SSN or EIN.

## Taxes

`taxSetAside` = the owner's percentage (default 25%, 0–60%) of the profit so
far this year, never below zero. Dates (`taxes.ts`): federal estimated tax
(Jan 15, Apr 15, Jun 15, Sep 15), Form 1099-NEC (Jan 31), payroll forms (if
payroll), the federal return (Mar 15 or Apr 15 depending on the entity), the
**Texas franchise tax report** (May 15). Weekends move to Monday; holidays are
not counted.

## Files for the accountant

- **QuickBooks / Xero CSV**: `Date` (MM/DD/YYYY), `Account`, `Description`,
  `Amount` (money in positive, money out negative), `Class` (plan type for
  income, category group for expenses). Income accounts:
  `Sales:Credit Repair Services`, `Sales:Refunds & Allowances`,
  `Sales:Chargebacks`, `Other Income:Monitoring Commissions`; fees
  `Merchant Account Fees` (estimate rows say ESTIMATE); partners
  `Commissions & Referral Fees`. No client names (the invoice number
  identifies a charge).
- P&L CSV, income ledger CSV (names masked unless shown), expenses CSV, 1099
  CSV. Every cell goes through the billing `toCsv`, so nothing is read as a
  formula.

## Who can open it

The capability `accounting` (`staff/permissions.ts`): administrators (the
owner) only; specialists and sales see "Only an administrator can…". Every
route asks `requireCapability("accounting")`; the database reads through
`staff_can_see_accounting()` (an active administrator). Clients, partners,
anonymous visitors, specialists and sales read nothing from any accounting
table (PGlite tests), and nobody writes through the API: only the server, with
the service role, after the role check. Every change adds a row to
`accounting_audit` (append-only). If a bookkeeper role is added later, give
it `accounting` and update `staff_can_see_accounting()` together.

## Database (migration 0036)

`expense_categories`, `accounting_settings` (set-aside percentage, bank feed
"none"), `month_closes` (append-only, only after the month), `accounting_imports`
(append-only, the same file once per kind), `accounting_recurring` (stopped,
not deleted; terms never change), `expenses` and `other_income` (voided, never
deleted; the closed-month guard; adjustments), `settlement_rows` (append-only,
one per gateway + transaction + kind), `reconciliation_matches` and
`collection_actions` (append-only; a collections step only for an unpaid
charge of that client, no reminder after an opt-out), `partner_tax_info` (no
tax id), `accounting_audit` (append-only), the bucket `accounting-receipts`.
Row level security on all, select-only for accounting staff.

## The demo

Invented books in this browser ("Reset the example"), counted back from today:
six months of expenses (amounts are examples, not quotes or fee schedules),
monthly rules, IdentityIQ commissions, the month before last closed, one demo
charge marked as a test (excluded), a sample bank statement and a sample NMI
export with a difference of each kind on purpose.

## What is not done

- Nothing has been checked against a real bank statement, a real NMI or
  Authorize.Net export, or a CPA. The export column names are UNVERIFIED.
- Ad spend comes from expenses; reading it from Meta/Google/TikTok
  (read-only) is an interface for later (`AdSpendSource`).
- Bank feeds are off (placeholder only).
- Leads in unit economics are the people the console knows (clients and
  converted prospects); open prospects are not counted.
- Revenue is cash basis only; there is no accrual view.

## Questions for the CPA

1. **Texas sales tax.** Do Credalti's credit repair services (and the
   referral commissions it receives) count as taxable services in Texas
   (for example as credit reporting or debt collection services, or as data
   processing), so that Credalti must hold a sales tax permit and collect
   sales tax? We have not assumed either way, and nothing computes it.
2. Cash or accrual basis for Credalti's books and returns, given that every
   charge is collected only after the work (CROA)?
3. Which entity and federal return applies (Schedule C, 1120-S, 1065,
   1120), and the estimated-tax schedule that follows from it?
4. Texas franchise tax: which report(s) Credalti files each May (no-tax-due
   threshold, Public Information or Ownership Information Report).
5. The Texas CSO registration fee and the $10,000 surety bond premium:
   expense in the year paid, or spread over the term?
6. Monitoring referral commissions from IdentityIQ: ordinary income; does
   IDIQ issue a 1099 to Credalti, and anything to reconcile against it?
7. Partner commissions: confirm the 1099-NEC treatment (≥ $600, W-9 before
   paying, backup withholding without one), and whether any partner payment
   needs a different form.
8. Refunds and chargebacks: reductions of revenue (as here) or expenses?
   Processing fees: the account and whether the estimate is acceptable until
   the statement arrives.
9. Written-off receivables: on cash basis nothing was recognized; confirm no
   bad-debt deduction applies.
10. A sensible default set-aside percentage for the owner's situation.
11. Record retention: how long to keep receipts, bank statements and
    processor exports (we keep them indefinitely; nothing is deleted).
