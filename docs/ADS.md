# The Ads Manager

«Anuncios» / «Ads» (`/equipo/anuncios`, section 2 «Marketing» of the side
menu, right after Content). Meta ads, **read only**, beside the leads and
signed clients they really brought. Built after ALTO Control's Ads tab, for
credit repair.

| What | Where | Who |
| --- | --- | --- |
| **Results**: the numbers for 7, 14, 30 or 90 days or custom dates, winners, every campaign → ad set → ad with a verdict, one ad's drawer, «What to make next», the rules | `/equipo/anuncios` (`?vista=resultados`) | administrators (`ads.view`) |
| **Ad copy with Alti** (AI): drafts, checked, sent to Content or Video Studio | `?vista=textos` | administrators and specialists (`ads.draft`) |
| **Spend & books**: Meta's spend per month beside the books | `?vista=libros` (and a card on Accounting → Expenses) | administrators |
| **Platforms**: Meta connected or not; Google Ads and TikTok Ads not connected yet | `?vista=plataformas` | administrators |

Sales sees none of it (spend is money, and sales never sees money). A
specialist opens the page on «Ad copy» and reads why the numbers are not
theirs. Every route asks the capability again; the database's row level
security asks the role a third time.

Code: `src/lib/ads/` (types, `meta.ts` the Marketing API client and parsers,
`window.ts`, `verdict.ts`, `attribution.ts`, `report.ts`, `copy.ts` +
`copyModel.ts`, `books.ts`, `capture.ts`, `demo.ts`, `server.ts`, `data.ts`,
`text.ts`), `src/components/staff/ads/`, the page, `/api/staff/ads`,
`/api/cron/ads`, `src/components/AttributionCapture.tsx`. Database:
`supabase/migrations/0037_ads.sql`. Tests: `src/lib/__tests__/ads.test.ts`
(the rules, attribution, Meta's answers from fixture JSON in
`src/lib/__tests__/fixtures/meta-ads/`, the window, the report, the copy and
its checklist, the tags, the books, permissions) and
`src/lib/__tests__/db/ads.test.ts` (the sync against a mocked Meta, row level
security by role, the routes, the cron's secret, and the ad travelling from
the signup and a HighLevel form into the report).

## Nothing here changes Meta

Every call to Meta is a `GET` (a test holds it). The token needs **`ads_read`
only**: it can read the account, campaigns, ad sets, ads, creatives and
insights, and can never create, edit, pause or pay for anything. A verdict
of «Turn off» is a suggestion for a person, who turns the ad off in Meta Ads
Manager («Open in Meta» in the drawer goes there). The token lives on the
server only, is sent in the `Authorization` header (never in a URL that could
be logged), and with `META_APP_SECRET` set every call carries
`appsecret_proof`.

## What it shows, and where each number comes from

Every number says whose it is, on the screen and here:

| Number | Whose | From |
| --- | --- | --- |
| Spend, impressions, link clicks, CTR | **Meta** | Insights, `level=ad`, `time_increment=1`: `spend` (currency units → cents), `impressions`, `inline_link_clicks` (`clicks` when absent). CTR = link clicks ÷ impressions. |
| Results, cost per result | **Meta** | The action in Meta's `actions` that is the ad set's goal, as Ads Manager's Results column counts it: `CONVERSATIONS` → messaging conversations started; `LEAD_GENERATION` → `lead`; website conversions → the pixel event (`fb_pixel_lead`…); `LINK_CLICKS` → link clicks; `LANDING_PAGE_VIEWS` → page views. A goal we cannot map: the first lead-type action, else "—". |
| Leads, cost per lead | **Credalti, verified** | Rows in the lead inbox (`leads`, migration 0034) credited to the ad by their first touch (below), counted on the day they arrived. |
| Signed clients, cost per signed client | **Credalti, verified** | Of those leads, the ones whose service agreement is signed (`leads.signed_at`, set by the database from `service_agreements`). |
| "N with no known ad" | **Credalti** | Leads from Meta (a Facebook click id, or `utm_source` Facebook/Instagram) whose ad, ad set and campaign are unknown. They count in the totals, not under any ad. |

