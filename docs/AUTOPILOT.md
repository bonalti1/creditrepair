# Piloto automático

The goal: one person runs fulfillment for hundreds of clients. In Credit
Repair Cloud every step waits on a person (the account we reviewed had 54
unprinted letters and 52 overdue tasks). In Credalti the system does the
routine follow-up, tells the client what happened, and mails the rounds that
pass every gate. A person sees only what truly needs a human, in one queue,
in the order to do it.

Everything new here **starts off** on the database. An administrator turns it
on in `/equipo/piloto`. In the demo it is on, and nothing leaves the browser.

Code: `src/lib/autopilot/`. Database: `supabase/migrations/0015_autopilot.sql`.
Tests: `src/lib/__tests__/autopilot.test.ts` (rules) and
`src/lib/__tests__/db/autopilot.test.ts` (the real migrations and the real run).

**Marketing and CRM live in HighLevel** (leads, nurture campaigns, reviews).
The app owns the client **after signup**: from the account onward every
automatic message is the app's, under the rules below. HighLevel should stop
messaging a person once they have an account, so the client never gets two
systems' reminders and an opt-out recorded here is not ignored there (open
item: sync opt-outs both ways).

## What runs by itself, and what still needs a person

| | Runs by itself | Still a person's, and why |
| --- | --- | --- |
| Unsigned agreement | 3 reminders (day 1, 3, 5 after the account) with a link to `/acuerdo` | After day 6 with no signature: a call. Whether to keep pursuing is a judgment call, and signing must never feel pushed |
| Missing ID / proof of address | 3 reminders from the first day work may start | After day 7: the client may be stuck (no scanner, wrong file) |
| Unfinished review | 3 reminders; any answer restarts the count | After day 10 of silence: only the client can answer, a person can ask why |
| Monitoring not sending a report (stale report, or no report after the bureaus' 30 days) | 3 reminders with the monitoring steps | After day 9: usually a billing or account problem at the provider |
| Missing payment method after a mailed round | Billing's own notice on the due day, then 3 reminders | After day 10 |
| Identity theft report missing | The FTC steps (IdentityTheft.gov) the same day, 2 reminders | **A person from day 1**: the app told the client a person would write, and it is a sensitive conversation |
| Letters mailed, certified letter delivered, new report and what it shows, next round prepared, payment receipt | Factual status message | — |
| Sending a prepared round | When "Enviar solas las rondas listas" is on: after the review window (default 24 h) in "Listas para enviar", if nobody held the client | Turning it on is the owner's decision. Anyone who sends rounds can hold a client, with a reason |
| Question the assistant passed on, returned letter, request to end the service, missing creditor address, payment past due after every retry | — | Always a person: an answer, an address, money or a goodbye |
| Client opted out, on hold, or unreachable (no channel, template not approved) | — | The notice comes to a person exactly as before, with why |

When the reminders are off (the default), the console shows every notice as
it did before the autopilot, with the "Recordarle…" WhatsApp draft.

## The follow-up schedules

From `FOLLOWUP_SCHEDULES` in `src/lib/autopilot/followups.ts`. Days count from
when the situation began; two messages of one schedule are never less than 20
hours apart; after the third, the client has a day to act before it becomes a
person's.

| Situation | Starts | Messages | A person's |
| --- | --- | --- | --- |
| `agreement_unsigned` | account created | day 1 · 3 · 5 | day 6 |
| `documents_missing` | first day work may start (after the 3-business-day window) | day 0 · 2 · 5 | day 7 |
| `review_unfinished` | the report, or the client's last answer, whichever is later | day 2 · 5 · 8 | day 10 |
| `monitoring_inactive` | report 45+ days old, or the 30-day response window over | day 0 · 3 · 7 | day 9 |
| `payment_method_missing` | the round's mailing | day 3 · 5 · 8 | day 10 |
| `identity_theft_report_missing` | the answer that said identity theft | day 0 · 3 · 7 | day 0 |

The third message of each says it is the last automatic one and that a person
can call. The queue item then reads "Se le escribió 3 veces sin respuesta" (or
"respondió, pero sigue pendiente" if the client wrote back), lists each
message with its date and channel, and its button is **Llamarle**.

## Automatic sending

`src/lib/autopilot/sending.ts` decides which rounds may go; `server.ts`
(`runAutopilot`) sends them through **`src/lib/rounds/send.ts`, unchanged**,
exactly as the staff send does: `requireAgreement: true`, the mail service
(Lob, or "simulado" without a key), the default mail class for each letter.

- A round is a candidate only when the console's own rule says it may be
  mailed now (`sendableRound` with the furnisher address book) and the send
  plan has no blockers. Then `send.ts` checks every gate again on the server:
  agreement signed, not cancelled, 3-business-day window over, no request to
  end the service, no unpaid charge after every retry, current monitoring
  report, attestation on every item, a readable client address, a checked
  address for every creditor, and idempotency (Lob's key is the letter's id).
- **Review window:** the time is counted from when the system first saw that
  round ready, with those letters (`autopilot_ready_rounds`, keyed by
  `roundPlanKey`). Different letters (a new answer, a new report) are a new
  round to review, and the window starts again.
- **Hold:** "Detener" on the home screen or the client page, with a reason
  (who and when are recorded). A held client gets no automatic round and no
  reminder; status messages about what already happened still go. "Soltar"
  lifts it.
- The round is recorded as sent by **sistema** (`attack_rounds.sent_by_name`),
  plus an event `round_sent_automatically`; the activity log says "El sistema
  envió la ronda…". Every automatic message is in the log as "El sistema le
  escribió…", and holds with the teammate's name.
- Billing is untouched: the charge still comes only from `/api/cron/billing`,
  for a round already mailed.

## Safety rules, and where each is enforced

| Rule | Where |
| --- | --- |
| No gate is weakened: agreement window, attestation, addresses, billing, identity theft hold, roles | `rounds/send.ts` (unchanged), `staff/stage.ts` `sendBlockReason` (unchanged); the autopilot only calls them |
| Everything new starts off; only an administrator turns it on | migration 0015 defaults; capability `autopilot.manage` (admin only, `staff/permissions.ts`); route `/api/staff/autopilot`; every change in `team_audit` (`autopilot_changed`) |
| No promises, no scores, no pressure | `templates.ts` (one source for every message); `checkClaimGuardrails` and `checkMarketingCopy` on every template and status message in both languages (`autopilot.test.ts`); `assertClaimGuardrails` again in every sender |
| Quiet hours 9 p.m.–8 a.m. on the client's clock (Texas by default) | `clock.ts`, `plan.ts`; DB test "quiet hours" |
| At most N automatic messages per client per local day (default 2), status first | `plan.ts` `planDeliveries` |
| BAJA / STOP / unsubscribe honored and recorded; ALTA / START to come back | `optout.ts`; inbound WhatsApp webhook; `/api/unsubscribe`; `message_opt_outs`; queued messages cancelled; DB test through the real webhook |
| Never sent twice | `outbound_messages.dedupe_key` unique; a message is claimed (insert, or queued → sending) before it is sent; a run that dies after the claim leaves it "sending" and never retries it (at most once); DB test "a run twice sends once" |
| WhatsApp 24-hour rule | `channels.ts`: plain text only inside 24 h of the client's last message; outside it only an approved template (`WHATSAPP_APPROVED_TEMPLATES`) |
| Never SMS for automatic messages | `CHANNELS = ["whatsapp", "email"]`; the database refuses `sms`; a test scans the autopilot and integrations for any SMS sender. Text messages are used only for login codes (Supabase Auth) |
| CAN-SPAM for email | email is on only with an unsubscribe link (signed with `UNSUBSCRIBE_SECRET`), the postal address (`NEXT_PUBLIC_COMPANY_ADDRESS`) and a `List-Unsubscribe` header (`integrations/email.ts`) |
| No automatic message after a cancellation or a request to end the service | `followups.ts` `clientStoppedService` |
| Old news is not sent | a queued status message expires after 3 days |
| Records cannot be rewritten | triggers on `outbound_messages` (words immutable; status only moves forward), `message_opt_outs`, `autopilot_holds` (released once), `autopilot_ready_rounds` |
| Read by role | staff read by `staff_can_see_case` (opt-outs: `staff_can_see_client`, so sales sees them); a client reads their own messages and opt-outs; nobody writes directly |

Existing direct WhatsApp sends now go through the outbound log: "letters
mailed" (via `send.ts`'s own `deps.sendWhatsApp`, so `send.ts` is untouched),
the payment receipt, the deletion message and the day-40 message (replaced by
the factual "report_changes" status message). Billing's decline and
missing-method notices still go directly but now skip a client who opted out.
`/api/webhooks/n8n` (manual relays) still sends directly.

## Channels

1. **WhatsApp** (primary). Inside 24 hours of the client's last message: the
   same words as plain text. Outside: the approved template.
2. **Email**, when WhatsApp cannot carry the message and the client gave an
   email. The words without the WhatsApp footer, plus the company's postal
   address and the unsubscribe link.
3. Otherwise nothing goes and the notice is a person's ("No hay un canal…" or
   "Falta aprobar en Meta la plantilla…").

