# Webinars and the campaign scorecard

«Webinars» (`/equipo/webinars`, section 2 «Marketing», after Ads and before
SEO) runs the live classes end to end, and, for the owner, answers the two
questions the go-to-market is for: **what does a client really cost (CAC)**
and **what is a client worth**, including what they buy later.

The plan it is built for: the owner's sister hosts live classes (Zoom,
Facebook, YouTube, Instagram, TikTok), the owner moderates, his brother
answers the messages; about $1,000 of Meta ads invite people to the class;
organic posts do the same. English first, Spanish one tap away; Texas only.

| What | Where | Who |
| --- | --- | --- |
| The webinars: create, publish, links, counters, reminders sent, attendance, registrants | `/equipo/webinars`, `/equipo/webinars/<id>` | see `webinars.view` / `webinars.manage` below |
| The live console | `/equipo/webinars/<id>/en-vivo` | `webinars.view` |
| Host script and run of show (printable) | `/equipo/webinars/<id>/guion` | `webinars.view` |
| Campaigns and cost per client (the scorecard) | `/equipo/webinars?vista=campanas` (a tab inside Webinars) | `campaigns.view` |
| The public registration page | `/webinar/<slug>` (and `/webinar/baja`, the reminders' unsubscribe) | anyone |
| Live chats (a person joins Alti's signup chat) | `/equipo/chats` (Lead Manager) | `leads.work` (see `docs/SIGNUP-CHAT.md`) |
| The Overview's «Next webinar» card | `/equipo/control` | `webinars.view` |

**Why the scorecard is a tab inside Webinars and not its own page:** a
campaign groups the webinars with the ads, keywords and organic sources that
brought people to them; the owner reads both together, and a separate page
would have been one more menu entry for one person.

Code: `src/lib/webinars/` (`types.ts`, `time.ts`, `register.ts`,
`publicCopy.ts`, `reminders.ts`, `unsubscribe.ts`, `attendance.ts`,
`scripts.ts`, `live.ts`, `packages.ts`, `scorecard.ts`, `value.ts`,
`views.ts`, `check.ts`, `text.ts`, `demo.ts`, `data.ts`, `server.ts`),
`src/components/staff/webinars/`, `src/components/site/WebinarRegistration.tsx`,
the pages above, `POST /api/webinars`, `POST /api/webinars/unsubscribe`,
`/api/staff/webinars`, `POST /api/cron/webinars`. Database:
`supabase/migrations/0044_webinars.sql`. Tests:
`src/lib/__tests__/webinars.test.ts` and `src/lib/__tests__/db/webinars.test.ts`.

## The roles

| Capability | Administrator | Specialist | Sales |
| --- | --- | --- | --- |
| `webinars.view`: the webinars, the live console, the scripts | yes | yes | yes |
| `webinars.manage`: create, change, publish, cancel, import attendance, mark attended | yes | — | — |
| `campaigns.view`: campaigns, costs, purchases, CAC, client value (money) | yes | — | — |
| `leads.work`: registrants' phones, emails and questions; the leads; the live chats | yes | — | yes |

- **The owner (administrator)** creates and publishes the webinar, moderates
  from the live console, imports the attendance and reads the scorecard.
- **The host (the owner's sister)** needs only the script page (any role).
- **The brother (sales)** answers the keyword messages in Lead Manager
  («Prospectos») and the live chats; he sees registrants with their
  contact details, never money.
- **A specialist** can moderate (console, scripts) and sees registrants as
  "Rosa G." with counts only: never a phone, an email or a question (the
  database's policies give registrations to administrators and sales only;
  the route reads the counts for a specialist with the service role and
  strips the contact fields).

Every route asks the capability again; the database's row level security
asks the role a third time.

## Before

1. **Create the webinar** («Nuevo webinar»): title in English and in Spanish,
   the host, the day and time **on Texas time**, minutes (45 by default),
   language (English, Spanish or both), the topic, a **campaign tag**
   (`webinar-test-1`: it marks the leads the class brings), the **keyword**
   (`CREDIT` by default), the platforms' links (Zoom, Facebook, YouTube,
   Instagram, TikTok; `https` only), and later the replay link. The titles
   and topic are checked as they are typed and again on the server: no
   promised result, never "free", no pressure, no score talk. It saves as a
   **draft**: a draft has no public page.
2. **Publish** it. The registration link is `/webinar/<slug>` (copy it from
   the webinar's page). A published webinar keeps its link; a cancelled one
   stays cancelled; none is ever deleted.
3. **Share the link** in the ads and posts. Ads carry the same URL
   parameters as every Meta ad (`docs/ADS.md`, «Set this once in Meta Ads
   Manager»): `utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}&ad_id={{ad.id}}`.
   The registration keeps them (first touch, `src/lib/ads/capture.ts`) on
   the registration, so a registrant who came from an ad counts for that ad.
   Organic posts: `utm_source=instagram` (or `tiktok`, `youtube`).

### The registration page (`/webinar/<slug>`)

Phone first, English and Spanish (`?lang=es` / `?lang=en`, the site's
language system), the website's look, with Alti waving and labelled
**"Alti · AI assistant"**. The badge says **"Live class · 45 minutes ·
Register"** (never "free"). The page lists what the class covers and says
it is a class, that nobody can promise how a bureau responds, and that
results vary.

The form: first name, last name (optional), WhatsApp number, email
(optional), state, preferred language, goal (buy a home, buy a car,
understand my report, just learning), timeline, biggest question (no
account or Social Security numbers: refused if they look like one), and the
**reminders consent**, never pre-ticked:

> Send me reminders about this class by WhatsApp or email (1 week, 1 day and
> 1 hour before, when it starts, the replay, and two follow-ups after). Up to
> 7 messages. Reply STOP or use the email's link to stop them. Never by text
> message.

Its version (`webinar-reminders-v1`) and the SHA-256 of the exact words are
stored with the registration, with the time, IP and browser.

- **Texas** registrants are served.
- **Any other state** may register to learn; the registration is marked
  `out_of_state` and the page says Credalti only offers its service in
  Texas, so no sign-up will be offered after. They get the reminders and the
  replay, never the two follow-ups (which invite to sign up).
- **Georgia** gets the "restricted" explanation and no button; the server
  refuses it (422) and the database refuses it again (`state <> 'GA'`).
- One registration per WhatsApp number per webinar: a second one says "This
  number is already registered".

While the class is live the page shows a "Watch on Zoom / Facebook / …"
button per platform; afterwards, the replay (or "the replay shows here once
it's ready"); a cancelled one says so.

## Reminders

Sent by `POST /api/cron/webinars` (shared secret; every 10 minutes;
`docs/n8n.md` Workflow 14; heartbeat `webinars`), only to registrants who
ticked the box, by the rules of every automatic message:

- **WhatsApp first**: plain text inside the 24-hour window of the person's
  last WhatsApp message, otherwise **only the approved template** below;
  **email** when WhatsApp cannot carry it (with the company's postal address
  and a signed one-tap unsubscribe link); **never SMS** (there is no SMS
  channel, and the database refuses one).
- **Quiet hours 9 p.m. to 8 a.m. Texas time**: nothing goes; a reminder
  waits for the morning only while its own window is still open.
- **Opt-out**: nothing to a number whose newest record says STOP / BAJA, or a
  registration that used the email's link (which records an opt-out of the
  number: no automatic message of any kind goes to it after).
- **Dedupe**: each reminder once per registration, claimed under
  `webinar:<registration>:<kind>` before it is sent (two runs at once: one
  wins, the other sends nothing).

The schedule (S = the start, E = the end). The windows never overlap, so a
missed reminder is never sent late; a person who registers on the day gets
the 1-hour reminder, not the week's:

| Reminder | Window | Who |
| --- | --- | --- |
| 1 week before | S − 7 days → S − 1 day | registered before S − 7 days |
| 1 day before | S − 1 day → S − 1 hour | registered before S − 1 day |
| 1 hour before | S − 1 hour → S | registered before S − 1 hour |
| We're live now | S → E | registered before S |
| The replay | E → S + 2 days, once the replay link is set ("within an hour after": add the link when the stream ends) | everyone who registered |
| Follow-up, day 2 | S + 2 days → S + 3 days | Texas registrants who have not signed up |
| Follow-up, day 5 (the last) | S + 5 days → S + 6 days | the same; nothing after |

The link in every message is the webinar's own page (`/webinar/<slug>?lang=`),
which shows the join buttons when live and the replay after; the follow-ups
also link the chat signup (`/registro?utm_source=webinar&utm_campaign=<tag>`).
The webinar's page shows, for an administrator, how many of each were sent
and how many failed ("failed" is usually a template Meta has not approved yet).

### WhatsApp templates to get approved in Meta

Create each in WhatsApp Manager → Message templates, category **Utility**,
languages **es_MX** and **en_US**, with exactly this name and body, then add
the names to `WHATSAPP_APPROVED_TEMPLATES`. Every message also carries the
automatic-message footer: "Automated message from Credalti. Reply STOP if you
do not want these messages." / "Mensaje automático de Credalti. Si no quieres
recibir estos mensajes, responde BAJA."

| Name | Params | English | Spanish |
| --- | --- | --- | --- |
| `credalti_webinar_semana` | name, class, date, link | Hi {{1}}, a reminder of your live class with Credalti: “{{2}}”, on {{3}}. It runs about 45 minutes and you can bring your questions. Your link: {{4}} | Hola {{1}}, te recordamos tu clase en vivo con Credalti: «{{2}}», el {{3}}. Dura unos 45 minutos y puedes traer tus preguntas. Tu enlace: {{4}} |
| `credalti_webinar_manana` | name, class, time, link | Hi {{1}}, your live class “{{2}}” is tomorrow at {{3}}. Your link: {{4}} | Hola {{1}}, mañana es tu clase en vivo «{{2}}», a las {{3}}. Tu enlace: {{4}} |
| `credalti_webinar_una_hora` | name, class, time, link | Hi {{1}}, your live class “{{2}}” starts in one hour, at {{3}}. Your link: {{4}} | Hola {{1}}, tu clase en vivo «{{2}}» empieza en una hora, a las {{3}}. Tu enlace: {{4}} |
| `credalti_webinar_en_vivo` | name, class, link | Hi {{1}}, we're live now: “{{2}}”. Join here: {{3}} | Hola {{1}}, ya estamos en vivo: «{{2}}». Entra aquí: {{3}} |
| `credalti_webinar_repeticion` | name, class, link | Hi {{1}}, thank you for signing up for “{{2}}”. Here is the replay: {{3}}. If you have a question, reply here and a person on our team will answer. | Hola {{1}}, gracias por registrarte a «{{2}}». Aquí está la repetición: {{3}}. Si te quedó una pregunta, responde aquí y una persona del equipo te contesta. |
| `credalti_webinar_seguimiento_2` | name, class, link | Hi {{1}}, did the class “{{2}}” leave you with a question? Reply here and a person on our team will answer. If you want to start your review, it is a short chat: {{3}} | Hola {{1}}, ¿te quedó alguna pregunta de la clase «{{2}}»? Responde aquí y una persona del equipo te contesta. Si quieres empezar tu revisión, es un chat corto: {{3}} |
| `credalti_webinar_seguimiento_5` | name, class, replay, link | Hi {{1}}, one last note about “{{2}}”: the replay is still here: {{3}}. Whenever you like, you can start your review in a short chat: {{4}}. This is our last message about this class. | Hola {{1}}, una última nota sobre «{{2}}»: la repetición sigue aquí: {{3}}. Cuando quieras, puedes empezar tu revisión en un chat corto: {{4}}. Este es nuestro último mensaje sobre esta clase. |

The email carries the same words, with the subject "Your live class is in
one week" / "Tu clase en vivo es en una semana" (and so on: `WEBINAR_EMAIL_SUBJECTS`).
Every template, filled in, passes the claim rules and the content check in
both languages (`webinars.test.ts`). The launch checklist lists them with the
others (`WHATSAPP_TEMPLATE_NAMES`).

## During

### The live console (`/equipo/webinars/<id>/en-vivo`)

Made for a laptop beside the stream (three columns from 1280 px; one on a
phone):

- **The navy band**: the timer (counting down before the start, then the
  time live), where the show is now, and the **next call to action** with a
  countdown.
- **The counters**, refreshed every 5 seconds: registered, attended, keyword
  messages, reports uploaded, videos sent, videos watched, signups started,
  signed. Videos read "Comes with the keyword funnel" until the live funnel
  says (below).
- **The moderator's messages**, in English or Spanish (a switch), each with
  «Copy»: welcome, "don't post personal info", the class link, the keyword
  (call to action 1), the two packages (call to action 2), sign up yourself,
  the question prompt, the home-buyer prompt, and the close with the replay
  (call to action 3).
- **The run of show**, compact, with the three call-to-action moments in gold.
- **Messages and leads coming in**: first name and initial, the start of
  their message, and whether they are signing up or signed.
- A red line when someone in the signup chat is waiting for a person (for
  members who work leads).

Nothing in the console sends anything: the moderator pastes the messages in
the stream's chat, and the brother answers the leads in Lead Manager.

### The run of show (45 minutes) and the host's script

`/equipo/webinars/<id>/guion` prints the whole script in English or Spanish:

| At | Minutes | Part | Call to action |
| --- | --- | --- | --- |
| 0:00 | 2 | Welcome | |
| 0:02 | 3 | Who we are (Alti is an AI, and he says so) | |
| 0:05 | 10 | Your rights under the FCRA, in plain words | |
| 0:15 | 2 | The notes: type the keyword | **1** |
| 0:17 | 10 | Reading your report | |
| 0:27 | 8 | How a dispute works (you decide; nobody can promise; results vary) | |
| 0:35 | 2 | The two packages, and sign up yourself | **2** |
| 0:37 | 6 | Your questions (and the home-buyer prompt) | |
| 0:43 | 2 | Close: the replay, the keyword | **3** |

**The two-package pitch** (owner's decision, 2026-11-25), in the host's
words and the moderator's message: **Credalti Complete** first (our team
prepares and mails your letters every round), then **Credalti DIY** (Alti
guides you step by step and you mail your own letters); "With Complete,
you're charged each month right after your letters are mailed; DIY is a
simple monthly subscription."; "Not sure? Start with DIY. If it gets to be
too much, switch to Complete anytime and keep everything you've done.";
"you decide what's wrong on your report, and nobody can honestly promise
results"; for home buyers soon, "Complete is the faster path"; credit
monitoring (IdentityIQ) is a separate monthly subscription. **Prices** come
from the offered, attorney-approved plans (the same list as `/precios`): a
plan whose name has "Complete" or "DIY", its first dollar amount
(`packagePrices`). Until such a plan is offered, the script says **[price]**
and the screen says the host reads the approved plan's price.

Every line of the scripts passes the claim rules and the advertising rules
in both languages; nothing "free", no pressure (`webinars.test.ts`). If
`docs/LIVE-FUNNEL.md` adds its own chat lines, they replace
`moderatorMessages` in `scripts.ts`.

## After

1. **Add the replay link** on the webinar («Cambiar» → Replay). The replay
   message goes on the next run (every 10 minutes).
2. **Import the attendance**: Zoom → Reports → Usage → the webinar →
   Attendee report → CSV (or a meeting's Participants export). On the
   webinar's page, choose the file: it is read, matched to the registrants
   by **email first, phone second**, and you see "N in the file · M match
   registrants · K not registered" **before** saving. Zoom's summary block on
   top is skipped, a person's several joins are added up, and "Attended: No"
   rows are left out. Or mark a registrant by hand («Marcar asistió»).
   Facebook, YouTube, Instagram and TikTok give no list of viewers: there the
   keyword messages are what counts.
3. The follow-ups on day 2 and day 5 go by themselves, then nothing more.

## How the live funnel plugs in

The keyword funnel (migration 0043, `src/lib/live/*`, `docs/LIVE-FUNNEL.md`):
a keyword typed in a live chat or sent on WhatsApp gets an automatic reply
and the lead is tagged with the keyword and the campaign. The webinars read
those tags from the lead inbox's own records (`leads`, migration 0034;
`src/lib/webinars/live.ts` `leadTags`): source `webinar` (or
`first_touch.channel = "webinar"`, or the live funnel's
`first_touch.funnel.tag = "webinar"`); the keyword in `first_touch.keyword`,
`.live.keyword` or the live funnel's `.funnel.keyword`; the campaign in
`first_touch.campaign`, `.campaignTag`, `.live.campaign` or `utm.campaign`;
the webinar in `first_touch.webinarId` or `.live.webinarId`, or the lead's
phone matching a registrant.

A lead belongs to a webinar by its id, a registrant's phone, or its keyword
(tagged as from a webinar) or campaign tag from the day before the class on.
"Keyword messages" counts the webinar's leads who sent any keyword (CREDIT or
the Spanish CRÉDITO).

What only the funnel knows comes through one interface, **connected**:

```ts
// src/lib/webinars/live.ts
export interface LiveFunnelSource {
  id: string;
  videos(leadIds: readonly string[]): Promise<{ sent; watched; reports?; started? }>; // sets of lead ids
}
```

`src/lib/live/webinarSource.ts` registers it (`registerLiveFunnelSource`),
imported once at the top of `src/lib/webinars/server.ts`. It reads four facts
per lead from `live_leads`, by lead id only (no name, phone or report data),
with the service role after the route checked the capability:
`report_at` (report uploaded on `/live`), `video_sent_at`, `video_watched_at`
and `started_at` («Get started» on `/v/<token>`). The console and the
scorecard count a report uploaded on `/live` and «Get started» even before an
account exists. If the source fails, the video counters read "No data yet",
never 0. In the demo the same facts come from the sample
(`webinars/demo.ts` `demoFunnelEvents`) plus what was done in this browser
(a video sent from `/equipo/revisiones`, the demo video page watched,
«Get started»: `live/data.ts` `demoLiveFunnelEvents`); the live funnel's
sample leads (Rosa, the 210 number) typed the keyword during the live class
(campaign tag `webinar-test-1`).

## Packages (Complete and DIY)

Owner's decision, 2026-11-25: "Credalti Complete", done for you, monthly,
charged right after each month's letters are mailed; "Credalti DIY", do it
yourself guided by Alti, a simple monthly subscription. The scorecard reads
them from the service options module (`docs/SERVICE-OPTIONS.md`), through
`src/lib/webinars/packages.ts`:

- `packageOf(client)`: the client's recorded option, `serviceOption` on the
  console's client record (the signed agreement in force, else the option
  they chose). `diy` is DIY, `full_service` Complete. A client with **no
  recorded option** (signed before the options existed) is Complete, the same
  rule billing and the console apply (`effectiveOption`).
- `upgradesOf(clientId, events)`: the client's `service_option_upgraded`
  events (written when a Complete agreement supersedes a DIY one), read on the
  server by `listUpgrades(db, userIds)` in `src/lib/service/server.ts`, beside
  `countUpgrades(db, from, to)`. "Collected after the upgrade" counts from the
  first one.

## The scorecard and its formulas

A **campaign** ("Webinar test #1", its dates on Texas's calendar, a budget)
groups: Meta campaigns (picked from the Ads Manager's cached data), webinars,
keywords and organic sources (`utm_source` values). Costs that are not
Meta's (Zoom, Canva, editing, people's time, other ads) are added by hand;
a cost entered by mistake is **voided**, never deleted.

**The funnel counts the leads that ARRIVED in the campaign's dates** (a
cohort, like the Ads Manager) and how far each has come **so far**. A lead
belongs to the campaign by its first touch, in this order, and counts once,
under the first that matches:

1. **Ads**: its Meta campaign (first touch, `ads/attribution.ts`; or the Meta
   ad on its webinar registration, by phone) is one of the campaign's;
2. **Webinar**: it came from one of the campaign's webinars (id, tag, or a
   registrant's phone);
3. **Keyword**: it typed one of the campaign's keywords;
4. **Organic**: its `utm_source` or channel is one of the organic sources.

| Number | From |
| --- | --- |
| Meta spend | the Ads Manager's daily insights for the campaign's Meta campaigns, in its dates (Meta's number) |
| Other costs | the costs recorded on the campaign (not voided) |
| Registered, attended | registrations of the campaign's webinars |
| Leads | the campaign's leads (above) |
| Reports uploaded | of those, the ones whose client has a report on file (only the client id is read, never the report) |
| Reports uploaded | (also) the report the lead uploaded on `/live` (the live funnel) |
| Videos sent / watched | the live funnel (above); "No data yet" if it cannot be read |
| Signups started | a chat signup or an account began, or «Get started» on the video page |
| Signed | the service agreement is signed (`leads.signed_at`) |

**CAC, two ways**, each with its formula written on the screen:

- **Ads only** = Meta spend on the campaign's Meta campaigns in its dates ÷
  signed clients credited to those ads.
- **Blended** = (that Meta spend + every other campaign cost) ÷ every signed
  client the campaign brought.

Below **3 signed clients** (`MIN_SIGNED_FOR_CAC`), a CAC reads **"Not enough
data yet"** (and the spend and count stay visible); with no spend, "No spend
recorded".

**Client value**, per signed client (first name and initial only; nothing of
their credit):

- **Money actually collected so far**: THE MONEY RULE
  (`src/lib/accounting/ledger.ts`, read only): payments in, refunds, voids
  and lost chargebacks out, test charges never;
- **IdentityIQ commissions** recorded for the client (`/equipo/monitoreo`),
  voided lines left out;
- **Later purchases** marked by hand on the scorecard (an upgrade, a
  household add-on, a partner offer, a loan officer connection, a home
  purchase, other), with the money they brought when they brought any;
  household members added and loan officer requests are also counted from
  the records;
- **DIY → Complete upgrades** as their own number, and inside the value as
  the money collected after the upgrade.

**Average value per client** = total value ÷ signed clients. **Value ÷ CAC** =
average value ÷ blended CAC (only when the CAC has enough data).

**By package** (Complete, DIY): signed, collected, average value, CAC*
(all campaign costs ÷ that package's signed clients, as if the campaign had
brought only those), ads CAC (Meta spend ÷ that package's ad-credited
signed clients), value ÷ CAC (using the whole campaign's blended CAC),
upgrades.

## The $1,000 test plan

1. In Ads, check Meta is connected and synced; set the URL parameters on
   every ad (above).
2. Create the campaign "Webinar test #1": dates (the ads' first day to two
   weeks after the last class), budget $1,000, the Meta campaign(s) inviting
   to the class, the webinars, keyword `CREDIT`, organic sources
   `instagram, tiktok, youtube`.
3. Create and publish two or three webinars (one per week works), with the
   campaign tag `webinar-test-1`; share the link in the ads and posts.
4. Record the costs that are not Meta's as they happen (Zoom, Canva,
   editing).
5. During each class, run the console; after, add the replay and import
   Zoom's CSV.
6. Read the scorecard weekly; decide at the end, not before: with fewer than
   3 signed clients the CAC says "Not enough data yet" on purpose. Compare
   ads-only to blended (how much the classes and organic add), and value ÷
   CAC by package. Keep running what earns more than it costs; turn off the
   ads the Ads Manager marks "Turn off".

## The Ideas center

`src/lib/ideas/signals.ts` source `webinars`, filled by the server
(`loadWebinarsSignal`): registrations (30 days), attendance rate of the
classes that ended, keyword leads, signed from webinars, and the newest
campaign's blended and ads-only CAC, value per client, value ÷ CAC (a new
unit, "ratio", shown as "2.5×") and DIY → Complete upgrades. A CAC below the
threshold is "no data", never a figure.

## The demo

No database: three **sample** webinars (one ended with its replay and a Zoom
import, one **live right now** so the console has something to show, one
next week), their registrants (some out of state), the campaign "Webinar
test #1" (about $1,000 of the sample Meta campaign's spend over its dates,
plus about $130 of other costs, a $1,200 budget), the leads it brought (ad
leads from the Ads Manager's sample account, keyword leads arriving during
the live class and under an organic post, organic), some signed and matched to the
demo's sample clients (so their value comes from the demo's own books, with
sample DIY clients and one upgrade), two later purchases, and two signup
chats waiting. Every screen says "Sample". What a member changes stays in
this browser («Reset the example»); nothing is sent. The public page shows
the sample webinars at `/webinar/reporte-explicado`, `/webinar/credito-en-vivo`
and `/webinar/primera-casa-texas`; registering stores nothing.