**Days are the ad account's** (its `timezone_name`, Texas when Meta does not
say), the days Ads Manager shows and Meta cuts insights by. A lead is counted
on its day in the same zone, so "the last 7 days" are the same days for the
spend and the leads. Custom ranges up to 400 days.

**Cohort**: the leads are the ones that **arrived** in the dates; "signed" is
how many of them have signed so far. Cost per signed client is the dates'
spend ÷ those signed clients.

A number with nothing behind it reads "—" (never "$0.00" for an unknown).

### How a lead is credited to an ad (first touch)

`src/lib/ads/attribution.ts`. First touch wins: the first ad that brought
the person, never a later one.

1. The ad's id in the first touch → **that ad**. It gets there three ways:
   - **A tagged link to the website.** The ad's URL parameters carry
     `ad_id={{ad.id}}` (and `utm_*`). `AttributionCapture` (root layout) keeps
     the tags in the browser for 28 days (Meta's click window); the chat
     signup sends them with its first call (`/api/signup` `start`, checked
     again by `sanitizeAttribution`); `signup_cases.attribution` keeps them;
     the database copies them into the lead's first touch when the signup
     reaches a phone (`leads_from_signup`, replaced in 0037).
   - **A click-to-WhatsApp ad.** Meta's first message carries a `referral`
     with the ad's id; the WhatsApp webhook starts the lead with it
     (`first_touch.ad.via = "ctwa"`) before the message's own trigger.
   - **A HighLevel form** that passes `adId` / `ad_id` (and `fbclid`) to the
     webhook: `prospects.source_detail.firstTouch.ad`, copied into the lead.
2. `utm_content` is an ad's id, or the name of exactly one ad (`{{ad.id}}` or
   `{{ad.name}}`) → that ad.
3. The ad set's id, or `utm_term` / `utm_medium` is an ad set's id or unique
   name → **that ad set only**.
4. The campaign's id, or `utm_campaign` is a campaign's id or unique name →
   **that campaign only**.
5. Otherwise a Facebook click id was present, or `utm_source` says Facebook
   or Instagram → **from Meta, ad unknown**.
6. Anything else → not from an ad.

A name two ads share is never guessed: the lead goes one level up.

**Nothing sensitive is stored**: marketing tags only, cleaned and capped
(letters, digits, a few separators, 120 characters). The Facebook click id is
never kept, only `fbclid: true`. No name, phone, email or credit data is read
from a URL. The Ads Manager shows a lead as a first name and an initial.

**Set this once in Meta Ads Manager** (each ad → Tracking → URL parameters):

```
utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}&ad_id={{ad.id}}
```

Click-to-WhatsApp ads need nothing: Meta sends the referral itself.

## The verdicts (the rules on the screen)

`src/lib/ads/verdict.ts`, shown in «How each ad is judged» with the same
numbers (`AD_RULES`). In order, the first that applies:

1. No spend in the dates → **Needs data**.
2. Spent **$150** or more with no result and no lead → **Turn off** (even during the test).
3. Fewer than **7 days** with spend → **Testing** ("day 3 of 7").
4. **2** or more signed clients at **$300** or less each → **Winner**.
5. Over **$45** per result, after spending **$50** → **Turn off**.
6. Fewer than **10** results → **Testing** ("6 of 10 results").
7. **$25** per result or less → **Winner**.
8. **$45** per result or less → **Looking good**.
9. Anything else → **Turn off**.

A "result" is Meta's own result when the ad set's goal is leads or chats. For
clicks and page views (which are not people reaching out), and when Meta
counted none while Credalti has leads, Credalti's verified leads are used.
The drawer says which ("measured on Meta's results" / "on Credalti's leads").

**Needs a person**: an ad marked **Turn off** that is still on in Meta (the
ad, its ad set and its campaign `ACTIVE`) and spent on the last day of data or
the day before. It shows in red on top of Results, on the Overview's Ads card
and as the red circle of section 2 «Marketing» (`navBadges.ts`, its own
source, added to Content's number, from `BadgeProbe` on any page, the last 7
days).

