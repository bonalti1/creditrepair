# Credalti brand in the product

The company is **Credalti**. **Alti**, the young man in the navy overshirt, is
the AI assistant: the main character and the only voice in the product, always
labelled as AI. **AltiBot**, the robot, is a small supporting cameo (two places
only). Both decisions are the owner's, of 2026-11-24 (see "Characters").
Internal and spec name remains Bonalti Credit (storage keys such as
`bonalti.locale` come from it; they are not the robot's name).

The product was called CreditCapi until November 2026. The name changed with
the move to full service: Credalti is now a company that does the work for its
clients. The assistant was a capybara mascot until the brand kit of November
2026 replaced it with the robot. The names, the characters' roles, the logo
files and the app icons live in `src/lib/brand.ts`; a test fails if the old
company name, the old mascot's name or the robot's old name appears anywhere in
`src/`, or in a file name under `public/`.

## The brand kit

The owner's brand kit (`Credalti_Everything_2026-11-21/1_Brand_Kit/`) is **not
in the repository**: it is a large download kept by the owner. What the app
uses from it was copied in unchanged (the tests hold each file's SHA-256):

| From the kit | In the repository |
| --- | --- |
| `brand/logo/vector/credalti-logo-white.svg`, `credalti-logo-navy.svg`, `credalti-check.svg` | `public/brand/logo/` |
| `brand/logo/favicon/favicon.ico`, `favicon.svg`, `apple-touch-icon.png` | `src/app/favicon.ico`, `src/app/icon.svg`, `src/app/apple-icon.png` (Next's file conventions) |
| `brand/logo/favicon/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | `public/brand/icons/` |
| `brand/logo/favicon/site.webmanifest` | rewritten as `src/app/manifest.ts` (same values, paths that match the repository) |
| `web-ready/bonalti/*`, `web-ready/alti/*` (the four views used, WebP @1x/@2x) | `public/brand/characters/` (the robot's files renamed `altibot_*`, contents unchanged) |
| `brand/palette/` (brand colors v2) | the tokens in `src/app/globals.css` (below) |

Read in the kit, not copied: `brand/logo/LOGO_README.md`, `brand/palette/PALETTE.md`,
`brand/typography/TYPOGRAPHY.md`, `brand/COMPLIANCE.md`, `brand/voice/BRAND_VOICE.md`.

**The robot's name.** The kit's files still call the robot **BONALTI**
(`characters/bonalti/BONALTI_IDENTITY_LOCK.txt`, `web-ready/bonalti/`, the
kit's `CLAUDE.md` and its other notes). The owner renamed him **AltiBot** on
2026-11-22; the art is the same. Where the kit says BONALTI, read AltiBot.
His name is one value, `cameo` in `src/lib/brand.ts`, used only where the
cameo appears. The assistant's name, Alti, is `assistant`; every page,
message, WhatsApp template and the assistant's instructions interpolate it.

## Logo

The official logo is the **✓Credalti mark**: a gold check and the "Credalti"
wordmark, approved by the owner on 2026-11-21. Only the kit's vector files are
the logo:

| File | Use |
| --- | --- |
| `credalti-logo-navy.svg` | On white and light backgrounds: navy `#12213A` wordmark, gold check. |
| `credalti-logo-white.svg` | On navy and other dark backgrounds: white wordmark, gold check. |
| `credalti-check.svg` | The check alone (square). The staff console's phone top bar and its folded side menu. |

`src/components/Logo.tsx` shows them as `<img>` with `alt="Credalti"`, the
width from the file's own viewBox (254.93 × 70.04), so it is never stretched.
`size` is the logo's height in px; `tone="dark"` picks the white version;
`variant="check"` shows the check alone. There is no wordmark without the check.

Where it appears:

| Where | Version | Height |
| --- | --- | --- |
| The public website's header (`SiteShell`: `/`, `/precios`, `/como-funciona`…) | white | 28 px |
| The website's footer, `/empezar`, on navy | white | 30 px |
| Open Graph image (`src/app/opengraph-image.tsx`), on navy | white | 84 px |
| Client app header (`AppNav`), onboarding | navy | 24 px |
| Staff console side menu (`StaffShell`), on navy | white | 30 px |
| Staff console phone «More» sheet, on navy | white | 26 px |
| Staff console phone top bar and folded side menu | the check alone | 26–30 px |
| Staff "no access" page (`equipo/layout.tsx`) | navy | 28 px |
| Login | navy | 32 px |
| Ad end card (`content/pipeline/assemble.ts`) | white | 190–200 px |
| `public/screens/*.png` (the `/empezar` screenshots) | navy, in the app header | |

Not shown on paper: the printed agreement copy (`/acuerdo/copia`) and the
staff print batch hide the app header, and the attorney letter packet
(`scripts/letters-packet.ts`) is Markdown with no logo. There is no Open Graph
image other than the website's (`src/app/opengraph-image.tsx`, the white
logo file on brand navy; docs/WEBSITE.md).

Rules (from the kit):

- Never recolour, outline, stretch, rearrange or redraw the logo, and never
  set "Credalti" in a font to imitate it (the wordmark's font is unidentified;
  it was traced, not typeset). No colour-changing CSS (`filter`, blend modes)
  on it.
- Clear space of at least the height of the "C" (about 47% of the logo's
  height, `LOGO_CLEAR_SPACE` in `brand.ts`) on every side. The headers' padding
  leaves it; `<Logo clearSpace />` adds it as margin where nothing else does.
- Never on the gold accent: the check disappears.
- The old gauge mark and the two-colour typeset "Cred"/"alti" wordmark are
  gone; the gauge was also a credit-score visual.

## Colours (brand colors v2)

The owner's brand colors v2 (2026-11-21), matched to the AP Fence logo:

| Token | Hex | Use |
| --- | --- | --- |
| navy | `#12213A` | Dark backgrounds, headings and links, text on gold, the logo's wordmark on light |
| navy-light | `#2E3C52` | Panels and cards on dark, the top of the hero gradient |
| gold | `#EFB537` | The check, accents, primary buttons |
| white | `#FFFFFF` | Text on dark, the logo's wordmark on dark |
| light | `#F5F6F8` | The page background |

The other colours in the kit's palette files are sampled from the character
art (Alti's shirt, the robot's shell): they describe the art and are **not UI
colours**. Never recolour the art to match the brand.

In the app the brand colours are the tokens of the `@theme` block in
`src/app/globals.css`. Components keep their class names; the scales were
rebuilt on the brand colours:

| Step | blue-* (navy) | amber-* (gold) |
| --- | --- | --- |
| 50 | `#EEF1F6` | `#FDF7E9` |
| 100 | `#DFE5EE` | `#FBEDCB` |
| 200 | `#C3CDDB` | `#F7DD9B` |
| 300 | `#9AA9BE` | `#F4C862` |
| 400 | `#6C7E98` | **`#EFB537`** brand gold: buttons, accents, gold on navy |
| 500 | `#4D5F7A` | `#E3A62A` gold button hovered |
| 600 | `#3A4A63` | `#B07A10` gold icons and dots on light (3:1) |
| 700 | **`#12213A`** brand navy: headings, links, active states | `#8A5C08` gold-toned **text** on light |
| 800 | **`#2E3C52`** navy-light: hero top, navy avatar circles, navy button hover | — |
| 900 | **`#12213A`** brand navy: the hero, text on gold and on tints | — |

`slate-50` is the brand light `#F5F6F8` (it was `#F5F5F7`); the other grays
are unchanged. The navy scale is named by role, not strictly by lightness
(700 and 900 are both the brand navy, 800 is navy-light), so that every
existing `text-blue-700` heading and `bg-blue-900` surface became the brand
navy without touching the components. The tints are the same desaturated navy
(hue about 217°), not the old purple-blue.

Contrast of every pair the UI uses (WCAG 2.x; checked by
`src/lib/__tests__/tokens.test.ts`):

| Pair | Ratio | Needs |
| --- | --- | --- |
| navy text on white / on light `#F5F6F8` | 16.1 / 14.9 | 4.5 |
| navy text on blue-50 / blue-100 tints | 14.2 / 12.7 | 4.5 |
| navy on gold button / hovered / hovered on the hero | 8.7 / 7.5 / 10.2 | 4.5 |
| navy on gold tints amber-50 / amber-100 (pills, banners) | 15.1 / 13.9 | 4.5 |
| white on navy / on navy-light | 16.1 / 11.1 | 4.5 |
| white icon on blue-500 | 6.5 | 3 |
| blue-100 text on navy / navy-light (hero lead) | 12.7 / 8.8 | 4.5 |
| blue-200 text on navy / navy-light (hero small print) | 10.0 / 6.9 | 4.5 |
| gold on navy / navy-light (headline accent) | 8.7 / 6.0 | 4.5 |
| amber-300 on navy (label on the navy card in `/acuerdo`) | 10.2 | 4.5 |
| amber-700 text on white / amber-50 / light | 5.8 / 5.4 / 5.4 | 4.5 |
| amber-600 icons and dots on white | 3.7 | 3 |
| blue-600 selected ring on white | 9.0 | 3 |
| **gold on white** | **1.85** | never as text |

Rules:

- **Primary actions are gold with navy text** (`bg-amber-400 text-blue-900`).
  Never white text on gold.
- **Never gold text on white or light backgrounds** (1.85:1). Gold-toned text
  on light (status words such as "En preparación", warnings) uses `amber-700`;
  gold text (`amber-300`/`400`) appears only on navy. A test scans the
  components for it.
- Navy is for headings, links and active states on light backgrounds, and for
  the hero field on landing pages.
- The browser's theme colour and the manifest use the brand navy `#12213A`.
- **The staff console** (ALTO Control's layout, docs/STAFF.md «The console's
  design system»): the navy side menu and the phone's navy bar and sheet carry
  the white logo; gold there marks the active section (a bar, the icon) and
  is text only on navy (`data-on-navy`); the "needs you" circles are red-600
  with white figures (4.8:1); the light page `#F5F6F8` with white cards. The
  word "Control" beside the logo is set in spaced Poppins capitals, apart from
  the logo, never as part of it.

## Favicon and app icons

The kit's favicon set (the gold check on a navy rounded square), unchanged,
through Next's metadata file conventions in `src/app/` (one mechanism, no
copies in `public/` and nothing in `metadata.icons`):

| File | Served at | Tag Next writes |
| --- | --- | --- |
| `src/app/favicon.ico` (16–256 px) | `/favicon.ico` | `<link rel="icon">` |
| `src/app/icon.svg` | `/icon.svg` | `<link rel="icon" type="image/svg+xml">` |
| `src/app/apple-icon.png` (180 px) | `/apple-icon.png` | `<link rel="apple-touch-icon">` |
| `src/app/manifest.ts` | `/manifest.webmanifest` | `<link rel="manifest">` |

The manifest: name and short name "Credalti", `display: standalone`, theme
and background `#12213A`, the 192, 512 and maskable 512 icons from
`public/brand/icons/`, `lang: es`. **`start_url` is `/dashboard`**: an icon on
a phone's home screen is for a client opening their app, not for the landing
page; signed out, the auth gate sends them to `/login` and back. The viewport's
`theme-color` is `#12213A` (it was the light gray).

## Typography

The owner adopted the kit's typefaces (`brand/typography/TYPOGRAPHY.md`) on
2026-11-22. Both come from `next/font/google` in `src/app/layout.tsx`: the
files are downloaded at build time and served from the site itself (no
request to Google from a visitor's browser), with `display: "swap"` and the
`latin` and `latin-ext` subsets (Spanish accents, ñ, ¿ and ¡).

| Role | Face and weights | Token | Used by |
| --- | --- | --- | --- |
| Headings and display | **Poppins** 600, 700 | `--font-display` (`font-display`) | The big headlines: landing, `/empezar`, onboarding, login, the agreement, payments, "Más", Home's next step |
| Body and interface | **Inter** 400, 500, 600 | `--font-sans` (the default) | Everything else, with the system font as fallback |

Rules:

- **Only the loaded weights.** Display headlines are `font-bold` (Poppins
  700); nothing is `font-extrabold` or `font-black`, which would make the
  browser fake a heavier weight. Body text stops at `font-semibold` (Inter
  600); `<b>`, `<strong>` and `<th>` are 600 too (`globals.css`, base layer).
  No italic headings (the only italics are the serif signatures on the
  agreement). `brand.test.ts` checks the weights, the subsets and that
  Nunito, the earlier display face, is gone.
- **Numbers line up**: `tabular-nums` on figures in lists, and on every table.
- Headings are balanced (`text-wrap: balance`), so a headline does not end on
  one short word; Poppins sets wider than Nunito did, and the landing and
  `/empezar` headlines were made slightly smaller for a 390 px phone.
- The ad pipeline's captions and end card use Poppins 700 and Inter 500 too
  (`content/pipeline/assemble.ts`, `content/brand/lock.json`).
- **Never use either font to imitate the logo.** The logo is the SVG files.
  `public/screens/*.png` (the `/empezar` screenshots) were taken before the
  change and still show the earlier fonts.

## Compliance rules from the kit

`brand/COMPLIANCE.md` (not legal advice; counsel reviews claims). As they apply
to the app:

- **No guaranteed outcomes**, and no wording or visuals of "deleted",
  "removed", "fixed", "+100 points", "guaranteed" or "approved" as a result.
  `src/lib/compliance/guardrails.ts` enforces the wording on marketing lines,
  in English and Spanish.
- **No credit-score visuals in marketing**: no score dials, gauges, numbers,
  before/after scores or green up-arrows, unless the owner approves a specific
  asset. The landing page, `/empezar`, the `/empezar` screenshots and the ad
  end card have none. (The `/empezar` step 1 screenshot used to be the home
  screen with its score ring; it is now the invited welcome. The logo's gauge,
  itself a dial, is gone.)
- **Disputes are about potential inaccuracies, with the consumer's consent**:
  the client decides what is inaccurate; nothing is sent without their say.
- **No false credentials**: Alti is AI and never presented as a licensed
  attorney, a human expert or a person; every message he writes says AI.
- **Respect**: no humour about debt, mistakes, income, language, immigrant
  background or literacy.
- **Taglines**: the kit approves none (`{TAGLINE — pending}`).

### Scores in the client app

**Decided by the owner on 2026-11-22:** the signed-in client app shows the
client their own scores only as **plain current numbers** from their report:
no dials or gauges, no change since an earlier report, no green or red, no
arrows, and no average in large type.

- Home (`/dashboard`): the journey's next step is the top of the screen
  ("Tu siguiente paso", its title, one button). Below the shortcuts, "Tus
  puntajes" lists each bureau with its current score in neutral colours, the
  source note ("VantageScore 3.0 según tu servicio de monitoreo. Los
  resultados varían.") and the report's date. The 270° gold ring, the
  average and the "+N desde tu primer reporte" pill are gone.
- Audit (`/audit`): "Tus puntajes hoy", each bureau's current score, the
  same note; the report's date is in the subtitle. No change since the first
  report.
- Factual lines about the report stay ("ya no aparece en tu reporte"), as do
  the WhatsApp messages, which never mention scores.
- The staff console keeps its numbers (`ReportImport`, the client page):
  staff need them.

`compliance.test.ts` ("scores in the client app") scans the client app for
the removed patterns: change-since-first-report copy, the ring, SVG/CSS
gauges, score arithmetic between pulls, arrows or green/red on a line with a
score, and any screen reading the score history.

## Characters

**Decided by the owner on 2026-11-24:** "I don't want AltiBot to be the one
answering. ALTI should be the one." Later the same day: "We can show AltiBot,
but very little." So:

| Character | What he is | Role in the product |
| --- | --- | --- |
| **Alti** | A young man in a navy overshirt with the Credalti logo, a lanyard badge reading "ALTI" and a gold shoulder strap. | **The AI assistant, the main character and the only voice.** He talks to clients and visitors: the app's chat (`/asistente`), the explanations and lessons, onboarding guidance, the website's "Ask Alti" chat and its hero example, WhatsApp replies from the assistant, saved answers sent automatically, the coach's instructions (he introduces himself as Alti, an AI). Every message he writes is labelled as AI beside his name (below). |
| **AltiBot** | A friendly robot: gold and cream shell, navy body, glowing amber face, a checkmark on his chest. | **A small supporting cameo.** He appears in exactly two places: the website's letter-mailing animation (small, carrying the envelope to "Delivered ✓", `src/components/site/MailCameo.tsx`) and once on `/nosotros`, beside Alti. He never speaks, never authors a message and never appears in the client app, the staff console, WhatsApp or the assistant's instructions. The kit calls him BONALTI; the owner renamed him AltiBot on 2026-11-22. |

Before 2026-11-24 the roles were the other way round (the robot was the AI
assistant and Alti stood for the human team). Nothing stands for the human
team as a character any more: a teammate's message carries the real person's
name, and "talk to a person" buttons show a plain person icon.

### The AI-disclosure rule

Alti looks like a person, so the product says in words, every time, that he is
not one:

- **Every message he writes** carries "Alti · AI assistant" / "Alti · Asistente
  con IA" beside his face (`aiByline` in `src/lib/brand.ts`): above the first
  bubble of each run of his messages on screen, and in each bubble for screen
  readers. The chat's header says the same, with "Artificial intelligence, not a
  person".
- **His first message** says he is an AI assistant and not a person (the app's
  chat, the website's chat, WhatsApp).
- **A real teammate's message** shows that person's own name, "Ana · Credalti
  team" / "Ana · equipo Credalti" (`teamByline`), never Alti's name, never a
  character and never the AI label (`TeamMessage`).
- **The coach and the website chat** are told they are AI, never a person or an
  employee, and to say so when asked (`src/lib/coach/systemPrompt.ts`,
  `src/lib/site/askAlti.ts`); the website chat also refuses any reply that
  claims to be a person.
- What the system does on its own (mailing, delivery, imports) is said in plain
  words ("Your round 1 letters were mailed"); the staff console calls it "The
  system" / "El sistema".

Why (checked through search results on 2026-11-24; the official pages were
outside the build machine's network, so **counsel should read each one before
launch**; this is not legal advice):

| Law | What it asks | Source |
| --- | --- | --- |
| **California B.O.T. Act**, Bus. & Prof. Code §§17940–17943 (SB 1001, 2018) | Unlawful to use a bot online to mislead a person in California about its artificial identity to sell goods or services; no liability if the bot's use is disclosed clearly, conspicuously and in a way reasonably designed to inform. | leginfo.legislature.ca.gov, BPC §17941; secondary: california.public.law/codes/business_and_professions_code_section_17941 |
| **Utah Artificial Intelligence Policy Act** (2024), as amended by SB 226 (2025, effective 2025-05-07), Utah Code title 13, ch. 77 | Generative AI interacting with a consumer must disclose it is AI when asked, and up front in "high-risk" interactions (financial advice among them); a clear disclosure at the start is a safe harbour. | le.utah.gov/Session/2025/bills/enrolled/SB0226.pdf; FPF, "Chatbots in Check: Utah's Latest AI Legislation" |
| **Maine** LD 1727 (2025), 10 M.R.S. §1500-DD | An AI chatbot in trade may not lead a reasonable consumer to believe they are talking to a person unless clearly told otherwise; enforced as an unfair trade practice. | legislature.maine.gov/statutes/10/title10sec1500-DD.html |
| **FTC Act §5** (15 U.S.C. §45) | Deceptive practices include misrepresenting that a chatbot is a person; the FTC's 2023 guidance ("Chatbots, deepfakes, and voice clones") warns against it. | ftc.gov business guidance blog, March 2023 |
| Texas **TRAIGA** (HB 149, effective 2026-01-01) | Consumer AI disclosure is required of state agencies and health care, not of a private credit services company; noted because Texas is where we operate. | capitol.texas.gov/tlodocs/89R/billtext |

We label every message, not only the first, because the cheapest way to never
mislead anyone is to never leave it unsaid. Tests hold the rule:
`brand.test.ts` (the bylines, "talk to a person" shows no character, the
robot's files allow-list), `conversation.test.ts` (an AI message carries "Alti ·
AI assistant"; a teammate's carries their name and never "Alti"),
`siteInteractive.test.ts` (the website chat).

### Where each appears

- **Website:** Alti in the hero (standing beside the phone, labelled "Alti · AI
  assistant", with a slow idle bob and a one-time greeting sway done with CSS
  transforms on the whole picture), in the hero example and "Ask Alti" (every
  line labelled), on the floating "Ask Alti" button and the phone's sticky bar,
  on `/nosotros` and in the final call. AltiBot: the mailing animation in the
  example, and the small card on `/nosotros`. `/empezar`: Alti at the top and
  beside step 2 (he explains the report).
- **Client app:** Alti in the chat's header and beside his messages, on the
  invited welcome ("Alti · AI assistant: I'll guide you step by step"), on the
  review choice in onboarding, beside the lessons he presents, on the
  build-your-credit plan and on graduation. "Talk to a person" (chat, Más,
  agreement, onboarding): a person icon. Waiting and status screens ("your
  report is being imported", the empty rounds screen, Mi caso's note): icons.
- **Staff console:** Alti's head beside each "Alti (IA)" message and his drafts
  (the byline "Alti · AI assistant" on top); at the foot of the side menu and
  in «Ask Alti», the helper of every section (labelled "Alti · AI assistant";
  it points at the team's help and at Alti's existing features and writes
  nothing); waving on the Overview's navy band over his greeting; and in empty
  states with a fitting pose (a picture beside a person's words, never
  speaking). No robot. See docs/STAFF.md, «The console's design system».

Rules for the characters:

- **The art is locked.** Never edit, redraw, recolour, re-crop or regenerate
  AltiBot: his files in `public/brand/characters/` are the kit's own WebP
  files, copied unchanged (renamed from `bonalti_*` to `altibot_*`, contents
  identical). **Alti was redrawn once, at the owner's request (2026-11-24):**
  "no droopy eyes", but "still a bit sarcastic". His eyes are now open, one
  eyebrow is up and he has a small smirk; face, outfit and style are the
  kit's. His two head views are crops of the new standing views. Six poses
  were made with him (`alti_wave`, `alti_phone`, `alti_thumbsup`,
  `alti_thinking`, `alti_envelope` with a yellow envelope, `alti_celebrate`;
  `BRAND.assistantPoses`). Change his art again only when the owner asks.
  Each character has four views (`front`, `three_quarter`, `head_front`,
  `head_three_quarter`), each at @1x and @2x, served with `srcSet` so retina
  screens get @2x. The round avatars show the head views inside a circle. Motion
  (`motion="idle"` / `"wave"` on `CharacterFigure`) moves the whole picture with
  CSS transforms only, and stops for visitors who ask for reduced motion.
- **Surfaces:** navy or ivory/white. On very dark or saturated backgrounds a
  light 1–2 px rim from the original studio backdrop may show on hair edges;
  move the art to a navy or ivory surface instead of touching it.
- **Alti never speaks for a person** and never stands in for a teammate.
- **The robot is a cameo**: only the two places above (the brand test holds the
  list of files that may name or show him), never an author.

## What the brand says it does

Full service, in one sentence: **"You tell us what is wrong on your report.
Our team prepares and mails the letters for you and keeps you posted."**
(Spanish: *"Tú nos dices qué está mal en tu reporte; nuestro equipo prepara y
envía las cartas por ti y te mantiene al tanto."*) Everything a client or a
prospect reads is written around it: the landing page, `/empezar`,
onboarding, the app, Alti and the WhatsApp messages.

**Language: English first, Spanish if needed** (the owner's decision,
November 2026; it replaces "Spanish-first"). Every client-facing surface is in
English by default and fully in Spanish one tap away; a Spanish browser, a
salesperson's Spanish invitation or the client's own choice starts it in
Spanish (`src/lib/i18n/detect.ts`). Say "in English or Spanish" (or
"bilingual"), never "Spanish-first" or "everything in Spanish". English copy is
written, not translated: short sentences, plain words, the same claims as the
Spanish and nothing more. Both languages pass the same claim rules and the
plain-language check. The staff console (`/equipo`) is still Spanish only.

Three things hold in every line of copy, in both languages:

- **Process, never outcome.** We say what we do (prepare and mail letters,
  keep the client posted). We never say or imply what will happen to a report
  or a score. The bureaus decide, and results vary.
- **The client decides what is inaccurate.** No copy suggests that the team
  picks what to dispute, or that everything negative gets disputed.
- **No price in the copy.** The service has a monthly fee, separate from the
  monitoring subscription the client pays to the monitoring provider. Amounts
  are not written anywhere; "our team explains the plan" ("nuestro equipo te
  explica el plan").

`src/lib/compliance/guardrails.ts` enforces the first two, and the tests run
every marketing line through it in English and Spanish. How the service is
delivered is a switch, `NEXT_PUBLIC_SERVICE_MODE` (`src/lib/service/mode.ts`):
unset means full service; `self_serve` brings back the earlier
do-it-yourself wording and its approve button, kept for later.

## Where the brand lives

| What | Where | How to change it |
| --- | --- | --- |
| Colours | `@theme` block in `src/app/globals.css` | `blue-*` is navy, `amber-*` is gold, `slate-*` is neutral (see "Colours"). Edit the values; `tokens.test.ts` checks the brand values and the contrast. |
| Names, logo paths, icons | `src/lib/brand.ts` | Company name, the page titles, the logo files (`logo`), the app icons and theme colour (`APP_ICONS`), the assistant `assistant` / `assistantImages` / `aiLabel` (Alti) with `aiByline` and `teamByline`, and the cameo `cameo` / `cameoImages` (AltiBot), with their image descriptions. |
| Logo | `public/brand/logo/*.svg`, shown by `src/components/Logo.tsx` | The kit's files, byte for byte (see "Logo"). |
| Characters | `public/brand/characters/*.webp`, drawn by `CharacterAvatar` (round head) and `CharacterFigure` (standing) in `src/components/Character.tsx` | Brand kit art (Alti redrawn at the owner's request, 2026-11-24, plus six poses); see "Characters". A test checks every path in `brand.ts` exists. |
| Favicon, app icons, manifest | `src/app/favicon.ico`, `icon.svg`, `apple-icon.png`, `manifest.ts`; `public/brand/icons/` | See "Favicon and app icons". |
| Typefaces | `src/app/layout.tsx` | See "Typography". |

## Copy from the brand board that must NOT ship

The board's mock website contains lines that break the product's legal
position. These phrases must not ship:

- "Reparamos, disputamos y mejoramos tu perfil de crédito" — "reparamos" and
  "mejoramos" promise an outcome. (Disputing is now what the team does, but
  only for what the client says is inaccurate: "disputamos por ti los puntos
  que tú nos indicas", never "disputamos todo".)
- "Mejora tu crédito hoy", "Aumenta tu puntaje", "Resultados reales" — outcome
  promises.
- The chip-card mock-up — implies we issue cards or lend money.

Approved pattern: "Tu crédito, con un equipo a tu lado." / "Tú nos dices qué
está mal. Nosotros enviamos las cartas." / "Los resultados varían."

No longer in use: "Tu crédito, en tus manos." and "Tú decides y tú apruebas."
They described the do-it-yourself product, where the client sent their own
letters.

## Ads

The same brand rules apply to video. The caption style and the end card are
locked in `content/brand/lock.json`, and every ad script must pass the claim
gate before anything is generated. See `content/README.md`.

**The existing ad videos show the old mascot (the capybara) and must be
remade** with Alti (the AI assistant, labelled as AI on screen) before they run
again. `lock.json` marks the old
character and its reference stills as retired and records the new characters'
files; the ad pipeline itself, the spot scripts and the hooks still describe
the old mascot and were left as they are (nothing was regenerated). New spots
need a new character block, written from the locked art, before any
generation.

The end card shows the official logo file (`credalti-logo-white.svg`) on
brand navy with the gold swoosh; the captions use the brand gold and navy.
It no longer draws the old gauge or sets the name in a font.

The end card's legal line and the ad text around the video were reworded for
full service ("Tú decides qué es inexacto. Nuestro equipo prepara y envía las
cartas."). A video assembled before that change still carries the old end
card and has to be assembled again before it runs.

## Open items

- **Trademark:** a quick web search found no existing "Credalti". That is not
  a clearance: counsel should run a proper trademark search before spend on
  signage or ads.
- **Alti's voice:** not chosen yet, for video; any voice must say it is AI.
- **Ads:** every existing video shows the old mascot and must be remade.
- **More poses:** Alti has six poses (2026-11-24) and a 4-second waving loop
  on the home page. AltiBot has only the kit's views.
- **AI-disclosure laws:** counsel to confirm the table above against the
  official texts.
