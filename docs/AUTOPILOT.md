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
| Question the assistant passed on, request to end the service | — | Always a person: an answer or a goodbye |
| Returned letter | Re-checked with the post office's data; re-mailed once to the corrected address (same round, no new charge) when automatic sending is on; or the client is asked to confirm their address; or the creditor's address is marked bad | What none of that settles (a lost or damaged letter, a re-mail that came back, nothing to correct) |
| Missing creditor address | One item per company for every client waiting, with the report's printed address as an unverified suggestion | Always a person, once per company: an address is mailed to only with a source and a date |
| Payment past due after every retry | Each decline notice carries the «Actualizar mi tarjeta» link; saving the card retries the charge at once | After the last retry with no fix; the card shows the exact words sent |
| Client address the post office cannot confirm | Checked before mailing; the client confirms or corrects it with one tap (3 reminders) | No answer after day 6, or the confirmed address fails too |
| Document the AI could not accept, for a reason a new photo fixes | The plain reason and an upload link (3 reminders) | A second failure, no answer after day 7, or a reason another photo does not fix |
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
| `address_unconfirmed` | the request to confirm the address (first request only) | day 0 · 2 · 4 | day 6 |
| `document_reupload` | the check that did not accept the document (first failure only) | day 0 · 2 · 5 | day 7 |

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

## When the next round is due (rounds/timing.ts)

There is no fixed 40-day cycle any more. `nextRoundDue(round, letters, tracking)`
in `src/lib/rounds/timing.ts` works it out from the evidence, and every screen
and job uses it: the client's journey and "Mi caso", the staff console's next
steps and stage, the business dashboard ("behind their next-round date"), the
partner view, `rounds/send.ts` (which records `next_round_due_at`), the
triggers of migration 0028 (which move it when a delivery is scanned or a
letter comes back) and the hourly re-pull (`/api/cron/rounds`, which also
re-checks the rule from the letters before pulling).

1. **Receipt.** The bureaus' 30 days run from the day they RECEIVE the dispute
   (FCRA § 611(a)(1)(A); a furnisher's direct dispute the same, 12 C.F.R.
   § 1022.43(e)). Per letter that reached someone: a certified letter's USPS
   delivery scan; otherwise its mailing date + **5 days** (a First-Class
   "delivered" from Lob is an estimate and may only move the date later). The
   round counts from the latest receipt, so every letter gets its 30 days.
2. **Window.** Receipt + **30 days**. Nothing is ever due before it.
3. **Answer and refresh.** + **5 days** for the bureau's mailed results (it has
   5 business days after finishing, § 611(a)(6)(A)) and the report to refresh.
   Then the report is pulled again and the next round prepared.
4. **Upper bound.** At most **45 days** from mailing, unless the legal window
   itself ends later (then the window wins).

| Round mailed Nov 2 | Receipt | Window ends | Next round | Days |
| --- | --- | --- | --- | --- |
| First class, no scan | Nov 7 (estimate) | Dec 7 | Dec 12 | 40 |
| Certified, delivered Nov 5 | Nov 5 | Dec 5 | Dec 10 | 38 (35 from delivery) |
| Certified, delivered Nov 14 | Nov 14 | Dec 14 | Dec 17 | 45 (upper bound) |
| Certified, delivered Nov 22 | Nov 22 | Dec 22 | Dec 22 | 50 (legal window) |

"Monitoring not sending a report" (`response_overdue`, the `monitoring_inactive`
follow-up) now starts after that date, not on day 30: before it, nobody
expects a new report. Copy that says "about 40 days" stays true: it is the
date with no tracking (`ESTIMATED_CYCLE_DAYS`). The agreement's own text
("about one round every 40 days") was not edited (it is versioned for the
attorney).

**Round 1** goes out the first working day after the cancellation window
(`roundOneMailDate`). The run notes a round 1 that will be sendable then while
the window is still open (`upcomingFirstRound`: recorded in
`autopilot_ready_rounds`, nothing mailed, no message), so its review window is
over by that day and the first hourly run of the first working day mails it;
`autoSendState` never lets round 1 go before that day (not on a weekend or
holiday night right after the deadline). The client sees "Your round 1
letters go out on November 30", with the round 2 date that follows.

