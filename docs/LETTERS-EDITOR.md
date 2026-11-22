# The letter editor: changing a letter, and the attorney's approval

The 42 dispute letters live in code (`src/lib/letters/`). The editor at
`/equipo/cartas` lets an administrator change a letter's wording without a
developer, and makes sure only text an attorney approved is ever mailed to a
real client. It follows the same idea as the service agreement
(`docs/AGREEMENT.md`): an approval is an approval of one exact text, and any
change needs a new approval.

*This file is not legal advice.*

## Who can do what

| Who | What |
| --- | --- |
| Administrator (`letters.edit`) | Opens `/equipo/cartas`, edits letters, sends them to the attorney, records the attorney's decision. |
| Specialist | Cannot open the editor. Reads the approved versions only, so the letters they preview and print in the console are the ones that are mailed (`GET /api/staff/letters/approved`). |
| Sales, clients | Nothing. |

The capability `letters.edit` (administrator only) is in
`src/lib/staff/permissions.ts`. Every route checks it on the server
(`requireCapability`), whatever the screen showed.

## How to change a letter

1. Open **Cartas** (`/equipo/cartas`). Letters are grouped like the library
   (category, then recipient). Each row says which version is in use
   ("Aprobada · v2", or "Sin aprobar · v1 incluida") and any draft or version
   with the attorney. "se usa en las rondas" marks the ten letters the round
   engine uses today.
2. Open a letter. On the left, the text; on the right, **Vista previa** (the
   letter exactly as it prints, for a fictional client, in the one plain print
   font) and **Cambios** (your text against the version in use, word by word).
