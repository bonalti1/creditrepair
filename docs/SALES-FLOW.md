# Sales first, then the service

Credalti is full service: the client tells us what is inaccurate on their
report, and our team prepares and mails the dispute letters for them. Most
clients do not sign up on their own. They see an ad, write on WhatsApp, talk
with a salesperson, and only then open the app. The product is built around
that order.

## The path

| Step | Who | What happens | Where it lives |
| --- | --- | --- | --- |
| 1 | Lead | Sees an ad and taps the button, which opens WhatsApp | `/empezar` and the landing page (the button goes to WhatsApp when `NEXT_PUBLIC_WHATSAPP_NUMBER` is set) |
| 2 | Alti (AI assistant) | Greets the lead once, in the language they wrote in (English unless Spanish), says it is AI, and says a person will write | `LEAD_GREETINGS` in `src/lib/integrations/whatsapp.ts`, sent by `src/app/api/webhooks/whatsapp/route.ts` |
| 3 | Salesperson | Talks with the lead in WhatsApp: what they want, where they live, how the service works, the plan | WhatsApp, following the rules below |
| 4 | Salesperson | Fills in a few fields, including **the client's language** (English unless they talked in Spanish), and sends the personal link with a message in that language | `/equipo/invitar` |
| 5 | Client | Opens the link: a welcome screen in their language, with their name, goal and state already filled in | `/onboarding?n=…&g=…&s=…&r=…&lang=…` |
| 6 | Client | Signs the service agreement, uploads ID and proof of address, activates monitoring, signs in with their phone | `/acuerdo`, `/onboarding` → `/login` |
| 7 | Client | Reviews each item on their report with Alti and says which ones are inaccurate and why | `/asistente`, `/items` |
| 8 | Team | Prepares and mails the letters, in rounds about every 40 days, and imports the report again to see what changed | `/equipo` (the staff console) |
| 9 | Client | Reads the letters and follows their status; the salesperson and the team stay available on WhatsApp | `/attack`, `/rounds`, WhatsApp |

Someone who arrives without a link gets the ordinary four-question onboarding.

**One more way in: sign up in a chat with Alti** (`/registro`,
`docs/SIGNUP-CHAT.md`). From the website's "Start my review" ("Or sign up in a
chat with Alti, in about 10 minutes"), the person chooses "Sign up now with
Alti" or "Talk to a person first" (WhatsApp with the team; also "Schedule a
call" when calls are turned on). Alti, the AI assistant, labelled as AI on
every message, walks them through five steps (Get started → Your info →
Verify identity → Your report → Sign up) and they sign the same agreement,
with the same disclosures and the same 3 business days to cancel. A case
reference ("CR-7KQ4M") is on screen from the start and stored with the signup
(`signup_cases`, migration 0032), so whoever answers on WhatsApp or on a call
can find it. The rules below hold in the chat too: Alti never quotes a price
that is not in an attorney-approved plan, never says which items to mark and
never promises a result. The invitation link still works on `/registro`
(`?n=…&g=…&s=…&r=…`), and `/onboarding`, `/acuerdo` and the invitation are
unchanged.

**Calls with a person: built, OFF** (`NEXT_PUBLIC_CALLS_ENABLED`, empty by
default; `docs/SIGNUP-CHAT.md`). When the owner turns it on, a person picks a
time from the hours the team sets in `/equipo/llamadas`, ticks their consent
to be called at that number (TCPA), and gets a confirmation and a reminder by
WhatsApp or email, never by text message. **A call is for questions only.**
Nobody is signed up, quoted a price or asked for payment details on the call;
afterwards the person signs up in writing, in the app. The booking page, the
messages and the team's screen all say so. See the attorney question below
before turning it on.

Two more ways in, both ending at step 4 with the same invitation:

- **HighLevel.** A lead form or ad in HighLevel hands the lead to the app
  (`POST /api/webhooks/highlevel`). It appears in `/equipo` as a prospect with
  its source ("HighLevel · <campaign>"), credited to a salesperson (the one
  HighLevel assigned, else the next in turn). **Preparar su invitación** on the
  prospect fills in the invite page. The app then reports each stage back to
  HighLevel's pipeline (Invitado, Firmó acuerdo… with no credit data). Setup:
  `docs/HIGHLEVEL.md`.
- **Referral partners** (realtors, loan officers, tax preparers). A partner's
  link or their portal brings the person in, credited to the partner; the
  invitation carries the partner's code through to the client. Partners see
  only a coarse status, never credit data. `docs/PARTNERS.md`.

Neither changes the rules below: the conversation is still in WhatsApp chat,
never a sales call, and never an SMS offer.

## Who decides what

- **The client decides what is inaccurate.** Each answer, and the reason for
  it, is the client's own and is recorded with a date before any letter is
  prepared. Nobody on the team marks an item for a client or tells them which
  to mark, and we never dispute "everything negative".
- **The team does the letters.** The client does not approve or send anything.
  They can read every letter in the app and see whether it is being prepared,
  when it was mailed, and that it is waiting for a response.
- **The bureaus decide the outcome.** Nobody at Credalti can promise one.

## Who answers on WhatsApp

- **A number that is not yet a client is a lead.** Alti sends one greeting
  and then stays quiet, so it never talks over the salesperson. Set
  `SALES_WEBHOOK_URL` to get a ping in Slack or n8n for each new lead.
- **A number that belongs to a client gets Alti**, with the last day of the
  conversation as context, always marked as AI. Alti explains the report and
  the service, never quotes a price, never says which items to mark, and passes
  what it cannot answer to the team (`src/lib/coach/systemPrompt.ts`).
