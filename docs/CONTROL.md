# Credalti Control

The owner's "business in a box" for Credalti, built after ALTO Control (the
staff hub of ALTO Pro), for credit repair. Phase 1 is four things inside the
existing staff console (`/equipo`); phase 2 makes the Overview the single home
of the business: every department one tap away, and Content and Accounting
on its cards and in its Today list (see «The home of the business» below).

| What | Where | Who |
| --- | --- | --- |
| **Overview** and **Today** | `/equipo/control` (section 0 «Overview» of the side menu) | everyone on the team; each card by role |
| **Leads**: the lead inbox, pipeline, numbers, autopilot switch | `/equipo/leads` (tab «Leads») | administrators and sales (`leads.work`) |
| **Lead autopilot** (OFF) | `/equipo/leads?vista=autopilot` | read by whoever works leads; switched only by an administrator (`autopilot.manage`) |
| **Phone alerts** (OFF for everyone) | `/equipo/alertas` (under «More») | each member, for themselves |

Database: `supabase/migrations/0034_control_leads.sql` (in `supabase/setup.sql`).
Code: `src/lib/leads/` (inbox, autopilot, drafts, metrics, templates, demo,
server), `src/lib/control/` (overview, today, alerts), `src/lib/push/webPush.ts`,
`public/staff-sw.js`, `src/components/staff/control/`, the pages above and
the routes `/api/staff/leads`, `/api/staff/leads/autopilot`,
`/api/staff/alerts`, `/api/staff/control`, `/api/cron/leads`.
Tests: `src/lib/__tests__/control.test.ts` (the rules),
`src/lib/__tests__/controlDepartments.test.ts` (phase 2: the Content card,
the books on the Money card, the Content and Accounting Today items, the
departments strip, who sees each) and
`src/lib/__tests__/db/controlLeads.test.ts` (the migration, row level
security, the autopilot run and the alerts sweep with a mocked WhatsApp, the
routes, and the Content card read through each member's own connection).

## Why a new tab, not a new Home

`/equipo` (Home) is the specialist's day (`docs/STAFF.md`): the work queue,
«Next» (focus mode), the new-hire checklist, and the morning summary links
straight to it (`/equipo?siguiente=1`). Replacing it would break the one
routine the console is built around. So the Overview is a tab of its own next
to Home, and its «Today» view reuses the same work queue rather than a second
one: nothing is counted twice and «Handled» means the same thing in both places.

## The Overview

One card per department, each with real numbers and a **Needs you** count
that opens the screen where the work is done:

| Card | Numbers | Needs you → | Who sees it |
| --- | --- | --- | --- |
| Leads & sales | open leads, new today, waiting on a person, handed over by the autopilot | waiting + hand-offs → `/equipo/leads?filtro=waiting` | `leads.work` |
| Clients in progress | signed (in the 3-day window), waiting on documents, report and review, rounds ready, mailed and waiting on the bureaus, new report in, paused, after-care | the work queue minus unsigned agreements → `/equipo` | everyone (their own clients, by the same scopes) |
| Money | collected this month, charges that failed, scheduled in the next 30 days (the dashboard's own rule); for the owner also this month's **net revenue, expenses and net profit from the books**, and «Open Accounting» | payment notices → `/equipo/clientes?aviso=payment_past_due` | `billing.view`: **never sales**; the books' lines need `accounting` |
| Content | waiting for review, scheduled to post this week (and approved but not scheduled), posted this week, failed posts, automatic publishing on or off; «Open Content» | approvers: in review + failed → board on «Ready for review»; editors: changes requested of them (theirs and unowned) + failed → board on «Changes requested»; only failures → the failed pieces | `content.view` (administrators and specialists) |
| Ads | ad spend in the last 7 days (Meta), leads from ads and cost per lead (Credalti, verified), ads to turn off that still spend; «Open Ads». Sample numbers in the demo, "No data yet" until Meta is connected | ads marked "Turn off" still spending → `/equipo/anuncios?vista=resultados&filtro=turn_off` | `ads.view` (administrators: spend is money) |
| Support | client questions waiting, lead conversations waiting, possible complaints (7 days), review requests sent (30 days) | questions → `/equipo/clientes?aviso=question_waiting` | everyone; reviews with `case.view` |
| Partners | new referrals (7 days), partner notes the team has not answered | → `/equipo/socios` | `partners.view` |
| Tech health | when each thing last happened: WhatsApp received, HighLevel lead, Lob mail update, automatic message, the leads job, morning summary | jobs later than expected | `business.view` (the owner) |

**Real numbers only** (ALTO's lesson): every number comes from the records the
member may read (the clients list, the leads, `/api/staff/control` through the
member's own connection). Something that could not be read, or has nothing
behind it (no lead yet, no charge yet, the demo has no database), shows
**"No data yet"** and the reason, never a 0 that looks like a result. A count
that really is zero is shown as 0.

**Error boundaries**: each card, the Today list and its rows, the lead list,
the conversation and each settings panel sit inside `SafeBoundary`; one bad
value shows "This part couldn't be shown" in that box only.

The **departments strip** on top of the Overview (and of Today) has a tile
for each department the member may open: Leads (`leads.work`), Clients
(everyone), Content (`content.share`; sales, who has no board, lands on the
partner kit), Ads (`ads.view`), Accounting (`accounting`), Partners
(`partners.view`) and Reviews (everyone), with the card's «Needs you» on the
tile when there is one. Three to a row on a phone, one row from 768 px.

Tech health shows what is checkable at a glance (last times, the leads
job's heartbeat in `cron_heartbeats`). The full check-up is in Launch
readiness → System health (`/equipo/lanzamiento?vista=salud`,
`docs/LAUNCH.md`): every service, every scheduled job's heartbeat (every
`/api/cron` route now records one) and «Check now»; the card links there for
an administrator. Outage alerts are still phase 3.

**Launch readiness on the Overview.** While the business is not live (any
required item not ready), an administrator sees a compact card under the
departments strip: "9 · Launch readiness: N of M ready", the next item, and a
link to `/equipo/lanzamiento`. It goes away by itself once every required item
is ready, and comes back if one stops being ready.

### Video Studio, SEO and Ideas on the Overview (final pass)

`src/lib/control/marketing.ts`. The **Content & video** card adds the Video
Studio's line ("Videos waiting for approval", with the videos sent back and
the approved ones still to hand to Content), and its «Needs you» adds the
Video Studio's own rule (`videoNeeds`); the Today list carries the same
videos the way it carries Content's pieces (approve, changes, hand over),
each with its steps. Two compact cards: **2 · SEO** (site checks to fix,
guides waiting for approval, sent back, on the website; "No data yet" until a
site check has run) and **8 · Ideas & tests** (new ideas to approve, tests
running, tests over to keep or drop, decided in the last 30 days; «Needs you»
only for an administrator). The departments strip lists every department in
the menu's order (Video Studio, SEO and Ideas included): two rows of five on
a laptop, one row that slides sideways on a phone. The menu's red circle for
Marketing is unchanged (the board's count, plus the Video Studio's and SEO's
own sources).

## Today

`src/lib/control/today.ts`. One list, worked top to bottom (ALTO's "Today"):
the console's work queue (`autopilot/queue.ts`, unchanged) plus the lead
inbox's hand-offs, waiting conversations, chat signups that asked for a
person and new leads nobody wrote to, the partners' notes waiting for the
team, Content (pieces to approve for an approver, the changes asked of an
editor, posts that failed and why), the books for the owner (a month not
closed after the 5th, receipts missing), and, for the owner, what the team
escalated. Ranked: escalations, complaints, other hand-offs, overdue urgent
notices, leads waiting an hour, signups asking for a person, other overdue
notices, leads waiting, urgent notices, **a failed post**, partner notes,
new leads, **a month to close**, **a piece waiting two days or more for
approval**, medium notices, **changes asked of an editor**, **a piece just in
review**, **missing receipts**, the rest.

Every item has its **step-by-step procedure** (the queue's «How to handle it»
card, or the lead procedures in `today.ts`) with a «Done when…» line, and its
ends: **Open**, **Handled** (queue items, the same mark as Home), and
**Escalate to the owner** with an optional note. An escalation is recorded
(`control_escalations`), shows at the top of the owner's Today list, and
alerts every administrator who turned "Escalated to you" on. Only the owner
marks it **Resolved**. Nothing is sent to a client from this list.

## The home of the business (phase 2)

The three departments built in parallel (Control, `docs/CONTENT.md`,
`docs/ACCOUNTING.md`) meet on the Overview without the Overview counting
anything itself:

- **Content** (`src/lib/control/content.ts`): one pure summary of the board
  from the content hub's own loaders (`content/server.ts` `loadPieces`,
  `loadSchedules`, `loadPublishSettings`), run on the server through the
  **member's own connection** (`control/server.ts`, `/api/staff/control`), so
  the content tables' policies decide: administrators and specialists read
  it, sales nothing (a PGlite test holds it). In the demo it is the board the
  Content tab keeps in this browser. Only titles, statuses, owners, dates,
  the changes note and the failure reason leave the hub, never a piece's
  words. "This week" is the content calendar's week (Sunday to Saturday,
  Central time). The board opens on the asked column with
  `/equipo/contenido?columna=review|changes|failed`.
- **The books** (`src/lib/control/books.ts`): the Money card's three lines
  are the accounting module's `totalsFor` for this Texas month (its one money
  rule: test charges, refunds, lost chargebacks, measured-before-estimated
  fees), on the same books the Accounting screens read: the Overview uses
  `useBooks` (`accounting/data.ts`, the body of `useAccounting`) with the
  clients it already loaded, so nothing is fetched for a member without
  `accounting`. «Expenses» is the dashboard's line; processing fees and
  partner commissions paid are its hint, and are taken off the profit as
  there. Nothing in the books this month: "No data yet".
- **Today from Content**: «Approve this piece» (`content.approve`), «Changes
  requested» (`content.edit` without approve: the editor's own pieces and the
  unowned ones), «A post failed» with the channel and the reason the
  publisher wrote (`content.edit`). Each with its three steps and «Done when».
- **Today from Accounting** (`accounting`): «Close the books for <month>»
  for each of the last three months that is over, has anything in the books,
  is not closed, and (for last month) only after the 5th; «N expenses of $75
  or more without a receipt» in the last 90 days, opening Expenses on the
  month that has most of them. $75 is a working threshold
  (`RECEIPT_THRESHOLD_CENTS`; the IRS uses $75 as its receipt line for
  travel, gift and car expenses), not tax advice; the close
  checklist still asks for every receipt. **Failed charges are not added**:
  they already come from billing through the work queue's payment notices.
- **Navigation**: since the console took ALTO Control's layout (docs/STAFF.md,
  «Navigation and the phone»), Content is section 2 and Accounting section 5
  of the side menu, each with its red circle; on a phone both are in «More».
