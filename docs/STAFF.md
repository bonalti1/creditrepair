# One person, one day: the staff console

Credalti is built so that **one employee, possibly new and lightly trained,
runs fulfillment for 100+ clients from a laptop or a phone**. The system does
the routine work (reminders, status messages, preparing rounds, mailing the
rounds that pass every gate once the owner turns that on; `docs/AUTOPILOT.md`).
The person does only what needs a human, from one list, with the steps for
each thing written next to it.

This page is the day, start to finish, and the pieces that make it short:
AltiBot's drafted replies, saved answers, the «Cómo se resuelve» cards, the
morning summary, the new-hire checklist and the phone layout. The console is in
English unless the member chooses Spanish (see «Language» below); the screen
names quoted here are the Spanish ones.

## The day

Times are estimates for about 100 active clients, from the minutes per notice
in `MINUTES_BY_KIND` (`src/lib/autopilot/queue.ts`) and the demo's mix of
notices. They are not measured yet: the business dashboard's «Minutos de
trabajo humano por cliente activo» is where real numbers will show.

| When | What | About |
| --- | --- | --- |
| 8:30 | **Morning summary** arrives (WhatsApp or email): "Hoy: 9 cosas · ~73 minutos", the first three, what the system did overnight, a link to «Siguiente» | 1 min to read |
| 8:35 | Open the link: **focus mode** (`/equipo?siguiente=1`). One item at a time, overdue first. Each shows why it needs a person, what the system already tried, the one button, and its **«Cómo se resuelve»** card with «Hecho cuando…» | — |
| | Questions from clients (≈5 min each): the conversation opens with the **saved answer** that matches, or **AltiBot's draft**. Read, edit if needed, **«Enviar así»**. If it will help the next client, **«Guardar como respuesta»** | 2–5 min each |
| | Calls after three automatic reminders (unsigned agreement, missing documents, stalled review, monitoring): the card says what to ask and what not to say | 5–6 min each |
| | Money (payment past due, missing method): only after the client got every notice with the «Actualizar mi tarjeta» link and did not use it. The card shows the exact words they got. Call; never collect by hand, never ask for a card number | 5–8 min each, about 1 a day |
| | A company's missing dispute address: **one item per company**, listing every client waiting on it, with the address the reports print as an unverified suggestion. Check it against a source, save it once in «Acreedores», and every waiting round can go | 8 min per company (not per client) |
| | Returned letters, addresses the client did not confirm, documents the client did not re-upload: only what the system could not settle (see «Lo que se arregla solo» in `docs/AUTOPILOT.md`) | 4–10 min each, rare |
| ~9:45 | **Listas para enviar**: review the prepared rounds and send them (or let automatic sending do it after its review window) | 5–10 min |
| Afternoon | New questions as they come in; the home screen and the morning summary say what is new. Everything else moves by itself | 15–30 min |

A typical day for 100 clients: **about 1¼ to 1¾ hours of a person's work**
(it was 1½ to 2 before the system began fixing addresses, returned letters,
payments and documents by itself), the rest of the day free for calls, new
clients or a second job role. As the saved-answer library grows, AltiBot
answers more questions by itself and the question time falls.

What changed, estimated for 100 clients (not measured):

| Notice | Before | Now |
| --- | --- | --- |
| Missing creditor address | 8 min × every client waiting (often 2–4 a week) | 8 min once per company; candidates from the reports |
| Returned letter | 10 min each | the system re-mails once when the post office's data corrects the address; a person sees only the rest |
| Payment past due / missing method | 5–8 min each, a message written by hand | the client fixes it from the link; the person's card shows what was sent |
| Document the AI could not accept | 4 min each | the client gets the plain reason and an upload button; a person only after a second failure or no answer |
| Client address the post office cannot confirm | new: caught before mailing, instead of a returned letter weeks later | the client confirms with one tap |

The home screen says how much: **«Esta semana el sistema resolvió N cosas
por su cuenta»**, with the count of each kind under «Resuelto solo»
(`autopilot_resolutions`, migration 0022).

## AltiBot's drafted replies

