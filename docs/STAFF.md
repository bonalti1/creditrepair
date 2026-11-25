# One person, one day: the staff console

Credalti is built so that **one employee, possibly new and lightly trained,
runs fulfillment for 100+ clients from a laptop or a phone**. The system does
the routine work (reminders, status messages, preparing rounds, mailing the
rounds that pass every gate once the owner turns that on; `docs/AUTOPILOT.md`).
The person does only what needs a human, from one list, with the steps for
each thing written next to it.

This page is the day, start to finish, and the pieces that make it short:
Alti's drafted replies, saved answers, the «Cómo se resuelve» cards, the
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
| | Questions from clients (≈5 min each): the conversation opens with the **saved answer** that matches, or **Alti's draft**. Read, edit if needed, **«Enviar así»**. If it will help the next client, **«Guardar como respuesta»** | 2–5 min each |
| | Calls after three automatic reminders (unsigned agreement, missing documents, stalled review, monitoring): the card says what to ask and what not to say | 5–6 min each |
| | Money (payment past due, missing method): only after the client got every notice with the «Actualizar mi tarjeta» link and did not use it. The card shows the exact words they got. Call; never collect by hand, never ask for a card number | 5–8 min each, about 1 a day |
| | A company's missing dispute address: **one item per company**, listing every client waiting on it, with the address the reports print as an unverified suggestion. Check it against a source, save it once in «Acreedores», and every waiting round can go | 8 min per company (not per client) |
| | Returned letters, addresses the client did not confirm, documents the client did not re-upload: only what the system could not settle (see «Lo que se arregla solo» in `docs/AUTOPILOT.md`) | 4–10 min each, rare |
| ~9:45 | **Listas para enviar**: review the prepared rounds and send them (or let automatic sending do it after its review window) | 5–10 min |
| Afternoon | New questions as they come in; the home screen and the morning summary say what is new. Everything else moves by itself | 15–30 min |

A typical day for 100 clients: **about 1¼ to 1¾ hours of a person's work**
(it was 1½ to 2 before the system began fixing addresses, returned letters,
payments and documents by itself), the rest of the day free for calls, new
clients or a second job role. As the saved-answer library grows, Alti
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

## Credalti Control: Overview, Today, Leads, phone alerts

The owner's control center is in `docs/CONTROL.md`. In short:

- **Resumen / Overview** (`/equipo/control`), a tab next to Home (Home stays
  the specialist's day, above): on top, a strip of tiles for every department
  the member may open (Leads, Clients, Content, Accounting, Partners,
  Reviews); then one card per department (leads and sales, clients in
  progress, money, content, support, partners, tech health) with real
  numbers, "No data yet" and why when something cannot be read, and a "Needs
  you" count that opens the right screen. Money never shows to sales; for the
  owner it adds this month's net revenue, expenses and net profit from the
  books and links to Accounting. Content shows to the content team.
- **Hoy / Today**: this page's work queue plus waiting leads, the autopilot's
  hand-offs, partners' notes, Content (pieces to approve, changes asked of
  an editor, posts that failed) and, for the owner, the books (a month not
  closed after the 5th, receipts missing) and escalations, ranked in one
  list; each item with its steps and «Escalate to the owner».
- **Prospectos / Leads** (`/equipo/leads`): every prospect conversation
  (WhatsApp, HighLevel, partners, the chat signup, by hand) with ✨ Suggest
  reply (the drafted-reply engine below, pointed at a lead), saved answers,
  «Prepare invitation», notes, assignment, the pipeline (only people move it;
  Invited and Signed set themselves) and the lead quality numbers.
- **The lead autopilot**, off until an administrator turns it on, and **phone
  alerts**, off until each member turns them on (`/equipo/alertas`).

## Alti's drafted replies

`src/lib/staff/drafts.ts`, `src/lib/staff/draftModel.ts`, `POST /api/staff/drafts`,
shown by `src/components/staff/ReplyAssist.tsx` inside the conversation.

When a question is waiting (one Alti passed to the team, or the client's
last message), the reply box opens with **"Borrador de Alti — revísalo antes
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

