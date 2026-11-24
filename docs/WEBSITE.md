# The public website

Credalti's marketing site: the pages a visitor sees before the app. Built
November 2026 against the leading credit repair company's site (ConsumerAffairs'
#1, observed 2026-11-24) as a benchmark of what a top site covers. Nothing of
theirs is copied (layout, words, graphics or assets) and they are never named.

## Pages

| Path | What it is | File |
| --- | --- | --- |
| `/` | Home: hero with the phone (the example, and "Ask Alti"), why it matters (sourced, with marks that fill in), the 30-second report check, the scroll story, what you get, after the letters (building credit, the home path, ITIN) with the home-ready teaser, the comparison toggle, the two calculators, pricing teaser, your rights, trust, partners, FAQ preview, final call | `src/app/page.tsx` |
| `/precios` | How every charge works, the offered plans (attorney-reviewed only), "When would I pay?" (the slider timeline), what is included, monitoring, cancelling | `src/app/precios/page.tsx` |
| `/como-funciona` | The whole journey as a scroll story with five screens of the real app (demo mode, 390 px, 2x, both languages), the rounds, after the letters with the teaser | `src/app/como-funciona/page.tsx` |
| `/preguntas` | 20 honest questions and answers, with FAQPage structured data, then the report check and the calculators | `src/app/preguntas/page.tsx` |
| `/socios` | For realtors, loan officers and tax preparers, above the existing application | `src/app/socios/page.tsx` |
| `/nosotros` | Who we are, Alti and AltiBot, our rules, where we work | `src/app/nosotros/page.tsx` |
| `/derechos` | Your rights in plain words and the federal CROA statement, reused from the agreement | `src/app/derechos/page.tsx` |
| `/privacidad`, `/terminos` | Placeholders marked "Draft · pending attorney review" | `src/app/privacidad`, `src/app/terminos` |

`/empezar` (the paid-traffic page) and onboarding are unchanged.

Every word is in `src/lib/site/copy.ts`, English and Spanish. The frame
(header, menu, language switch, footer with the disclosures) is
`src/components/site/SiteShell.tsx`; each page renders it, so the header always
knows the current page.

## Language

The existing system (`src/lib/i18n/`): the server renders the request's
language on the first paint. Each page has one path (Spanish route names) and
two language URLs, `?lang=en` and `?lang=es`; the proxy saves the choice in the
`credalti.locale` cookie. The bare path is the `x-default`. The language switch
is a plain link to the same page with the other `?lang=` (no JavaScript).
Every site path is in the proxy's matcher (a test checks it).

## Rules the copy follows (all tested in `src/lib/__tests__/site.test.ts`)

- Every line passes `checkMarketingCopy` and `checkClaimGuardrails`, EN and ES.
- No outcome words (deleted, removed, fixed, guaranteed, approved), no score
  numbers, gauges, "+N pts" or before/after. No sentence over 25 words.
- Nothing is called "free": the service is paid and monitoring is paid to the
  provider. "At no cost" is said only of disputing on your own, cancelling in
  the first 3 business days and ending the service.
- No price in the copy. Amounts appear only on `/precios`, generated from an
  attorney-approved, offered plan (`src/lib/site/plans.ts`) in the contract's
  own words. Pay per delete is never shown on the public site.
- No money-back guarantee (attorney-pending). "End the service any time, at no
  cost to end it" is from the draft agreement, section 8.
- No phone sales. The main button opens WhatsApp with the team when
  `NEXT_PUBLIC_WHATSAPP_NUMBER` is set, else the online start (`/onboarding`).
  A phone number shows only in the footer, as a support line, and only when
  `NEXT_PUBLIC_COMPANY_PHONE` is set.
- Alti is the AI assistant and the only voice: every line he "says" is
  labelled "Alti · AI assistant" (docs/BRAND.md, the disclosure rule). The robot,
  AltiBot, appears only as the small cameo in the mailing animation and on
  `/nosotros`.
- Not "Start free review": the review needs the paid monitoring subscription,
  and the copy tests forbid "free". The button reads "Start my review".

## The hero example (home page)

