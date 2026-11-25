# SEO: how people find Credalti

«SEO» (`/equipo/seo`, in the Content group of the menu, between Content and
Reviews) is the department that makes the public website easy to find and
worth finding: the site's health, the guides published at `/guias/<slug>`,
Google Search Console's numbers, the phrases we want to be found for, and the
local checklist (Google Business Profile, name/address/phone, reviews).

No score anywhere: every check passes or says what to fix, why it matters and
how. No promises, nothing called free, no pressure, Texas only (never
Georgia), every legal fact sourced, and nothing an AI wrote goes on the site
until a person checked it and an administrator published it.

Code: `src/lib/seo/*` (model and rules), `src/app/equipo/seo/*` (screens),
`src/components/staff/seo/ui.tsx`, `src/app/api/staff/seo/*` and
`src/app/api/cron/seo` (routes), `src/app/guias/*` and
`src/components/site/GuideArticle.tsx` (public pages),
`supabase/migrations/0039_seo.sql`. Tests: `src/lib/__tests__/seo.test.ts`
and `src/lib/__tests__/db/seo.test.ts`.

## Who may do what

| Capability | Administrator | Specialist | Sales |
| --- | --- | --- | --- |
| `seo.view`: see SEO (health, guides, search numbers, keywords, local) | ✓ | ✓ | — |
| `seo.edit`: write guides, send them for approval, track phrases, tick the local checklist, run Alti's drafts | ✓ | ✓ | — |
| `seo.publish`: approve and publish a guide, ask for changes, take one off the site | ✓ | — | — |

The screens hide what a role may not use and say why; every route checks the
capability again on the server; the database lets only administrators and
specialists read the tables (row level security), and only the server writes.

## The tabs

### Site health (`/equipo/seo`, works with no keys)

«Check now» makes the server read its own public pages the way a search engine
does (`src/lib/seo/health.ts`): every page of the route list
(`src/lib/site/routes.ts`) and every published guide, in English and Spanish
(`?lang=en`, `?lang=es`), then `robots.txt`, `sitemap.xml` and a sample of
private routes. It checks:

| Check | Pass when |
| --- | --- |
| Page answers | 200 |
| Title | 15–65 characters |
| Meta description | 70–160 characters |
| One main heading | exactly one `h1` |
| Canonical | the page's own language URL (`…?lang=xx`) on `NEXT_PUBLIC_SITE_URL` |
| hreflang | `en`, `es` and `x-default` exactly as `hreflangAlternates` |
| Open Graph | `og:title`, `og:description`, `og:image`, `og:url` |
| Page language | `<html lang>` matches the language asked |
| Structured data | Organization on every page; FAQPage on `/preguntas`; Article on guides |
| Image descriptions | every `img` has `alt` (`alt=""` marks a decorative picture) |
| Links | every internal link found on the pages answers (each once, up to 60) |
| robots.txt | the site open, every `PRIVATE_PATHS` entry disallowed, the sitemap named |
| Sitemap | every public page and live guide in both languages; nothing private |
| Private pages | disallowed in robots.txt **and** marked noindex (`X-Robots-Tag` or meta) |

It only ever reads this site: the request's own origin when it is a local
server or this site's address, otherwise `NEXT_PUBLIC_SITE_URL`
(`crawlOrigin`), never an address from the request. With a database the
result is kept (`seo_settings.health`) for the screen and the red count; the
cron runs it every day. In the demo it really runs (the dev server reads its
own pages) and the result stays in the browser.

What this work fixed on the real site (found by the checks, held by tests):

- The home page's titles were 73 and 80 characters (cut off in results): now
  "Credalti — Credit report help in Texas, in English and Spanish" and its
  Spanish twin. The About page's descriptions were under 70 characters: now
  full sentences. A test keeps every page's title and description in range.
- Private pages said noindex only in the console's layout. Now every path in
  `PRIVATE_PATHS` gets `X-Robots-Tag: noindex, nofollow` (`next.config.mjs`,
  the same list, a test keeps them equal), and the proxy adds it to its own
  login redirects.
- The guides are in the proxy's matcher, so `?lang=` works on them like on
  every page.

### Guides (`/equipo/seo/guias`)

A guide is one article in English and Spanish (English first) at one address,
`/guias/<slug>`, with `?lang=en` / `?lang=es` and hreflang, the same language
system as every page of the site (`docs/WEBSITE.md`). It has a title (and
h1), a meta description, an introduction, sections with h2 headings, a
questions block and its sources. Two marks in the text, nothing else:
`[words](/como-funciona)` is a link (site paths or https only) and
`[^source-id]` cites a source.

**The rules** (`checkGuide`, on the screen as it is typed and again on the
server): every word through `checkMarketingCopy` and `checkClaimGuardrails`
and the content team's rules (`checkText`: nothing free, no outcome words, no
score talk, no amounts, no pressure, no AltiBot), plus the guide's own:

- **Every legal fact has a source.** A paragraph (intro, section paragraph or
  FAQ answer) that names a law or section, a legal duty ("must", "debe") or a
  time limit ("30 days", "7 años") needs a `[^id]` citation of a source on the
  list. Unknown citations block; unused sources are flagged. Sources should be
  official (the statute, the CFPB, the FTC, Texas; `OFFICIAL_HOSTS`).
- Texas only: another state in a title, description, heading, phrase or the
  slug blocks; Georgia blocks anywhere.
- No text left to write (`[Write: …]`), no unsafe link, no telling the reader
  what to dispute, both languages complete.

**The SEO checklist** (`guideChecklist`): title 30–60 characters with the
phrase, description 70–160, a valid unique slug, at least three headed
sections, links to `/como-funciona` and `/precios` in both languages, the soft
call to action (added by the page: «Start my review», how it works, pricing),
2–6 questions in each language, both languages with the same sections,
sources for every legal fact, Texas only; length (400–2,500 words) is advice.

**The workflow** (`applyGuideAction`, the same in the demo, the route and the
database's triggers): draft → «Send for approval» (`seo.edit`) → an
administrator reads it and either asks for changes (with a note) or «Approve
and publish» (`seo.publish`). Publishing needs no blocking issue, every
required checklist item, and three ticks by a person: «I opened every source
link, and it says what the guide says», «I read both languages», «It explains
the process; it never tells the reader what to dispute or promises a result».
The approval is the SHA-256 of exactly what was approved (slug, both
languages, sources); the page shows that **published version**. An edit after
publishing sends the working copy back to draft (approval and ticks gone)
while the published version stays live until a newer one is published. The
address of a live guide never changes. «Take off the site» (`seo.publish`)
unpublishes; a guide is archived, never deleted.

**Alti drafts** (`src/lib/seo/draft.ts`, `POST /api/staff/seo/draft`,
`seo.edit`, 12 an hour): from the topic, brief and search phrases, Alti (Claude
Opus 5.5, `SEO_MODEL` overrides it; structured output, cached instructions,
the refusal fallback) writes the outline and the article in both languages
with sources, told the house rules and to cite only the source library or
official sites. The draft goes through `checkGuide`; one that breaks a
blocking rule is written again once with the reasons. A library source keeps
the library's own address; a non-official one the model invents is dropped.
**Without `ANTHROPIC_API_KEY`** (and in the demo): an outline in both
languages, with the headings, the sources that fit the topic and the closing
paragraph with the links, and every paragraph to write marked (the check
holds it until a person writes it). Either way it is a draft: «Put the draft
in the guide» fills the editor, nothing is saved until «Save», and it is
marked as Alti's draft (AI).

**Preview** (`/equipo/seo/guias/<id>/vista-previa`): the same component as the
public page, from the saved working copy, marked «Preview · not published».

**The starter guides** (`src/lib/seo/starters.ts`), four drafts written
carefully and sourced, unpublished:

1. How to dispute a credit report error in Texas (FCRA § 611: 30 days, +15
   with new information, 5 business days to the furnisher and for the results,
   frivolous disputes; § 623 and Reg V for direct disputes; the statement of
   dispute; the CFPB complaint).
2. Texas credit services organization law (Tex. Fin. Code ch. 393:
   registration, bond, the disclosure statement, the written contract, the
   Texas cancellation notice and 10-day refund; CROA's rules on top).
3. How long negative items stay on a report (FCRA § 605: 7 years, the 180-day
   rule for collections and charge-offs, 10 for bankruptcy, judgments; what
   does not restart the period; § 605(b)'s exceptions without amounts).
4. What a credit repair company can and cannot do (CROA §§ 1679b–1679g: no
   charge before the work, no false statements, the disclosure, the contract,
   3 business days to cancel, no waiver, the right to sue; the FTC's warnings).

How they were checked: the FCRA § 611 timelines against search results from
uscode.house.gov and govinfo.gov (2026-11-25); the rest follows the sections
`docs/LEARN.md` and `docs/AGREEMENT.md` already use, checked the same way.
The official pages could not be opened from the build machine, which is why
the person's «I opened every source» tick is required before publishing. The
Texas chapter 393 items follow `src/lib/agreement/statutes.ts`, which marks
the same sections as not yet compared word for word. In the demo the second
starter waits for approval, so the flow can be tried; on the database the
migration seeds nothing: «Add the starter guides» adds them as drafts.

### Search Console (`/equipo/seo/busqueda`, read-only)

Clicks, impressions, click-through rate and average position (weighted by
impressions), totals and per query or per page, for the last 7, 28 or 90 days
or chosen dates (ranges end two days ago: Google's numbers arrive late).
Without a connection the screen shows the «Connect» card and **no numbers at
all**; only the demo shows numbers without one, labelled sample.

Connect it (the owner, once):

1. In Search Console, add and verify the property (a Domain property,
   `sc-domain:credalti.com`, verified by DNS, is best).
2. **Service account (recommended).** In Google Cloud: create a project,
   enable the "Google Search Console API", create a service account and a JSON
   key. In Search Console → Settings → Users and permissions, add the service
   account's email with **Restricted** (read) permission. Set on the server:
   - `GOOGLE_SEARCH_CONSOLE_SITE` — `sc-domain:credalti.com` (or the URL-prefix
     property exactly, with the final slash: `https://credalti.com/`)
   - `GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL` — the service account's email
   - `GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY` — the key's `private_key` (PEM; `\n`
     may be written as `\\n`)
3. **Or OAuth (the owner's own Google account).** Create an OAuth client
   (type Web) in Google Cloud, get a refresh token once with the scope
   `https://www.googleapis.com/auth/webmasters.readonly` (for example in
   Google's OAuth 2.0 Playground with "Use your own OAuth credentials"), and
   set `GOOGLE_SEARCH_CONSOLE_SITE`, `GOOGLE_SEARCH_CONSOLE_CLIENT_ID`,
   `GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET`, `GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN`.
4. Schedule n8n Workflow 8 (`POST /api/cron/seo`, `docs/n8n.md`).

Only the read-only scope is asked; nothing in Search Console can be changed
from the app. No dependency: the service account's token request is a JWT
signed with `node:crypto` (`src/lib/seo/searchConsole.ts`). A sync error is
kept and shown («The last sync failed: …»).

### Keywords & ideas (`/equipo/seo/palabras`)

Tracked phrases: the phrase, its language, statewide or a Texas city (46
cities, `TEXAS_CITIES`, the same list in the database), and the page meant to
answer it (a site page or a guide), with its Search Console position and
clicks (last 28 days) when connected. A city outside Texas, Georgia or Atlanta
in a phrase, or a duplicate is refused (and by the database).

Content gaps (`contentGaps`): tracked phrases with no page; phrases that rank
past the first page; searches people already make (from Search Console only,
20 impressions or more) that no phrase covers; and topics no guide covers yet.
«Make it a brief» creates the guide with the topic, phrase and brief and
opens it with Alti's panel ready.

### Local SEO (`/equipo/seo/local`)

The owner's and the team's to-dos, each a tick with who and when: create and
verify the Google Business Profile (service area: Texas cities; hide the
address if it is a home office; the closest real category; a plain
description; hours and the website; the logo and a real photo), the same name,
address and phone everywhere, the Google review link in Reviews, answering
every review, verifying Search Console, and no pages for other states. The
name, address, phone, email and website shown are the ones the agreement
prints (`NEXT_PUBLIC_COMPANY_LEGAL_NAME`, `…_ADDRESS`, `…_PHONE`, `…_EMAIL`,
`NEXT_PUBLIC_SITE_URL`), with "Not set" and the variable when missing, and a
warning if the address is not in Texas. Links to Reviews (`/equipo/resenas`)
and the public review page (`/opina`).

## The red count

`src/lib/seo/needs.ts`: guides waiting for approval (for administrators),
guides sent back with changes (for writers) and site-health checks with
something to fix. It is added to the Content group's circle
(`src/lib/staff/navBadges.ts`, the `seo` source, additive to the Overview's
content count), from `GET /api/staff/seo?view=needs` every five minutes, or the
browser's copy in the demo.

## Public pages

- `/guias/<slug>` (`src/app/guias/[slug]/page.tsx`): the published version
  only, read with the anon key through `seo_published_guide(slug)` (a
  security-definer function that returns the published snapshot and nothing
  else). Metadata with canonical and hreflang, Open Graph `article`, Article,
  FAQPage and BreadcrumbList data from the same version, Alti's pose labelled
  "Alti · AI assistant", the sources list, a calm call to action and "General
  information, not legal advice… We do not guarantee results."
- `/guias`: the published guides; **not found while there are none**, so no
  empty page is ever indexed.
- The sitemap lists `/guias` and each published guide in both languages only
  once one is published (`src/lib/seo/sitemap.ts`).

## The database (migration 0039)

`seo_guides` (working copy, hash, approval, published snapshot),
`seo_guide_events` (append-only), `seo_keywords`, `seo_search_rows`,
`seo_settings`. Row level security on all of them (administrators and
specialists read; sales, clients and anyone signed out read nothing; the
server writes). Triggers: a guide is never deleted; a content change must
change the hash; an approval of an old hash is dropped and the working copy
goes back to draft; only the approved version can be published; a live
guide's address never changes; a new guide starts unpublished. `npm run
db:setup-sql` rebuilds `supabase/setup.sql`.

## What the owner must do

1. Search Console: verify the domain and connect it (service account or
   OAuth, above), then schedule Workflow 8.
2. Google Business Profile: create and verify it, and tick the local list.
3. Set the company variables the agreement uses, and `NEXT_PUBLIC_SITE_URL`.
4. Read each starter guide, open every source link, tick the boxes and
   publish the ones that are right.
5. `ANTHROPIC_API_KEY` for Alti's full drafts (without it, outlines only).

## Not done

- No in-app "Sign in with Google" for Search Console: it connects through the
  environment variables above.
- Search Console numbers are synced daily, not live; the screen shows the last
  sync.
- The crawl reads up to 60 internal links per run and does not render
  JavaScript (the site's pages are server-rendered, so nothing is missed today).
- The source links of the starter guides were not opened from the build
  machine (its network does not reach the official sites).