**Never SMS.** Carriers (Twilio, HighLevel) reject credit-repair SMS campaigns
without resubmission. Text messages are only for login codes.

Environment (all on the server, see `.env.example`): `WHATSAPP_ACCESS_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APPROVED_TEMPLATES`; `EMAIL_API_KEY`,
`EMAIL_FROM`, optional `EMAIL_API_URL`, `UNSUBSCRIBE_SECRET`,
`NEXT_PUBLIC_COMPANY_ADDRESS`, `NEXT_PUBLIC_APP_URL`. The email adapter uses
Resend's request shape and **has not been tried against a live account**:
send one to yourself before turning email on. `/api/health` reports both.

## WhatsApp templates to get approved in Meta

Each must be created in WhatsApp Manager → Message templates with exactly this
name, category **Utility**, languages **es_MX** and **en_US**, the body in
`src/lib/autopilot/templates.ts` (the `{{n}}` parameters as listed), and the
footer "Mensaje automático de Credalti. Si no quieres recibir estos mensajes,
responde BAJA." / "Automated message from Credalti. Reply STOP if you do not
want these messages." Then add the approved names to
`WHATSAPP_APPROVED_TEMPLATES` (comma-separated). Until a template is approved,
that message never goes on WhatsApp outside the 24-hour window.

