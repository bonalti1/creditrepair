# The live funnel: webinars and ads → a word or a tap → a personal video

Credalti's sister-led live webinars (Zoom, Facebook, YouTube, Instagram,
TikTok) and its ads end with one call to action that works on a phone: **send
a word, or tap a link**. Never a QR code (people are watching on the phone
they would scan with).

| Step | Who | What happens | Where it lives |
| --- | --- | --- | --- |
| 1 | Viewer | Sends **CREDIT** to our WhatsApp, comments a word, or taps the link in the comments, the bio or an ad | WhatsApp, HighLevel / ManyChat, `/live` |
| 2 | Alti (AI, labelled) | Answers once, automatically, with the link to `/live` carrying the keyword and the campaign; the lead appears in the Lead Manager tagged with where it came from | `src/app/api/webhooks/whatsapp/route.ts`, `src/lib/live/` |
| 3 | Viewer | On `/live`: first name, WhatsApp number, optional email, state (Texas only proceeds), language, goal, two consents; then uploads **their own** report (annualcreditreport.com or IdentityIQ) | `src/app/live`, `/api/live`, `/api/live/report` |
| 4 | Team | Reads the AI report reader's **review overview**, records a 2–5 minute screen-and-camera video in the browser, sends its private link on WhatsApp with one tap | `/equipo/revisiones` |
| 5 | Viewer | Watches it (`/v/<token>`), picks **Credalti Complete** or **Credalti DIY** and signs up in writing, or chats with us | `/v/[token]` → `/onboarding?…&option=complete\|diy` |

Nothing in the signup's rules changes: the agreement, its disclosures, the 3
business days to cancel, the client deciding what is inaccurate. Code:
`src/lib/live/` (keywords, replies, stages, overview, packages, copy, text,
templates, sms, server, data, badge, demo), `src/components/live/`,
`src/components/staff/live/`. Database: `supabase/migrations/0043_live_funnel.sql`.
Tests: `src/lib/__tests__/live.test.ts` (the rules, the words, the
invariants) and `src/lib/__tests__/db/live.test.ts` (the migration, row level
security and every route against a real database with a mocked WhatsApp).

## The scripts

### The host (live)

> "If you want to get started tonight, send the word **CREDIT** to our
> WhatsApp, or tap the link in the comments / our bio. It opens a chat with
> us: my brother and [owner] are answering right now, and Alti, our AI
> assistant, can help you get your report reviewed. With Complete, you're
> charged each month right after your letters are mailed; DIY is a simple
> monthly subscription."

In Spanish:

> «Si quieres empezar esta noche, manda la palabra **CRÉDITO** a nuestro
> WhatsApp, o toca el enlace en los comentarios o en nuestra bio. Se abre un
> chat con nosotros: mi hermano y [dueño] están respondiendo ahora mismo, y
> Alti, nuestro asistente con IA, te ayuda a que revisemos tu reporte. Con
> Complete, se cobra cada mes justo después de enviar tus cartas; DIY es una
> suscripción mensual sencilla.»

Say it two or three times during the live (after the main explanation, at the
Q&A, at the close), and pin the link comment. On Zoom put the WhatsApp number
and the link in the chat; on Instagram and TikTok, "link in bio".

What the host never says: that anything will come off a report, points or
dates, "guaranteed", "free", "today only", or which items someone should
dispute. Results vary; the bureaus decide; the person decides what is
inaccurate.

### The moderator (the owner, in the comments)

- Pin: «Send CREDIT to our WhatsApp {number}, or tap: {APP_URL}/live?src=webinar&c={campaign}».
- When someone asks "how?": "Send CREDIT to our WhatsApp, or tap the pinned link. A person answers."
- When someone writes their situation in public ("I have 3 collections"):
  "Thanks for sharing! Please send us the details privately on WhatsApp, not here: comments are public."
- Never answer prices, results or legal questions in the comments: "Great
  question, send it to us on WhatsApp and a person answers you there."
- Delete comments that post a phone number, an account number, a Social
  Security number or a date of birth, and tell the person to write privately.

