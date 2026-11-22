# HighLevel and the app

Marketing and the lead CRM run in **HighLevel** (the Credalti sub-account).
The app owns the person once sales starts working them. Two connections join
the two:

```
HighLevel form / ad / funnel ──(workflow: Custom Webhook)──▶ POST /api/webhooks/highlevel
                                                                 │  a prospect in /equipo, with its source
                                                                 ▼
                                                   sales invites from the prospect (one click)
                                                                 │
app records (agreement, documents, rounds, billing) ──▶ integration_outbox ──(cron)──▶ HighLevel Inbound Webhook
                                                                                        (moves the opportunity)
```

Code: `src/lib/highlevel/` (lead parsing, dedupe, assignment, stage events),
`src/lib/leads/server.ts` (creating or updating the prospect),
`src/app/api/webhooks/highlevel/route.ts`, `src/app/api/cron/highlevel/route.ts`.
Database: migration `0017_partners_highlevel.sql` (`prospects.source…`,
`integration_outbox`, `webhook_receipts`).

## Rules that do not bend

- **Sales happens in WhatsApp chat, never on a phone call.** A sale closed on a
  call would fall under the FTC Telemarketing Sales Rule, which forbids
  charging for credit repair before the results it promises; our per-round fee
  depends on the sale being written. No HighLevel step may call the lead, or
  book a call, to sell.
- **Do not send SMS offers.** Carriers forbid credit-repair marketing by text
  message, and a blocked number takes the whole sub-account with it. No SMS
  campaign, no SMS step in a workflow, no "text us" button. Conversations
  happen on WhatsApp.
- **Never ask for a Social Security number or a date of birth** on a HighLevel
  form, and never map one into the webhook. The app drops such a field before
  reading anything else, logs only the field's name (an alert reaches
  `ERROR_WEBHOOK_URL`), and records only that name in `webhook_receipts`. Its
  value is never stored. The client gives identity data in their own app.
- **No outcome claims in HighLevel copy** (ads, forms, emails, WhatsApp
  templates). The same rules as the app: process, never results
  (`docs/BRAND.md`, `src/lib/compliance/guardrails.ts`). Run new copy through
  `npm run content:check` or ask a developer to.

## 1. In the app (once)

Set these on the server (Render → Environment) and redeploy:

| Variable | What |
| --- | --- |
| `HIGHLEVEL_WEBHOOK_SECRET` | A long random string (`openssl rand -hex 32`). HighLevel sends it with every lead. Without it the endpoint refuses everything (503). |
| `HIGHLEVEL_INBOUND_WEBHOOK_URL` | The HighLevel Inbound Webhook URL from step 4. Falls back to `SALES_WEBHOOK_URL` (a Slack or n8n ping) when empty. https only. |
| `N8N_WEBHOOK_SECRET` | Already set for the other crons; the stage sync uses the same one. |
| `PARTNER_LANDING_URL` | Optional: a HighLevel funnel where partners' links land (`docs/PARTNERS.md`). |

`GET /api/health` (with the shared secret) shows whether the first two are set.

## 2. The lead form: consent text

Every HighLevel form that feeds the app must show this text beside an
**unchecked** checkbox that the person ticks themselves, and the workflow must
send the same text in `consentText` (step 3). A lead without it is refused
(422). The attorney should review the wording before ads run.

> **Español:** Acepto que Credalti me contacte por WhatsApp sobre su servicio.
> Puedo pedir que dejen de escribirme cuando quiera. No me pidan aquí mi número
> de Seguro Social ni mi fecha de nacimiento.
>
> **English:** I agree that Credalti may contact me on WhatsApp about its
> service. I can ask them to stop writing to me at any time. Do not ask me here
> for my Social Security number or date of birth.

The form asks only: first name, last name, mobile phone (WhatsApp), email
(optional), state, and the goal (a dropdown: Comprar una casa / Comprar un auto
/ Mejores tarjetas / Mi crédito en general). Add two hidden custom fields if you
use partners: **Código de socio** (filled from the URL parameter `socio`) and,
if you like, the campaign name.

## 3. Workflow: hand each lead to the app

In the Credalti sub-account: **Automation → Workflows → Create Workflow → Start
from scratch**.