| Template | Parameters | For |
| --- | --- | --- |
| `credalti_acuerdo_1`, `_2`, `_3` | nombre, enlace | Unsigned agreement (1st, 2nd, last) |
| `credalti_documentos_1`, `_2`, `_3` | nombre, documentos, enlace | Missing documents |
| `credalti_revision_1`, `_2`, `_3` | nombre, pendientes, enlace | Unfinished review |
| `credalti_monitoreo_1`, `_2`, `_3` | nombre, enlace | Monitoring not sending a report |
| `credalti_pago_metodo_1`, `_2`, `_3` | nombre, ronda, enlace | Missing payment method |
| `credalti_robo_identidad_1`, `_2`, `_3` | nombre, enlace | Identity theft report (FTC steps) |
| `credalti_cartas_enviadas` | nombre, cartas, ronda, enlace | Letters mailed |
| `credalti_carta_entregada` | nombre, destinatario, fecha, enlace | Certified letter delivered |
| `credalti_reporte_cambios` | nombre, cambio, enlace | New report, with disputed items no longer listed |
| `credalti_reporte_nuevo` | nombre, enlace | New report, nothing gone |
| `credalti_ronda_preparada` | nombre, ronda, enlace | Next round prepared |
| `credalti_recibo` | nombre, recibo, monto, fecha, trabajo, enlace | Payment receipt |

24 templates for clients. One more, for the team: `credalti_resumen_equipo`
(nombre, cosas, minutos, lo primero, lo que hizo el sistema, enlace), the
morning summary (`docs/STAFF.md`). Meta may reject a template whose variables carry whole
sentences; `cambio` and `trabajo` are short generated phrases, and if Meta
objects, split them into fixed-text templates.

## The work queue

`src/lib/autopilot/queue.ts` (`workQueue`) and the staff home (`/equipo`):

- **Trabajo de hoy: N cosas · ~M minutos** at the top, with how many are past
  their due time.