A phone frame with two tabs: **Try the example** and **Ask Alti** (below). The
example: a sample collection ("Sample Collections", invented balance, labelled
Example). Alti, the AI assistant, types (a typing indicator) and explains it;
the visitor taps "It's not mine", "Wrong balance" or "Looks right"; Alti says
what happens next, every line labelled "Alti · AI assistant". "See it in Mi
caso" shows the visitor's answer flying into the case, then the letters
travelling: the robot's small cameo carries the envelope along a track
(Mailed → On the way → **Delivered ✓**, `MailCameo.tsx`), then the case's dates
appear one by one. "Replay" plays it all again; "Try another answer" goes back
to the question. The case is built on the server by the app's own timeline
rules (`src/lib/site/demo.ts` → `src/lib/case/timeline.ts`), so the example
says exactly what a client's Mi caso says. "Looks right" mails nothing. No
network call and no AI call (`src/components/site/AltiDemo.tsx`).

## Interactive pieces

All client components ("islands") live in `src/components/site/` and are
reached through `islands.tsx` (`next/dynamic`: each one is its own chunk,
still rendered on the server, so nothing shifts and the content is there
without JavaScript). Their words are `SITE_COPY[locale].live`
(`src/lib/site/live.ts`, EN/ES), so the site's copy tests (both claim checks,
25-word sentences, nothing "free", no outcome words, no amounts) cover every
line; their logic is in `src/lib/site/interactive.ts`, `askAlti.ts` and
`payTimeline.ts` (tested in `src/lib/__tests__/siteInteractive.test.ts`).

| Piece | Where | What it does |
| --- | --- | --- |
| Hero phone (`HeroPhone`, `AltiDemo`, `MailCameo`) | `/` | The example above, and the "Ask Alti" tab. A real tab list (arrow keys). |
| **Ask Alti** (`AskAlti`, `AskAltiLauncher`) | Every page (`SiteShell`) | A floating button on wide screens (after a short scroll) and a sticky bar on phones ("Start my review" + "Ask Alti"); the chat panel. Below. |
| Stat marks (`motion.tsx`: `StatPictogram`) | `/`, why it matters | "1 in 5" and "1 in 20", the FTC figures, drawn as 5 and 20 marks that fill in when scrolled to, one of them gold. The figure itself never changes: only sourced numbers. |
| **What's on your report?** (`ReportQuiz`) | `/`, `/preguntas` | Seven chips (late payments, collections, inquiries you don't recognize, accounts that aren't yours, wrong name or address, wrong balance or status, items older than 7 years) and "None of these". Each pick gets what it is, what the law says, what Credalti does, and its source (CFPB, FTC, IdentityTheft.gov, 15 U.S.C. §1681c). No personal data, no score, no prediction; ends in "Start my review". |
| Scroll story (`HowScroll`) | `/`, `/como-funciona` | Wide screens: the steps scroll past a sticky phone whose screen cross-fades with the step in the middle of the window (IntersectionObserver), with a numbered rail. Phones: swipeable cards (scroll snap) with dots. Five real screens (`public/screens/site/{welcome,case,review,letters,build}-{en,es}@{1x,2x}.webp`). |
| Comparison toggle (`CompareToggle`) | `/` | "Credalti" / "Many companies": the six rows swap in one by one. Same facts as before (`facts.ts`). |
| **When would I pay?** (`PayTimeline`) | `/precios` | A slider over months 0–6 (at least one): rounds mailed and where a charge can happen, from the billing rules (`payTimeline.ts`: nothing before round 1 is mailed, a day's delay after mailing, never two charges within 30 days, a monthly plan's quiet periods, the cap). With no attorney-reviewed plan offered: the rule only, no amounts. With one: its own amounts, from its terms. |
| Calculators (`Tools`) | `/`, `/preguntas` | Card utilization and "How long can this stay?", the Aprende arithmetic (`src/lib/learn/calculators.ts`), nothing saved or sent. |
| Home-ready teaser (`HomeReadyTeaser`) | `/`, `/como-funciona` | Two taps (goal; SSN, ITIN or rather not say) and the after-care features that fit, in order: the home-ready path, the build-your-credit plan, the ITIN guide, Mi caso. "Requirements vary by lender, and the lender decides." |

### Ask Alti