- **Ads** (`src/lib/ads`, `docs/ADS.md`): the Ads card and tile read the Ads
  Manager's last 7 days (`adsSummary`), on the server through the member's
  own connection (`loadControlExtras` → `loadAdsSummary`; its tables are
  administrators' only, migration 0037), in the demo from the sample ad
  account. Section 2 is now «Marketing» (Content, Ads, Reviews; Video Studio
  and SEO join it). Ad spend never enters the books by itself: Accounting →
  Expenses shows Meta's spend beside "Advertising: Meta" as a reconciliation
  suggestion (THE MONEY RULE is cash basis).

## Leads

One inbox for every prospect conversation, whatever the way in. The database
keeps the `leads` table by itself (triggers), so nothing that already works
had to change:

| Way in | Becomes a lead when | Source shown |
| --- | --- | --- |
| WhatsApp (Cloud API) | a number with no account writes (`chat_messages`, user_id null) | WhatsApp |
| HighLevel | the webhook creates the prospect (`prospects.source = 'highlevel'`) | HighLevel · campaign |
| Partner referral | the portal or the HighLevel code creates the prospect | Partner · name |
| Chat signup (`/registro`) | the signup case is linked to an account with a phone | Chat signup · CR-… |
| By hand / household | sales adds the prospect | Added by hand / Household |
| The live funnel (`docs/LIVE-FUNNEL.md`) | a WhatsApp keyword ("CREDIT"), the `/live` form, or a comment handed over by HighLevel / ManyChat (`/api/webhooks/live`) | WhatsApp or Live funnel, plus a "Live · <stage>" tag |

**The live funnel's stages.** A lead from a webinar or an ad carries a line
beside its pipeline stage, set by facts only: New → Reviewing report → Video
sent → Watched → Started signup → Signed (`src/lib/live/stages.ts`, from
`live_leads`, migration 0043, which sales reads for its own leads; no credit
data). The conversation shows where they came from (webinar, platform,
keyword, campaign) and the steps. The keyword's automatic reply (one per
person and keyword in 7 days, labelled "Alti · AI assistant", STOP and quiet
hours as the greeting) replaces the greeting for that message. The report
review and the personal video live in **3 · Lead Manager → Report reviews**
(`/equipo/revisiones`, `reviews.video`: administrators and specialists, never
sales), whose waiting reviews are added to the Lead Manager's red circle.
WhatsApp only for leads; the funnel's SMS channel is a separate, narrow
exception, off by default (`docs/LIVE-FUNNEL.md`, «SMS»).

