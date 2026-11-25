# Content: the marketing hub in the staff console

`/equipo/contenido` is where Credalti's marketing content is planned, written,
checked, approved, posted and measured: short videos and reels, carousels,
single images, stories, YouTube videos, WhatsApp statuses, partner flyers and
posts, emails, blog and FAQ pieces. English first, Spanish too.

It follows the lesson of the owner's other business (its "ad plan" board):
**creation happens in outside tools** (CapCut, Canva, the ad pipeline in
`content/`) **or in the console's own Video Studio** (`/equipo/video`,
`docs/VIDEO.md`), **a person approves**, and results are **measured, never
invented**. On top of that, the app can **publish approved pieces itself**
once the owner connects the accounts and turns publishing on (it starts off).

Code: `src/lib/content/` (rules, checks, templates, assistant, results,
publishing), `src/app/equipo/contenido/` (screens),
`src/components/staff/content/` (pieces of the screens),
`src/app/api/staff/content/` and `src/app/api/cron/content/` (routes),
`supabase/migrations/0035_content.sql` (tables and policies).

## The screens

| Tab | Path | Who | What |
| --- | --- | --- | --- |
| Board | `/equipo/contenido` | content.view | One column per status, filters by channel, language, audience and owner. On a phone: a row of status chips and one list. |
| Calendar | `/contenido/calendario` | content.view | Month or week (phones start on the week). Each piece on the day it was posted, else scheduled, else due, in Central time. |
| Templates | `/contenido/plantillas` | content.view | Pre-checked templates with structure and EN/ES examples; "Use this template". |
| Results | `/contenido/resultados` | content.view | By theme and by piece; "No data yet" instead of zeros; leads through the links' campaign code. |
| Brand kit | `/contenido/marca` | content.share | Logo, colours with contrast, fonts, Alti (views, poses, waving loop) and the cameo rule, voice, claim rules, video specs, downloads. |
| Partner kit | `/contenido/socios` | content.share | Approved partner material only, to copy and download. Where sales lands. |
| Publishing | `/contenido/publicar` | content.publish | The switches (all off by default) and the account connections. |
| A piece | `/contenido/pieza/<id>` | content.view | Details, words (EN/ES side by side, tabs on a phone), files, the check, the checklist, approval, Alti's assistant, posting and scheduling, results, history. |
| New piece | `/contenido/nueva` | content.edit | Blank, from a template (`?plantilla=<id>`) or with Alti. |

## A piece

Type, channels, language (EN, ES or both), audience (consumers, Hispanic
consumers, realtors and lenders), theme (for results by theme), goal, the
words (hook, on-screen text, script, caption, call to action, per language),
the characters in the visuals (Alti, the robot), links, files (uploads or
https links) with alt text, owner, due date, a campaign code (`cnt-xxxxxx`)
and the status:

**Idea → Planned → In production → Ready for review → Approved → Scheduled →
Posted → Measured**, plus **Changes requested** (sent back with a note),
**Failed** (publishing failed, with the reason) and **Archived** (restorable;
nothing is ever deleted). The rules are pure functions in `rules.ts`, the same
in the demo and on the server.

## The check (`check.ts`)

Every piece runs through the check on every keystroke, and again on the
server before approval, scheduling and publishing. Each issue is shown under
the field and language it is in, with a plain explanation and what to do
instead, in the member's language.

**Blocking** (cannot be approved while present):

- Every rule of `checkMarketingCopy` and `checkClaimGuardrails`
  (`src/lib/compliance/guardrails.ts`): no promised outcomes, no "we remove /
  fix / raise", no points in days, the client decides what is inaccurate,
  no approval claims, no rent-to-own bait.
- The website's copy rules (docs/WEBSITE.md): nothing called "free"/"gratis";
  no outcome words (deleted, removed, fixed, guaranteed, approved); no score
  visuals (+N points, 3-digit scores, before/after); no price; no money-back;
  no pressure ("act now", "last chance", "solo hoy", "no esperes").
- Characters: if Alti appears in the visuals or the words, the piece says he
  is AI; never presented as a person; the robot is never named or speaking in
  the copy (he is a silent cameo).
- "Results vary" / "Los resultados varían" in each language when the piece
  talks about credit, reports or disputes.
