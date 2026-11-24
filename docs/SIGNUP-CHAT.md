# Sign up in a chat with Alti, and calls with a person

One more way to sign up, beside `/onboarding`, `/acuerdo` and the
salesperson's invitation (all unchanged): the whole signup in one chat with
Alti, the AI assistant, at **`/registro`**. Built after looking at a
competitor's chat signup (a "specialist" chat with a progress bar, a case
number, the price in the chat and the disclosures as a sheet), keeping what
works and dropping what does not fit our rules: our assistant says he is AI
and is labelled as AI on every message, never a human-looking fake specialist;
the price shown is only an attorney-reviewed plan; nothing is charged before
the work.

Also built: **"Schedule a call with a person"**, switched **off** by default.

*Nothing here is legal advice. The attorney questions are at the end and in
`docs/SALES-FLOW.md`.*

## Where it lives

| Piece | File |
| --- | --- |
| The page (server: offered plans, the flags) | `src/app/registro/page.tsx`, `layout.tsx` |
| The chat | `src/components/signup/SignupChat.tsx` |
| Bubbles (Alti's runs, labelled "Alti · AI assistant") | `src/components/signup/Bubbles.tsx` |
| The five-step bar | `src/components/signup/SignupProgressBar.tsx` |
| The disclosures and contract sheets | `src/components/signup/AgreementSheets.tsx` |
| Sign in by phone, in the chat | `src/components/signup/PhoneSignIn.tsx` |
| "Rather talk to someone?" | `src/components/signup/TalkToPerson.tsx` |
| Words (EN/ES), the transcript | `src/lib/signup/copy.ts` |
| Steps, saved progress | `src/lib/signup/steps.ts` |
| Case reference | `src/lib/signup/caseRef.ts` |
| The report in counts | `src/lib/signup/reportSummary.ts` |
| Soft-pull provider interface | `src/lib/credit/softPull.ts` |
| The signup's record | `src/lib/signup/server.ts`, `src/app/api/signup/route.ts`, table `signup_cases` |
| Calls | `src/lib/calls/*`, `src/app/registro/llamada`, `src/components/signup/CallBooking.tsx`, `src/app/api/calls`, `src/app/api/staff/calls`, `src/app/equipo/llamadas`, `src/components/staff/CallsScreen.tsx`, `CallsQueue.tsx` |
| Database | `supabase/migrations/0032_calls.sql` (in `supabase/setup.sql`) |
| Tests | `src/lib/__tests__/signupChat.test.ts`, `calls.test.ts`, `db/calls.test.ts` |

Linked from the website: under every "Start my review" button group, "Or sign
up in a chat with Alti, in about 10 minutes" (`CHAT_START` in
`src/lib/site/cta.ts`). The main button is unchanged (WhatsApp when a number
is set, else `/onboarding`).

## The flow

First screen: Alti says he is AI, shows the case number, and offers two
choices: **Sign up now with Alti (about 10 minutes)** or **Talk to a person
first** (WhatsApp with the team, the message carrying the case number; and
"Schedule a call" only when calls are on). The case number ("CR-7KQ4M") is in
the header from the first moment.

| Step | What Alti asks | What it writes, with the existing code |
| --- | --- | --- |
| 1 Get started | First name, goal, state | The state check is the open-states switch (`useOpenStates`, `/equipo/estados`): only Texas is open; a closed state gets the waitlist form (`/api/waitlist`); Georgia gets the "restricted" explanation and no form. |
| 2 Your info | Last name (as on the ID), SSN or ITIN (the kind only), email (optional), then the cell phone | Sign-in is the `/login` code (Supabase phone code; text messages only for login codes). Then the profile through `/api/profile/onboarding` (goal, state, id type, salesperson and partner from an invitation link), the same record onboarding writes; the account is linked to the case. |
| 3 Verify identity | Mailing address, ID, proof of address | `MailingAddress` and `IdentityDocs` (the intake: `/api/intake/document`, automatic check, a person sees what fails). "I'll do this later" is allowed; letters wait for them. |
| 4 Your report | — | When a report is on file: what it lists in counts and words ("5 accounts. Among them: 2 collections and 1 account with late payments…"), then "you choose which look wrong; only you decide" and "nobody can promise how the bureaus respond". No score, no gauge, no colours. With no report (the usual case): the monitoring subscription (IdentityIQ, `MONITORING_OFFER`, with the commission disclosure), turned on **right after signing**. |
| 5 Sign up | — | The plan: attorney-approved, offered plans only (`publicPlans`, as `/precios`); with none, the rule only ("How every charge works") and "your plan is in the agreement". Then the two sheets below. |

**The sheets** reuse the agreement itself (`useAgreement` → the same
`/api/agreement/acknowledge` and `/sign`, the same documents, readiness,
state documents, plan snapshot, hash and name checks as `/acuerdo`):

- *Step 1 of 2 · TX*: "Your rights first": the federal **Consumer Credit File
  Rights Under State and Federal Law**, the Texas statement and the
  e-sign consent, as their own document before the contract. The consent
  checkbox, then **I read this** (records the acknowledgement) or **I have a
  question first**: the sheet closes, Alti answers in the chat (the website's
  "Ask Alti" route, `/api/site/ask`: guardrails, no personal data, nothing
  stored), and "Back to my rights" reopens the sheet at the same scroll spot.
- *Step 2 of 2 · TX*: plain-words summary, the contract, the authorization,
  the notice of cancellation, the statements by the signature, typed legal
  name, three consents, **Sign**. Nothing is charged when signing.

After signing: the cancellation deadline (3 business days, Texas time), "Turn
on my credit monitoring" (when the partner link is set), "Go to my app"
(`/asistente`, where the item review and the attestation happen, untouched) and
the printable copy. With a real database and an unapproved agreement, Alti says
the agreement is in its final review and a person will write; nobody signs.

