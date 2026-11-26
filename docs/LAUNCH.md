# Launch readiness

`/equipo/lanzamiento` («Listo para lanzar»), section **9 · Team & Settings**,
first sub-tab. For the owner and administrators only (the capability
`launch`; specialists and sales see why they can't open it, and the route
refuses them again). One screen that says exactly what is ready and what is
missing to serve the first real client, and a **System health** view, after
ALTO Control's Infrastructure and Tech Health tabs.

`docs/GO-LIVE.md` is still the owner's list in words (the messages to send,
the accounts to open). This screen is the same list, checked.

## What the screen shows

**Go live** (the first tab):

- A navy band: **N of M ready** (required items only), a progress bar, and
  one line: either "Every required item is ready. The business can serve real
  clients." or "Not ready to go live yet". It says *ready* only when **every**
  required item is "Ready": "Needs a check", "Owner ticks by hand", "late" and
  "Failing" never count (`summarize` in `src/lib/launch/status.ts`, tested
  item by item). Recommended and later items are counted apart and never hold
  the launch back.
- **The next things to do**: the first three required items not ready, in the
  order the business needs them (the attorney first: it takes longest), the
  ones that can be done now before the ones that wait on something.
- **What is blocked, and by what**: for each outcome (clients signing up,
  charging, mailing letters, WhatsApp, answering leads, scheduled work, Alti,
  the monitoring button, alerts, posting content, or "everything: the app is
  still the demo") the items not ready that block it.
- Every item, by group: **Legal & licensing**, **Accounts & keys**,
  **Database**, **Scheduled jobs**, **Content**, **Business setup**. Each
  shows its status, whether it is required, and who does it (you, the
  attorney, the developer, IdentityIQ, the processor); opened, it says why it
  matters, the exact next step, the variables still to set (names only), what
  it waits on, what it blocks, and the doc section with the full steps.
  Filters: All · Not ready · Required only.

**System health** (`?vista=salud`): each service the app talks to
(Supabase, phone sign-in through Twilio in Supabase, Anthropic, Lob, WhatsApp,
email, the payment processor, error alerts, phone alerts, content publishing,
HighLevel): not set up / set up, not confirmed / working / failing, its mode
when it can be told safely ("test" or "live" for Lob, "sandbox" or "live" for
Authorize.Net, the demo processor), when it last did something real (the
newest WhatsApp message received, Lob event, HighLevel lead), when it last
reported an error, and its last «Check now». Below, every scheduled job
(`docs/n8n.md`) with its last good run and its state. The Overview's Tech
health card links here.

**On the Overview** (`/equipo/control`): while the business is not live, an
administrator sees a compact "9 · Launch readiness: N of M ready" card with the
next item and a link here.

## Statuses

| Status | Means |
| --- | --- |
| Ready | Done, as far as the software can tell (or ticked by the owner, with who and when). |
| Missing | Not set or not done. The note says what (variable names, never values). |
| Needs a check | Set, but not confirmed: tap «Check now»; or a scheduled job is late (no good run in three of its intervals, at least two hours). |
| Owner ticks by hand | The software can't know it (the attorney's session, the test pass, the processor's webhooks, the bureau addresses, the WhatsApp templates in Meta): tick it when done. |
| Failing | Was set up and is not working: a check failed, the last run of a job failed, the database can't be read, or the test switch for unapproved letters is on. |

## Where each status comes from

`src/lib/launch/`:

- `checklist.ts`: the **one registry** of every item (key, group, required /
  recommended / later, who, kind, the variables it covers, the doc section,
  what it blocks, what it waits on, its priority, how it is evaluated), the
  scheduled jobs (`CRON_JOBS`), the WhatsApp template names, and one table or
  column per migration (`MIGRATION_SENTINELS`).
- `env.ts`: what may be known about the settings (below).
- `server.ts`: the database facts with the service role (counts, yes/no and
  times; no client's data), the heartbeats, the last checks, the ticks.
- `status.ts`: the report and the summary. Pure.
- `health.ts`: the system health view. Pure.
- `probes.ts`: «Check now».
- `text.ts`: every word, in English and Spanish.
- `demo.ts`, `data.ts`: the demo's sample facts, and where the screen reads.

How each kind is known:

- **Settings**: set or not set, per variable name. The attorney's approvals
  are "the variable equals the current version string" (yes or no). The
  agreement's facts use the agreement's own parsing (a fee that is not an
  amount counts as not set).
- **Database**: connected (a query works), **every migration applied** (one
  table or column each migration creates is there: `MIGRATION_SENTINELS`;
  `0006` and `0028` change only policies or functions and are not
  checkable), at least one active administrator, the `identity-docs` bucket
  private, letters the rounds use with an attorney-approved version, active
  (attorney-approved) billing plans and a default one, Texas open (and which
  other states, if any; Georgia never can be).
- **Scheduled jobs**: every `/api/cron/*` route records a heartbeat in
  `cron_heartbeats` (`src/lib/control/heartbeat.ts`): when it last ran, when
  it last ran without an error, and the error (redacted). Never ran: missing.
  Last run failed: failing. No good run in three intervals: late.
- **Checks** («Check now»): one harmless read per service, only when an
  administrator taps it, at most once a minute per service (the database
  keeps the last result per service, `launch_probes`) and six a minute per
  person:
  - phone sign-in: Supabase Auth's public settings, "is the phone provider
    on?" (that is how Twilio-in-Supabase is detected);
  - Anthropic: list one model (no tokens are used);
  - Lob: list one address;
  - WhatsApp: read the phone number's id;
  - Authorize.Net: `authenticateTestRequest`, its own "are these keys right?".
  NMI has no call this harmless: its sandbox checks are a person's (an item
  ticked by hand). What is kept is ok or not, a short code (`ok`, `refused`,
  `unreachable`, `off`, `error`) and the HTTP status: never the provider's
  words.
- **Ticks**: `launch_ticks`, append-only: each tick or untick is a row with
  who and when; the newest decides.
- **Errors**: `reportError` (`src/lib/observability/errors.ts`) now also keeps,
  in this server's memory, when each place last failed (the place and the
  time only, never the message). It starts empty after a deploy; the full
  errors stay in the hosting log.