- Monitoring mentioned → the commission disclosure ("Credalti earns a
  commission from the monitoring service", as in the agreement).
- Partner material → whether partners are paid ("The partner program pays no
  referral fees").
- Both languages: a field written in one language only; an empty piece; a
  link that is not https; an image without alt text.

**Worth fixing** (warnings): sentences over 25 words; different numbers in
the English and Spanish versions; old positioning ("DIY", "Spanish-first").

## The checklist and the approval

Before approval, the checklist (only what applies to the piece):

- **Brand**: logo file and version, colours, fonts, Alti's AI label (when he
  appears), the robot only as a small silent cameo (when he appears).
- **Legal**: results vary, the monitoring commission, partners paid or not
  (these three are decided by the app from the check), English and Spanish say
  the same (a person ticks it).
- **Accessibility**: captions on video (a person), alt text on every image (the app).

**Only an administrator approves** (`content.approve`), and only a piece in
review with zero blocking issues and the checklist complete. The approval
stores the **SHA-256 hash of exactly what was approved** (`hash.ts`: the
words, links, channels, type, language, characters and files with their alt
text). Any edit to those afterwards drops the approval and sends the piece back
to review, on the screen, on the server, and in the database (a trigger refuses
a content change without a new hash and clears an approval that no longer
matches; a file added or changed does the same). Changing the owner or the date
does not. "Request changes" needs a note.

## Alti's writing assistant (`assist.ts`, `assistModel.ts`)

On a piece (and "With Alti" on a new piece): a topic becomes three hook ideas,
on-screen text, a script, a caption and a call to action, in English and
Spanish. The panel is labelled "Alti · AI assistant" and every output is marked
"Draft by Alti (AI)".

- **With `ANTHROPIC_API_KEY`**: Claude (`CONTENT_MODEL`, default
  `claude-opus-5-5`), with the brand voice and the claim rules in a cached
  system prompt, structured JSON out, low effort, the API's refusal fallback;
  the repo's model pattern (`src/lib/staff/draftModel.ts`). A draft that breaks
  a blocking rule is written again once, with the reasons.
- **Without it** (or on a refusal or bad output): the closest pre-checked
  template, with the topic in two extra hooks. A normal state.
- Either way every line goes through the same check; nothing is saved until a
  person inserts it into the piece and saves, and once a person edits the
  words they are no longer marked as Alti's draft. Rate-limited (30 an hour).
  Tests mock the model.

## Templates (`templates.ts`)

Myth vs fact; Your rights under the FCRA in 30 seconds; What a dispute letter
is; ITIN and Spanish; Partner: your clients in good hands; After the letters:
building credit; Meet Alti, the AI assistant. Each has its beats and example
copy in both languages that passes every check (blocking and warnings; a test
holds it). The facts are the website's: the FCRA's right to dispute and the
bureau's 30 days, weekly reports at AnnualCreditReport.com.

## Files

The intake pattern (`src/lib/intake/files.ts`): the type is read from the
file's first bytes, never its name. JPEG, PNG, WebP, GIF and PDF up to 20 MB go
through the server; MP4, MOV and WebM up to 500 MB go straight to storage with a
one-time signed upload link, then the server reads the first bytes from storage
and deletes anything that is not a video. HEIC is refused (export as JPEG). The
private bucket `content-assets` also enforces the size and types on Supabase.
People see files through one-hour signed links. Links (Canva, Drive, CapCut)
must be https. 20 files a piece.

## Posting and results

**By a person**: on an approved piece, "Record the post" with the channel, the
post's link and the date. The piece becomes Posted.

**By the app**: see "Publishing" below.

**Tracked links**: the piece's first link, per channel, with `utm_source`
(the channel), `utm_medium`, `utm_campaign=content` and
`utm_content=<campaign code>`. A lead's first touch (`prospects.source_detail.firstTouch`,
migration 0017) keeps the UTM tags it arrived with, so the Results screen
counts the leads and the clients that came through each piece. A count shows
only where at least one lead matched.

**Results**: views, reach, likes, comments, shares, link clicks, leads and new
clients, per channel, typed in on the piece (blank is not zero) or read from
the networks once connected. Kept append-only; the newest value of each metric
per channel counts. A piece with results becomes Measured. Nothing measured
reads "No data yet", never 0.

## Publishing (`src/lib/content/publish/`)

One interface (`types.ts`: `PublishProvider`), three providers:

| Provider | Channels | What it does |
| --- | --- | --- |
| `meta.ts` | Facebook Page, Instagram Business | Graph API v21: Page feed, photo(s) or video; Instagram image, carousel (with alt text), reel or story (container, wait until processed, publish, permalink). Insights for metrics. |
| `tiktok.ts` | TikTok | Content Posting API: video (or photos) by URL. Posts as **private** until `TIKTOK_AUDITED=true`. Status and video query for metrics. |
| `youtube.ts` | YouTube (and Shorts) | Data API v3 resumable upload; a short gets "#Shorts" and a /shorts link. Statistics for metrics. |

Every call goes through an injected `fetch`, so the tests mock every provider:
no test makes a live call.

**The hard gates** (`gates.ts`), checked at the moment of posting, after the
schedule is claimed:

1. Publishing is on (the global switch, **off by default**) and on for the channel (each **off by default**).
2. The channel's account is connected and its token valid (renewed with the
   refresh token where the network has one).
3. The piece is approved and the approval's hash is the hash of what it says
   and carries now: an edit after approval fails here (and cancels the schedule).
4. Zero blocking issues and the checklist complete, checked again.
5. The channel is one of the piece's and the piece has the file it needs
   (Instagram and TikTok a picture or video, YouTube a video).

**Scheduling**: an approved piece is scheduled per channel at a date and time,
**Central time** by default, and in one language for a bilingual piece. The
database accepts a schedule only for a piece approved as it is, on one of its
channels.

**The run** (`run.ts`, `POST /api/cron/content` with the shared secret, every
10 minutes, docs/n8n.md Workflow 6):

- A schedule whose gates only hold it back (publishing off, channel off, not
  connected) waits, logged once; more than a day past its time, it fails with
  the reason and an alert, so nothing old goes out by surprise. A gate about
  the piece cancels it.
- **Idempotent**: the schedule is claimed (`scheduled/retry → publishing` in
  one conditional update) before the provider is called, and the publish key
  (piece, channel, approved hash) is unique in the database while live: the
  same approved content is never posted twice to a channel. A claim left in
  "publishing" by a run that died is never sent again blindly: after 15
  minutes it fails with "check the account first".
- **Retries**: temporary errors (rate limits, 5xx, network, a video still
  processing) retry after 5, 15, 60 and 240 minutes; then it fails.