## Saved answers, and what Alti answers by itself

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

**Alti (the client's chat, `/api/coach`) answers by itself** when an
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

**«Ask Alti»** in the top bar of every section (and Alti at the foot of the
side menu) opens Alti's panel; its first tab, «This screen», is the help for
that screen («¿Qué hago aquí?», `SCREEN_HELP`) with the cards that matter
there (see «The console's design system» below).

## Navigation and the phone

`src/components/staff/StaffShell.tsx`, the groups in `src/lib/staff/nav.ts`.
The console is laid out like **ALTO Control**, the owner's control center at
his other company, in Credalti's brand (the whole system is in «The console's
design system» below).

- **768 px and wider: a navy side menu** with the white logo, "Control" and
  ten **numbered groups** in the order the business works (`NAV_GROUPS`,
  ALTO's GROUPS): **0 Overview** (Resumen) · **1 My day** (Inicio, Actividad)
  · **2 Marketing** (Contenido, Estudio de video, Anuncios, SEO, Reseñas) · **3 Lead Manager** (Prospectos, Invitar) ·
  **4 Fulfillment & Clients** (Clientes, Respuestas, Piloto automático,
  Llamadas, Importar de CRC; the send and print screens belong here too) · **5 Payments &
  Accounting** (Contabilidad, Facturas, Planes, Monitoreo) · **6 Letters & Rules**
  (Cartas, Acreedores, Estados) · **7 Partners** (Socios, Ofertas) ·
  **8 Ideas & numbers** (Negocio, Ideas: `docs/IDEAS.md`) · **9 Team &
  Settings** (Listo para lanzar, for administrators: `docs/LAUNCH.md`;
  Equipo, Alertas al teléfono, Mi perfil, Bienvenida). A group shows only when the role may open
  one of its pages (the same `needs` as `PRIMARY_NAV` / `MORE_NAV`, which stay
  the list of destinations and their capabilities), and opens on the first of
  them; a group with two or more shows them as **sub-tabs** under the top bar.
  The menu folds to icons (folded by default below 1280 px and, like
  ALTO's, on Lead Manager; the member's choice is remembered in this browser). At its foot: **Alti** ("Alti · AI
  assistant", opens his panel) and the member (name, role; the menu opens the
  language switch, the profile and sign out).
- **The top bar** of every section: its name (Poppins capitals after ALTO's
  gold bar), **«✓ Clear»** when the section has a red circle, **search**
  (Ctrl/Cmd+K), the demo pill, and **«Ask Alti»**.
- **Red circles** (`src/lib/staff/navBadges.ts`): how many things need the
  member in a group, from the Overview's own «Needs you» counts, never a count
  of their own. The shell works out My day (the work queue), Leads (waiting +
  handed over), Fulfillment (client questions) and Money (payment notices) on
  any page (`BadgeProbe`: the same `overviewCards` on the same clients, queue
  and lead list, through the member's own connection); the Overview adds
  Content, the books and Partners when it opens; Marketing also counts the
  ads marked "Turn off" that are still spending (`ads.view`, its own source,
  added on top, `docs/ADS.md`), and the Video Studio's own count (videos
  waiting for approval, changes asked, approved videos to hand over) is added
  to it on any page (`lib/video/badge.ts`). Unknown means no circle.
  «✓ Clear» (and «Clear all notifications») hides a circle for this member in
  this browser until its number goes up; it changes no record.
- **Phone:** the check, the section's short name, search and Alti's face on
  top; a **navy bottom bar** with four sections (the groups of the everyday
  destinations first: My day, Overview, Leads, Clients for an administrator)
  and «More», each with its red circle (More shows a red dot when a section
  under it needs the member); **«More» opens a navy sheet** with every
  section, its number, its one-line purpose or, in red, what needs the member
  there, plus search, «Clear all notifications», and the member (language,
  profile, sign out). An open lead conversation takes the whole phone screen.
- The demo's «Ver como» bar scrolls away with the page.
- At 390 px every staff screen checked has no sideways scroll, and every
  control is at least 44 px tall on a phone, except links and buttons inside
  a sentence (WCAG 2.5.8's inline exception).
- «Cartas» (`/equipo/cartas`, the letter template editor) is behind the
  capability `letters.edit`, administrators only.
- **Search** (`src/lib/staff/search.ts`, `components/staff/GlobalSearch.tsx`):
  the search button in the top bar (an icon on a phone), Ctrl+K / Cmd+K
  anywhere, and «Buscar» at the top of the phone's «Más» sheet. Pages, clients by name or phone (only the ones the
  member's role may see: the same list, and with a database the same row level
  security, as the clients screen), partners, letter templates and actions
  ("send rounds", "import report", "import rosa" for that client's importer).
  Both languages match; ↑ ↓ and Enter move and go, Esc closes. The
  destinations come from `src/lib/staff/nav.ts`, shared with the bars.
- **The client page has two tabs**: «Caso» and «Reportes» (every report in
  the file, with what it changed, and Open / Print / Download; see
  `src/lib/reports/history.ts`). `?pestana=reportes` opens the second.
- **The client page** opens with the journey strip (lead → finished), and
  carries the client's notification settings (read-only), their credit
  monitoring (record a check) and their documents (open, accept, or not
  accepted with the reason the client reads). How a client goes through
  Credalti, step by step: `docs/FULFILLMENT.md`.

## The console's design system

The owner asked for the console to look and feel like ALTO Control, with
Credalti's colours, logo, fonts and Alti. ALTO Control (Vite + React +
Tailwind + one CSS file, `tradetechpro/src/control/` in the ALTO repository)
was run locally with fake providers and screenshotted; what follows is its
system as Credalti uses it. Tokens and utilities: the console block at the end
of `src/app/globals.css` (scoped to `.console`, so the client app and the
website keep their own look); shared pieces: `src/components/staff/ui.tsx`.

**Layout.** One light world: the light background `#F5F6F8` (slate-50), white
cards, a **navy side menu** (brand navy `#12213A`, white logo, "Control" in
spaced Poppins capitals after a gold dash, "Operations center · team
console"), a white top bar with a hairline under it, and the page in a padded
column (16 px on a phone, 28 px from 768 px; no centred max width, like ALTO).
No dark mode: ALTO is light only, and so is the console (the navy menu is its
one dark surface).

**Navigation model.** Numbered groups (0–9) with a red circle each, sub-tabs
per group, a top bar with the section's name and its helper (see «Navigation
and the phone»).

**«Ask Alti» (ALTO's per-tab bot, TabBot).** `src/components/staff/AskAlti.tsx`,
rules in `src/lib/staff/altiHelp.ts`. ALTO's bot is a chat with its own
access; Credalti's helper never writes an answer of its own and sends
nothing. A panel on the right (a sheet from the bottom on a phone), headed by
Alti's face and **"Alti · AI assistant"** (`aiByline`), with three tabs:
**This screen** (the screen's help and its «How to handle it» cards: what
«¿Qué hago aquí?» showed), **What Alti does here** (the AI features that
already exist in this section and the role may use, each with where it lives
and who has the last word: drafted replies to clients, saved answers he sends
by himself, the lead drafts and the lead autopilot, the content writing
assistant; tagged "A draft · a person sends it", "Approved text only",
"Off until an administrator turns it on", "Words only"), and **Search the
playbook** (the team's written cards, screen help and house rules, found by
words; nothing generated, so `src/lib/compliance/guardrails.ts` and the
drafts' own checks stay the only path for AI words). Tested in
`consoleShell.test.ts`.

**Alti in the console.** At the foot of the side menu and in «Ask Alti»; on
the Overview, waving (`AltiWaveLoop`, a still for reduced motion) on the navy
band with "Alti · AI assistant" over his greeting; beside every lead message
he wrote and on his drafts (the byline on top); in empty states, with a pose
that fits (`EmptyState` in `ui.tsx`: thumbs up or celebrate when nothing is
waiting, thinking when a filter finds nothing, phone or envelope when a list
is still empty). In an empty state he is a picture beside words a person
wrote and does not speak. AltiBot never appears in the console
(`brand.test.ts`).

**Spacing and radii.** Cards 14 px corners; inner boxes, inputs and buttons
10–12 px; pills and chips fully round. Card padding 16–20 px; gaps 14–20 px
between cards; 6 px between pills.

**Shadows.** Cards: a 1 px navy line at 8 % plus `0 1px 2px` and
`0 6px 20px` at 5 % (ALTO's `--shadow`); navy bands a little deeper. Panels
and sheets: a large soft shadow and a navy shade behind.

**Cards.** White, the line and shadow above. A department card's title is
Poppins capitals with its section's number ("3 · LEADS & SALES") and an icon
tile; up to four numbers show as big figures in a two-column grid (Poppins
26 px), longer lists as rows with the figure on the right. The Overview and
Home open with a **navy band** (ALTO's KPI band): the day's work in gold, the
other figures in white on navy, each opening its screen.

**Tables.** Heads small (11.5 px), capitals, spaced, slate on a pale band;
rows separated by hairlines; figures tabular.

**Badges and pills.** **Red circle** (red-600, white figures, 22 px; a ring
pings on the side menu, still for reduced motion) = how many need you. **«Needs
you»** on a card: a white pill with the red circle and a chevron; **"✓ Clear"**
(green) when it is zero; "—" when it is not known. Status chips: a dot in the
chip's own colour before the word (ALTO's pill). Sub-tabs and filter chips: navy
filled when on, white with a line (gold on hover) when off (`pillTab`).

**Buttons.** One gold button per region (gold with navy text, `PRIMARY_BUTTON`),
the others white with a slate line that turns gold on hover; 10 px corners;
48 px tall for the main action, 44 px for the rest on a phone.

**Typography.** Poppins 600 for titles: the page title 24 px (22 on a phone,
`page-title`), the section's name on the top bar 20 px in spaced capitals,
labels 12.5 px spaced capitals (`console-label`). Inter for everything else,
14–15 px body, 12–13 px secondary. Figures tabular.

**Icons.** The product's line icons (`Icon.tsx`, 1.75 px stroke, round joins),
18–23 px in navigation, inside a 36–40 px rounded tile on cards and in the
phone's sheet; on navy the active one turns gold.

**Density.** ALTO is dense on a laptop (three cards across at 1440 px, the
menu always in view) and roomy on a phone (one column, 44 px targets).

**Empty and loading states.** Empty: Alti with a pose, a short title and what
to do. A number that could not be read: "No data yet" and why, never a 0.
Loading: the screen waits for its data rather than flashing zeros; a box that
breaks shows "This part couldn't be shown" inside `SafeBoundary` only.

**Colour rules kept.** Gold text only on navy (`data-on-navy`, checked by
`tokens.test.ts`); navy for headings, links and active states on light; red
only for "needs you" and errors; green for done. Focus: the navy 3 px ring on
everything focusable. Motion: transforms and opacity only, off for reduced
motion.

**What ALTO has that the console does not copy:** its condensed display face
(Barlow Condensed; Credalti's is Poppins), the bell for phone alerts in the
top bar (Credalti's alerts are a page, `/equipo/alertas`), the environment pill
(the demo pill stands in), and ALTO's bots' own access, jobs and chat (Alti
only points at what exists).

## Accounting

«Contabilidad» / «Accounting» (`/equipo/contabilidad`, section 5 «Payments & Accounting») is the
accounting department, for the owner and administrators only (the capability
`accounting`; specialists and sales see why they can't open it, and the
routes and the database refuse them). Dashboard, the income ledger built from
billing (test charges never counted), expenses with receipts and monthly
rules, bank CSV import with a mapping step, reconciliation against the NMI or
Authorize.Net export, collections (WhatsApp or email reminders a person sends,
never SMS), unit economics, partner commissions and the 1099-NEC list,
reports with the QuickBooks / Xero file and the printable monthly report,
month close, and a tax set-aside estimate with the year's dates. Everything,
including the questions for the CPA, is in `docs/ACCOUNTING.md`.

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
Alti's drafted replies (`drafts.ts`: the model is told to write in the
client's language), saved answers (each has a language, `saved_answers.language`;
only answers in the client's language are suggested or sent by Alti), the
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

## Content

«Contenido» (`/equipo/contenido`, section 2 «Marketing») is the marketing hub: a board
and a calendar of content pieces (videos, carousels, stories, WhatsApp
statuses, partner flyers, emails), each checked against the claim and brand
rules as it is typed, with a checklist before approval, Alti's writing
assistant (AI, always a draft), templates that already pass the rules,
posting (by a person, or by the app once the owner connects the accounts and
turns it on), results, the brand kit and the partner kit. Specialists make
content (`content.edit`); only an administrator approves (`content.approve`)
and connects accounts (`content.publish`); sales sees the brand kit and the
approved partner material only (`content.share`). See `docs/CONTENT.md`.

## Ads

«Anuncios» / «Ads» (`/equipo/anuncios`, section 2 «Marketing», after
Content) is the Ads Manager: Meta ads, read only, beside the leads and signed
clients they really brought (Meta's numbers and Credalti's verified ones,
each labelled), the winners, every campaign → ad set → ad with a verdict from
rules written on the screen, one ad's drawer (its creative, every number, its
leads, what to do), «What to make next», Alti's ad copy drafts (AI, checked
against the claim rules and a credit-repair ad checklist, sent to Content or
Video Studio), and Meta's spend beside the books as a reconciliation
suggestion. The numbers are administrators' (`ads.view`); the content team
drafts ad copy (`ads.draft`); sales sees none of it. Nothing there changes
Meta. See `docs/ADS.md`.
## SEO

«SEO» (`/equipo/seo`, section 2, a sub-tab between Content and Reviews) is how
the public website gets found: **Site health** (the server reads its own
public pages, robots.txt and the sitemap and lists each check as pass or fix,
with why and how; no score, no keys needed), **Guides** (articles in English
and Spanish at `/guias/<slug>`, drafted by Alti or a person, every legal fact
with an official source, the claim rules and an SEO checklist, published only
by an administrator), **Search Console** (read-only clicks, impressions and
position once the owner connects it; a «Connect» card until then),
**Keywords & ideas** (Texas phrases tied to their pages, and content gaps that
become briefs) and **Local SEO** (Google Business Profile and the business's
details, with who ticked what). Administrators and specialists see and write
(`seo.view`, `seo.edit`); only an administrator publishes (`seo.publish`);
sales has no SEO. Guides waiting for approval or sent back, and checks to
fix, add to section 2's red count. Ask Alti lists «Draft a guide for the
website» there. See `docs/SEO.md`.
## Video Studio

«Estudio de video» / «Video Studio» (`/equipo/video`, section 2, right after
Content) plans, edits and checks short videos and ads in the browser: a
board (Planned → Editing → Ready for approval → Approved → Handed to
Content), briefs from the Ads Manager (`?brief=`), Alti's script-and-shots
draft, an editor (trim, split, order, crop or fit, words and lower thirds,
captions, the locked logo, intro and end cards, Alti with his label, music
from the rights-checked library) that exports H.264/AAC MP4s with
ffmpeg.wasm, the check and checklist before approval, and the hand-off that
gives the approved MP4 to a Content piece for posting. Specialists make videos
(`content.edit`); only an administrator approves (`content.approve`); sales
does not see it. Its «Needs you» is added to the Content group's red circle.
See `docs/VIDEO.md`.

## What is not done

- Nothing here has been tried with real clients or a live Claude key; the
  drafts were checked with a mocked model and the screenshots use a mocked
  draft.
- The template `credalti_resumen_equipo` must be approved in Meta before the
  summary goes by WhatsApp outside the 24-hour window.
- In the demo, saved answers added in the browser are not seen by the
  demo's Alti (the server uses the invented library).
- The minutes per notice are estimates until real handled times exist.
- The checklist's ticks are kept per browser (its dismissal is per member).
- Still Spanish in an English console: the invented demo data (names,
  notes, conversations, refund reasons), the reasons the AI intake gives
  when it reads a bureau letter (quoted as written), and the field labels of
  the client-language picker on `/equipo/invitar` (owned by the client-side
  work).