**Progress** is saved on the device (`bonalti.signupChat.v1`: names, goal,
state, id kind, optional email, report counts; never a number or the report)
and on the server (`signup_cases.step`). A person who comes back sees "Welcome
back" and the same place. "Rather talk to someone?" is at the bottom of every
step and records that they asked (`wants_person`).

**Rules held**: Alti is labelled "Alti · AI assistant" above each run of his
messages and inside each bubble for screen readers; his first message says he
is AI, not a person; "talk to a person" shows a person icon, never a
character; the robot never appears (brand test). Every line passes
`checkMarketingCopy` and `checkClaimGuardrails` in both languages, has no
"free", no pressure words, no outcome words, no score talk, no sentence over
25 words (`signupChat.test.ts`). Inputs are labelled, everything works by
keyboard (Escape closes sheets and the panel), the thread is a polite live
region, and motion stops under reduced motion.

## The case reference

"CR-" and five characters from `23456789ABCDEFGHJKMNPQRSTWXYZ` (no 0/O, 1/I/L,
U/V). The server makes it (`POST /api/signup` `start`) with a random resume
token; only the token's SHA-256 is stored. The row moves forward only, is
linked to the account once, and is never deleted. Staff read it by scope
(a lead's by administrators and sales). Demo: the reference is made on the
device and nothing is stored.

## The instant soft pull (not connected)

`src/lib/credit/softPull.ts` defines `SoftPullProvider` and a registry.
`SOFT_PULL_PROVIDER` defaults to `none`, and with `none` the report step uses
the monitoring subscription. No credit API is called anywhere. To plug one in:
write a provider (server-only keys), `registerSoftPullProvider`, set
`SOFT_PULL_PROVIDER`; the chat then shows a consent checkbox
(`SOFT_PULL_CONSENT`, attorney-pending) and `POST /api/signup` `soft_pull`
returns the counts. Saving the pulled report into the case should go through
the existing import (`importReportForUser`) when a provider is chosen.

## Calls with a person (OFF)

`NEXT_PUBLIC_CALLS_ENABLED` empty (default): no call option anywhere; the
booking page, the console screen and both routes answer 404; the console menu
has no entry. `"1"` turns it on.

- **The team** (`/equipo/llamadas`, capability `calls.manage`: administrators
  and sales) adds call hours on the Texas clock (a day, from, to, 15–60-minute
  calls; at most 12 hours; removed, never edited), sees the calls booked and
  closes each one (done, no answer, cancelled, with a note). Booked calls also
  appear on the console's home under "Needs a person" with the case number,
  the person's question, what was sent, and a call button.
- **The person** (`/registro/llamada`) sees free times on their own clock
  (Texas by default; a zone menu), gives first name and cell number, picks
  WhatsApp (or email when signed in) for the confirmation, and ticks the
  **TCPA consent** to be called at that number (its own box, never pre-ticked,
  "not a condition of buying anything"). Stored with the booking: the words'
  version and hash, time, IP and browser, and the version of the "questions
  only" notice shown.
- **Questions only**, said first on the booking page, in both messages and on
  every staff item: signup and any payment happen afterwards, in writing, in
  the app, never on the call (16 C.F.R. 310.4(a)(2); 310.6(b)(5)).
- **Messages**: a confirmation at booking and a reminder 3 hours before, by
  WhatsApp (approved template outside the 24-hour window:
  `credalti_llamada_confirmada`, `credalti_llamada_recordatorio`) or email
  (needs an account, for the signed unsubscribe link). Never SMS (no such
  channel; the database refuses it). Opt-outs by number or account, the
  autopilot's quiet hours on the person's clock, one message per dedupe key
  (`call:<booking>:<kind>`). Sent at booking when allowed, otherwise by the
  hourly `/api/cron/autopilot` run.
- **Database** (0032): `call_windows`, `call_bookings` (one booking per slot;
  a real, open, future slot; consent required; never rewritten or deleted;
  closed once), `call_messages`. Server writes only; anon reads nothing;
  clients read their own; staff by `staff_can_see_client`, leads by
  administrators and sales.

## For the owner

1. Decide whether to link `/registro` more prominently once tried with real
   people (today: a line under the website's main buttons).
2. Get the two call templates approved in Meta before turning calls on, and
   add them to `WHATSAPP_APPROVED_TEMPLATES`.
3. Turn calls on only after the attorney answers below.
4. A soft-pull provider, if wanted: contract, permissible purpose, consent
   wording, then the steps above.

## For the attorney

1. **Calls and the Telemarketing Sales Rule** (the full question is in
   `docs/SALES-FLOW.md`): does a questions-only call before an online signup
   make the sale telemarketing, so that no fee may be collected until six
   months after results are shown? Is there any design that keeps calls?
2. **TCPA consent text** (`CALL_CONSENT`) and whether calls must check the
   National Do Not Call Registry and Texas telemarketing rules.
3. **Monitoring before or after signing.** The chat keeps the existing order
   (agreement first, then the monitoring purchase). Is that right, and is
   requiring monitoring a "payment" under CROA (`docs/AGREEMENT.md` q. 11)?
4. **A soft pull before signing**: is it a "service" under CROA when free, and
   what consent wording satisfies FCRA §604?
5. **The disclosures as a sheet in a chat**: does a sheet acknowledged with
   its own timestamp, before the contract is shown, satisfy "a document which
   is separate" (CROA §1679c(b)), as asked for `/acuerdo`?
6. **"I have a question first"** answered by an AI assistant from the FAQ:
   any risk in the AI answering questions about the disclosures?