## Secrets

Launch readiness **never** returns a secret's value, its length or any of its
characters. `env.ts` reads a secret for one thing only: set or not set. The
few words it can tell are reduced to one word: Lob's documented key prefix
becomes "test" or "live" and nothing else. A heartbeat's error text is
redacted before it leaves the server (every secret's value, and anything that
looks like a token, becomes "[hidden]"). The checks put the key in a header,
never in a URL, and log only the place and the service. Tests:
`launchReadiness.test.ts` ("secrets are never revealed") builds the whole
report from two settings that differ only in their secrets and checks they
are byte for byte the same and contain no value or prefix of any of them.

## The demo

Without a database the screen shows **sample data** (a business part of the
way there), labelled as such at the top; «Check now» checks nothing and says
so; ticks are kept in this browser.

## Adding an item

Add it to `LAUNCH_ITEMS` in `checklist.ts` and its words to `text.ts` (both
languages). A test fails when:

- a variable in `.env.example` belongs to no item and is not in
  `NOT_FOR_LAUNCH` (with the reason);
- a variable `docs/GO-LIVE.md` names is not covered;
- an item has no words in a language, or its doc section does not exist;
- a migration has no entry in `MIGRATION_SENTINELS` (add one table or column
  it creates, or `null` if it changes only functions or policies);
- an `/api/cron` route has no job, no heartbeat, or no workflow in
  `docs/n8n.md`;
- the app sends a WhatsApp template that is not in the template list.

## Tests

- `src/lib/__tests__/launchReadiness.test.ts`: the registry's coverage, the
  status logic (never live with a required item not ready, each required
  item broken on its own breaks the launch, jobs, ticks, checks), secrets,
  the checks with a mocked network.
- `src/lib/__tests__/db/ideasLaunch.test.ts`: on the real migrations with row
  level security: only administrators read ticks and checks, nobody writes
  them directly, the route (403 for others, ticks with who and when, no
  secret in the answer), the check's cooldown, the database facts, the
  heartbeat a cron route records.

## Not done

- The checks' exact provider answers are UNVERIFIED from the build
  environment (Supabase's `/auth/v1/settings` shape, Lob's and the Graph
  API's answer to a bad key); a wrong guess shows as "error", never "ok".
- Email (Resend or another) has no harmless check that works with a sending-
  only key: it shows as set up, not confirmed.
- Error times live in one server's memory; a deploy clears them.