**What to make next** (`whatToMakeNext`): what most winners (Winner and
Looking good) share, in counts a person can check: video or picture (against
all judged ads), language, button, the length of the text, words that come
back in the headline and first line, and the goal. Nothing is said with fewer
than two winners.

**Compliance warning**: a campaign that is on without Meta's Special Ad
Category for credit (`CREDIT`, or `FINANCIAL_PRODUCTS_SERVICES` since Meta
merged them) is named in red on Results.

## Ad copy with Alti

`src/lib/ads/copy.ts`, the content writing assistant's pattern
(`content/assist.ts`): with `ANTHROPIC_API_KEY` Claude writes as Alti (the
content assistant's model, `CONTENT_MODEL`, cached instructions, structured
output, `effort: "low"`, the refusal fallback; `copyModel.ts`); without it the
closest **pre-checked template** is the base, with the angle as a hook, and
the screen says why. A draft that breaks a blocking rule is written again
once, with the reasons. The output is always a **draft**, labelled
"Alti · AI assistant".

Every line, in each language, goes through `checkText` (the content check:
`checkMarketingCopy` and `checkClaimGuardrails`, nothing "free", no outcome
words, no score talk or before/after, no price, no pressure, Alti never a
person) plus the **credit-repair ad checklist**:

| Item | Checked by |
| --- | --- |
| The campaign declares Meta's Special Ad Category (credit, or financial products and services) | a person, in Ads Manager (Results warns about campaigns without it) |
| Assumes nothing about who reads it: no age, gender or ZIP code ("over 50", "moms", "78701") | the app (`ad-targeting`) |
| Never tells the reader about their own finances ("your bad credit", "¿tienes deudas?"): Meta's personal-attributes rule | the app (`ad-personal-attribute`) |
| No promised result | the app (the claim guardrails) |
| Never "free" | the app |
| No score, points or before and after | the app (words); a person (the visual) |
| Results vary, in the primary text, in each language | the app |
| No price and no pressure | the app |

The person edits the draft on the screen; the check runs again on every
change. A draft with **no blocking issue** can be sent:

- **To Content**: a new piece (short video, picture or carousel; Facebook and
  Instagram; `aiDraft`), through Content's own rules and capability
  (`content.edit`) and its normal review and approval.
- **To Video Studio** (video drafts): a brief in `ads_briefs` (the words in
  both languages, who asked, the winner it learned from). The server checks
  the words again and refuses a brief that breaks a rule (422). A brief's
  words never change after it is sent; only its status moves (`new`,
  `planned`, `in_production`, `done`, `dropped`), which Video Studio
  (`/equipo/video`, built separately) owns. The Ads Manager links there and
  imports none of its code.

## Spend and the books

THE MONEY RULE (`src/lib/accounting/ledger.ts`) is cash basis: everything on
the day money moved, from what actually moved. Meta's "spend" is what the ads
used, by the day they ran, in the ad account's time zone; Meta charges the
card later (at a billing threshold or monthly), and that charge reaches the
books from the bank import or the receipt, under **"Advertising: Meta"**.
Adding Meta's spend to the books automatically would count the same money
twice and on the wrong day. So **the Ads Manager never writes to the books**
(a test holds it). It offers a **reconciliation suggestion** instead
(`books.ts`):

- **Spend & books** (Ads): the last six months, Meta's spend beside the
  books' Advertising: Meta (voided expenses left out, adjustments in), with
  "Matches" (within $5 or 2%), "The books have less" (with «Record the
  charge», opening Accounting → Expenses on that month) or "The books have
  more".
- **Accounting → Expenses**: the same check for the month on screen, for a
  member who may see the ads.

Differences at a month's edge are normal (spend on the 30th, charged on the
2nd). The Overview's **Ads card** shows the last 7 days' spend (Meta), the
leads from ads and the cost per lead (Credalti) and the ads to turn off; the
**department strip** has an Ads tile with that count.

## Other ad platforms

