# UX Strategy — 10x more user-friendly than Dispute Beast

Dispute Beast wins on engine scope (secondary bureaus, escalation) but its UX
assumes a motivated, English-speaking, credit-literate user on a desktop. Our
user is Spanish-first, mobile-first, and often doing this for the first time.
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
| 9 | English-only | Spanish-first everywhere; letters mail in English with a note explaining why | all copy |

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

## Next (not yet implemented)

- English toggle (spec: Spanish default, EN toggle) — dictionary-based i18n
  across pages; copy is already centralized enough to extract.
- Deletion celebration screen driven by the real diff engine when Phase 1 data
  is wired (confetti on `items_deleted`).
- WhatsApp deep links back into the exact next step (journey engine keys map
  1:1 to notification kinds).
- Accessibility pass: focus management in the wizard, reduced-motion variants,
  larger type mode (many users are 45+).
- Real score-band goal track once monitoring data flows (mortgage-ready band
  from the partner API, never a promised score).