For the attorney: (1) is preparing the next round at ~35 days from a
certified delivery (38–40 from mailing) fine, given the 30-day window and the
5 business days for results? (2) The 15-day extension (§ 611(a)(1)(B)) when
the consumer sends more information during the window: our letters do not,
but a client may write to a bureau directly; should the rule wait 45 days
then? (3) § 612(a)(3) gives 45 days for a dispute made after a free annual
report (and § 612(a)(2) 15 days to provide it): our disputes follow
monitoring reports, not § 612 requests; confirm 45 days never applies.
(4) The method-of-verification letters: § 611(a)(7) gives the bureau 15 days
to describe its procedure; does any letter of ours start a shorter clock that
should be tracked? (5) Is the system noting (not mailing) round 1 during the
cancellation window "work" under CROA / Texas Fin. Code ch. 393?

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
missing-method notices now go through the outbound log too (migration 0022),
as status messages with the «Actualizar mi tarjeta» link; the in-app line is
written at once, as before.
`/api/webhooks/n8n` (manual relays) still sends directly.

## Channels

1. **WhatsApp** (primary). Inside 24 hours of the client's last message: the
   same words as plain text. Outside: the approved template.
2. **Email**, when WhatsApp cannot carry the message and the client gave an
   email. The words without the WhatsApp footer, plus the company's postal
   address and the unsubscribe link.
3. Otherwise nothing goes and the notice is a person's ("No hay un canal…" or
   "Falta aprobar en Meta la plantilla…").

**The client's own settings** (Más → Avisos, `notification_settings`,
migration 0041; `docs/FULFILLMENT.md`, "Messages") narrow this: only the
channels the client kept; progress updates and reminders may be turned off
(a reminder turned off makes the situation a person's, like an opt-out);
receipts, payment notices and letters mailed in their name always go. An
opt-out still wins over everything.

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
name, category **Utility**, and **two languages under the same name**:
**en_US** (English, the `en` body) and **es_MX** (Spanish, the `es` body), from
`src/lib/autopilot/templates.ts` (the `{{n}}` parameters as listed), with the
footer "Automated message from Credalti. Reply STOP if you do not want these
messages." (en_US) / "Mensaje automático de Credalti. Si no quieres recibir
estos mensajes, responde BAJA." (es_MX). Then add the approved names to
`WHATSAPP_APPROVED_TEMPLATES` (comma-separated). Until a template is approved,
that message never goes on WhatsApp outside the 24-hour window. **Approve both
languages of every template**: the app is English first, Spanish if needed
(migration 0024), so each message goes in the client's saved language
(`profiles.locale`): English unless they chose Spanish (or arrived on an
invitation in Spanish, or with a Spanish browser). A template approved in only
one language fails for clients in the other.

Every row below is one name with an **en_US** and an **es_MX** version.

| Template | Parameters | For |
| --- | --- | --- |
| `credalti_acuerdo_1`, `_2`, `_3` | nombre, enlace | Unsigned agreement (1st, 2nd, last) |
| `credalti_documentos_1`, `_2`, `_3` | nombre, documentos, enlace | Missing documents |
| `credalti_revision_1`, `_2`, `_3` | nombre, pendientes, enlace | Unfinished review |
| `credalti_monitoreo_1`, `_2`, `_3` | nombre, enlace | Monitoring not sending a report |
| `credalti_monitoreo_previo` | nombre, fecha, enlace | The team found the monitoring cancelled and the next report is due within 7 days: sent before the report is missing (`docs/FULFILLMENT.md`) |
| `credalti_pago_metodo_1`, `_2`, `_3` | nombre, ronda, enlace | Missing payment method |
| `credalti_robo_identidad_1`, `_2`, `_3` | nombre, enlace | Identity theft report (FTC steps) |
| `credalti_cartas_enviadas` | nombre, cartas, ronda, enlace | Letters mailed |
| `credalti_carta_entregada` | nombre, destinatario, fecha, enlace | Certified letter delivered |
| `credalti_reporte_cambios` | nombre, cambio, enlace | New report, with disputed items no longer listed |
| `credalti_reporte_nuevo` | nombre, enlace | New report, nothing gone |
| `credalti_ronda_preparada` | nombre, ronda, enlace | Next round prepared |
| `credalti_recibo` | nombre, recibo, monto, fecha, trabajo, enlace | Payment receipt. Body (2026-11-26): «…cobramos {{3}} el {{4}} por {{5}}…», where {{5}} is «trabajo ya hecho: Ronda 2: …» under Credalti Complete, or the Credalti DIY subscription period / the letters we mailed for them: a DIY charge never says "work already done". Submit this body (`src/lib/autopilot/templates.ts`) |
| `credalti_direccion_1`, `_2`, `_3` | nombre, enlace | Address the post office could not confirm (link to «Confirmar dirección») |
| `credalti_documento_nuevo_1`, `_2`, `_3` | nombre, documento, motivo, enlace | Document to upload again, with the plain reason |
| `credalti_pago_rechazado` | nombre, monto, ronda, fecha, enlace | A charge declined; retried on the date; link to «Actualizar mi tarjeta» |
| `credalti_pago_pausa` | nombre, monto, ronda, enlace | The last retry declined; the case pauses; link to «Actualizar mi tarjeta» |
| `credalti_pago_falta_metodo` | nombre, ronda, fecha, enlace | A mailed round and no payment method; link to «Actualizar mi tarjeta» |
| `credalti_carta_reenviada` | nombre, destinatario, ronda, enlace | A returned letter went out again |
| `credalti_resena` | nombre, enlace | The one review request per client (docs/REVIEWS.md). Likely category **Marketing** in Meta, not Utility |

36 templates for clients, each in en_US and es_MX (72 versions). One for
referral partners: `credalti_socio_avance` (nombre, avance), the milestone
notice, in the partner's language (`partners.locale`, English unless they read
their portal in Spanish): en_US "Hi, {{1}}. {{2}} More details in your Credalti
partner portal." and es_MX "Hola, {{1}}. {{2}} Más detalles en tu portal de
socios de Credalti." (`src/lib/partners/sharingServer.ts`). One more, for the
team, in Spanish only (es_MX): `credalti_resumen_equipo`
(nombre, cosas, minutos, lo primero, lo que hizo el sistema, enlace), the
morning summary (`docs/STAFF.md`). Meta may reject a template whose variables carry whole
sentences; `cambio` and `trabajo` are short generated phrases, and if Meta
objects, split them into fixed-text templates.

