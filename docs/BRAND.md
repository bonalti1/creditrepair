# Credalti brand in the product

The company is **Credalti**. The AI assistant is **Capi**, the capybara mascot
with the headset. Internal and spec name remains Bonalti Credit.

The product was called CreditCapi until November 2026. The name changed with
the move to full service: Credalti is now a company that does the work for its
clients, and Capi stays as the assistant clients talk to. The names live in
`src/lib/brand.ts`, and a test fails if the old name appears anywhere in `src/`.
The client screens and their copy still describe the do-it-yourself product;
rewriting them for full service is a later phase.

## Where the brand lives

| What | Where | How to change it |
| --- | --- | --- |
| Colours | `@theme` block in `src/app/globals.css` | `blue-*` is navy (accent, links, active states), `amber-*` is gold (primary actions, gauge), `slate-*` is neutral. Edit the values; no component changes needed. |
| Names | `src/lib/brand.ts` | Company name, the two halves of the wordmark, the assistant's name and the page titles. |
| Logo and gauge mark | `src/components/Logo.tsx` (`Logo`, `GaugeMark`) | Drawn in code: "Cred" + "alti" beside the gauge from the brand board. Replace with the final SVG when it exists; every screen imports from here. |
| Capi's face | `public/brand/capi.png`, rendered by `CapiAvatar` | A crop from the brand board, good up to about 96px. Replace with a transparent-background render for anything larger. |
| App icon | `src/app/icon.svg` | Navy tile with the gold gauge. |
| Typefaces | `src/app/layout.tsx` | System font (San Francisco on Apple devices, Inter elsewhere) for interface text; Nunito 800/900 via `font-display` for the wordmark and large headlines. |

## Rules

- **Primary actions are gold with navy text** (`bg-amber-400 text-blue-900`).
  Never white text on gold: it fails contrast.
- **Navy is for text, links and active states** on light backgrounds, and for
  the hero field on landing pages. On navy, "Cred" is white and "alti" stays gold.
- **The score ring is the logo's gauge**: yellow at the low end, orange at the high end.
- **Capi is always identified as artificial intelligence** wherever he speaks
  (chat header, first message, WhatsApp prefix).

## Copy from the brand board that must NOT ship

The board's mock website contains lines that break the product's legal
position. Visual identity is approved for use; these phrases are not:

- "Reparamos, disputamos y mejoramos tu perfil de crédito" — says we do the
  disputing. The customer disputes; Capi assists.
- "Mejora tu crédito hoy", "Aumenta tu puntaje", "Resultados reales" — outcome
  promises.
- The chip-card mock-up — implies we issue cards or lend money.

Approved pattern: "Tu crédito, en tus manos." / "Capi prepara todo. Tú decides
y tú apruebas." / "Los resultados varían."

## Ads

The same brand rules apply to video. The mascot's photoreal look, the caption
style and the end card are locked in `content/brand/lock.json`, and every ad
script must pass the claim gate before anything is generated. See
`content/README.md`.

## Open items

- **Trademark:** a quick web search found no existing "Credalti". That is not
  a clearance: counsel should run a proper trademark search before spend on
  signage or ads. (The earlier concern, two registered US marks for CREDITAPI,
  was about the old name.)
- **Brand board:** the board still shows the old wordmark. The gauge, colours
  and Capi are unchanged; the wordmark in the product is drawn in code.
- **Capi's voice:** not chosen yet; the video model invents one per render.
- **Final artwork:** logo as SVG, Capi as transparent PNG/SVG in a few poses
  (waving, thumbs up, celebrating) for empty states and celebrations.