- **Failures**: a permanent error or an expired connection marks the schedule
  and the piece **Failed**, writes the reason in plain words on the piece, and
  alerts the owner (`ERROR_WEBHOOK_URL`, the app's alert channel). "Back to
  approved" on the piece lets it be scheduled again.
- **Metrics**: posts made by the app in the last 30 days are read (read-only)
  at most every 6 hours each, into the results.

**The publish log** (`content_publish_log`, append-only): every scheduling,
hold, claim, send (with the exact text, the file ids, who approved and the
approved hash), answer, retry, failure, cancellation, settings change,
connection and disconnection. Never a token.

**Tokens**: encrypted at rest with AES-256-GCM (`crypto.ts`, key
`CONTENT_TOKEN_KEY`, stored as `v1.<iv>.<tag>.<ciphertext>`), decrypted only on
the server for one call, never returned to a browser. `content_connections`
has no read policy at all: only the server reads it. The settings screen shows
each connection's account, status, expiry, the permissions granted and those
missing.

## Connecting the accounts

Publishing works only after the owner does the following for each network.
Until then the network shows "Not set up on the server" and nothing is posted.

1. **The key for tokens**: set `CONTENT_TOKEN_KEY` (32 random bytes:
   `openssl rand -base64 32`). Keep it: changing it makes stored connections
   unreadable (connect them again).
2. **The cron**: n8n Workflow 6 (`POST /api/cron/content`, header
   `x-webhook-secret: N8N_WEBHOOK_SECRET`).
3. **Meta (Facebook + Instagram)**: `META_APP_ID`, `META_APP_SECRET`
   (optional `META_PAGE_ID` when the account manages several Pages).
   - A Meta app (Business type) with **business verification**, and **app
     review** for `pages_manage_posts`, `pages_read_engagement`,
     `pages_show_list`, `instagram_basic`, `instagram_content_publish`,
     `instagram_manage_insights`, `read_insights` and `business_management`.
     Without review, only people with a role on the app can use it.
   - The Instagram account must be a **Business** (or Creator) account linked
     to the Facebook Page.
   - Valid OAuth redirect URI: `{APP_URL}/api/staff/content/connect/meta`.
   - Instagram and Facebook fetch files from the signed storage links: they
     must be reachable from the internet (they are, on Supabase).
4. **TikTok**: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`.
   - The **Content Posting API** product approved for the app, with
     `video.publish` (and `user.info.basic`, `video.list`).
   - **The audit**: until TikTok audits the app, it can only post **privately**
     (`SELF_ONLY`). The app posts privately and says so on the schedule. After
     the audit, set `TIKTOK_AUDITED=true`.
   - Pulling files by URL needs the storage domain **verified** in TikTok's
     developer portal.
   - Redirect URI: `{APP_URL}/api/staff/content/connect/tiktok`.
5. **YouTube**: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` (a Google Cloud
   project with the YouTube Data API v3 enabled).
   - The **OAuth consent screen verified** by Google (`youtube.upload` is a
     sensitive scope); until then only test users can connect, and uploads
     from unverified projects may be locked as private.
   - **Quota**: an upload costs 1,600 of the default 10,000 units a day (about
     6 uploads a day); ask Google for more if needed.
   - Redirect URI: `{APP_URL}/api/staff/content/connect/youtube`.
6. In the console, **Publishing**: Connect each account (administrators only),
   check the permissions shown, then turn on the channel and, last, the global
   switch.

The app never spends on ads and never changes anything in the accounts except
creating the posts it was told to.

## Videos from the Video Studio

An approved video from the Video Studio (`docs/VIDEO.md`) is handed to a piece
here with **Hand to Content**: a new short-video (or YouTube) piece with the
video's words, or an open piece chosen from the board, gets the approved MP4 as
its file through this hub's own upload, the brand and caption items the studio
already guarantees ticked, and goes to review. Its approval and publishing are
this hub's, unchanged: the piece's own hash, the gates, the scheduler. The Video
Studio has no publishing code of its own.

## Who may do what

| Capability | Administrator | Specialist | Sales |
| --- | --- | --- | --- |
| `content.view` board, calendar, templates, results | ✓ | ✓ | |
| `content.edit` create, edit, submit, files, record posts and results, schedule | ✓ | ✓ | |
| `content.approve` approve, request changes | ✓ | | |
| `content.publish` switches and account connections | ✓ | | |
| `content.share` brand kit and approved partner material | ✓ | ✓ | ✓ |

A designer or VA is invited as a **specialist** with no clients assigned: they
see the content hub and nothing of any client. Every route asks
`requireCapability`; the database's policies say the same: administrators
and specialists read the content tables; sales reads only approved partner
material and its files; clients, partners and signed-out visitors read
nothing; only the server writes.

## Tests

- `src/lib/__tests__/content.test.ts`: the check (blocking and warnings, EN and
  ES), every template passes, the checklist, approval and edit-after-approval,
  the hash, filters, calendar, attribution, results, the assistant with a
  mocked model, files, roles and route schemas.
- `src/lib/__tests__/contentPublish.test.ts`: the gates, each provider against
  a mocked fetch (Meta feed, reel, carousel, OAuth exchange; TikTok private
  posting and error codes; YouTube resumable upload and quota), token refresh,
  metrics, error classes, the signed OAuth state.
- `src/lib/__tests__/db/content.test.ts` (PGlite, the real migrations): who may
  do what through the routes, row level security for every role and anon,
  the approval held by the database, append-only records, encrypted tokens,
  schedules, and the scheduler: off by default, claim and post once, retry with
  backoff, permanent failure with alert, expired connection, a stuck claim,
  edit after approval, metrics.

## What is left for the owner

- Connect the accounts (above): Meta app review and business verification,
  TikTok's audit, Google's consent screen verification. Nothing here was tried
  against the live networks; the providers follow their documented APIs and
  are tested with mocks only.
- `ANTHROPIC_API_KEY` for Alti's assistant to write with Claude (without it,
  it writes from the templates).
- The ad pipeline (`content/`) still describes the retired mascot; new spots
  start from a template here and Alti's locked art.
- Counsel to review the claim rules and the disclosure lines.
- A dedicated "content" role (instead of inviting a designer as a specialist)
  if the team grows.