- Each item: why it needs a person, **what the system already did** (each
  message, date, channel), an estimated time (`MINUTES_BY_KIND`), how long it
  has waited, a due time (24 h for urgent, 48 h for important, 72 h for minor,
  counted from when it became a person's) and one button. Overdue first, then
  by due time.
- **Siguiente**: one item at a time. J next, K previous, E open the action,
  H handled, Esc close.
- On `/equipo/negocio`: **Minutos de trabajo humano por cliente activo** =
  (estimated minutes of the notices marked handled in the period + estimated
  minutes of the notices waiting today) ÷ active clients today. What the
  system does by itself is not counted. It is an estimate, not a time sheet.

In the demo: 12 notices on the console's raw list become 8 in the queue
(documents, an unfinished review, monitoring and a payment method are left to
the reminders).

Each item also carries its «Cómo se resuelve» card, a waiting question shows
the saved answer that matches it, and each teammate can get the queue as a
morning summary by WhatsApp or email. The one-person day, start to finish, is
in `docs/STAFF.md`.

## Setup

1. Apply `supabase/migrations/0015_autopilot.sql` (or the whole
   `supabase/setup.sql` on a new project).
2. Set the environment above; check `/api/health`.
3. Get the templates approved; list them.
4. A clock that calls `POST {APP_URL}/api/cron/autopilot` every hour with the
   header `x-webhook-secret: {N8N_WEBHOOK_SECRET}`:
   - **n8n**: Workflow 3 in `docs/n8n.md` (Cron node → HTTP Request).
   - **Render**: a Cron Job service (`schedule: "15 * * * *"`, command
     `curl -fsS -X POST -H "x-webhook-secret: $N8N_WEBHOOK_SECRET" https://APP/api/cron/autopilot`).
     Render's free plan has no cron jobs; n8n is the default.
   Run it after `/api/cron/rounds` in the same hour so a report it imports is
   announced in that hour.
5. Turn things on in `/equipo/piloto`, one at a time: status messages are on
   by default; then reminders (after the attorney's answers below); then
   automatic sending, once the team trusts the review window.

## For the attorney (questions, not decided)

Nothing in the agreement was edited. These are proposals.

1. **Where is consent to automated messages captured?** Today: the service
   agreement's service list says "le avisamos por WhatsApp o mensaje de
   texto" (`src/lib/agreement/documents.ts`, `serviceItems`), and the E-SIGN
   consent covers electronic delivery of notices, not marketing or automated
   messages as such. Is that enough for automated WhatsApp and email
   reminders and status updates under the TCPA (and Texas law), given
   WhatsApp is not SMS but uses the phone number?
2. **Before signing.** The unsigned-agreement reminders go to people who have
   an account (phone verified by a login code) but have not signed. What
   consent covers them? Should they go only to people who wrote to us on
   WhatsApp first, or should the account screen carry a consent line?
3. **"Mensaje de texto".** The agreement promises updates "por WhatsApp o
   mensaje de texto", but carriers reject credit-repair SMS, so automated
   updates will be WhatsApp or email. Proposed wording (attorney-pending):
   - es: "Mantenerle informado. Usted puede ver en la aplicación el estado de
     cada carta. Con su permiso le enviamos avisos y recordatorios
     automáticos por WhatsApp o por correo electrónico; puede dejar de
     recibirlos en cualquier momento respondiendo BAJA o con el enlace de
     baja del correo. Una persona de nuestro equipo responde sus preguntas."
   - en: "Keep you informed. You can see the status of every letter in the
     app. With your permission we send you automated updates and reminders by
     WhatsApp or email; you can stop them at any time by replying STOP or with
     the unsubscribe link in the email. A person on our team answers your
     questions."
   - and a separate, unticked-by-default checkbox at signup: "Acepto recibir
     recordatorios y avisos automáticos de Credalti por WhatsApp y correo
     electrónico sobre mi servicio. No es una condición para contratar."
4. **Revocation.** The FCC's 2024 rule lets a consumer revoke by any
   reasonable means. We honor BAJA, STOP, ALTO, PARAR, CANCELAR, QUIT, END,
   REVOKE, OPT OUT, UNSUBSCRIBE, "no más", an email unsubscribe and a
   teammate's note. Is that list, and acting from the next hourly run, enough?
5. **Quiet hours.** We use 9 p.m.–8 a.m. in the client's time zone (Texas
   when unknown), stricter than the TCPA's 8 a.m.–9 p.m. Confirm, and whether
   Texas or other states add anything for these messages.
6. **Payment reminders.** Are reminders for a missing payment method, for
   work already performed, "debt collection" in any sense that needs other
   wording or limits?
7. **CROA / Texas CSO.** Do reminders to sign the agreement count as
   solicitation subject to any disclosure, and is three reminders acceptable?

## Not done yet

- Syncing opt-outs with HighLevel.
- An SMS inbound webhook is not needed (no automated SMS); a login-code reply
  of STOP is handled by the SMS provider.
- Real WhatsApp and email deliveries have not been tried against live
  accounts (the request shapes follow the providers' documentation).
- Delivery receipts from WhatsApp (read/delivered) are not recorded; "sent"
  means the provider accepted it.
- Billing's decline and missing-method notices still go directly (with the
  opt-out check), not through the outbound log and templates.
- The client app does not show the client their own message log yet (they can
  read it; there is no screen).