- `WHATSAPP_LEAD_REPLIES=ai` lets Alti answer leads too, for hours when nobody
  is on sales. Alti is then told the person is not a client yet.

## The client's language

The app is English first, Spanish if needed. On the invite page the
salesperson picks **Idioma del cliente**: Inglés (the default) or Español, the
language they talked with the client in. The link then carries `lang=en` or
`lang=es`, the client lands in that language (it is saved on their device and,
once they sign in, on their profile), and the ready message is written in it
(`inviteMessage` in `src/lib/sales/invite.ts`). Someone who arrives without a
link starts in English, or in Spanish when their phone's language is Spanish.
Either way the client can switch at any time with the button at the top of
every screen ("Español" / "English"), and their automatic messages follow the
language they use (`src/lib/i18n/detect.ts`, migration 0024).

## What the link does and does not do

- It carries a first name, a goal, a state, the client's language and the
  salesperson's handle. No phone number, no address, no account data.
- Everything in it is checked again in the app. A link for a state we are not
  open in leads to the waitlist, not the app.
- It skips questions. It does not skip what only the client can do: signing
  the agreement, reviewing each item and ticking the attestation.
- The salesperson's handle is saved on the client's profile at first sign-in
  (`profiles.referred_by`, migration `0005`), and is not overwritten by a later
  link. That is the record for sales credit.

## Rules for the salesperson

These are on the invite page (`SALES_MAY_SAY` and `SALES_MAY_NOT_SAY` in
`src/lib/sales/invite.ts`) and repeated here because they are what keeps the
business legal. The line between the two lists is process against outcome:
what we do may be described; what the bureaus will do may not be promised.

**What you may say**

1. How we work: the client reviews their report and says what is inaccurate;
   our team prepares and mails the letters, in rounds of about 40 days.
2. What the client has to do: sign the agreement, upload ID and proof of
   address, connect monitoring, and review their report.
3. Monitoring is a separate subscription: the client pays it to the monitoring
   service, not to us.
4. The plan is explained before signing, as it is written in the agreement.
   Nothing is charged before the service it pays for has been performed.
5. After signing, the client has 3 business days to cancel at no cost.

**What you may not say or do**

1. Results, points, dates or approvals. No "we remove", "we delete" or "we
   raise your score": the bureaus decide and results vary.
2. What to mark. The answers are the client's: do not give them for the
   client, and do not say we dispute everything negative.
3. Prices or discounts that are not in the plan.
4. Pressure: no "today only", no "last spots". The client decides in their
   own time.
5. Payment by phone. Everything in writing on WhatsApp: do not close a sale or
   take a payment on a call.

The same line is enforced in code. A teammate's reply in a client's
conversation, the invitation message, every WhatsApp template and Alti's
replies are checked against the claim rules in
`src/lib/compliance/guardrails.ts` before they are sent.

## Service mode

`NEXT_PUBLIC_SERVICE_MODE` (`src/lib/service/mode.ts`) says how the service is
delivered. Leave it unset for full service, which is the business today.
`self_serve` brings back the earlier version, where the client approves and
sends their own letters; it is kept for later. The mode changes the client
app's wording, whether the approve button exists, the WhatsApp templates,
Alti's instructions and one claim rule: saying "we dispute" is allowed under
full service and banned under self-serve. Promising an outcome is banned in
both.

## Open questions for the attorney

- Registration and bond as a credit services organization in Texas, and in
  whose name.
- The service agreement: the disclosures it must carry, the 3-business-day
  right to cancel, and when the monthly fee may be charged so that no charge
  comes before the service it pays for.
- Whether letters the team prepares and mails may go out in the client's name,
  and what the client must sign for that (see `docs/LETTER-LIBRARY.md`).
- Whether sales may ever move to a voice call, and what that triggers under
  the Telemarketing Sales Rule.
- **Calls with a person ("Schedule a call", built and off).** Under the
  Telemarketing Sales Rule, a credit repair service sold by telephone may not
  be paid for until the promised results are shown on a consumer report
  issued more than six months after they were achieved (16 C.F.R.
  310.4(a)(2)), and the exemption for calls a consumer places in answer to
  general media advertising does not apply to credit repair (310.6(b)(5)).
  Our design: the call is for questions only; signup and any payment happen
  afterwards, in writing, in the app, and the call, the booking page and the
  team's screen say so. Questions: (1) Does a questions-only call that
  precedes an online signup make the later sale "telemarketing" under the
  TSR, so that no fee may be collected until six months after results are
  shown? (2) If so, can any design keep calls (for example, only after the
  agreement is signed, or only for existing clients)? (3) Is the TCPA consent
  text for being called at the number given adequate, and must calls respect
  the National Do Not Call Registry and Texas's own telemarketing rules
  (Tex. Bus. & Com. Code ch. 304)? (4) Must calls be recorded or logged in a
  particular way?
- How salespeople may be paid (per signup, per active client) without
  creating an incentive that conflicts with the no-promises rule.
- Referral fees to partners (RESPA Section 8 for realtors and loan officers,
  Texas CSO rules, FTC endorsement disclosure): `docs/PARTNERS.md`.
- The consent text HighLevel lead forms show: `docs/HIGHLEVEL.md`.
- Whether Credalti may still be paid a commission by the monitoring service
  now that it also charges a service fee, and how to disclose it.

## Not built yet

- A list of leads and clients per salesperson. The data is recorded
  (`events.kind = 'whatsapp_lead'`, `profiles.referred_by`); the screen belongs
  in ALTO Control.
- Billing for the monthly service fee. No amount appears anywhere in the app
  or its copy.