`src/lib/staff/drafts.ts`, `src/lib/staff/draftModel.ts`, `POST /api/staff/drafts`,
shown by `src/components/staff/ReplyAssist.tsx` inside the conversation.

When a question is waiting (one AltiBot passed to the team, or the client's
last message), the reply box opens with **"Borrador de AltiBot — revísalo antes
de enviar"**: an answer in the client's language, written from:

- the question and the recent conversation (SSN-like numbers redacted, as for
  AI intake);
- the case facts **the teammate's role may see**: stage and next step,
  agreement dates and the cancellation window, documents on file, review
  progress (counts only), rounds and each letter's mail status, and billing
  standing in words (only with `billing.view`, never an amount). Never the
  report's personal information, account numbers, the phone, the address or
  an SSN. Sales gets no draft at all (no `case.view`, no `clients.reply`);
- Credalti's service facts and voice, and the rules: no promises, no price,
  the client decides what is inaccurate (asked what to mark, the draft
  explains what to check and that the decision is theirs);
- the closest approved saved answer, as the base.

**How a draft is checked.** Before anyone sees it, on the server:
`checkStaffReply` (the same claim rules every staff reply passes) plus
`draftProblems`: no advice on what to mark, no amount, nothing SSN-like. A
draft that fails is written again **once**, with the reasons; a second failure
gives **no draft**, and the screen says why. «Enviar así» sends it through the
one send path (`data.sendReply` → `/api/staff/case`), which checks again.

The model is Claude Opus 5.5 (`DRAFT_MODEL` overrides it), with structured
output, `effort: "low"`, the fixed instructions cached, and the API's refusal
fallback. Each question is drafted once per browser tab.

**Without `ANTHROPIC_API_KEY`:** no draft, no call, and the note "No hay
borrador: el servidor no tiene la clave de Claude (ANTHROPIC_API_KEY)". Saved
answers still work.

