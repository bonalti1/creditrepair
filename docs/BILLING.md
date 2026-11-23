# Billing

Federal law (the Credit Repair Organizations Act, 15 U.S.C. §1679b(b)) forbids
a credit repair company from charging or receiving money for a service before
that service is fully performed. Credalti's billing offers what Credit Repair
Cloud (CRC) offers, in CRC's words, and is built so the software **cannot**
charge a client for work that is not recorded as done: the pure rules
(`src/lib/billing/rules.ts`) and the database triggers
(`supabase/migrations/0011_billing.sql`, `0026_billing_plans.sql`) refuse it
separately, whoever asks.

Nothing here is legal advice, and nothing has been reviewed by an attorney.
The legal points come from memory: legal and processor sites could not be
opened from the build environment. Every plan text, both payment
authorizations and both programs (pay per delete, referral credits) are
marked attorney-pending and are blocked from real clients until the owner
records the attorney's approval.

## Plans (`/equipo/planes`, administrators)

Laid out like CRC's "Manage Plans": name, plan type, first work fee yes/no,
recurring amount, due date, duration, household discount, and a **payment
timeline preview** worked out by the same rules that charge (an example
client with rounds every 40 days, billed day by day).

| Plan type (CRC name) | What it charges | What the work is | Why it does not charge first |
| --- | --- | --- | --- |
| **Subscription (monthly)** | A fee for each 30-day period (counted from the first round's mailing) in which a round was mailed | The round mailed in that period | Charged only when the period has ended. A period with no round has no charge ("No work this month, no charge") |
| **Per round** | A fee for each round mailed (optionally up to N rounds) | The round | Charged the day after the round is mailed |
| **Flat fee** — installments | A fixed total for N rounds in N equal installments (the last carries the remainder) | Installment *k* is round *k* | Each installment only after its round is mailed; never more than N |
| **Flat fee** — after the last round | A fixed total for N rounds in one charge | Round N | Charged only after round N is mailed |
| **Pay per delete** (attorney-pending, off) | A fee per item the client disputed **through us** that a **later** report no longer shows ("deleted"; "updated" only if the plan says so) | The report pull that proves it, after the round that disputed the item | Charged after that report is imported, items batched, 30 days apart, up to the per-client cap. Off until an administrator records the attorney's approval of the program |

Options on every plan:

- **First work fee** (CRC's name), allowed with its timing redefined: charged
  once, **only after the client's first round is mailed**, never at signup and
  never when letters are only saved. With per round and flat installments it
  is part of the first round's charge; with subscription and flat-after-last
  it is its own charge on round 1. Not offered on pay per delete (its promise
  is "if nothing changes, you pay nothing").
- **Due date**: "after the first round is mailed" (default) or "N days after
  the first round is mailed" (1–30). CRC's "N days after the plan is saved"
  and "when letters are saved" are shown disabled with the reason: both can
  charge before any work is performed.
- **Duration**: indefinite, N months (subscription) or N rounds (per round);
  a flat fee lasts its rounds.
- **Most you'll pay** (the cap): the lower of the plan's own maximum and an
  explicit cap; required when the plan has no end. Printed in the agreement
  summary, the contract and on "Mis pagos" ("Most you'll pay: $X"). The last
  charge is trimmed to what is left; nothing is charged after it. Refunded
  charges do not count toward it.
- **Household discount**: a percent off every amount for two linked clients
  (a couple or household; `household_links`, one household per client).
- **No setup fee**: there is no field for one. A request carrying
  `setupFee…`, `enrollment…`, `signup…`, `activation…`, `retainer…`,
  `upfront…`, `deposit…` is refused with the reason, and the table has a
  check constraint against those keys.

### Versions and the signed snapshot

A plan version is a **draft** while it is edited, then an administrator
records the attorney's approval (name, date, "I confirm"), then it can be
**offered** (active); an offered version never changes (a change is a new
version, and offering it retires the old one); **retired** versions stay as
records. One active version may be the **default**; an administrator can
offer a specific plan to one client before they sign (`client_plan_offers`).

When the client signs, the agreement's `terms.plan` keeps a snapshot of the
exact version: its id, number, terms, the hash its approval is tied to
(`planTermsHash`: terms, names and the generated contract text in both
languages, `PLAN_TEXT_VERSION`), and the effective amounts after any household
discount. The database refuses a signature whose snapshot is not exactly an
active, approved version with the right amounts (trigger
`service_agreements_plan_check`), and the signed terms can never change
(0010). Billing reads only the snapshot.

The contract's "What it costs" section is generated from the plan
(`paymentTermsLines`, `neverInAdvance`), so it says exactly what billing does;
the document hash covers it. **The agreement is ready to sign only when the
plan version offered is attorney-approved** (`agreement/readiness.ts`:
`planApproved`), on top of the agreement version and the statutes.

Agreements signed before plans existed carry no `terms.plan` and are billed
exactly as before: per mailed round at the signed `monthlyFee`.

## The invariants, and where each is enforced

| Invariant | Pure rule | Database |
| --- | --- | --- |
| No charge before recorded work: a round marked mailed, dated in the past, with a letter that went out, mailed after the cancellation window | `planRounds`, `pickUnit` | `charges_guard_insert`, `billing_performed_round` |
| Subscription: only an ended 30-day period that has a round; named by the first round mailed in it | `subscriptionPeriods` | period computed by the trigger; "still open" and "named by the first round" refused; `unique (agreement_id, period_start)` |
| Pay per delete: only items disputed through us, proven gone by a later report, still gone, never charged before | `chargeableResults` | `billing_result_proved_at` (letter_items → letters → mailed round; `item_results` proof pull after the dispute, item's last sighting before the proof); `charge_items.item_id` unique |
| One charge per unit of work, ever (a re-mailed round is the same round) | `pickUnit` | `charges_one_per_round_work`, `charges_one_first_work`, `charges_one_per_period`, `charges_one_per_installment`, `charges_one_flat` |
| At least 30 days apart | work date **and** creation of the last charge | `work_date` and `created_at` (forced to `now()`) of every earlier charge |
| Signed snapshot amounts only | `effective` amounts | expected amount recomputed from `terms.plan`; first work fee part checked |
| Never above the plan's maximum total | `remainingUnderCap` | sum of non-refunded charges of the agreement |
| Due date (N days after round 1) | `before_due_date` | refused before `first round + max(1, N)` days |
| Nothing in the cancellation window, after a cancellation or a request to end the service | gate | trigger |
| Pay per delete and referral credits off until the attorney's approval | `switches` | `billing_switch_on()` (append-only `billing_program_changes`) |
| Staff can never create a charge or change an amount | no such operation | service role only; amounts and units frozen (`charges_guard`) |

Verified on PGlite (`src/lib/__tests__/db/billingPlans.test.ts`): each plan
type's forbidden cases refused by the database itself, the allowed ones work,
and the billing run charges at the snapshot amounts once.

## Payment methods: card and ACH bank debit

- Both come from the processor's **hosted fields** (`components/billing/HostedFields.tsx`):
  NMI Collect.js or Authorize.Net AcceptUI. The app gets a token; it never
  sees a card, account or routing number. The vault refuses a reference that
  is only digits (a card, account or routing number).
- **ACH** has its own authorization (`billing/achAuthorization.ts`,
  `ACH_AUTHORIZATION_VERSION`, attorney-pending, versioned, hashed): amount
  (from the signed plan, with the most-you'll-pay total), timing (only after
  the work, at most every 30 days), what happens on a return (no fee), how to
  revoke (remove it in "Mis pagos" or write), a copy. Real money needs
  `NEXT_PUBLIC_ACH_AUTHORIZATION_APPROVED_VERSION` set to that version.
- **Returns** (`billing/achReturns.ts`) map to the existing dunning: R01/R09
  (funds) → retried on day 3 and 7 on the same charge; R02/R03/R04/R16/R20
  (account) → no more tries, the case pauses until a new method; R05/R07/R10/
  R11/R29 (not authorized / revoked) → the account comes off file, a person
  looks; anything else → a person. The database lets a paid charge go back to
  `failed` only with its `payment_returns` row on record.

## Gateways (`BILLING_GATEWAY=nmi|authorize_net|demo`)

Keys only from the environment (`.env.example`). Idempotency by our charge id
and attempt number. Refunds become voids when the charge has not settled.
Webhooks at `POST /api/billing/webhooks/<gateway>`, signature checked before
anything is read, each event applied once (`gateway_events`).

**NMI** (`gateways/nmi.ts`). Confirmed from NMI's documentation as quoted in
search results: Collect.js with `data-tokenization-key` and `response.token`;
the tokenization key is public and only makes tokens; `payment_token` with
`type=sale`; `customer_vault=add_customer` returns `customer_vault_id`, used by
later sales; `response_code` 100 approved / 200 declined; webhooks signed with
HMAC-SHA256 over `nonce + "." + body`, header `Webhook-Signature: t=<nonce>,s=<sig>`;
event names `transaction.<action>.<result>` and a "Check Status" family.

UNVERIFIED (NMI):
1. Endpoint URLs `https://secure.nmi.com/api/transact.php` and `/api/query.php`, and `/token/Collect.js`.
2. No native idempotency key: we send our key as `orderid` and ask the Query API (`order_id`) before every sale.
3. Query API element names (`transaction_id`, `order_id`, `condition`, `action_type`, `cc_number`, `cc_type`, `check_account`, `account_type`) and `report_type=customer_vault`.
4. `sec_code=WEB` on a vault sale to a bank account.
5. Condition names `pendingsettlement`/`pending` (void instead of refund).
6. Webhook body fields (`event_id`, `event_type`, `event_body.transaction_id`, `action.response_code`, `action.amount`) and the exact names `transaction.check.status.return|latereturn|settle` and `chargeback.*`.
7. Collect.js `configure()` options (`variant`, `paymentType`, field selectors, `callback`) and `startPaymentRequest()`.

**Authorize.Net** (`gateways/authorizeNet.ts`). Confirmed from Authorize.Net
documentation and staff answers in its forum, as quoted: opaqueData with
`COMMON.ACCEPT.INAPP.PAYMENT`; a payment profile created from it with
`validationMode: liveMode`; the token is one-time; AcceptUI's
`data-paymentOptions` with `showCreditCard`/`showBankAccount`; eCheck.Net must
be on for bank fields; webhooks signed `X-ANET-Signature: sha512=<HEX>` over
the raw body.

UNVERIFIED (Authorize.Net):
1. Whether the signature key is used as hex bytes or as text (both are tried).
2. Whether a bank (eCheck) nonce can create a payment profile (forum answers disagree).
3. 20-character limits of `refId` and `invoiceNumber` (we send a 20-char hash of our key).
4. `getUnsettledTransactionListRequest` returning `invoiceNumber` (our idempotency check).
5. `responseCode` "4" (held for review) treated as "no definite answer".
6. Refund to the stored profile instead of the card's last four digits.
7. AcceptUI script URLs and button attributes; the E00039 duplicate-profile message format.
8. No webhook for eCheck returns or chargebacks: staff record them by hand from the Merchant Interface (`/equipo/cobros`, evidence page).

## Chargebacks

Recorded from a webhook or by hand (`chargebacks`, one per charge, only for
money taken; open → won/lost/accepted, closed stays closed). For each charge,
**one click** generates the **evidence pack** (`/equipo/cobros/<charge id>`,
`/api/staff/billing/evidence`; `billing/evidence.ts`): the charge; the signed
agreement (version, document hash, time, IP, browser); the plan snapshot and
its generated terms; the payment authorization (version, hash, time, IP); the
exact work (letters, recipients, mailing dates, mail class, USPS tracking,
delivery and return scans; for pay per delete the items with dispute and
proof dates); the receipt and the messages to the client about it; refunds
and the dispute. Printable to PDF, downloadable as HTML, with its own SHA-256.
What each processor's dispute form wants is UNVERIFIED.

The **chargeback rate** (chargebacks received ÷ charges taken, by count, in
the window) is on the dashboard and the invoice list, with a warning from
0.75%: processors commonly act around 1% (the exact formula each uses is
UNVERIFIED).

## Invoices, statements, exports

- Every charge gets an invoice number from the database (`INV-2026-000123`).
  Status: paid, processing, failed, refunded, voided, disputed.
- **Mis pagos**: the plan, "Most you'll pay", charged so far, each invoice
  (printable), and monthly statements, with "No work this month, no charge"
  for a subscription period without a round.
- **`/equipo/cobros`**: the invoice list with filters (status, method, plan,
  dates, client or invoice), the **transactions CSV** and a **QuickBooks CSV**
  (date, invoice, client, amount, fee estimate, net, method, status); also
  `GET /api/staff/billing?format=transactions|quickbooks`. Cells are never
  read as formulas. Processing fees are an **estimate** from
  `NEXT_PUBLIC_BILLING_FEE_*` (defaults: card 3.9% + 30¢, ACH 1% + 30¢ capped
  at $5); the real figure is on the processor's statement.

## Referral credits (off, attorney-pending)

A client who refers another client (`client_referrals`, recorded by staff)
earns a credit (`client_credits`, the amount the program sets) once the
referred client has signed and their cancellation window is over. The credit
lowers the next charge that is due; it never creates a charge and never pays
before the work. A charge covered in full is settled without the processor.
A refund returns what was collected. Separate from partner commissions.

## Staff and dashboard

The client's billing card shows the signed plan and version, "most they'll
pay" with what has been charged against it, upcoming charges with the work
each one will pay for, invoice numbers and chargebacks. The business
dashboard adds revenue by plan type, ACH vs card share, estimated processing
fees and the chargeback rate.

## What the owner must do

1. Open a merchant account that accepts credit repair (NMI or Authorize.Net
   are the two adapters), set `BILLING_GATEWAY` and the keys (`.env.example`),
   and point the processor's webhooks at `/api/billing/webhooks/<gateway>`.
2. Check every UNVERIFIED item above against the processor's sandbox.
3. Build the plans in `/equipo/planes`, have the attorney approve each version
   and the generated contract text, record the approvals, offer them.
4. Attorney review of the card and ACH authorizations; then set
   `NEXT_PUBLIC_PAYMENT_AUTHORIZATION_APPROVED_VERSION` and
   `NEXT_PUBLIC_ACH_AUTHORIZATION_APPROVED_VERSION`.
5. Only with the attorney's written approval: turn on pay per delete or
   referral credits in `/equipo/planes`.
6. Set the fee estimates (`NEXT_PUBLIC_BILLING_FEE_*`) from the merchant
   account's pricing.
7. n8n (or any cron) calls `POST /api/cron/billing` hourly with the shared secret.

## Questions for the attorney

Every plan type
1. Is a round of letters mailed "fully performed" service under §1679b(b), so it may be billed the day after mailing?
2. Is the generated payment-terms text of each plan version adequate for the contract (CROA §1679d; Tex. Fin. Code §393.201)? Each version is approved separately.
3. After a client asks to end the service, may already-performed, unbilled work still be charged?
4. Texas Finance Code ch. 393 on fees and the bond, as they apply to each plan type.

Subscription (monthly for work done)
5. May a fee be called "monthly" when it is charged only for a 30-day period in which a round was mailed, at the end of that period?
6. Is one mailed round enough "work" for a whole period's fee, or must the fee be prorated to the work?

Flat fee
7. Installments: is charging installment *k* after round *k* consistent with §1679b(b) when the package price covers N rounds?
8. One charge after the last round: is the client's price for earlier rounds "received" before those rounds are performed if a first work fee was charged?

First work fee
9. Is a one-time fee charged after the first round is mailed (and described as such) permissible, and must it be tied to specific work?

Pay per delete
10. Under CROA, the Telemarketing Sales Rule (16 C.F.R. §310.4(a)(2)) and Texas ch. 393, may we charge per item a later report no longer shows? Does the pricing itself imply results? Is the wording "If an item you disputed no longer appears on a later report, you pay $X for it. If nothing changes, you pay nothing." acceptable?
11. May an "updated" item count, and what if the item later reappears after it was charged?
12. Is the per-client cap required or advisable, and at what level?

Household discount
13. Any issue with a discount conditioned on another client signing (two linked clients)?

Referral credits
14. Is a credit for referring another client permissible (a referral inducement), and must it be disclosed in the contract? Does it differ from partner commissions (RESPA §8 where mortgage-related)?

ACH
15. The ACH authorization wording: Nacha rules for consumer WEB debits (authorization form, amount or how determined, timing, revocation and its timing, copy), and Regulation E for preauthorized transfers (notice of varying amounts?).
16. Must we give advance notice of each debit when the amount varies by plan (e.g. a trimmed last charge)?

Card authorization, refunds, chargebacks
17. Wording of the recurring card authorization; Regulation E for debit cards.
18. Refund policy wording; responding to chargebacks with the evidence pack (personal data in it).