1. **Trigger:** *Form Submitted* (pick the lead form). Add one trigger per form,
   or use *Facebook Lead Form Submitted* for Meta instant forms.
2. **Action:** *Custom Webhook* (in the action list under webhooks; HighLevel
   lists it among its premium actions, which may be billed per run — check the
   sub-account's plan).
   - **Method:** `POST`
   - **URL:** `https://<your app>/api/webhooks/highlevel`
   - **Authorization:** none, and add a **header** instead:
     `x-credalti-secret` = the value of `HIGHLEVEL_WEBHOOK_SECRET`.
     (Alternatively choose *Bearer token* and paste the secret: the app
     accepts `Authorization: Bearer <secret>` too.)
   - **Content type:** `application/json`
   - **Raw body** (use the merge-field picker for each `{{…}}`; the custom field
     keys depend on how they were named in the sub-account):

```json
{
  "contactId": "{{contact.id}}",
  "firstName": "{{contact.first_name}}",
  "lastName": "{{contact.last_name}}",
  "phone": "{{contact.phone}}",
  "email": "{{contact.email}}",
  "state": "{{contact.state}}",
  "goal": "{{contact.meta}}",
  "consentText": "Acepto que Credalti me contacte por WhatsApp sobre su servicio. Puedo pedir que dejen de escribirme cuando quiera. No me pidan aquí mi número de Seguro Social ni mi fecha de nacimiento.",
  "campaign": "Formulario Casa propia",
  "utm": {
    "source": "{{contact.attribution_source.utm_source}}",
    "medium": "{{contact.attribution_source.utm_medium}}",
    "campaign": "{{contact.attribution_source.utm_campaign}}"
  },
  "assignedTo": "{{user.email}}",
  "partnerCode": "{{contact.codigo_de_socio}}"
}
```

   UNVERIFIED: the exact merge keys for the attribution (UTM) values and the
   assigned user. Pick them from the picker; the app ignores empty values.
   `assignedTo` may be the assigned user's email, name or their app handle; when
   it matches nobody active in sales, the next salesperson in turn gets the lead.
   The plain *Webhook* action (HighLevel's own contact payload, with
   `contact_id`, `first_name`, `phone` and `customData`) is also read, but the
   Custom Webhook body above is the one to use.
3. **Save, publish, and test** with *Test Webhook* (or submit the form with a
   test phone). The answer is `{"ok": true, "outcome": "created", "prospectId": "…", "salesperson": "ana"}`
   and the person appears in `/equipo` under **Llegaron solos esta semana** and
   in **Clientes**, with "HighLevel · <campaign>" under the name.

What the app does with a lead:

| Case | Result |
| --- | --- |
| Same HighLevel contact again | The prospect is updated (email, consent if missing); the first campaign stays, the new one is kept as `lastTouch` |
| Same phone, prospect open, less than 90 days old | Updated, not duplicated |
| Same phone, prospect older than 90 days | The old prospect is closed (`lost_at`) and a new one starts |
| Phone or contact already belongs to a client | Nothing new; the client's HighLevel contact id is linked |
| The exact same delivery twice (a retry) | Answered from `webhook_receipts`; nothing happens twice |
| `ssn`, `dob`, `fecha_nacimiento`, `seguro_social`… anywhere | Dropped, name logged, value never stored |
| No consent text, no US phone, no state | 422 with the reasons |

Who gets the lead: the salesperson HighLevel assigned (if they are an active
member of sales or an administrator), else the partner's salesperson, else the
next active salesperson in turn (`team_settings.last_sales_assigned`), else the
first administrator. With the team's round-robin on, a specialist is assigned
too, as for a person added by hand.

Then the salesperson opens the person in `/equipo`, presses **Preparar su
invitación** (or **Invitar** on the home screen), and sends the usual message
(`src/lib/sales/invite.ts`). Sending or copying it records the invitation, which
HighLevel receives as "Invitado".

### Trust: what is verified and what is assumed

- **Verified** (HighLevel help center, "Workflow Action – Custom webhook", as
  quoted in search results; the page itself could not be opened from the build
  environment): the Custom Webhook action sends custom headers and offers
  Bearer / API key / Basic authorization. The app checks the shared secret in
  `x-credalti-secret` or `Authorization: Bearer`, in constant time.
- **Unverified:** a signature from HighLevel on workflow webhooks. HighLevel
  signs Marketplace app webhooks (`X-GHL-Signature`, Ed25519; the older
  `X-WH-Signature`, RSA), but nothing found says the workflow action is signed,
  so none is checked. HighLevel does not offer fixed IP addresses to allow-list.
  If the secret leaks, change `HIGHLEVEL_WEBHOOK_SECRET` and the header in
  every workflow at the same time.
- Limits: 16 KB body, 120 requests a minute per address.

## 4. Workflow: stage changes back into HighLevel

The app sends one POST per stage a person reaches. Suggested pipeline
(**Opportunities → Pipelines → Create**, name it "Credalti"):

| # | Pipeline stage | Moved by | `stage` in the payload |
| --- | --- | --- | --- |
| 1 | Nuevo prospecto | HighLevel (form submitted) | — |
| 2 | Conversando por WhatsApp | Sales, in HighLevel | — |
| 3 | Invitado | the app | `invited` |
| 4 | Firmó acuerdo | the app | `agreement_signed` |
| 5 | Documentos completos | the app | `documents_complete` |
| 6 | Primera ronda enviada | the app | `first_round_mailed` |
| — | Canceló en su plazo (mark *Lost*) | the app | `cancelled_in_window` |
| — | En pausa por pago | the app | `paused_for_payment` |
| — | Terminó el servicio (mark *Lost*) | the app | `service_ended` |

The `stageLabel` in each payload is exactly the pipeline stage name above.

Steps:

1. **Automation → Workflows → Create Workflow**. **Trigger:** *Inbound Webhook*
   (a premium trigger). Copy its URL into `HIGHLEVEL_INBOUND_WEBHOOK_URL` and
   redeploy.
2. Schedule the sync, like the other crons: `POST https://<your app>/api/cron/highlevel`
   with the header `x-webhook-secret: <N8N_WEBHOOK_SECRET>`, every 15 to 60
   minutes (n8n *Schedule* → *HTTP Request*). Run it once by hand so HighLevel
   receives a first event, then in the trigger press **Fetch sample requests**
   and pick it as the mapping reference.
3. **Action:** *Find Contact* by `phone` (or by `contactId` when present), then
   *Create or Update Contact* with the phone if none is found.
4. **Action:** *If/Else* on `stage`, one branch per row of the table, each with
   *Create or Update Opportunity* in pipeline "Credalti" at that stage (status
   *Lost* for the two marked so). Optionally *Add Tag* `credalti:<stage>`.
5. **No SMS step** in any branch.

The payload (`src/lib/highlevel/stages.ts`, `stagePayload`):

```json
{
  "event": "credalti.stage_changed",
  "eventId": "+17135550140:agreement_signed",
  "contactId": "hlC0ntact123",
  "phone": "+17135550140",
  "stage": "agreement_signed",
  "stageLabel": "Firmó acuerdo",
  "occurredAt": "2026-11-22T15:04:05.000Z",
  "source": "credalti",
  "text": "Credalti · +17135550140 · Firmó acuerdo"
}
```

That is all it carries: the HighLevel contact id when known (`null`
otherwise), the phone, the stage, its date, and the event's id. **No name, no
email, nothing from the credit file (no report, items, scores, letters), no
amounts.** The database refuses any other key (`integration_outbox_guard`), and
a test checks every demo client's events. `text` is for a Slack or n8n
fallback. `eventId` is the same for a repeat, so a workflow may ignore one it
has seen.

Delivery: each event is queued once (`integration_outbox.dedupe_key`), claimed
before it is sent so two runs never both send it, and retried after 5, 10, 20…
minutes (at most 12 hours apart) up to 8 times, then left on record as given
up. Only stages reached in the last 14 days are queued, so turning the sync on
does not replay a client's history; where the records keep no date
(documents complete, paused for payment) the event is dated when the sync
noticed it.

## Questions for the attorney

- The consent text above, for contact on WhatsApp (TCPA and the Texas
  telemarketing rules), and whether it must be stored with more (IP, page).
- Confirm that a chat-only sale keeps the business outside the Telemarketing
  Sales Rule, and that HighLevel's own auto-replies are not "telemarketing".
- Whether a partner's referral fee on a lead that HighLevel captured raises the
  issues listed in `docs/PARTNERS.md`.
