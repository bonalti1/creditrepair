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
| 2 | Capi | Greets the lead once, says it is AI, and says a person will write | `LEAD_GREETING` in `src/lib/integrations/whatsapp.ts`, sent by `src/app/api/webhooks/whatsapp/route.ts` |
| 3 | Salesperson | Talks with the lead in WhatsApp: what they want, where they live, how the service works, the plan | WhatsApp, following the rules below |
| 4 | Salesperson | Fills in four fields and sends the personal link | `/equipo/invitar` |
| 5 | Client | Opens the link: a welcome screen with their name, goal and state already filled in | `/onboarding?n=…&g=…&s=…&r=…` |
| 6 | Client | Signs the service agreement, uploads ID and proof of address, activates monitoring, signs in with their phone | `/acuerdo`, `/onboarding` → `/login` |
| 7 | Client | Reviews each item on their report with Capi and says which ones are inaccurate and why | `/asistente`, `/items` |
| 8 | Team | Prepares and mails the letters, in rounds about every 40 days, and imports the report again to see what changed | `/equipo` (the staff console) |
| 9 | Client | Reads the letters and follows their status; the salesperson and the team stay available on WhatsApp | `/attack`, `/rounds`, WhatsApp |

Someone who arrives without a link gets the ordinary four-question onboarding.

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

- **A number that is not yet a client is a lead.** Capi sends one greeting
  and then stays quiet, so it never talks over the salesperson. Set
  `SALES_WEBHOOK_URL` to get a ping in Slack or n8n for each new lead.
- **A number that belongs to a client gets Capi**, with the last day of the
  conversation as context, always marked as AI. Capi explains the report and
  the service, never quotes a price, never says which items to mark, and passes
  what it cannot answer to the team (`src/lib/coach/systemPrompt.ts`).
- `WHATSAPP_LEAD_REPLIES=ai` lets Capi answer leads too, for hours when nobody
  is on sales. Capi is then told the person is not a client yet.

## What the link does and does not do

- It carries a first name, a goal, a state and the salesperson's handle. No
  phone number, no address, no account data.
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
conversation, the invitation message, every WhatsApp template and Capi's
replies are checked against the claim rules in
`src/lib/compliance/guardrails.ts` before they are sent.

## Service mode

`NEXT_PUBLIC_SERVICE_MODE` (`src/lib/service/mode.ts`) says how the service is
delivered. Leave it unset for full service, which is the business today.
`self_serve` brings back the earlier version, where the client approves and
sends their own letters; it is kept for later. The mode changes the client
app's wording, whether the approve button exists, the WhatsApp templates,
Capi's instructions and one claim rule: saying "we dispute" is allowed under
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
- How salespeople may be paid (per signup, per active client) without
  creating an incentive that conflicts with the no-promises rule.
- Whether Credalti may still be paid a commission by the monitoring service
  now that it also charges a service fee, and how to disclose it.

## Not built yet

- A list of leads and clients per salesperson. The data is recorded
  (`events.kind = 'whatsapp_lead'`, `profiles.referred_by`); the screen belongs
  in ALTO Control.
- Billing for the monthly service fee. No amount appears anywhere in the app
  or its copy.
