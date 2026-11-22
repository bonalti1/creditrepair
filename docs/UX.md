# UX Strategy — 10x more user-friendly than Dispute Beast

> **Written for the do-it-yourself product.** Under full service (the
> default; see `NEXT_PUBLIC_SERVICE_MODE` in `README.md`) the client still
> reviews each item and reads every letter, but the team prepares and mails
> them: there is no approve step, the letters page is read-only with each
> letter's status, and the rounds page is the team's timeline.

Dispute Beast wins on engine scope (secondary bureaus, escalation) but its UX
assumes a motivated, English-speaking, credit-literate user on a desktop. Our
user reads English or Spanish (the app is English first, Spanish if needed),
is mobile-first, and is often doing this for the first time.
Every bet below targets a specific Dispute Beast failure mode.

## The bets (implemented)

| # | Dispute Beast failure | Our answer | Where |
| --- | --- | --- | --- |
| 1 | User lands in a dashboard and doesn't know what to do | **Journey engine**: exactly ONE next step at all times, plain Spanish, one button | `src/lib/ux/journey.ts`, `JourneyHero` |
| 2 | Wall-of-rows item list full of jargon | **Guided review wizard**: one item at a time, "¿Qué es esto?" + "verifica antes de decidir" checklists, jargon glossary inline | `items/page.tsx`, `src/lib/ux/explainers.ts` |
| 3 | Nudges users to dispute everything | "Se ve correcto" is a first-class, celebrated answer; attestation checkbox is the only path into a letter (also our Armor #2) | wizard card |
| 4 | Letters are a black box you approve blind | **Full letter preview** + "en palabras simples" summary of what each letter does and the law it invokes | `attack/page.tsx`, `STAGE_EXPLAINERS` |
| 5 | The 30–40 day wait feels like abandonment | **Visible clocks**: FCRA ~30-day response window + day-40 next-round date on a progress bar, with "no necesitas hacer nada" reassurance | `rounds/page.tsx` |
| 6 | Coach buried in a separate tab | **Floating coach** on every page, quick-question chips, offline educational fallbacks so it never dead-ends | `CoachWidget.tsx` |
| 7 | State lives per-page; users re-review | **Shared review store** (localStorage now, `item_flags` later): decisions follow the user across wizard → attack → dashboard | `src/lib/ux/flagsStore.ts` |
| 8 | Desktop-web-first | **Mobile bottom tab bar**, thumb-reachable actions, single-column layouts | `AppNav.tsx` |
| 9 | English-only | English and Spanish everywhere, one tap apart (English first; Spanish for a Spanish browser, a Spanish invitation or the client's choice); letters mail in English with a note explaining why | all copy, `src/lib/i18n/` |

## Principles

1. **One next step.** If a screen offers more than one primary action, it's wrong.
2. **Explain, never assume.** Every term a bureau uses gets a plain-Spanish
   sentence next to it. The glossary lives in code (`TERM_GLOSSARY`) so it's
   consistent everywhere.
3. **Honesty is UX.** "Se ve correcto" and "los resultados varían" build the
   trust that keeps users through 6–12 rounds. Compliance (Armor #2/#3) and
   user-friendliness are the same feature here, not a tradeoff.
4. **The wait is part of the product.** Between rounds, always show: what was
   sent, who must respond, by when, and what happens next. WhatsApp carries the
   same story (spec §4.3).
5. **Celebrate progress.** Finished review, approved attack, detected deletion —
   each gets a moment. Retention loop = emotional loop.

## Since implemented

- Language: dictionary-based i18n (`src/lib/i18n/`) covering all app
  chrome, explainers, glossary, and journey copy. **English first, Spanish if
  needed** (owner's decision, November 2026). The order, in
  `src/lib/i18n/detect.ts`: an invitation's `?lang=` → the choice saved on the
  device (cookie `credalti.locale` + localStorage) → the signed-in client's
  profile (`profiles.locale`) → the browser's language (Spanish when it
  prefers Spanish) → English. The server reads the cookie and
  `Accept-Language` for the first render, so there is no flash of the wrong
  language, and `<html lang>` matches. The button at the top of every client
  screen names the other language ("Español" / "English"); the choice is
  saved on the device and on the profile, which is the language automatic
  messages go out in. The staff console stays Spanish.
- WhatsApp deep links back into the exact next step (`appLink()` in the
  WhatsApp integration; journey keys map 1:1 to destinations).
- Passwordless auth (email magic link) — no passwords to forget; review
  decisions persist server-side (`item_flags`) and follow the user across
  devices.

## Client experience (November 2026)

The bar: the client never has to ask "any update?", can read or listen to
everything, and understands credit better than before they came.

### "Mi caso" and "¿Qué está pasando?"

- `/caso` is one honest timeline, newest first: disclosures read, agreement
  signed and its cancellation deadline, documents received and checked, each
  report imported, review finished, each round prepared / mailed / delivered
  (from the letters' mail status), returned letters, bureau answers, and every
  charge with what it paid for. Above it, "Lo que sigue": the bureaus' 30-day
  deadline and "Tu siguiente ronda se prepara alrededor del …", from the
  process's own dates. Facts only: no scores, no promises.
- Home opens with **one plain sentence of status** ("Tus cartas de la ronda 1
  se enviaron el 12 de noviembre. Los burós tienen unos 30 días para
  responder."), with Escuchar; a compact "Mi caso" card follows the next step.
  On every other client screen the header's (i) button opens the same sentence.
- Logic: `src/lib/case/timeline.ts` (pure; every state unit-tested in
  `caseTimeline.test.ts`, both languages, guardrails and sentence length).
  Facts: `src/lib/case/useCase.ts` switches like the other stores. The demo
  builds them from the device's stores; "Ver un caso de ejemplo" on `/caso`
  writes a labelled example case (invented dates, counted back from today)
  into those same stores, so Home, rounds, letters, payments and Mi caso agree
  and each shows "Ejemplo". With a database, `GET /api/case` reads the
  client's own rows (`src/lib/case/server.ts`, RLS; tested in
  `db/clientExperience.test.ts`). Documents' "checked" date arrives with the
  document check (`src/lib/intake/`); until then only "received" shows.

### Accessibility

- **Letra grande** (Más → Letra grande): per device (`bonalti.textSize`),
  applied before the first paint by a script in the root layout, scales the
  client app and onboarding by 1.2 with CSS zoom (`.client-scale`), so text
  and tap targets grow together and layouts stay intact. Every client screen
  was checked at 390 px in large text: no horizontal overflow.
- **Escuchar** everywhere it matters (see `docs/VOICE.md`): status sentence,
  Mi caso, each item explanation, each letter summary, lessons, results.
  `src/lib/voice/` is a pluggable adapter interface; today the phone's own
  voice.
- Checks run with Playwright on 18 client screens × ES/EN × normal/large ×
  fresh/example (144 states): images have alt, buttons and links have
  accessible names, fields have labels, html `lang` matches the language,
  exactly one visible h1, no horizontal overflow, controls at least 24 px,
  and focus is visible on the first controls reached by Tab. Fixes: a 3 px
  navy `:focus-visible` ring on every control (globals.css); the onboarding
  step dots (an image with a label) became a visible "Paso 1 de 4 · Tus datos
  · 1 minuto"; the "Quitar" payment-method link and the lesson source links
  got 44 px tap areas; the bottom bar's inactive labels moved from slate-400
  to slate-500; read-aloud buttons say what they read ("Escuchar: qué está
  pasando") and expose aria-pressed; the status dialog is a native `<dialog>`
  (focus moves in, Escape closes, focus returns). Text contrast stays covered
  by `tokens.test.ts` (gold labels on navy are marked `data-on-navy`).

### Plain language

`src/lib/ux/plainLanguage.ts` + `plainLanguage.test.ts`: no sentence over 25
words in the client copy (dictionaries, marketing/onboarding, journey,
explainers, billing, item display, chat lines, rounds, pulse, lessons), in
both languages. The agreement's legal documents are attorney text and exempt.
The first run found 12 long sentences (6 Spanish, 6 English); all were split.
"FCRA" now always comes with "la ley de reportes de crédito".

### Aprende

Ten lessons and two tools; see `docs/LEARN.md`.

### Satisfaction pulse ("¿Cómo vamos?")

After the agreement is signed, the first round is mailed and the first answer
comes in, Home asks once: three faces (one tap saves) and an optional comment.
"Ahora no" closes it for good. Only the latest reached moment is asked.
Stored in `client_pulses` (migration 0018): written only by `POST /api/pulse`
after validation (no insert policy), read by the client (own) and by staff
through `staff_can_see_case` (admin all, specialist assigned, sales none);
no staff write; rows unchangeable except for one first comment.

**For the business dashboard** (owned by the staff console; not wired here):
read `client_pulses` through the member's own connection
(`select user_id, moment, rating, comment, created_at from client_pulses`,
filtered to the period), map rows with `pulseFromRow`, and show
`pulseSummary(rows)` from `src/lib/pulse/pulse.ts`: `average` (1–3, with its
written definition in the function's comment), `distribution`, `byMoment` and
`comments` (newest first).

### First-week speed

The first week is four steps with time estimates (`src/lib/ux/firstWeek.ts`),
shown on onboarding and on the agreement when the client comes from it:
"Paso 2 de 4 · Tu acuerdo · unos 5 minutos". Each milestone (invite opened,
details, disclosures, signature, monitoring, review started) is timestamped on
the device only (no tracking service). Reopening the invitation link after
signing goes straight to the first unfinished step.

Taps from the invitation link to the first review item (demo, 390 px,
measured with Playwright; documents counted as one tap per photo):

| | Before | After |
| --- | --- | --- |
| Welcome "Sí, empezar" | 1 | 1 |
| Disclosures: consent + "Lo recibí" | 2 | 2 |
| Contract: name field | 1 (+ typing the full name) | 0: prefilled from the account (or the link's full name), the client checks it |
| Contract: 3 consents + "Firmar" | 4 | 4 |
| Documents (ID, proof of address) | 2 | 2 |
| "Continuar" after signing, monitoring "Continuar" | 2 | 2 |
| **Total** | **12** | **11** |
| Coming back through the link later | welcome again + 1 tap | straight to the step left off |

The legal steps (separate disclosures, three consents, the signature button)
were kept as they are on purpose.

## Next (not yet implemented)

- Deletion celebration screen driven by the real diff engine once partner data
  flows (confetti on `items_deleted`).
- Accessibility: focus management in the review wizard after each answer.
- Real score-band goal track once monitoring data flows (mortgage-ready band
  from the partner API, never a promised score).
- Coach widget chrome i18n (answers already follow the user's language).