### The person answering messages (the owner's brother)

The keyword's automatic reply goes out by itself; the conversation then
belongs to a person (`/equipo/leads`). The WhatsApp quick replies below are
also worth saving as approved saved answers (`/equipo/respuestas`).

## WhatsApp quick replies

Save these in WhatsApp Business (Settings → Business tools → Quick replies) or
as saved answers. Each passes the claim rules; none promises a result.

| Shortcut | English | Spanish |
| --- | --- | --- |
| `/link` | Here is your link to get your credit report reviewed by our team, at no cost: {APP_URL}/live?src=whatsapp | Aquí está tu enlace para que nuestro equipo revise tu reporte de crédito, sin costo: {APP_URL}/live?src=whatsapp&lang=es |
| `/report` | You can get your reports at annualcreditreport.com, the official site where the law lets you get them at no cost. Save each one as a PDF and upload it on your link. Never send us your Social Security number. | Puedes sacar tus reportes en annualcreditreport.com, el sitio oficial donde la ley te permite sacarlos sin costo. Guarda cada uno como PDF y súbelo en tu enlace. Nunca nos mandes tu número de Seguro Social. |
| `/video` | Thanks! A person on our team is reviewing your report and will send you a short private video here. Then you decide. | ¡Gracias! Una persona del equipo está revisando tu reporte y te manda aquí un video privado corto. Luego tú decides. |
| `/packages` | We have two ways to work together. Credalti Complete: done for you, charged each month right after your letters are mailed. Credalti DIY: you do it yourself, guided by Alti, a simple monthly subscription. Start with DIY, upgrade anytime and keep everything you've done. | Tenemos dos formas de trabajar. Credalti Complete: lo hacemos por ti, se cobra cada mes justo después de enviar tus cartas. Credalti DIY: lo haces tú, con la guía de Alti, una suscripción mensual sencilla. Empieza con DIY, cambia a Complete cuando quieras y conserva todo lo que ya hiciste. |
| `/results` | Nobody can promise a result: the bureaus decide, and results vary. You decide what is inaccurate on your report, and we explain everything before you sign. | Nadie puede prometer un resultado: los burós deciden y los resultados varían. Tú decides qué es inexacto en tu reporte, y te explicamos todo antes de firmar. |
| `/texas` | Right now we serve Texas only. If you live in another state, leave your email on your link and we'll write when we open there. | Por ahora solo atendemos en Texas. Si vives en otro estado, deja tu correo en tu enlace y te escribimos cuando abramos ahí. |

## Step 2: keyword auto-replies on WhatsApp

A WhatsApp message from a number with **no account** that **is** a keyword
(and nothing else) gets one automatic reply, instead of the usual one-time
greeting:

> 🤖 Alti · AI assistant
> Thanks for writing to Credalti! Here is your link to have our team review
> your credit report, at no cost: https://…/live?src=whatsapp&kw=credit&c=webinar-nov&lang=en
>
> A person on our team will also answer you right here. Reply STOP if you
> don't want automatic messages.

(Spanish for a Spanish keyword: «¡Gracias por escribir a Credalti! Aquí está
tu enlace…».) The words are fixed (no model writes them) and pass the claim
rules, the advertising rules and the staff reply rules (`funnelWordsProblem`).

- **Keywords**: `LIVE_KEYWORDS`, comma-separated, each `WORD` or
  `WORD=campaign`. Empty: `CREDIT, CREDITO, WEBINAR`. Case, accents,
  punctuation and emoji do not matter ("Crédito!" counts); the message must be
  the word alone, or the word and a `#campaign` tag (what `/live`'s WhatsApp
  button prefills: `CREDIT #webinar-nov`). "I need credit help" does not count.
  A keyword can never be an opt-out or opt-in word (STOP, BAJA, START, ALTA…):
  those are dropped from the list.
- **The lead**: created (or updated) in the Lead Manager before the message is
  stored, so its first touch is the funnel's: tag `webinar`, the keyword, the
  campaign. First touch wins, as everywhere.
