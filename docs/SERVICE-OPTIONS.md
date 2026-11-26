# Two ways to work with Credalti: Credalti Complete and Credalti DIY

Each client chooses how the service is delivered. The choice is theirs, it is
recorded, and it decides the agreement they sign, how they are billed, what
the app shows them and what the team does for them.

| | **Credalti Complete** · Done for you | **Credalti DIY** · Do it yourself, guided by Alti |
| --- | --- | --- |
| Who it's for | Busy, buying a home soon, or want it handled | Hands-on, tighter budget, not in a rush |
| Who decides what is inaccurate | The client, item by item | The client, item by item |
| Letters | The team prepares them from the approved templates | Alti prepares them from the same approved templates |
| Mailing | The team mails them | The client prints and mails them, or taps "Mail them for me" and Credalti mails the letters they pick, for a fee per letter shown before they confirm |
| Next round | The team prepares it | Alti says when it is due |
| Help | The team, and Alti | Alti, and the team answers questions |
| When they pay | Each month, right after that month's letters are mailed: never before the work (unchanged rule) | A monthly subscription from the start, after the 3-business-day window; a mailing fee after Credalti mails |

Names, subtitles and "Who it's for" are in `src/lib/service/options.ts`
(`OPTION_NAME`, `OPTION_SUBTITLE`, `OPTION_FOR`) and are used everywhere.
Complete is always listed first. Every comparison carries the line "Start
with DIY, upgrade anytime and keep everything you've done", the price of each
option from its offered plan (or "Price set by the team" when none is offered,
as in the demo), and the note that credit monitoring is a separate monthly
subscription (`NEXT_PUBLIC_MONITORING_PRICE`) on which Credalti earns a
commission. The monitoring provider is named (IdentityIQ) only when
`NEXT_PUBLIC_MONITORING_SIGNUP_URL` is set, the existing partner-name rule.

## The owner's decisions (2026-11-25)

Recorded as the owner reported them; not legal advice.

1. The owner reports the attorney approved **Credalti DIY priced like
   Dispute Beast**: a monthly subscription charged from the start, because the
   client performs the disputes with the software.
2. The owner reports the attorney approved **Credalti Complete as built**:
   charged only after the work.
3. Prices are set on `/equipo/planes`.
4. Each plan version still needs its contract text approved through the
   existing approval flow before it can be offered. That gate is unchanged:
   a plan of either option is offered only when active **and** carrying the
   recorded attorney approval.
5. **Full-service monthly timing.** Subscription plans get the timing
   "charge when the period's round is mailed" (`periodTiming: "on_mailing"`),
   the default for new full-service monthly plans. Still never before the
   window, never before the first round, never twice per period, never in a
   period without a round, and always within the cap. The older timing,
   "charged when the period has ended" (`period_end`), stays for plans that
   use it; a plan without the field is `period_end`, so the hash of every plan
   saved before keeps matching.
6. Names and presentation: "Credalti DIY" and "Credalti Complete", Complete
   first, no pressure. Alti may mention once that Complete is usually faster
   for someone buying a home soon; it never pushes either.

## Where the choice is made