## Lo que se arregla solo (migration 0022)

Code: `src/lib/mail/verify*.ts`, `returns*.ts`, `gaps*.ts`,
`src/lib/intake/reupload.ts`, `src/lib/autopilot/resolutions.ts`. Database:
`supabase/migrations/0022_self_healing.sql`. Tests:
`src/lib/__tests__/selfHealing.test.ts` and `src/lib/__tests__/db/selfHealing.test.ts`.

- **Addresses checked before mailing.** `rounds/send.ts` has a step 5b, added
  after the address book step (nothing before it changed): the client's return
  address and every recipient's are checked with Lob's US verification
  (`POST /v1/us_verifications`; what was verified against Lob's own schema and
  what was assumed is written in `mail/verify.ts`). A correction (ZIP+4, unit)
  is used as the post office writes it and logged; a client address it cannot
  confirm stops the round and opens one request (`address_confirmations`) that
  the follow-up `address_unconfirmed` carries to the client
  (`/confirmar-direccion`, prefilled with the suggestion, one tap); a creditor
  address it does not deliver to clears that book entry's verification, so it
  is a missing address for every client. A bureau address that fails stops
  the round for a person. Each check is recorded (`address_verifications`)
  and reused for 30 days. Cost: `VERIFICATION_COST_MILLS` ($0.05, unverified),
  shown on the send screen. Without `LOB_API_KEY`: "unchecked" (the mail is
  simulated then too).
- **Returned letters.** Each autopilot run (step 0) re-checks a returned
  letter's addresses. When the return is about the address and the post
  office's data corrects it (or the book now has another verified address),
  the same letter goes again **once**: a new letters row of the same round
  with `remail_of` (unique; never a re-mail of a re-mail; only a letter that
  came back — the database enforces all three). Only with automatic sending
  on, never for a held client or one the round gate would stop. Billing: one
  charge per round (`charges.round_id` unique), and a round whose letters all
  came back is charged only once a re-mail is on its way; the round's work
  date does not move.
- **Missing creditor addresses.** One queue item per company (`groupFurnisherGaps`)
  listing every client waiting; `furnisher_gaps` records when each company
  was first seen missing (the item's clock) and when it was resolved.
- **Payments.** Billing's notices carry `/pagos/tarjeta`; saving a card there
  runs the same billing run as the hourly one.
- **Documents.** A first failure whose every reason a new photo fixes
  (`intake/reupload.ts`) starts `document_reupload` with the reason in the
  message and a one-tap upload screen (`/documentos`).
- **«Resuelto solo».** Each fix is one row in `autopilot_resolutions`; the
  staff home counts the last 7 days.

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

In the demo: 17 notices on the console's raw list become 9 in the queue
(documents, an unfinished review, monitoring, a payment method, a document to
upload again and an address to confirm are left to the system; three clients
waiting on Midland's address are one item).

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
- The client app does not show the client their own message log yet (they can
  read it; there is no screen).