- **Once**: one reply per inbound message ever (`live_replies.inbound_ref` is
  unique, claimed before sending), and none again for the same person and
  keyword within **7 days** (`REPLY_WINDOW_HOURS`). Another keyword is another
  reply.
- **STOP / BAJA**: a number that opted out gets nothing.
- **Quiet hours (9 p.m. – 8 a.m. on their clock, Texas when unknown)**: the
  existing lead greeting answers a message the person just sent whatever the
  hour (it is a reply, not an outreach), and the keyword reply does the same,
  but only for a message sent in the last 5 minutes; a delivery that arrives
  late is left for a person.
- **A client** (a number with an account) gets the client assistant, as before.
- The sales channel ping (`SALES_WEBHOOK_URL`) fires once per reply sent.
- Without a database (the demo) the same words go out, deduplicated in memory.

## Instagram and Facebook comments

"Comment INFO and we'll send you the link" works today through HighLevel or
ManyChat, which already hold Meta's permission to send a private reply to a
comment. Building Meta's own private-reply integration in the app needs a Meta
app review (instagram_manage_comments, pages_messaging) and is **next**, not
built.

**Pick a neutral word.** Comments are public: "CREDIT" or "REPAIR" under a
post tells everyone the person has credit problems. Prefer **INFO** or
**LINK** for comments. Do not use **START** (or STOP, ALTA, BAJA): those are
the opt-in and opt-out words on WhatsApp and SMS. Keep CREDIT for WhatsApp,
which is private.

### HighLevel (Automation → Workflows)

1. Create a workflow, trigger **Facebook / Instagram comment on a post**
   (choose the page or account; "contains" the word **INFO**; optionally
   only on one post or the live).
2. Action **Instagram / Facebook interactive messenger → Reply in private
   message** with the text below (the link carries the source:
   `src=ig-comment` or `src=fb-comment`, and the campaign `c=`).
3. Optional, to get them into the Lead Manager right away: a **Wait for reply**
   asking for their WhatsApp number, then **Custom webhook**:
   `POST {APP_URL}/api/webhooks/live`, header `x-credalti-secret:
   {LIVE_FUNNEL_WEBHOOK_SECRET}`, JSON body:
   `{"phone": "{{contact.phone}}", "firstName": "{{contact.first_name}}",
   "email": "{{contact.email}}", "platform": "instagram", "source": "comment",
   "keyword": "INFO", "campaign": "webinar-nov", "locale": "en"}`.
4. Optional: a public reply to the comment, "Sent you a DM!" (never anything
   about their credit).

### ManyChat (Automation → New automation)

1. Trigger **Instagram → User comments on your post or reel** (or Facebook
   comments), keyword **INFO**, "Comment Reply" on.
2. Send a **message** with the text below (button "Open my link" to the
   `/live` link with `src=ig-comment&c={campaign}`).
3. Optional: **Collect user data → Phone**, then **Actions → External request**:
   `POST {APP_URL}/api/webhooks/live`, header `x-credalti-secret`, body as above
   (`{{phone}}`, `{{first_name}}`, `{{email}}`).

### The private message, exact words

- **EN:** "Hi! Thanks for your comment. Here is your link to get your credit
  report reviewed by our team, at no cost: {APP_URL}/live?src=ig-comment&c={campaign}
  A person on our team answers on WhatsApp too. Reply STOP to stop messages."
- **ES:** "¡Hola! Gracias por tu comentario. Aquí está tu enlace para que
  nuestro equipo revise tu reporte de crédito, sin costo:
  {APP_URL}/live?src=ig-comment&c={campaign}&lang=es Una persona del equipo
  también responde por WhatsApp. Responde BAJA para no recibir más mensajes."

### The endpoint: `POST /api/webhooks/live`