First touch wins (never overwritten). Each row shows the source and first
touch, the language (saved, else the one they wrote in), the stage, who works
it, the last message and how long they have waited. The list is newest first;
waiting, hand-offs, STOP and "WhatsApp closes in N h" are tags on the row,
never a hidden ranking (ALTO's lesson). Filters: All (without Archived),
Waiting, Mine, Unassigned, and each stage; search by name, number or CR-.

**Who sees what** (row level security, `staff_can_see_lead`): an administrator
every lead; sales the leads they work and the ones nobody has yet; a
specialist, a client, a partner and anon none. Sales now also reads the
WhatsApp conversation of their leads (before 0034, a conversation with no
account was the owner's only). Leads nobody has go to the next salesperson in
turn every few minutes (`/api/cron/leads`, the HighLevel webhook's own
round-robin); sales may **take** an unassigned lead; only an administrator
assigns one to someone else (`clients.assign`).

### The pipeline: only people move leads

New → Contacted → Qualified → **Invited** → **Signed**, plus Not interested,
Closed-lost and Archived. A person moves a lead (a stage event with the
person as the actor: the database refuses a move without an active member of
the team, a move straight on the row, and a move to Invited or Signed).
**Invited** and **Signed** are facts, never a choice: Invited when the
invitation goes out from «Prepare invitation» (`prospects.invited_at`, or the
lead's own for a WhatsApp-only lead), Signed when the service agreement is
signed (a trigger on `service_agreements`). An archived lead who writes again
shows in New. The autopilot never moves anyone.

### The conversation

Like WhatsApp: the lead on the left; the team (with the person's name) and
Alti (labelled "Alti · AI assistant") on the right; messages read from
HighLevel, when that is on, labelled as such. Around it:

- **✨ Suggest reply**: Alti's drafted-reply engine (`staff/drafts.ts`: the
  same model call, the same checks, the one retry, the "no draft, and why")
  pointed at a lead (`leads/drafts.ts`): service facts, the website's
  approved FAQ and the closest approved saved answer only. No price, no
  result, no pressure, no "free", no phone sales. A person reads, edits and
  sends it under their own name.
- **Saved answers**: the team's approved answers in the lead's language, the
  closest first.
- **Prepare invitation**: `/equipo/invitar?lead=…` fills in what the lead gave
  (name, phone, state, goal, language, partner code); sending or copying it
  sets Invited.
- **Notes** (append-only), **who works it**, **the stage**, the history
  (moves and automatic messages).
- **WhatsApp's 24-hour rule**: inside 24 hours of the lead's last message, any
  reply (checked against the reply rules on the screen and again on the
  server); after that, only the approved template
  `credalti_prospecto_seguimiento`, outside quiet hours, and only once it is
  approved in Meta and listed in `WHATSAPP_APPROVED_TEMPLATES`. A number that
  said STOP gets nothing until START. **Never SMS** (the live funnel's
  keyword reply and video link are the one exception, off by default and
  only for a person who texted us or consented: `docs/LIVE-FUNNEL.md`).

### Lead quality numbers

On top of the inbox and under «Numbers» (`leads/metrics.ts`): new leads
today and in 7 days by source, the median time to the first reply **by a
person** (Alti's greeting and the autopilot do not count), and contacted,
invited and signed as a share of the leads of the last 30 days. Each number
has its definition; a rate with no lead behind it is "No data yet" with why.
Replies written inside HighLevel's own inbox are not seen (unless the
conversations provider below is on): the definition says so.

### HighLevel's Conversations API (off)

The app sits on top of HighLevel and does not rebuild it. If the team chats
in HighLevel's inbox, the conversation can be **read** into the lead's page:
`LEAD_CONVERSATIONS_PROVIDER=highlevel`, `HIGHLEVEL_API_TOKEN` (a Private
Integration token with conversations read access) and `HIGHLEVEL_LOCATION_ID`.
Anything less and no call is made. It never sends. **Unverified** against a
live account: the endpoints (`/conversations/search`,
`/conversations/{id}/messages`, header `Version: 2021-04-15`) follow
HighLevel's API v2 as remembered at build time; tests use a mocked fetch.

## Autopilot for leads (OFF)

`src/lib/leads/autopilot.ts` (rules), `autopilotServer.ts` (the run, from
`/api/cron/leads`). Built on ALTO's lead autopilot, stricter for credit repair:

- **Off by default** (the database default). Only an administrator turns it on,
  with a confirmation; every change is recorded with who and what
  (`lead_autopilot_changes`). Turning it on dates it: it **never answers the
  backlog**.
- **What it may send: three things, and no model writes them.** A greeting
  that says it is AI, not a person; an answer from the website's approved FAQ
  (the library "Ask Alti" uses), word for word, only on a close match; the
  link to sign up in the chat with Alti (`/registro`, crediting the lead's
  salesperson), only when asked how to start. Every message starts with
  "🤖 Alti · AI assistant" and passes the claim rules, the staff reply rules
  and "Ask Alti"'s checks (no price, no "free", no promise, no personal data).
- **When it does not answer**: sooner than the delay (2 minutes by default,
  so a person can answer first); a message it already answered; a chat a
  person wrote in during the last 6 hours; a client or a signed lead; a closed
  lead; a number that said STOP; outside WhatsApp's 24 hours; in quiet hours on
  the lead's clock (9 p.m.–8 a.m. by default); over the caps (3 per lead per
  day, 40 for everyone, by default).
- **Hand-off to a person, sending nothing**: a complaint, money or cancelling
  (any price question), a legal question, results ("points", "guarantee",
  "how fast"), a request for a person or a call, personal data, or nothing in
  the FAQ answers it, or the words did not pass the rules. The lead shows the
  reason in red, the Today list puts it at the top, and the complaint alert
  fires for whoever turned it on.
- **An audit row for every automatic message** (`lead_auto_messages`): claimed
  before sending (so two runs never both send it; a run that dies leaves it
  "claimed", never retried), then sent or failed; hand-offs are rows too. The
  words, the lead and the key can never be changed; the channel can only be
  WhatsApp. The message also shows in the conversation as Alti's.
- It never moves a stage, never uses SMS, never sends a template.

The existing one-time lead greeting of the WhatsApp webhook
(`docs/SALES-FLOW.md`, step 2) is unchanged and is not behind this switch.

## Phone alerts (OFF for everyone)

`src/lib/control/alerts.ts` (who and what), `alertsServer.ts` (the sweep and
delivery), `src/lib/push/webPush.ts`, `public/staff-sw.js`.

- **Per topic and per person, all off** until the member turns one on:
  New lead, Lead waiting (after N minutes, 15 by default), Complaint, Partner
  note, and for the owner "Escalated to you". Only the topics about the
  member's own work are offered: sales (new lead, lead waiting, complaint, for
  their leads and nobody's), a specialist (complaint, partner note, for their
  clients), the owner (everything).
- **Once per member per thing** (`staff_alerts`, unique key), found by the
  sweep in `/api/cron/leads`; an escalation at once.
- **Web push without a payload**: the phone is woken (VAPID, signed on the
  server); the service worker asks the app for the member's new alerts with
  their own session and shows them. Nothing about a lead or a client passes
  through Google's or Apple's push servers; the alert itself carries a first
  name and an initial at most, never credit data. Only browser vendors' push
  services are accepted as subscription addresses. On an iPhone, web push
  needs the console added to the Home Screen.
- **Without VAPID keys** nothing is pushed, the screen says which variables
  are missing, and the alerts still list on `/equipo/alertas`.

## Language, brand, phone

English first, Spanish with the member's switch (inline pairs and `{en, es}`
tables; a test walks them). What goes to a lead is in the lead's language.
Brand navy and gold, Poppins and Inter, the console's own components. Every
screen was checked at 390 px (no sideways scroll, 44 px controls) and at 1440.
The console now has ALTO Control's own layout too: a navy side menu with
numbered sections and red circles, a top bar with «Ask Alti» (Alti's panel:
the screen's help, his existing features there, the team's playbook) and
search (Ctrl/Cmd+K), sub-tabs per section, and on a phone a navy bottom bar
with four sections and a «More» sheet; see docs/STAFF.md, «Navigation and the
phone» and «The console's design system».