**Google Ads** and **TikTok Ads** show a "Not connected yet" card on
Platforms, with what connecting them will need, and **no number of their
own**. Their spend reaches the books from the bank file under "Advertising:
Google" / "Advertising: TikTok", as today.

## The sync

`runAdsSync` (`server.ts`), from `POST /api/cron/ads` (shared secret, `docs/n8n.md` Workflow 8,
every 3 hours) or «Sync now» (an administrator; at most 6 an hour):

1. Reads the ad account (name, currency, time zone, status).
2. Reads every campaign, ad set and ad (with its creative), all pages (only
   Meta's own `paging.next` links are followed).
3. Reads the insights per ad per day for the last **7** days (Meta revises
   recent days, and conversions arrive up to a week late), **90** on the
   first sync, and upserts them (`ads_insights_daily`, one row per ad per
   day: running twice never doubles anything).
4. Records the run (`ads_sync_runs`, append-only) and a heartbeat
   (`cron_heartbeats`, job `ads`). A failed read is recorded with Meta's
   words (never the token) and changes nothing else.

Without `META_ADS_ACCESS_TOKEN` and `META_AD_ACCOUNT_ID` it calls nothing and
records nothing; the screen says which variables are missing.

A video ad plays in the drawer on a tap: the server asks Meta for the video's
`source` then (Meta's links expire, so they are never stored).

## The demo

No database: the page shows a **sample ad account** (`demo.ts`): four
campaigns, five ad sets, twelve ads over 100 days, Meta-style numbers, sample
leads credited the three ways real ones are, some signed, and one campaign
without the Special Ad Category. Every screen says "Sample data"; «Sync now»
is not offered; the briefs made in the demo stay in the browser.

## The environment

| Variable | What |
| --- | --- |
| `META_ADS_ACCESS_TOKEN` | A **System User** token (Business Settings → Users → System users → Generate token) from the same Meta app as `META_APP_ID`, with **`ads_read`** only. Server only. |
| `META_AD_ACCOUNT_ID` | `act_1234567890` (or the number). The system user must be assigned to the ad account (Business Settings → Accounts → Ad accounts → Add people, "View performance"). |
| `META_APP_SECRET` | Already there for content publishing; when set, every ads call carries `appsecret_proof`. |
| `META_GRAPH_VERSION` | Optional; `v21.0` by default (the content publisher's). |
| `ANTHROPIC_API_KEY` / `CONTENT_MODEL` | Already there; Alti's ad copy uses them like the content assistant. Without the key: templates. |

## For the owner

1. Apply migration 0037 (or the whole `supabase/setup.sql` on a new project).
2. In Meta: add the **Marketing API** product to the app and request the
   **`ads_read`** permission (nothing else). Reading your own business's ad
   account usually works with Standard access; Meta may still ask for App
   Review of `ads_read` (Advanced access) and for business verification.
   Create a System User, assign it the ad account, generate a token with
   `ads_read`, and set the two variables.
3. Add n8n Workflow 8 (`POST {APP_URL}/api/cron/ads` every 3 hours).
4. Put the URL parameters above on every ad (website ads); click-to-WhatsApp
   ads need nothing. For HighLevel forms, map `{{ad.id}}` into the webhook's
   `adId`.
5. Make sure every credit campaign declares the Special Ad Category
   (Results warns about any that does not).
6. Each month, compare «Spend & books» and record Meta's charge from its
   receipt.

## Not done

- Nothing was run against a live Meta account: the client and parsers follow
  the Marketing API (Graph v21.0) and were tested with fixture JSON and a
  mocked fetch. Check the first sync's numbers against Ads Manager for one
  day.
- Results for goals other than leads, chats, website leads, clicks and page
  views read the first lead-type action, or "—".
- The rules' numbers are fixed in code (`AD_RULES`), shown on the screen; the
  owner cannot change them from the page yet.
- No breakdown by state or city (ALTO's): only Texas is open, and Meta's
  region breakdown was left for later.
- Google Ads and TikTok Ads are not connected (no numbers are shown for them).
- Video Studio reads the briefs on its side; until it does, a brief is a
  record with a link.
