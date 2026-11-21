# Credalti brand in the product

The company is **Credalti**. Two characters appear in the product: **BONALTI**,
the robot, is the AI assistant, and **Alti** is the face of the human team.
Internal and spec name remains Bonalti Credit.

The product was called CreditCapi until November 2026. The name changed with
the move to full service: Credalti is now a company that does the work for its
clients. The assistant was a capybara mascot until the brand kit of November
2026 replaced it with BONALTI. The names, the characters' roles and their image
files live in `src/lib/brand.ts`; a test fails if the old company name or the
old mascot's name appears anywhere in `src/`, or the old mascot in a file name
under `public/`.

## Characters

The owner's brand kit (part 3 of 3, "web-ready") brought two characters. Parts
1 and 2 (probably the logo, colours and guidelines) have **not arrived yet**:
until they do, the logo stays the one drawn in `src/components/Logo.tsx` and the
palette stays as it is (navy `blue-*`, gold `amber-*`), which already matches
the characters.

| Character | What he is | Role in the product |
| --- | --- | --- |
| **BONALTI** | A friendly robot: gold and cream shell, navy body, glowing amber face, a checkmark on his chest. | **The AI assistant.** He speaks in the chat, greets on WhatsApp and explains the report. A robot makes "this is AI" obvious, and every place he speaks still says so in words ("tu asistente con IA"). The kit writes his name in capitals; the owner may prefer "Bonalti". It is one value in `brand.ts`, and no copy, style or check depends on its casing. |
| **Alti** | A young man in a navy overshirt with the Credalti logo, a lanyard badge reading "ALTI" and a gold shoulder strap. | **The face of the human team.** He appears where the app talks about the team as a whole: the landing page and `/empezar`, the invited client's welcome ("Tu equipo Credalti"), "talk to a person", the "what happens next" screen after signing, and "your team is working" states. |

Where each one appears today:

- **Landing page:** both, side by side in the hero (Alti and BONALTI turned
  toward each other, with name tags). Below the buttons on a phone, beside the
  headline on a wide screen. BONALTI's head is also in the "Hola, soy…" pill.
- **`/empezar`:** both heads at the top; BONALTI beside step 2 (the assistant
  explains the report), Alti beside step 3 (the team prepares and mails).
- **Onboarding:** Alti on the invited welcome; on "how do you want to do your
  review", BONALTI on the assistant option and Alti on the person option.
- **Chat (`/asistente`):** BONALTI in the header and beside the assistant's
  messages; Alti on the "Persona" button.
- **Más → Hablar con una persona,** the agreement's "talk to a person" button,
  step 3 of "Qué sigue" after signing, "Tu equipo está importando tu reporte"
  and the empty "rounds" screen: Alti. The empty "letters" screens, which send
  the client back to the review: BONALTI.
- **Staff console:** BONALTI's head beside each "BONALTI (IA)" message. Alti
  does not appear in the console.

Rules for the characters:

- **The art is locked.** Never edit, redraw, recolour, re-crop or regenerate
  either character. The files in `public/brand/characters/` are the kit's own
  WebP files, copied unchanged: four views per character (`front`,
  `three_quarter`, `head_front`, `head_three_quarter`), each at @1x and @2x,
  served with `srcSet` so retina screens get @2x. The round avatars show the
  kit's head crops inside a circle; nothing is cropped into new files. The
  kit's `side`, `back` and `head_side`/`head_back` views are not used yet.
- **Surfaces:** navy or ivory/white. On very dark or saturated backgrounds a
  light 1–2 px rim from the original studio backdrop may show on hair edges;
  move the art to a navy or ivory surface instead of touching it.
- **Alti never speaks for a person.** A teammate's message in the chat is
  signed with that teammate's own name and "del equipo" (`TeamMessage`), and in
  the console with their name. Alti is never shown as the author of a message,
  never stands in for a particular teammate, and is never presented as AI.
- **BONALTI is always identified as artificial intelligence** wherever he
  speaks (chat header, first message, WhatsApp prefix, the coach's
  instructions).

## What the brand says it does

Full service, in one sentence: **"Tú nos dices qué está mal en tu reporte;
nuestro equipo prepara y envía las cartas por ti y te mantiene al tanto."**
Everything a client or a prospect reads is written around it: the landing
page, `/empezar`, onboarding, the app, BONALTI and the WhatsApp messages.