## What ALTO taught, and what is different here

Carried over: only people move leads (bots suggest); real numbers only; sit on
top of HighLevel; one control center; error boundaries; every automatic send
behind an explicit switch; the Today list with steps and "ask the owner"; the
autopilot's delay, "never the backlog", "a person wrote, so leave the chat",
per-lead and daily caps, hand-off instead of guessing, a record of every
message.

Different for credit repair: the autopilot sends **no model-written words**
at all (ALTO's wrote with its sales prompt): only fixed or approved text,
because a single promise of a result is a CROA and FTC problem. Every
automatic message is labelled as AI. No SMS anywhere (carriers reject credit
repair texts; ALTO used SMS). No selling by phone: the Today procedures and
the reply box say so (Telemarketing Sales Rule). Quiet hours and STOP apply
to leads. Money is a separate card that sales never sees. Leads become
"Signed" from the agreement record, not from a payment, and nothing is
charged before the work (billing is untouched).

## For the owner

1. Apply migration 0034 (or the whole `supabase/setup.sql` on a new project).
2. Add the n8n workflow `POST {APP_URL}/api/cron/leads` every 2–5 minutes
   (`docs/n8n.md`, Workflow 6).
3. Phone alerts: set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
   (`.env.example` shows how to make the pair). Each person turns on their
   own topics.
4. Get `credalti_prospecto_seguimiento` approved in Meta (en_US and es_MX,
   likely category Marketing), with the bodies and footers in
   `src/lib/leads/templates.ts`; add it to `WHATSAPP_APPROVED_TEMPLATES`.
5. HighLevel: nothing new is required. To read HighLevel's own conversations
   into the inbox, create a Private Integration token with conversations read
   access and set the three variables above; then check one lead.
6. Turn the lead autopilot on only after reading its three texts on the
   switch screen (and, if wanted, after the attorney's answer below).
7. If the team chats inside HighLevel, "median time to first reply" counts
   only what the app sees until step 5 is done.

## For the attorney

1. The lead autopilot answers a person who wrote to us first, on WhatsApp,
   with an AI-labelled greeting, an FAQ answer or the signup link. Is that
   "telemarketing" or solicitation under the TSR, the TCPA or Texas ch. 304,
   given the person initiated the conversation?
2. The follow-up template outside the 24 hours goes to a lead who wrote to us
   (or gave consent on a HighLevel form). Is the consent we store enough for
   one follow-up, and should it be limited further?

## Not done (phase 2)

- The Content card reads the whole board (up to the hub's 2,500 pieces) on
  each Overview load; a counting view in the database would be lighter.
- The books on the Money card load the full accounting book (as the
  Accounting screens do) for the owner; a summary route would be lighter.
- «Collected this month» (billing, the dashboard's rule) and «Net revenue»
  (the books) can differ: the books leave out test charges and take off
  refunds and lost chargebacks. Both are shown, each with its own label.

## Not done (phase 1)

- No analyst (read-only) role: phones are shown in full to administrators
  and sales, the only roles that see leads.
- Phone alerts were not tried on a real phone (no VAPID keys in the build
  environment); the VAPID token is verified by a test, the delivery path is
  tested with a mocked push service.
- No live WhatsApp, HighLevel or Claude calls were made; replies, the
  autopilot and the drafts were tested with mocks.
- Opt-outs are still not synced with HighLevel (`docs/AUTOPILOT.md`).
- Tech health is last-seen times only; alerting on outages is phase 3.