The same trust as the HighLevel webhook: a shared secret in
`x-credalti-secret` or `Authorization: Bearer`, checked in constant time;
without `LIVE_FUNNEL_WEBHOOK_SECRET` every delivery is refused (503).
Rate limited, 16 KB at most. Body: `phone` (required, a US number), optional
`firstName`, `email`, `state`, `locale`, `platform` (instagram, facebook,
tiktok, youtube, zoom…), `source` (comment, bio, ad, webinar), `keyword`,
`campaign`, `consentText`. Any field named like a Social Security number, a
date of birth or a card number is dropped unread (its name is logged). A state
we have not opened goes to the waitlist; Georgia is refused; a client is left
alone. Nothing is sent to the person from here. Answers
`{ ok, outcome: created | updated | waitlisted | state_blocked | existing_client }`.

## SMS (off by default)

The owner says texting these leads is cleared with his attorney. The SMS
channel is built **off**, behind `SMS_FUNNEL_ENABLED=on` plus
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.

**Read this first.** US carriers and Twilio list credit repair among the
restricted (often forbidden) categories for business texting: an **A2P 10DLC
campaign for credit repair may be rejected**, and unregistered traffic is
filtered or blocked. Register the brand and the campaign, and turn this on
only after it is approved. **WhatsApp stays the default.**

What it may send, and only this (`src/lib/live/sms.ts`, the only file in the
app that sends a text message other than a login code):