## The database (migration 0044)

`campaigns`, `campaign_costs` (voided, never deleted), `webinars` (never
deleted; a published one keeps its link and never goes back to draft),
`webinar_registrations` (what the person gave never changes; one per phone per
webinar; Georgia refused; the consent's version and hash required when
ticked), `webinar_messages` (claimed under a unique dedupe key; WhatsApp or
email only; settled once), `webinar_audit` (append-only), `client_purchases`
(voided, never deleted), `signup_chat_threads`, `signup_chat_messages`
(append-only; Alti refused while a teammate is in; a teammate refused before
joining). Reads: webinars, every member of staff; registrations and chats,
administrators and sales (or whoever may see the client once the case is
linked); the reminders' log, campaigns, costs, purchases and the audit,
administrators. Writes: the server only, with the service role. In
`supabase/setup.sql` (`npm run db:setup-sql`) and Launch readiness's
migration check (sentinel `signup_chat_messages`).

## What the owner must do

1. **Get the seven WhatsApp templates approved** in Meta (above) and add
   their names to `WHATSAPP_APPROVED_TEMPLATES`. Until then reminders go by
   email (to registrants who gave one) or not at all.
2. **Email**: `EMAIL_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_COMPANY_ADDRESS`,
   `UNSUBSCRIBE_SECRET` and `NEXT_PUBLIC_APP_URL` (already in Launch
   readiness) make the email channel and its unsubscribe link work.
3. **n8n Workflow 14**: call `/api/cron/webinars` every 10 minutes.
4. **Zoom**: export the attendee report as CSV after each class (Zoom
   Webinars or a meeting's participants list).
5. **Budgets and costs**: create the campaign with its budget, and record the
   non-Meta costs as they happen.
6. **Offer the two packages' plans** (named with "Complete" and "DIY") so
   the script reads their prices instead of "[price]".
7. Ask the attorney whether the class's sign-up invitation (call to action 2)
   and the follow-ups need anything more in Texas (the same questions as the
   sales flow in `docs/SALES-FLOW.md`).

## What is not done

- No live Zoom, Facebook, YouTube, Instagram or TikTok connection: links are
  typed in, attendance is Zoom's CSV.
- Nothing has been sent to a real number or address; the reminders were
  tested with a mocked sender.