Visitors type real questions; Alti answers as the AI assistant, labelled
"Alti · AI assistant" on every answer and in the header ("Artificial
intelligence, not a person"); the first message says he is AI and asks for no
personal details. Every answer ends with "Start my review" and "Chat with the
team on WhatsApp" (or "See all questions" when no WhatsApp number is set).

The route is `src/app/api/site/ask/route.ts`; the rules are in
`src/lib/site/askAlti.ts`:

- **With `ANTHROPIC_API_KEY`:** Claude answers as Alti (`ASK_MODEL`,
  `claude-opus-5-5`, low effort, at most 90 words asked, 2,000 tokens allowed).
  The system prompt (rules plus the site's FAQ and library in both languages)
  is the same for every visitor and marked `cache_control`, so it is cached.
  Restricted to credit reports, bureaus, disputes, rights, building credit in
  general and how Credalti works; anything else gets `OFF_TOPIC` and the
  off-topic line.
- **Without a key** (and when the model fails or refuses): the answer comes
  from the FAQ and the library in `live.ts` by word overlap, with suggested
  questions as chips. That is a normal state, as for `/api/coach`.
- **Before any model:** a message that looks like an SSN or ITIN, an email, a
  phone, an account number or a birth date gets "please don't share personal
  details" and is never sent anywhere (earlier turns with it are dropped);
  greetings get the introduction; a question with no credit word and no close
  library match gets the off-topic line.
- **Every model reply is checked:** `checkMarketingCopy` and
  `checkClaimGuardrails`, no amount of money (prices are never quoted; the
  pricing page explains charging), no "free", no claim to be a person, no
  taxpayer number, the robot's name never, a length cap. On any failure: the
  closest library answer, else "a person on our team can answer that".
- **Limits:** 15 questions per IP per 10 minutes (`rateLimit`), an 8 KB body
  (`readJsonBody`), 8 messages of 500 characters, a 25-second timeout with one
  retry.
- **Nothing is stored:** no question and no reply, on the server or in the
  browser; only counts of how each answer was made (`ASK_COUNTS`), in memory.

### Motion and accessibility

- **Scroll reveal** (`Reveal`): sections fade up when they scroll into view.
  The server renders them visible; only an element still below the fold is
  hidden, once the script runs, so nothing blinks and nothing is hidden
  without JavaScript.
- **Micro-interactions:** message slide-ins and typing dots, hover lift on
  cards and chips, Alti's idle bob and greeting sway (transforms on the whole
  locked picture), floating product-fact cards beside the hero phone (facts,
  never reviews), the language switch cross-fades the next page (CSS view
  transitions; a plain link still).
- **Reduced motion:** every keyframe and transition is off under
  `prefers-reduced-motion: reduce` (`globals.css`), the example and the chat
  show each step at once (`demoTimings`), the reveal shows everything. Tested.
- Keyframes animate `transform` and `opacity` only (a test checks it): no
  layout shift.
- The chat and the example are polite live regions; chips are toggle buttons
  (`aria-pressed`); tabs are tab lists with arrow keys; the slider says "3
  months"; the chat is a non-modal dialog closed by Escape, focus returning to
  the button; every input has a label; focus rings everywhere (`globals.css`).
- Colours stay on the tokens; gold text only on navy (`data-on-navy`,
  `tokens.test.ts`).

### Performance

No new dependency. The chat panel's code loads only when someone opens the
chat (or points at the button). Each island is its own chunk. The browser copy
(`live.ts`) imports only `brand.ts`; the billing rules stay on the server (the
timeline's events are built there). Images keep width, height and `srcSet`;
only the hero's Alti loads eagerly; the story's screens are lazy.

## Why it matters: sources

Every figure links to its source. Checked through search results on 2026-11-24
(the pages themselves were outside the build machine's network): **open each
once before launch.**

| Claim | Source |
| --- | --- |
| 1 in 5 people had an error on at least one of their three reports | FTC press release, 11 Feb 2013, on its FACTA §319 study: ftc.gov/news-events/news/press-releases/2013/02/ftc-study-five-percent-consumers-had-errors-their-credit-reports-could-result-less-favorable-terms |
| 1 in 20 (5%) had errors that could mean paying more, e.g. auto loans and insurance | Same release |
| Employers may check your report, with your written permission | consumer.ftc.gov/articles/employer-background-checks-and-your-rights |
| Credit, jobs, insurance and rentals among the decisions a report can affect | 15 U.S.C. §1679c (the CROA statement itself) |
| Your three reports at no cost every week at AnnualCreditReport.com | consumer.ftc.gov/consumer-alerts/2023/10/you-now-have-permanent-access-free-weekly-credit-reports |

## The comparison: sources

Our column: each row names product facts in `src/lib/site/facts.ts`, each with
the file that makes it true and the text that must be in it; the test fails if
the evidence disappears.

| Row | Our facts (file) |
| --- | --- |
| When you're charged | charge-after-work, no-setup-fee, first-work-fee-after-round (`src/lib/billing/plans.ts`) |
| The total | most-youll-pay, every-30-days (`src/lib/billing/plans.ts`) |
| What's included | no-feature-tiers (`plans.ts`: plan terms have no feature fields), three-bureaus, creditor-collector-letters (`src/lib/agreement/documents.ts`), inquiry-letters (`src/lib/letters/bureauTemplates.ts`) |
| Seeing the work | case-timeline (`src/lib/case/timeline.ts`), certified-mail (`src/lib/mail/classes.ts`) |
| Spanish | bilingual-one-site (`src/lib/i18n/detect.ts`), assistant-explains (`src/lib/i18n/marketing.ts`) |
| Promises | no-outcome-claims (`src/lib/compliance/guardrails.ts`), client-decides (`documents.ts`) |

The "many companies" column describes only what was observed on the benchmark
site on 2026-11-24: monthly tiered plans plus a first work fee; inquiry
challenges and three-bureau reports only in the higher tiers; a separate
Spanish website; score-change examples ("+N pts") in its marketing; progress
updates in its app. The page says "many companies" describes plans and ads
seen in the industry, not any one company.

Left out on purpose: money-back guarantees, phone consultations. (Credit
building, the home-ready path and ITIN support are on the site now, as general
guidance in the app: "After the letters", docs/AFTERCARE.md.)

## Reviews and press

`src/lib/site/socialProof.ts`, empty by default. While empty, the home page
shows "We're new. Here is how we earn your trust." and no stars, counts,
"as seen in" logos or awards, and the structured data has no rating. A review
needs the client's exact words, the source and its link, the date and written
consent; a press mention needs the outlet, title, date and link (never a logo
without permission). Add reviews as they come, good and bad (FTC rule on
consumer reviews, 16 C.F.R. part 465).

## SEO and performance

- Per-page title, description, canonical (the page's language URL) and
  hreflang en/es/x-default (`src/lib/site/seo.ts`); `metadataBase` in the root
  layout from `NEXT_PUBLIC_SITE_URL` (else `NEXT_PUBLIC_APP_URL`).
- `src/app/sitemap.ts` (every page in both languages with alternates),
  `src/app/robots.ts` (the app, console, portal and API kept out),
  `src/app/opengraph-image.tsx` (the official white logo file on brand navy,
  gold accent; generated at build time).
- Structured data: Organization on every page, FAQPage on `/preguntas`.
- Server components everywhere except the islands above; the phone menu is a
  `<details>`, the FAQ is `<details>`, the language switch is a link. Images
  have width and height; the character art and screenshots ship as @1x/@2x
  WebP with `srcSet`; only the hero's art loads eagerly.

## What the owner must supply

1. `NEXT_PUBLIC_SITE_URL` (the public domain), `NEXT_PUBLIC_WHATSAPP_NUMBER`,
   `NEXT_PUBLIC_COMPANY_ADDRESS`, `NEXT_PUBLIC_COMPANY_EMAIL`, and optionally
   `NEXT_PUBLIC_COMPANY_PHONE` (support line only).
2. The founder's story and photo (`src/lib/site/owner.ts`).
3. Real reviews and press, as they come (`src/lib/site/socialProof.ts`).
4. Attorney-approved plans in `/equipo/planes` (they appear on `/precios`).
5. The attorney's privacy/GLBA notice and website terms.
6. Open each source link above once, and the CROA text against the official
   page (`src/lib/agreement/statutes.ts`).
7. `ANTHROPIC_API_KEY` for "Ask Alti" to answer with Claude (without it, it
   answers from the FAQ), and `NEXT_PUBLIC_WHATSAPP_NUMBER` for its WhatsApp
   button.
