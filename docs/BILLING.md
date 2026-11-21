# Billing

Federal law (Credit Repair Organizations Act, 15 U.S.C. §1679b(b)) forbids a
credit repair company from charging or receiving money for a service before
that service is fully performed. Billing is built so the software **cannot**
charge a client for work that is not recorded as done.

## How it works

- The billable unit is a **round of letters actually mailed** for the client.
- The amount is the fee in the client's **signed agreement** (its terms
  snapshot), never today's config.
- One charge per round, ever. A failed attempt retries the same charge with the
  same idempotency key, so a retry can never charge twice.
- No charge earlier than the day after mailing (`CHARGE_DELAY_DAYS = 1`), so a
  round marked sent by mistake can be corrected first.
- At most one charge every 30 days (`MIN_DAYS_BETWEEN_CHARGES`), whatever the
  rounds do.
- Nothing is charged inside the cancellation window, after a cancellation, or
  for a client who asked to end the service (`BILL_PERFORMED_WORK_AFTER_END_REQUEST
  = false`; a person decides).
- No setup, cancellation, late or mailing fees.
- Failed payment: retried after 3 and 7 days, with a plain message each time.
  After the last failure the case pauses (no new rounds) until payment is fixed;
  paying resumes it automatically.
- Staff can refund (with a written reason) or pause a client's billing. Staff
  can never create a charge by hand or change an amount.
- We never see or store card numbers: only the processor's token, the brand and
  the last four digits. The token is not readable by the client or staff.

## Where each rule is enforced

| Rule | Pure rules (`src/lib/billing/rules.ts`) | Cron route (`/api/cron/billing`) | Database (`0011_billing.sql`) |
| --- | --- | --- | --- |
| Only mailed rounds, mailed date in the past | ✓ | ✓ (asks the rules) | ✓ trigger refuses the insert |
| Agreement signed, not cancelled, window over | ✓ | ✓ | ✓ trigger |
| One charge per round | ✓ | ✓ | ✓ `unique (round_id)` |
| Amount positive, never edited | ✓ | — | ✓ check + trigger |
| No deletes of charges or refunds | — | — | ✓ |
| Only the server writes | — | ✓ service role | ✓ RLS |

Verified on PGlite: 125 database checks (each forbidden thing refused, each
allowed thing works).

## What the owner must do

1. **Choose a payment processor that accepts credit repair businesses.** Many
   ordinary processors do not. Which ones do has **not** been verified here.
2. **Write its adapter** in `src/lib/billing/gateway.ts` (interface:
   `createCustomer`, `attachPaymentMethod(token)`, `charge({ amountCents,
   idempotencyKey })`, `refund`), add its name to the accepted list, set
   `BILLING_GATEWAY`. Card entry must use the processor's hosted fields.
3. **Set the plan fee** (`NEXT_PUBLIC_PLAN_MONTHLY_FEE`, see `docs/AGREEMENT.md`).
4. **Attorney review** of the recurring-payment authorization, then set
   `NEXT_PUBLIC_PAYMENT_AUTHORIZATION_APPROVED_VERSION`.
5. Have n8n (or any cron) call `POST /api/cron/billing` with the shared secret,
   like `/api/cron/rounds`.

## Questions for the attorney

1. Is a round of letters mailed "fully performed" service under §1679b(b), so it
   may be billed the day after mailing?
2. May the fee be described as "monthly" when it is charged per mailed round,
   at most once every 30 days?
3. After a client asks to end the service, may already-performed, unbilled work
   still be charged?
4. Wording of the recurring-payment authorization; Regulation E requirements
   for debit cards.
5. Texas Finance Code ch. 393 requirements on fees, and on the bond, as they
   apply to this billing.
6. Refund policy wording.

The legal points above come from memory; legal sites are not reachable from
the build environment, so no statute wording here is verified.
