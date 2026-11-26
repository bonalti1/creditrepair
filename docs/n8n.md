# n8n setup — the round loop

The app exposes everything n8n needs; n8n only provides the clock.

## Workflow 1: hourly round check (the only required one)

- **Trigger:** Cron, every hour.
- **Node:** HTTP Request → `POST {APP_URL}/api/cron/rounds`
  - Header `x-webhook-secret: {N8N_WEBHOOK_SECRET}`
- The endpoint is idempotent: it finds rounds past `next_round_due_at`,
  re-pulls via the monitoring adapter, imports + diffs, and marks rounds
  complete. The client hears about the new report from the import itself: a
  factual status message queued in the outbound log and sent by Workflow 3.
  Response lists what it processed.

## Workflow 3: the autopilot (hourly)

- **Trigger:** Cron, every hour (any minute; staggering it from Workflow 1 by
  15 minutes lets a report imported by the round check be announced in the
  same hour).
- **Node:** HTTP Request → `POST {APP_URL}/api/cron/autopilot`, header
  `x-webhook-secret: {N8N_WEBHOOK_SECRET}`.
- Notes rounds ready for the first time, mails those whose review window is
  over (only when "Enviar solas las rondas listas" is on), and sends the
  automatic messages that are due. Running it twice sends nothing twice.
  See `docs/AUTOPILOT.md`.

## Workflow 4: billing (hourly)

- `POST {APP_URL}/api/cron/billing`, same header. See `docs/BILLING.md`.

## Workflow 5: the team's morning summary (every 15 minutes)

- `POST {APP_URL}/api/cron/staff-digest`, same header. Each member who turned
  it on in their profile gets one message a day at or after their chosen time
  (8:30 a.m. Texas by default), by WhatsApp (template
  `credalti_resumen_equipo`) or email. Every 15 minutes keeps it close to the
  time chosen; hourly works too, just later. Running it twice sends nothing
  twice. See `docs/STAFF.md`.

## Workflow 6: the lead inbox's clock (every 2 to 5 minutes)

- `POST {APP_URL}/api/cron/leads`, same header. Gives leads nobody has to the
  next salesperson in turn, runs the lead autopilot (does nothing while its
  switch is off, the default), sends the staff phone alerts members turned on,
  and records a heartbeat for the Overview's Tech health card. The autopilot's
  "wait before replying" is measured from the lead's message, so a run every
  2–5 minutes keeps it close. Safe to run twice. See `docs/CONTROL.md`.

## Workflow 7: content publishing and metrics (every 10 minutes)

- `POST {APP_URL}/api/cron/content`, same header. Posts the approved, scheduled
  content pieces that are due (only when the owner has turned publishing on;
  it starts off), retries temporary errors, and reads the numbers of recent
  posts. Running it twice posts nothing twice. See `docs/CONTENT.md`.

## Workflow 8: the Ads Manager's read of Meta (every 3 hours)

- `POST {APP_URL}/api/cron/ads`, same header. Reads the Meta ad account (READ
  ONLY: the account, its campaigns, ad sets and ads, and the last 7 days of
  numbers per ad; 90 on the first run) and caches them for `/equipo/anuncios`.
  It never changes anything in Meta. Until `META_ADS_ACCESS_TOKEN` and
  `META_AD_ACCOUNT_ID` are set it answers `{"skipped": "not_configured"}` and
  calls nothing. Safe to run twice (the numbers are upserted per ad per day).
  See `docs/ADS.md`.

## Workflow 9: SEO, Search Console and site health (once a day)

- **Trigger:** Cron, once a day (any hour; early morning Texas time is
  fine).
- **Node:** HTTP Request → `POST {APP_URL}/api/cron/seo`, header
  `x-webhook-secret: {N8N_WEBHOOK_SECRET}`. Allow it up to 5 minutes.
- Reads the last 10 days of final Search Console numbers (clicks,
  impressions, position per day, page and query) into `seo_search_rows`,
  read-only (nothing when Search Console is not connected; the variables are
  in `docs/SEO.md`), then reads the public site from `NEXT_PUBLIC_SITE_URL`
  and keeps the site-health result for `/equipo/seo` and the red count on the
  menu. Running it twice stores nothing twice (rows are upserted by day, page
  and query; the health result is replaced). See `docs/SEO.md`.

## Workflow 10 (optional): Alti's weekly ideas (once a week)

- `POST {APP_URL}/api/cron/ideas`, same header, once a week (Monday morning
  is a good time). Alti, the AI assistant, reads the business's aggregate
  numbers (the dashboard, the lead inbox, content) and leaves 3 to 5 proposed
  experiments in `/equipo/ideas` → «Alti's proposals» for an administrator to
  add to the board or dismiss. Nothing is acted on. It asks at most once in
  six days (a person's «Ask Alti for ideas» counts), so calling it more often
  costs nothing. Without `ANTHROPIC_API_KEY` it does nothing and says so. See
  `docs/IDEAS.md`.

## Workflow 11: partner notices and summaries (hourly)

- `POST {APP_URL}/api/cron/partners`, same header, every hour. Milestone
  notices to partners who opted in, the "ask to follow progress" messages that
  waited for quiet hours, and the Monday summary. Running it twice sends
  nothing twice. See `docs/PARTNERS.md`.

## Workflow 12 (only with HighLevel): stage sync (every 15 to 60 minutes)

- `POST {APP_URL}/api/cron/highlevel`, same header. Sends each person's stage
  changes back to HighLevel. Leave it off unless HighLevel is used. See
  `docs/HIGHLEVEL.md`.

## Workflow 13: webinar reminders (every 10 minutes)

- `POST {APP_URL}/api/cron/webinars`, same header. Sends the reminders that
  are due to registrants who ticked the box: 1 week, 1 day and 1 hour before,
  "we're live now", the replay (once its link is set), and the follow-ups on
  day 2 and day 5, then it stops. WhatsApp (an approved template outside the
  24-hour window) or email, never SMS; never 9 p.m.–8 a.m. Texas time; never
  to a number that said STOP / BAJA or used the email's link; each reminder
  once (claimed under `webinar:<registration>:<kind>`). Every 10 minutes keeps
  "1 hour before" and "we're live now" on time. Nothing to do until a webinar
  is published. See `docs/WEBINARS.md`.

## Heartbeats: is each workflow running?

Every `/api/cron/*` route records one heartbeat per run in `cron_heartbeats`
(`src/lib/control/heartbeat.ts`): when it last ran, when it last ran without
an error, and the error (at most 300 characters). `/equipo/lanzamiento` →
«System health» lists every workflow above with its last good run, and
Launch readiness marks a required one as missing (never ran), late (no good
run in three of its intervals) or failing (the last run failed). The
Overview's Tech health card keeps reading the leads job's own heartbeat.

## Workflow 2 (optional): notification relays

For ad-hoc messages (e.g. manual "attack ready" nudges), call
(these go straight to WhatsApp, outside the autopilot's outbound log, so they
do not check opt-outs or quiet hours: prefer the autopilot for anything
recurring),
`POST {APP_URL}/api/webhooks/n8n` with the same secret header and body
`{ "action": "attack_ready" | "day40_reengage", "userId": "...", ... }`.

## Inbound WhatsApp

Not an n8n concern: Meta calls `GET/POST {APP_URL}/api/webhooks/whatsapp`
directly (configure the webhook URL + `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in the
Meta app dashboard). Replies are generated by the guardrailed coach.