3. Edit the "Re:" line and the body. The parts filled in for each client are
   **chips** that cannot be typed into or split; remove one whole or insert it
   with the buttons under the text:

   | Chip | What it prints |
   | --- | --- |
   | `{partidas}` Lista de partidas | The items the client marked, one per line, each followed by the reason the client chose (not for goodwill, settlement, authorized-user and collector letters, which never print reasons). Must stay, alone in its paragraph, wherever version 1 has it. |
   | `{detalles}` Palabras del cliente | The client's own words. The paragraph that holds it is printed only when the client wrote something. Must stay wherever version 1 has it. |
   | `{sin_detalles}` Solo si no escribió nada | Marks a paragraph printed only when the client wrote nothing (two letters have such a fallback). |
   | `{frase_adjuntos}` Frase de adjuntos | "I have enclosed the documents listed at the end of this letter.", only when something is enclosed. |
   | `{nombre}` Nombre del cliente | The client's full name. Optional. |
   | `{destinatario}` Destinatario | The bureau's or company's name. Optional. |

   The header (client's name and address, the date, the recipient),
   "To Whom It May Concern:" and the signature with the enclosure list are
   added to every letter automatically and are not part of the text. A blank
   line separates paragraphs.
4. **Guardar borrador** saves a draft (version 2, 3, …). Nothing is mailed
   from a draft. You can keep changing it or throw it away.
5. **Enviar al abogado** freezes the draft and opens the **attorney's packet**
   (`/equipo/cartas/paquete`), in English: each letter's purpose, recipient,
   required client facts and statutes, every change against the text in use
   (added words underlined, removed words struck through), the full letter for
   the fictional client, the text's SHA-256 fingerprint, and the decision line.
   Use "Imprimir o guardar PDF" and send it to the attorney.
   To have the attorney approve the library as it is, use **"Enviar al abogado
   las N sin revisar"** on the list: it sends every unreviewed letter's
   version 1 unchanged.
6. When the attorney answers, open the letter and press **Registrar la
   decisión del abogado** on that version: approved or not, the attorney's
   name, the date of their decision, a note (required when they asked for
   changes), and the box confirming that this is the attorney's decision on
   this exact text, not yours. **Marcar aprobada** makes it the version that is
   mailed from that moment.

## What the editor checks

On every keystroke in the browser, and again on the server when a draft is
saved (`src/lib/letters/versions/validate.ts`). Errors stop the save:

- every chip version 1 has (`{partidas}`, `{detalles}`, `{sin_detalles}`) is
  still there: what the client declared stays in the letter; `{partidas}` and
  `{detalles}` once each, `{partidas}` alone in its paragraph;
- no unknown chips (`{cuenta}`), no stray `{` or `}`, no chip a letter does not
  take (for example `{detalles}` in a letter that has no place for the client's
  words), no chips in the "Re:" line;
- `checkClaimGuardrails` (`src/lib/compliance/guardrails.ts`): no promise or
  implication of results ("we will remove", "guaranteed deletion", …);
- the letter is the client's: it does not name Credalti or AltiBot, or say
  "on behalf of"; it is in the first person and in English (no accents, ñ,
  ¿ ¡);
- no hand-written "To Whom It May Concern", "Re:" or "Sincerely" (they are
  added automatically), and no line starting with "- " (it would be mistaken
  for an item line);
- the "Re:" line is present, one line, at most 200 characters; the body at
  most 20,000 characters.

Warnings ("Para el abogado") do not stop the save: a legal citation that
version 1 had was removed, or the free text says something is enclosed outside
the enclosure chip.

## The versions

| Version | Status | Can change? |
| --- | --- | --- |
| 1 "incluida" | The text in code. It gets a database row only when it is sent to the attorney. | Only by a developer, in code. |
| 2, 3, … | Borrador (draft) → Con el abogado (sent) → Aprobada / Rechazada | A draft can be rewritten or discarded. From "sent" on, the text never changes and the row cannot be deleted; a decision is recorded once and never changes. A change is a new version. |

Stored in `letter_template_versions` (migration
`supabase/migrations/0019_letter_versions.sql`): letter key, version number,
origin, locale (`en`: letters mail in English), "Re:" line, body, the chips
used, the version it was edited from, author, created/updated, sent at/by,
status, `approved_by` (the attorney's name, as text: the attorney is not a
user), `approved_at` (the day), `approval_note`, the same three for a
rejection, who recorded the decision and when, and `content_hash` (SHA-256 of
the key, locale, "Re:" line and body). Only the server writes, with the
service role, after `requireCapability("letters.edit")`; there is no insert,
update or delete policy. A trigger freezes a sent version's text and the
decision, even for the server. One open draft per letter (unique index).
Administrators read every version; specialists read approved ones.

## What gets mailed

`src/lib/letters/versions/versions.ts` → `resolveLetter(key, versions)`:

- the **newest approved** version whose text matches its fingerprint is
  mailed: an edited version is rendered from its stored text
  (`renderSource`); an approved version 1 by the template in code (the editor's
  text for version 1 is read back from the template and a test checks, for
  all 42 letters, that both render the same letter character for character);
- an approval of **version 1 counts only while the template in code is the
  text the attorney approved** (same fingerprint). If a developer changes a
  template, its version 1 is no longer approved and needs a new approval;
- drafts, versions with the attorney and rejected versions are never mailed;
- with no approved version the letter is version 1, **unapproved**.

`src/lib/rounds/send.ts` (the one place letters leave from: the team's send,
the print batch's "marcar como enviado", the autopilot, the client's self-serve
approval) renders each letter with the resolved version and stores
`letters.template_version` and `letters.template_hash` with it. The console's
previews and the printed pages (`/equipo/imprimir`, the client page) use the
same approved versions (`staffLetterText`), so what is printed is what the
server records.

## The readiness rule

Added to `sendRound` as step 6, after the existing gates (agreement, round,
monitoring, attestation, addresses), which are unchanged, and before anything
is created or mailed:

> With a database, a round is mailed or printed for a client only if **every
> template it uses has an attorney-approved version**. Otherwise it is refused
> (409, `code: "letters_not_approved"`) with the letters that are missing, and
> the send screen shows that reason. Nothing is written.

`LETTERS_ALLOW_UNAPPROVED=1` lets unapproved letters go (rendered from
version 1 and recorded as version 1). It is **only for testing with Lob's test
key** before the attorney has answered. Do not set it with real clients:
`GET /api/health` reports "Letters approved by the attorney" as failing while
it is set, and the editor shows a red warning. Without the variable, health
lists any of the ten round letters not yet approved.

The demo (no database) has no sending; there the editor keeps its versions in
the browser only, under a "Demo" banner, and "Reiniciar la demo" clears them.

## No disguise

Font rotation and AI rewording stay off by default (`src/lib/letters/fonts.ts`,
`src/lib/letters/variation.ts`; `LETTER_FONT_ROTATION`, `LETTER_AI_REWORDING`).
The editor does not touch either: its preview uses the one default print font,
and a test checks that no editor file refers to the rotation or the rewording.

## Files

| File | What |
| --- | --- |
| `src/lib/letters/versions/source.ts` | The text format, the chips, version 1 read from code, `renderSource` |
| `src/lib/letters/versions/validate.ts` | The checks |
| `src/lib/letters/versions/versions.ts` | Versions, fingerprints, `resolveLetter`, `lettersMayBeMailed`, the draft/send/decision rules |
| `src/lib/letters/versions/server.ts` | Database reads and writes, the route's body schema |
| `src/lib/letters/versions/data.ts`, `useLetterVersions.ts` | The screens' data: demo (browser) or `/api/staff/letters` |
| `src/lib/letters/versions/diff.ts`, `packet.ts` | The comparison and the attorney's packet (built on `src/lib/letters/packet.ts`) |
| `src/app/equipo/cartas/`, `src/components/staff/letters/` | The screens |
| `src/app/api/staff/letters/route.ts`, `approved/route.ts` | The routes |
| `src/lib/__tests__/letterVersions.test.ts`, `src/lib/__tests__/db/letterVersions.test.ts` | Tests (rules; and the real migration in PGlite) |

## Not done

- The "Cartas" entry in the console's navigation is added with the staff
  navigation work; until then the editor is reached at `/equipo/cartas`.
- A mailed letter's page in the console is re-rendered with the version in use
  today; the exact text mailed is in `letters.body`, with its version and
  fingerprint.
- The client app's own letter preview (`/attack`, self-serve) still renders
  version 1.
- The catalogue's metadata (titles, when to use, required facts) is not
  editable; only the letter text is.