Three things hold in every line of copy:

- **Process, never outcome.** We say what we do (prepare and mail letters,
  keep the client posted). We never say or imply what will happen to a report
  or a score. The bureaus decide, and results vary.
- **The client decides what is inaccurate.** No copy suggests that the team
  picks what to dispute, or that everything negative gets disputed.
- **No price in the copy.** The service has a monthly fee, separate from the
  monitoring subscription the client pays to the monitoring provider. Amounts
  are not written anywhere; "nuestro equipo te explica el plan".

`src/lib/compliance/guardrails.ts` enforces the first two, and the tests run
every marketing line through it in Spanish and English. How the service is
delivered is a switch, `NEXT_PUBLIC_SERVICE_MODE` (`src/lib/service/mode.ts`):
unset means full service; `self_serve` brings back the earlier
do-it-yourself wording and its approve button, kept for later.

## Where the brand lives

| What | Where | How to change it |
| --- | --- | --- |
| Colours | `@theme` block in `src/app/globals.css` | `blue-*` is navy (accent, links, active states), `amber-*` is gold (primary actions, gauge), `slate-*` is neutral. Edit the values; no component changes needed. |
| Names and characters | `src/lib/brand.ts` | Company name, the two halves of the wordmark, the page titles, and the two characters: `assistant` / `assistantImages` (BONALTI) and `teamMascot` / `teamMascotImages` (Alti), with their image descriptions. Swapping the roles, or renaming either, is a change to this file only. |
| Logo and gauge mark | `src/components/Logo.tsx` (`Logo`, `GaugeMark`) | Drawn in code: "Cred" + "alti" beside the gauge from the brand board. Replace with the final SVG when it exists; every screen imports from here. |
| Characters | `public/brand/characters/*.webp`, drawn by `CharacterAvatar` (round head) and `CharacterFigure` (standing) in `src/components/Character.tsx` | Locked art from the brand kit; see "Characters" above. A test checks every path in `brand.ts` exists. |
| App icon | `src/app/icon.svg` | Navy tile with the gold gauge. |
| Typefaces | `src/app/layout.tsx` | System font (San Francisco on Apple devices, Inter elsewhere) for interface text; Nunito 800/900 via `font-display` for the wordmark and large headlines. |

## Rules

- **Primary actions are gold with navy text** (`bg-amber-400 text-blue-900`).
  Never white text on gold: it fails contrast.
- **Navy is for text, links and active states** on light backgrounds, and for
  the hero field on landing pages. On navy, "Cred" is white and "alti" stays gold.
- **The score ring is the logo's gauge**: yellow at the low end, orange at the high end.
- **The assistant is always identified as artificial intelligence** wherever
  he speaks (chat header, first message, WhatsApp prefix).

## Copy from the brand board that must NOT ship

The board's mock website contains lines that break the product's legal
position. Visual identity is approved for use; these phrases are not:

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
remade** with BONALTI and Alti before they run again. `lock.json` marks the old
character and its reference stills as retired and records the new characters'
files; the ad pipeline itself, the spot scripts and the hooks still describe
the old mascot and were left as they are (nothing was regenerated). New spots
need a new character block, written from the locked art, before any
generation.

The end card's legal line and the ad text around the video were reworded for
full service ("Tú decides qué es inexacto. Nuestro equipo prepara y envía las
cartas."). A video assembled before that change still carries the old end
card and has to be assembled again before it runs.

## Open items

- **Trademark:** a quick web search found no existing "Credalti". That is not
  a clearance: counsel should run a proper trademark search before spend on
  signage or ads. (The earlier concern, two registered US marks for CREDITAPI,
  was about the old name.)
- **Brand kit parts 1 and 2:** not received. Expected to hold the logo,
  colours and guidelines. Until then the wordmark is drawn in code and the
  palette is unchanged. If they define a different name casing for the robot,
  change `assistant` in `src/lib/brand.ts`.
- **Brand board:** the board still shows the old wordmark. The gauge and
  colours are unchanged; the wordmark in the product is drawn in code.
- **BONALTI's voice:** not chosen yet, for video.
- **Ads:** every existing video shows the old mascot and must be remade.
- **More poses:** the kit has four views per character (front, three-quarter,
  side, back). Poses such as waving or celebrating, for celebrations, would
  have to come from the owner as new locked art.