Tests: `src/lib/__tests__/staffAssist.test.ts` (what is included and excluded
per role, the retry, the no-key path, all with a mocked model) and
`src/lib/__tests__/db/staffAssist.test.ts` (a draft over a case read through
the specialist's own connection).

## Saved answers, and what AltiBot answers by itself

`src/lib/staff/answers.ts`, `/equipo/respuestas`, `POST /api/staff/answers`,
migration `0020_staff_assist.sql` (`saved_answers`, `saved_answer_events`).

- After a reply goes out, **«Guardar como respuesta»** offers it to the
  library (the client's name in the greeting removed). An administrator's goes
  in **approved**; a specialist's goes in as a **proposal**. Only an
  administrator approves, edits an approved answer or deletes; a specialist may
  edit or withdraw their own proposal. Sales cannot.
- Nothing of one client may be in it: no name, amount, long number, phone or
  email, and the staff reply rules (`answerProblems`).
- Every save, edit, approval and deletion is recorded with the words
  (`saved_answer_events`, append-only, read by administrators).
- The console suggests the closest **approved** answer first: in the
  conversation, and in the queue on each waiting question.

**AltiBot (the client's chat, `/api/coach`) answers by itself** when an
approved answer matches the new question closely: the words the two questions
share must be at least 60% of all the words of both, and at least two
(`libraryReplyFor`; "¿Las cartas salen por correo certificado?" does not match
"¿Cuándo salen mis cartas?"). Before it is sent, the claim rules are checked
**again** on the exact words; an answer approved before a rule existed is not
sent. The reply says it is the team's approved answer. This works with or
without a model key. **Anything else goes on exactly as before**: to the
model, and to a person when the model cannot answer. A proposal is never
sent to a client.

Similarity is plain word overlap (accents, plurals and small words removed),
no embeddings: a match is explainable by the shared words, which the screen
shows.

## «Cómo se resuelve» cards

`src/lib/staff/playbook.ts`. One card per kind of notice (all 15), 3–5 steps
in plain Spanish and a «Hecho cuando…» line, written from what the app does
for that notice (the rule in `stage.ts` or `intake/exceptions.ts`, the button,
what the autopilot already tried). Folded under each item in the queue, open in
focus mode and in the help panel. A test fails if a kind has no card.

**«¿Qué hago aquí?»** in the top bar of every staff screen opens the help for
that screen (`SCREEN_HELP`) with the cards that matter there.

## Navigation and the phone

`src/components/staff/StaffShell.tsx`.

- **768 px and wider:** one compact top bar: Inicio, Clientes, Respuestas, and
  «Más» (Invitar, Acreedores, Actividad, Piloto automático, Negocio, Socios,
  Equipo, Cartas, Mi perfil, Bienvenida, each only for the roles that may open
  it), then «¿Qué hago aquí?» and the member's initial. One line from 768 to
  any desktop width (checked at 1024, 1280 and 1440).
- **Phone:** logo, help and initial on top; a bottom tab bar like the client
  app's (Inicio, Clientes, Respuestas, Más); «Más» opens a sheet.
- The demo's «Ver como» bar scrolls away with the page.
- At 390 px every staff screen checked (home, focus mode, client page,
  conversation, send screen, import preview, clients, saved answers, profile,
  dashboard, welcome) has no sideways scroll, and every control is at least
  44 px tall on a phone, except links and buttons inside a sentence (WCAG
  2.5.8's inline exception).
- «Cartas» (`/equipo/cartas`, the letter template editor) is behind the
  capability `letters.edit`, administrators only.
- **Search** (`src/lib/staff/search.ts`, `components/staff/GlobalSearch.tsx`):
  the box in the top bar, Ctrl+K / Cmd+K anywhere, and «Buscar» at the top of
  the phone's «Más» sheet. Pages, clients by name or phone (only the ones the
  member's role may see: the same list, and with a database the same row level
  security, as the clients screen), partners, letter templates and actions
  ("send rounds", "import report", "import rosa" for that client's importer).
  Both languages match; ↑ ↓ and Enter move and go, Esc closes. The
  destinations come from `src/lib/staff/nav.ts`, shared with the bars.
- **The client page has two tabs**: «Caso» and «Reportes» (every report in
  the file, with what it changed, and Open / Print / Download; see
  `src/lib/reports/history.ts`). `?pestana=reportes` opens the second.

## The morning summary

`src/lib/staff/digest.ts` (the words and when), `src/lib/staff/digestServer.ts`
(the run), `POST /api/cron/staff-digest` (shared secret, every 15 minutes:
`docs/n8n.md` Workflow 5), `staff_preferences` and `staff_digests` (migration
0020).

- **Off until the member turns it on** on their profile (`/equipo/perfil`):
  channel (WhatsApp or email), time (8:30 a.m. by default), their clock (Texas
  by default). The profile shows a preview of the message as it would go now.
- Says: "Hoy: N cosas · ~M minutos", the first three items (client first name
  and last initial only), what the system did in the last 24 hours (messages
  sent, rounds mailed by the system), and the link to «Siguiente».
- **Once per member per local day**: the day's row is claimed before sending
  (unique key); a second run sends nothing. After their time, never in quiet
  hours (the autopilot's, 9 p.m.–8 a.m.).
- Channels are the autopilot's: WhatsApp inside 24 hours as text, outside only
  as the approved template **`credalti_resumen_equipo`** (Utility, es_MX):
  "Buenos días, {{1}}. Hoy: {{2}} cosas · ~{{3}} minutos. Lo primero: {{4}}.
  En las últimas 24 horas el sistema {{5}}. Empieza aquí: {{6}}". Otherwise
  email, with the company's postal address and a link to the profile to turn
  it off. **Never SMS** (the database refuses it).
- Each member's clients are the ones their role sees (`canSeeClient`, the
  same scopes as the database policies): a specialist's summary counts only
  their assigned clients.

## New-hire mode

- **First-day checklist** on the home screen (`NewHireChecklist`), under the
  day's work: the screens, a 5-minute tour of an example client, the rules,
  one «Cómo se resuelve» card, the morning summary. Shown until the member
  closes it (`staff_preferences.checklist_dismissed_at`); «Volver a mostrar la
  lista» on the profile.
- **Bienvenida** (`/equipo/bienvenida`): what each screen does, the rules
  (no promises; never tell a client what to mark; no phone sales; no card
  numbers or documents by WhatsApp; ask an administrator when unsure), every
  card, and the **tour**: five steps with a guide bar (`?recorrido=N`) that
  follows a client with a waiting question (in the demo, an invented one).

## The pulse on the dashboard

`/equipo/negocio` now has «Cómo se sienten los clientes»: the average of
«¿Cómo vamos?» in the period (with its written definition, like every number),
how many of each face, by moment, and the recent comments with the client's
name. Read through the member's own connection under the 0018 policy:
administrators see everyone's; a specialist sees their assigned clients' (also
on each client page); sales sees none. Nobody on the team can change an answer.

## Language

English first, Spanish when the member wants it. Two languages, two rules:

**The console speaks the member's language.** Each member chooses English or
Spanish on «My profile» (`/equipo/perfil`, «Console language») or from the
menu under their initial. The choice is theirs alone: `staff_preferences.locale`
(migration `0025_staff_locale.sql`; written by the preferences route like the
rest of the row), or this browser in the demo, per member of the demo team.
Until they choose: their browser's language if it is Spanish
(`Accept-Language` on the server for the first paint, `navigator.languages`
after), otherwise English. The layout works it out on the server, so the first
render is already in the right language (`src/lib/staff/i18n/`).

Everything a teammate reads follows it: navigation, every `/equipo` screen,
stages, notices and their buttons, next steps, the client's timeline and the
activity feed, the work queue and what autopilot tried, metric labels and
definitions, permission labels and denials, «How to handle it» cards, the
new-hire checklist and tour, saved answers, partners, autopilot settings, the
send and print screens, the address book, the letter editor's screen (the
letters stay English legal text), the report import preview, the AI intake
checks, and the morning summary (sent in the member's saved language, English
if they never chose). Messages that come back from a check or a route are
written once in Spanish where the rule lives and shown through
`staffMessage` (`i18n/messages.ts`). What a client or a teammate typed (a
question, a note, a refund reason) is quoted as typed.

**What goes to a client is in the CLIENT's language**, whatever the member's:
`clientLanguage(client)` (`profiles.locale`; a client with none is written to
in English). That covers the drafted WhatsApp messages (`staff/messages.ts`),
AltiBot's drafted replies (`drafts.ts`: the model is told to write in the
client's language), saved answers (each has a language, `saved_answers.language`;
only answers in the client's language are suggested or sent by AltiBot), the
automatic reminders and the invite (the panel «Add client» and `/equipo/invitar`
both ask for the client's language). Wherever a teammate writes to a client the
console shows «Client's language: Spanish» (`ClientLanguageTag`).

Replies are checked in both languages before they go (`checkStaffReply`: the
claim rules plus plain one-to-one promises such as "it will be deleted" or
"you'll be approved"); the reason a reply is held back is in the member's
language.

Code: text tables are `{ en, es }` with the same keys (`defineText`); inline
screen text is `t("Spanish", "English")` from `useTx()`; sentence builders in
`src/lib/staff/` take a `locale`. `src/lib/__tests__/staffLanguage.test.ts`
walks every table in both languages and fails on a missing language or on
Spanish words left in the English.

## What is not done

- Nothing here has been tried with real clients or a live Claude key; the
  drafts were checked with a mocked model and the screenshots use a mocked
  draft.
- The template `credalti_resumen_equipo` must be approved in Meta before the
  summary goes by WhatsApp outside the 24-hour window.
- In the demo, saved answers added in the browser are not seen by the
  demo's AltiBot (the server uses the invented library).
- The minutes per notice are estimates until real handled times exist.
- The checklist's ticks are kept per browser (its dismissal is per member).
- Still Spanish in an English console: the invented demo data (names,
  notes, conversations, refund reasons), the reasons the AI intake gives
  when it reads a bureau letter (quoted as written), and the field labels of
  the client-language picker on `/equipo/invitar` (owned by the client-side
  work).