1. the keyword reply to a person who **texted the keyword** to our number
   (`/api/webhooks/sms`, Twilio's signature checked);
2. their video's link, to a person who texted the keyword or **ticked the SMS
   consent on `/live`** (the box shows only while SMS is on; its words are
   stored with the lead).

Every text carries "Reply STOP to opt out" and passes the claim rules. STOP /
START received by SMS are recorded (`live_sms_opt_outs`; Twilio also answers
STOP itself); a WhatsApp BAJA/STOP blocks SMS too. Quiet hours and the 7-day
dedupe apply as on WhatsApp; a video link by SMS is never sent in quiet hours.
Client follow-ups, the autopilot, reminders, billing and everything else keep
the "never SMS" rule: nothing there imports the SMS adapter, the integrations
folder holds no SMS file, and the tests hold both.

## Step 3: `/live`

Public, phone first (one column, 56 px buttons, nothing wider than 390 px),
English first with "Español" one tap away, the website's navy and gold, Alti
waving (`AltiWaveLoop`) beside his labelled greeting. Kept out of search
engines (a campaign page).

- **Chat with our team**: WhatsApp with the keyword prefilled
  (`CREDIT #campaign`), so the person gets the link and a person answers.
- **Get my credit report reviewed**: the form (first name, US WhatsApp number,
  optional email, state, language, goal) and two required consents:
  messages, and storing their report for review (deleted after 30 days if they
  don't sign up). The exact words are stored with the lead. Only an opened
  state proceeds (Texas today); another state gets the existing waitlist;
  Georgia gets the restricted-state message. Never a Social Security number, a
  date of birth or a card number: there is no field for them, and the page says so.
- **The report**: 1 to 3 files (a PDF or a saved page; one per bureau from
  annualcreditreport.com, or one 3-bureau report), up to 20 MB each, with a
  5-minute guide to annualcreditreport.com ("the official site where the law
  lets you get your reports, at no cost"; enter the SSN only there), and the
  IdentityIQ option with the existing commission disclosure.
- **Where they came from**: `src`, `kw`, `c` (and `p`) on the link, plus the
  ad tags the Ads Manager already keeps in the browser (first touch, 28 days:
  `src/lib/ads/capture.ts`), go into the lead's first touch.
- The word "free" is never used: the review is "at no cost".

## Step 4: report intake and the review overview

- The files go to the private **live-reports** bucket (administrators and
  specialists may read; only the server writes). The AI report reader
  (`docs/INTAKE.md`: the same model, schema and validation) reads each one
  after the upload answers (the person can close the page); the cron retries
  a reading that did not finish. Readings of several files are merged (each
  bureau from the newest file); scores are dropped.
- The **review overview** (`src/lib/live/overview.ts`, words in `text.ts`):
  plain counts (accounts, open, collections, late payments, charge-offs,
  inquiries, public records; an account on several bureaus counted once), per
  bureau; **what the law lets them dispute** (inaccurate, incomplete or
  unverifiable, § 611; the § 605 time limits); each negative item's § 605
  date; **what the data checks noticed** (`docs/DATA-CHECKS.md`; never a
  verdict); how many items the reader was not sure about; credit-building
  basics; **which package may fit** — Credalti Complete first, then Credalti
  DIY, each with who it is for, how it is charged, and "Start with DIY, upgrade
  anytime and keep everything you've done" — and the names of the plans the
  attorney approved (`publicPlans`). No score, no promise, never "we'll
  remove"; the person decides what is inaccurate.
- Without an API key the reading is the simulated one, labelled, and can never
  be imported into a case.

## Step 4: the personal video (`/equipo/revisiones`)

Group 3 · Lead Manager, `reviews.video` (administrators and specialists; sales
sees the stage in the Lead Manager, never the report). The red circle on Lead
Manager adds the reviews waiting for a person.

- **Record video** opens a recording view that covers the console and shows
  only this person's overview and the script, so sharing "this tab" never
  shows anyone else. The browser's screen share (this tab offered first), an
  optional camera bubble and the microphone are mixed on a canvas
  (MediaRecorder, WebM). 3-second countdown, up to 5 minutes (it stops by
  itself), aiming for 2–5. **Retake**, or **trim** the start and the end: the
  kept part is recorded again, so what was cut is not in the uploaded file.
  The file goes straight to the private **live-videos** bucket through a
  one-time signed link; the server checks its first bytes. On a phone (no
  screen recording) the screen says to use a computer.
- **The script** (2 to 5 minutes) sits beside the recorder, with the "never"
  line.
- **Send**: WhatsApp with one tap (plain text inside the 24 hours after their
  last message; outside, only the template `credalti_video_revision` once
  approved in Meta and listed in `WHATSAPP_APPROVED_TEMPLATES`); by email (the
  member's own mail app opens with the message); by text message only when SMS
  is on and allowed; or copy. Each send makes a **new link** (the earlier one
  stops working) valid **14 days**, and sets the lead's "Invited".
- **Tracked**: sent, opened (the page ran in a browser, so a link preview does
  not count), watched (80 % or to the end), «Get started».
- **Signed**: «Import as the first report» puts the reading into the case
  through the existing import (`reports.import`; the same rules as any report);
  the funnel's copy is then deleted.

### The video page `/v/<token>`

Only the video (a short-lived signed link), their first name, the two packages
(Complete first) and «Chat with us». No report data. Never indexed, generic
link-preview title. «Get started» opens the signup with their invitation and
the package preselected:

    /onboarding?n=<first name>&g=<goal>&s=<state>&r=<salesperson>&lang=<en|es>&option=complete
    /onboarding?…&option=diy

`option` (`complete` | `diy`, `src/lib/live/packages.ts` `OPTION_PARAM`) is
for the signup to read and preselect the package; anything else is ignored.

## Step 5 in the Lead Manager: the funnel's stages

Every funnel lead carries a line beside its pipeline stage: **New → Reviewing
report → Video sent → Watched → Started signup → Signed** (facts, never
chosen; `src/lib/live/stages.ts`), with where it came from (Webinar ·
WhatsApp · CREDIT · webinar-nov). The row shows "Live · Video sent"; the
conversation shows the steps and, for a reviewer, a link to the review.

## For the Webinars section (migration 0044)

The funnel's facts by campaign and keyword are in `live_leads` (`tag`,
`keyword`, `campaign`, `src`, `platform`, and the stage dates), with
`leads.signed_at`. To count:

```ts
import { countFunnelStages, countFunnelByCampaign } from "@/lib/live/stages"; // pure
import { countFunnelForCampaign, loadFunnelRows } from "@/lib/live/server";  // server

await countFunnelForCampaign(db, "webinar-nov");
// → { total, new, reviewing, video_sent, watched, started, signed }  (each: reached that stage or further)
countFunnelByCampaign(await loadFunnelRows(db)); // Map<campaign, counts>
```

Campaigns are stored lowercase (`cleanCampaign`), keywords uppercase. A
webinar can name its campaign tag and keyword; the link to share is
`{APP_URL}/live?src=webinar&c=<campaign>` and the WhatsApp keyword
`WORD=<campaign>` in `LIVE_KEYWORDS`. If 0044 changes `leads_source_check`, it
must keep `'live'`.

## Retention

- A report (its files, its reading and its overview) and its video are
  **deleted 30 days after the upload** if the person did not sign up
  (`/api/cron/live`, hourly, `docs/n8n.md` Workflow 13, heartbeat "live",
  required in Launch readiness). The bare record stays (no credit data) for
  the funnel's counts.
- Signed: it waits for «Import as the first report» (at most 60 more days),
  and the funnel's copy goes as soon as it is imported.
- «Delete now (if they ask)» on the review deletes it at once.
- Upload tokens expire after 24 hours. Video links after 14 days.

## Security and privacy

- Row level security: reviews, files and videos for administrators and
  specialists only; the funnel facts as the lead itself (an administrator,
  sales theirs and nobody's); a client, a partner and anon read nothing. Only
  the server writes. Both buckets are private; the person gets a 1-hour signed
  link to their video from the server, never the bucket.
- Only the SHA-256 of an upload token and of a video link is stored.
- The records of replies and SMS opt-outs cannot be rewritten; facts only move
  forward (the database's guards).
- Secrets (`LIVE_FUNNEL_WEBHOOK_SECRET`, Twilio's token) are never shown on any
  screen; the review screen shows only the keywords and whether SMS is on.

## For the owner

1. Apply migration 0043 (or the whole `supabase/setup.sql` on a new project).
2. Add n8n Workflow 13: `POST {APP_URL}/api/cron/live` every hour.
3. Optional: set `LIVE_KEYWORDS` (e.g. `CREDIT,CREDITO,WEBINAR,INFO=ig-nov`).
4. Get `credalti_video_revision` approved in Meta (en_US and es_MX; words in
   `src/lib/live/templates.ts`) and add it to `WHATSAPP_APPROVED_TEMPLATES`, so
   a video can go after the 24 hours.
5. Comments: set `LIVE_FUNNEL_WEBHOOK_SECRET` and build the HighLevel or
   ManyChat automation above with a neutral word (INFO or LINK).
6. SMS: leave `SMS_FUNNEL_ENABLED` empty unless the attorney confirms and an
   A2P 10DLC campaign is approved.
7. Before the first webinar: send CREDIT to the number yourself, fill `/live`
   with your own report, record and send yourself a video, open it on a phone.

## For the attorney

1. The keyword reply answers a person who wrote first, with an AI-labelled
   message and a link, including in quiet hours when they just wrote. Is that
   consistent with the TCPA, the TSR and Tex. Bus. & Com. Code ch. 304?
2. The two consents on `/live` (messages; storing the report for 30 days, read
   by an AI vendor): enough as worded (`src/lib/live/copy.ts` CONSENT_TEXT)?
   PDFs carry the SSN and date of birth to the AI vendor (`docs/INTAKE.md` Q5).
3. A recorded video explaining a prospect's report before they sign: any CROA
   issue (no payment is asked; no promise is made; the person decides)?
4. SMS: the consent text, and whether texting prospects who texted us first is
   allowed for a credit services organization in Texas.

## Not done

- Meta's own private replies to comments (needs app review); HighLevel or
  ManyChat do it today.
- Texts other than the keyword (and STOP/START) received by SMS are not shown
  anywhere; the team works on WhatsApp.
- The recorder was checked in desktop Chrome; Safari's MediaRecorder writes MP4
  and was not tried. Trimming re-records in real time (up to 5 minutes).
- No live WhatsApp, Twilio, HighLevel, ManyChat or Claude call was made; all
  were tested with mocks.
- The signup does not read `option=` yet: the other packages' helper builds it.