- **Signup chat** (`/registro`): after the report step and before the plan, a
  side-by-side comparison with one button per option and an "Ask Alti"
  button. Nothing is pre-selected, except what a link asks for: `option=diy` /
  `option=complete` (the live funnel's video page) or `o=diy` / `o=complete`
  (an invitation, the website's "Start with …") marks that option in the
  comparison, and the person taps it or the other one to continue
  (`linkOption` in `src/lib/sales/invite.ts`). `docs/SIGNUP-CHAT.md`.
- **Onboarding** (`/onboarding`, where the video page's «Get started» and an
  invitation land): when the link carries an option, the same comparison, with
  it marked, comes before the ID question; the prices come from the layout
  (the offered, attorney-approved plans).
- **Website**: `/precios` (after the hero) and `/como-funciona` show the same
  comparison (`src/components/site/OptionsSection.tsx`), with "Start with …"
  links that carry the option to `/registro`.
- **Staff invitation** (`/equipo/invitar`): "The option they want" with
  "Hasn't decided: they choose in the app" selected by default, and the
  comparison as the client sees it. `docs/SALES-FLOW.md`.
- **Later**: More → My option (`/mas/opcion`) to switch.

The choice is written by the server (`POST /api/service-option`,
`src/lib/service/server.ts`) to `client_service_options`, with every change
in the append-only `service_option_changes` and an `events` row. The option
that applies is the **signed agreement in force**, else the chosen option,
else Credalti Complete (`effectiveOption`). `NEXT_PUBLIC_SERVICE_MODE` is
retired: there is no global switch any more (`src/lib/service/mode.ts` keeps
only the type and the default).

## The agreements

Each option has its own text and version (`src/lib/agreement/documents.ts`):
`AGREEMENT_VERSION` (Complete) and `DIY_AGREEMENT_VERSION`
(`2026-11-25-diy-draft.1`). Both carry the same disclosures, the same
3-business-day cancellation, the same signature, fingerprint and snapshot.
The DIY contract says, in bold, that the client prepares and sends their own
disputes with the software, and that Credalti mails a letter only when the
client asks and pays for that letter. `ATTESTATION_TEXT` is unchanged.

A signed DIY agreement records `terms.serviceOption: "diy"`; a Complete one
carries no option, so every agreement signed before keeps its hash. Each
version is offered only after its own approval:
`NEXT_PUBLIC_AGREEMENT_APPROVED_VERSION` and
`NEXT_PUBLIC_DIY_AGREEMENT_APPROVED_VERSION` (`readiness.ts`). DIY also needs
an approved, offered DIY plan.

## Billing

- **Plans** get an option, from their type: `diy_subscription` is Credalti
  DIY; subscription, per round, flat fee and pay per delete are Credalti
  Complete. Each option has its own default plan.
- **Credalti DIY** charges:
  - `diy_period`: the subscription, one per 30-day period, charged at the
    start of the period. The first period starts when the cancellation window
    ends. One per agreement and period; within the cap (the cap counts only
    subscription charges).
  - `mailing`: the plan's fee per letter (`mailFeeCents`, $0–$25) times the
    letters the client asked us to mail, charged only after they are mailed.
    The total is shown before the client confirms, and the request records it.
- **Credalti Complete** is unchanged. The triggers still refuse any
  full-service charge before its work; a DIY unit is never accepted under a
  Complete agreement, and a round or letter **the client mailed** (`mail_via`
  / `mail_provider` = `client`) is never full-service work.
- The triggers (`supabase/migrations/0042_service_options.sql`) decide by the
  **governing agreement** (`public.governing_agreement`: the one in force,
  else the newest) and its option. DB tests: `src/lib/__tests__/db/serviceOptions.test.ts`.

`docs/BILLING.md` has the details.

## The client app

- **Credalti DIY**: "Prepare my letters" (from the approved templates, only
  the items the client confirmed), **Print my letters** (`/attack/imprimir`),
  **I mailed them** (records the date, at most 30 days back; starts the
  bureaus' 30 days and Alti's next-round reminder) and **Mail them for me**
  (pick letters, see "3 letters × $4.00 = $12.00", confirm; the team mails
  them through Lob and the charge comes after).
- The journey strip, Alti's instructions (`coach/systemPrompt.ts`), the
  WhatsApp/status messages and the claim rules follow the client's option.
  Complete clients see what they saw before.

### Upgrade prompts (no pressure)

Alti offers "Want our team to handle it from here?" (labelled "Alti · AI
assistant") at most once per moment, and never to a client who opted out of
messages or turned reminders off (`UpgradeOffer.tsx`, `firstTimeFor`):

1. when a new round is due;
2. when letters are not marked mailed 14 days after they were prepared. This
   moment also creates a gentle follow-up for the salesperson (notice
   `diy_followup`, capability `options.followup`: admin and sales).

## The staff console

- An option badge ("Complete" / "DIY") on the client list (with a filter,
  `?opcion=diy|complete`), the client page, the send queue and the home list.
- DIY clients never enter the mailing queue or the round work (stage
  `with_client`), except the letters they bought "Mail them for me" for: those
  appear in "Ready to send" with only those letters, go **only** by the mail
  service (never the office print; capability `diy.mail_requests`: admin and
  specialist), and the request is closed when they are mailed. They appear in
  "Needs a person" when they ask a question.
- Overview: clients by option above "Clients by stage". Invoices: collected by
  option. Accounting dashboard: revenue by option this month. Business
  numbers: active, signed and charged by option.

## Switching

- **DIY → Complete (upgrade), any time.** The client signs the Complete
  agreement (`/mas/opcion` → `/acuerdo`). The new agreement supersedes the DIY
  one at signature (`superseded_at`, `superseded_by`); everything done is kept
  (reviews, attestations, rounds, letters). Open "Mail them for me" requests
  are cancelled, since the team now mails every letter. Billing switches at
  the next cycle without a double charge: Complete charges wait for their own
  window and work, and full service's 30-day spacing counts the DIY charges.
- **Complete → DIY (downgrade).** The same, the other way. The DIY
  subscription's first period starts at the later of the new window's end and
  30 days after the last charge under the earlier agreement.
- Until the new agreement is signed, the one in force keeps governing (work
  and billing continue as before).

## Counting upgrades

Each switch writes an `events` row at signature: `service_option_upgraded` or
`service_option_downgraded`. `countUpgrades(db, from, to)` in
`src/lib/service/server.ts` returns `{ upgrades, downgrades, userIds }` for a
date range; `listUpgrades(db, userIds)` returns each client's upgrades, which
the campaign scorecard reads per client (`docs/WEBINARS.md`, «Packages»).

## Invariants kept

The client decides what is inaccurate (never staff, never Alti); letters only
from approved templates; no promises; no score visuals; never the word
"free"; never SMS; quiet hours and opt-out; Texas only, never Georgia; Alti
always labelled "Alti · AI assistant".

## Demo

Demo mode shows both options with labelled sample data. Three demo DIY
clients: Valeria (c70, mailed her round herself), Arturo (c71, letters
prepared 16 days ago, a question waiting, the follow-up for sales) and Celia
(c72, an open "Mail them for me" request). The demo plan catalogue has a DIY
plan ("Credalti DIY · monthly", $39 a month, $4 per letter mailed); the
comparison shows "Price set by the team" because no demo plan is approved.

## What the owner must do

1. Set the prices on `/equipo/planes`: at least one Credalti DIY plan (monthly
   amount, the most it can cost, the fee per letter for "Mail them for me")
   and the Credalti Complete plans (new monthly plans default to "charge when
   the month's round is mailed").
2. Have the attorney approve each plan version's contract text, record the
   approval, then offer it. Nothing is offered before.
3. Have the attorney approve the Credalti DIY agreement text
   (`DIY_AGREEMENT_VERSION`), then set
   `NEXT_PUBLIC_DIY_AGREEMENT_APPROVED_VERSION` to it. Until then nobody can
   sign DIY; the comparison still shows it.
4. Run migration `0042_service_options.sql` (`npm run db:setup-sql` already
   includes it in `supabase/setup.sql`).
5. Remove `NEXT_PUBLIC_SERVICE_MODE` from the environment; it does nothing now.
