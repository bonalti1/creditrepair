# Sales first, then the software

Most customers do not sign up on their own. They see an ad, write on WhatsApp,
talk with a salesperson, and only then open the app. The product is built
around that order.

## The path

| Step | Who | What happens | Where it lives |
| --- | --- | --- | --- |
| 1 | Customer | Sees an ad and taps the button, which opens WhatsApp | `/empezar` (button goes to WhatsApp when `NEXT_PUBLIC_WHATSAPP_NUMBER` is set) |
| 2 | Capi | Greets the lead once, says it is AI, and says a person will write | `src/app/api/webhooks/whatsapp/route.ts` |
| 3 | Salesperson | Talks with the lead in WhatsApp: what they want, where they live, how it works, what it costs | WhatsApp, following the sales playbook |
| 4 | Salesperson | Fills in four fields and sends the personal link | `/equipo/invitar` |
| 5 | Customer | Opens the link: a welcome screen with their name, goal and state already filled in | `/onboarding?n=…&g=…&s=…&r=…` |
| 6 | Customer | Activates monitoring, signs in with their phone, and lands in the chat with Capi | `/onboarding` → `/login` → `/asistente` |
| 7 | Capi + salesperson | Capi explains each item; the salesperson stays available on WhatsApp | app + WhatsApp |

Someone who arrives without a link gets the ordinary four-question onboarding.

## Who answers on WhatsApp

- **A number that is not yet a customer is a lead.** Capi sends one greeting
  and then stays quiet, so it never talks over the salesperson. Set
  `SALES_WEBHOOK_URL` to get a ping in Slack or n8n for each new lead.
- **A number that belongs to a customer gets Capi**, with the last day of the
  conversation as context, always marked as AI.
- `WHATSAPP_LEAD_REPLIES=ai` lets Capi answer leads too, for hours when nobody
  is on sales.

## What the link does and does not do

- It carries a first name, a goal, a state and the salesperson's handle. No
  phone number, no address, no account data.
- Everything in it is checked again in the app. A link for a state we are not
  open in leads to the waitlist, not the app.
- It skips questions. It does not skip decisions: the customer still reviews
  each item, ticks the attestation and approves the letters themselves.
- The salesperson's handle is saved on the customer's profile at first sign-in
  (`profiles.referred_by`, migration `0005`), and is not overwritten by a later
  link. That is the record for sales credit.

## Rules for the salesperson

These are on the invite page and repeated here because they are what keeps the
model legal:

1. No promises of results, points or dates. Results vary.
2. The customer reviews, confirms and approves everything personally. The
   salesperson does not do it for them or tell them what to tick.
3. Everything in writing on WhatsApp. No closing by phone call.
4. The only cost is the monitoring subscription, paid to the monitoring
   service, not to us.

## Open questions for the attorney

- Whether a salesperson guiding a customer in chat changes how the product is
  classified, given that the customer still makes every decision.
- Whether sales may ever move to a voice call, and what that triggers under
  the Telemarketing Sales Rule.
- How salespeople may be paid (per signup, per active customer) without
  creating an incentive that conflicts with the no-promises rule.

## Not built yet

- A list of leads and customers per salesperson. The data is recorded
  (`events.kind = 'whatsapp_lead'`, `profiles.referred_by`); the screen belongs
  in ALTO Control.
- Protecting `/equipo/invitar` with a team login. It composes links and reads
  no customer data, so it is unlisted rather than locked.
