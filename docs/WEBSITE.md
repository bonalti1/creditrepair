# The public website

Credalti's marketing site: the pages a visitor sees before the app. Built
November 2026 against the leading credit repair company's site (ConsumerAffairs'
#1, observed 2026-11-24) as a benchmark of what a top site covers. Nothing of
theirs is copied (layout, words, graphics or assets) and they are never named.

## Pages

| Path | What it is | File |
| --- | --- | --- |
| `/` | Home: hero with the AltiBot example in a phone, why it matters (sourced), how it works, what you get, the comparison, pricing teaser, your rights, trust, partners, FAQ preview, final call | `src/app/page.tsx` |
| `/precios` | How every charge works, the offered plans (attorney-approved only), what is included, monitoring, cancelling | `src/app/precios/page.tsx` |
| `/como-funciona` | The whole journey with screens of the real app (demo mode, 390 px, 2x, both languages) | `src/app/como-funciona/page.tsx` |
| `/preguntas` | 20 honest questions and answers, with FAQPage structured data | `src/app/preguntas/page.tsx` |
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
- AltiBot is always called AI; Alti stands for the team and never speaks.
- Not "Start free review": the review needs the paid monitoring subscription,
  and the copy tests forbid "free". The button reads "Start my review".

## The AltiBot example (home page)

A phone frame with a sample collection ("Sample Collections", invented
balance, labelled Example). The visitor taps "It's not mine", "Wrong balance"
or "Looks right"; AltiBot says what happens next; "See it in Mi caso" shows the
case a few days later, with real calendar dates from today. The case is built
on the server by the app's own timeline rules (`src/lib/site/demo.ts` →
`src/lib/case/timeline.ts`), so the example says exactly what a client's Mi caso
says. "Looks right" mails nothing. It is the only client component on the site
(`src/components/site/AltiBotDemo.tsx`); no network call, no AI call.

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

Left out on purpose: credit building and a home-ready path after disputes
(`src/lib/aftercare/` does not exist yet), money-back guarantees, phone
consultations.

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
- Server components everywhere except the example; the phone menu is a
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
