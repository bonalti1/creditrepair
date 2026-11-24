# Credalti — credit dispute software

*(Company: Credalti. Alti is the AI assistant and the only voice, always labelled as AI; the robot AltiBot is a small cameo only (owner's decisions of 2026-11-24; see docs/BRAND.md). Called CreditCapi until November 2026; the assistant was a capybara until the brand kit of November 2026. Internal/spec name: Bonalti Credit.)*

**What it is:** Credalti is a full-service credit services company, in
English and Spanish (English first, Spanish if needed), launching in Texas. A sales team talks to the lead first and
sends an invitation into the app. The client signs a service agreement,
uploads ID and proof of address, connects credit monitoring (IdentityIQ), and
reviews each item on their report, saying which ones are inaccurate and why.
From there Credalti's staff prepares and mails the dispute letters for the
client, in rounds whose timing follows the evidence (30 days from the bureaus'
receipt plus 5 for their answer, about 35–45 days; `src/lib/rounds/timing.ts`), from the staff console at `/equipo`
(see `src/lib/staff/`), with software automated enough for two staff to run
fulfillment. The client can read the letters and follow their status.

Credalti charges a monthly service fee, separate from the monitoring
subscription the client pays to the monitoring provider. Amounts are not
decided and no price is written anywhere in the app. Billing charges only for
work already done (a round of letters mailed); see `docs/BILLING.md`.
The engine underneath follows the spec in `Bonalti Credit SaaS — Spec v2`
(Dispute Beast architecture + Armor), which was written for a do-it-yourself
product.

**Service mode:** `NEXT_PUBLIC_SERVICE_MODE` (`src/lib/service/mode.ts`).
Unset means full service. `self_serve` brings back the do-it-yourself version,
where the client approves and sends their own letters; it is kept for later.
The mode changes the client app's wording, whether the approve button exists,
the WhatsApp templates, the assistant's instructions and one claim rule.

**Positioning rule (enforced in code):** describe the process, never promise
an outcome. Under full service it is true, and allowed, to say "nuestro equipo
prepara y envía tus cartas" or "disputamos por ti los puntos que tú nos
indicas". In every mode it is banned to say "we remove / we fix / we repair /
we delete", "te subimos el puntaje", any guarantee, points or timeframe, and
anything that takes the client's decisions away ("we dispute everything
negative", "we decide what to dispute"). Copy says "ronda de cartas" (the
spec's "ataque" was replaced after user testing: it read as aggressive). See
`src/lib/compliance/guardrails.ts`, which lints marketing copy, WhatsApp
messages, staff replies and coach output.

## Stack

Next.js 16 (App Router) · Supabase (Postgres/Auth/RLS) · n8n (pull scheduling, round
triggers) · WhatsApp Cloud API · Lob (letter printing/mailing) · Claude API
(letter wording variation + AI Credit Coach) · Stripe (only if white-label billing).

## Repository map

| Path | What it is |
| --- | --- |
| `src/lib/domain/types.ts` | Core domain types (bureaus, items, escalation stages, plans) |
| `src/lib/domain/parser.ts` | Provider-agnostic report parser → structured entities (spec §4.1) |
| `src/lib/domain/diff.ts` | Diff engine: deletions/changes between pulls (retention loop) |
| `src/lib/domain/attack.ts` | Round-based attack engine: Attack 1 = personal-info cleanup ×3 bureaus; Attack 2+ = per-category per-bureau letters; escalation §611 → MOV → furnisher-direct (spec §4.2) |
| `src/lib/domain/bureaus.ts` | Primary + secondary bureau registry (**addresses are placeholders — VERIFY_AT_BUILD**) |
| `src/lib/compliance/attestation.ts` | Armor #2: per-item accuracy attestation text + record builder |
| `src/lib/compliance/guardrails.ts` | Armor #3: claim guardrails (ES + EN), aware of the service mode: process may be described, outcomes may not be promised |
| `src/lib/service/mode.ts` | The service mode switch: full service (default) or self-serve |
| `src/lib/letters/templates.ts` | Merge-field letter templates (§611, MOV, §623 furnisher-direct, §609, personal-info) |
| `src/lib/letters/variation.ts` | Claude-powered per-letter wording variation (e-OSCAR countermeasure) |
| `src/lib/letters/fonts.ts` | Print/handwritten font rotation, deterministic per letter |
| `src/lib/coach/systemPrompt.ts` | Alti's instructions (the AI assistant), per service mode, answering in the language the client writes in (else the app's; `src/lib/coach/language.ts`): explains the service, never promises a result, never picks items, never quotes a price, hands over to the team |
| `src/lib/integrations/lob.ts` | Lob mail client: first class or certified (with electronic return receipt), parsed addresses, idempotency key; simulated without an API key. Which request details are verified is listed at the top |
| `src/lib/integrations/whatsapp.ts` | WhatsApp Cloud API sender; message copy runs through guardrails |
| `src/app/api/reports/import` | Import + parse + diff a monitoring pull; deletion celebration |
| `src/app/api/attacks/build` | Build the draft round plan (requires active monitoring subscription) |
| `src/app/api/attacks/approve` | The self-serve approval (refuses with 409 under full service, where letters leave only from the staff send). Both go through `src/lib/rounds/send.ts` |
| `src/app/api/coach` | Coach endpoint with post-hoc guardrail lint on output |
| `src/app/api/webhooks/n8n` | Round triggers / day-40 re-engagement (shared-secret auth) |
| `supabase/migrations/0001_init.sql` | Full schema with owner-only RLS on every table |
| `src/app/*` | Landing, onboarding (goal selector), dashboard, item finder + attestation, letters page (read-only under full service), rounds — demo-data backed until Phase 1 auth wiring |
| `src/lib/ux/teamRound.ts`, `src/lib/ux/reviewChatCopy.ts` | Full service in the client app: where the team's round stands (being prepared, mailed), and what Alti says once the review is finished |
| `src/app/api/chat`, `src/lib/chat/` | The thread with Alti, stored per user (`chat_messages`); AI replies are recorded by the server, never accepted from the browser |
| `src/lib/security/` | Rate limiter, constant-time secret checks, WhatsApp webhook signature verification |
| `src/lib/observability/errors.ts`, `src/instrumentation.ts` | Error log lines + optional alert webhook (`ERROR_WEBHOOK_URL`) |
| `src/lib/__tests__/`, `content/spots.test.ts` | Test suite (`npm test`), run in CI |
| `src/lib/monitoring/subscription.ts` | When a monitoring subscription counts as active: a report from the last 45 days, and no cancellation on record |
| `src/lib/letters/enclosures.ts` | ID and proof-of-address photos attached as pages behind each mailed letter |
| `supabase/setup.sql` | Every migration in order, for pasting into the Supabase SQL editor (a test keeps it in sync) |
| `src/lib/sales/`, `src/app/equipo/invitar` | Sales-first handoff: the salesperson's invite link and the page that builds it — see `docs/SALES-FLOW.md` |
| `src/lib/highlevel/`, `src/lib/leads/`, `src/app/api/webhooks/highlevel`, `src/app/api/cron/highlevel` | HighLevel → app lead handoff (prospects with their source, dedupe, round-robin) and app → HighLevel stage sync (an outbox sent once per event, no credit data) — see `docs/HIGHLEVEL.md` |
| `src/lib/partners/`, `src/app/socios`, `src/app/equipo/socios`, `src/app/r/[code]` | Referral partners: public application, staff approval and commission records, the `/r/<code>` link (60-day cookie), the partner portal (coarse status only, no credit data) — see `docs/PARTNERS.md`. Migration `0017_partners_highlevel.sql` |
| `src/lib/brand.ts` | Company name (Credalti), the official logo files and app icons, Alti (the AI assistant, with `aiByline`/`teamByline`) and the robot's cameo, their names and image paths; pages and messages read from here. `src/components/Logo.tsx` shows the logo and `src/components/Character.tsx` draws the characters (see `docs/BRAND.md`) |
| `src/lib/staff/stage.ts` | Staff console logic: a client's stage, what needs a person (exceptions), and the system's next step with its date |
| `src/lib/staff/data.ts`, `src/lib/staff/demoClients.ts` | Where the console gets clients: the interface, the demo implementation (invented clients), and the database one (staff routes) |
| `src/app/equipo/` | Staff console: home (exceptions, batch send, pipeline), client list, client page, invite. Open in the demo; staff-only when Supabase is configured |
| `supabase/migrations/0007_staff.sql` | `staff_members`, `is_staff()`, and read-only staff policies on client tables |
| `src/lib/letters/reasons.ts`, `src/lib/ux/disputeReason.ts`, `src/components/DisputeFields.tsx` | A stated reason for every disputed item: the catalogue, the rule that a reason (and a note for "other") is required to confirm, and the picker both review screens share. The letter prints the reason's sentence on the item's line; the client's own words are never printed |
| `supabase/migrations/0008_dispute_reason.sql` | `item_flags.reason_code` (nullable: answers confirmed earlier have none). Apply it before deploying the code that reads it |
| `src/lib/staff/printBatch.ts`, `src/app/equipo/imprimir` | Print a batch of letters locally (US Letter, #10 window envelope, cover sheet and enclosure slips) and mark the rounds as mailed |
| `src/lib/service/mode.ts` | How the service is delivered: full service (default) or self-serve (`NEXT_PUBLIC_SERVICE_MODE`) |
| `src/lib/agreement/` | The service agreement full service requires (CROA, Texas Finance Code ch. 393): the documents and the statutory text, the 3-business-day cancellation window, the gate that holds every letter until work may start, the business terms the owner fills in, and readiness — see `docs/AGREEMENT.md`. **Draft: no attorney has reviewed the text** |
| `src/app/(app)/acuerdo`, `src/app/api/agreement`, `src/lib/ux/agreementStore.ts` | The client's side: disclosures first, then the contract and signature, the printable copy, cancelling; the endpoints that record each step |
| `supabase/migrations/0010_service_agreements.sql` | `service_agreements`: acknowledgement, signature, cancellation. Read-only for clients and staff, written by the server, and unchangeable once written |
| `src/lib/staff/permissions.ts`, `src/lib/staff/guard.ts` | Team roles (admin, specialist, sales): the capability matrix, which clients each role sees, and the wrapper every console page acts through. Staff routes check the same matrix on the server (`requireCapability` in `access.ts`) |
| `src/lib/staff/team.ts`, `teamData.ts`, `teamStore.ts`, `src/app/equipo/equipo` | The team screen: add by email or phone, change role, deactivate (never delete), round-robin assignment; people added by hand; the demo's record of it |
| `src/lib/staff/metrics.ts`, `src/app/equipo/negocio` | Business dashboard (administrators): every number with its written definition; removals counted only from recorded round results |
| `src/lib/staff/activity.ts`, `src/app/equipo/actividad` | Who did what, per client and for the team, built from the records |
| `src/app/api/staff/` | Staff routes for the team and for adding / assigning clients; role checked on the server |
| `supabase/migrations/0012_team.sql` | Team details, invitations, assignments, prospects, an append-only `team_audit`, and the "staff read" policies scoped by role |
| `content/` | Ad content kit: locked mascot, spot files, claim gate, assembly and transcript check — see `content/README.md` |
| `src/lib/mail/` | Mail: classes per kind of letter (`classes.ts`), US address parsing (`address.ts`), the Lob price table and cost preview (`pricing.ts`, prices unverified), tracking events → status and the response-window rule (`tracking.ts`), the furnisher address book and name matching (`furnishers.ts`), the per-round send plan and its blockers (`sendPlan.ts`, `sendBatch.ts`), recording webhook events (`server.ts`) |
| `src/app/equipo/enviar`, `src/app/equipo/acreedores` | Staff: the send screen (address, class and cost of every letter, "simulado" without a Lob key) and the furnisher address book (search, add, edit, history) |
| `src/app/api/webhooks/lob`, `src/app/api/furnishers` | Lob tracking webhook (signed, replay window, each event once) and the staff-only address book save |
| `supabase/migrations/0013_mail_tracking.sql` | Mail class and tracking on `letters`, append-only `mail_events`, no charge for a round whose letters all came back, `furnishers` + `furnisher_changes` (history by trigger) |
| `src/lib/autopilot/`, `src/app/equipo/piloto`, `src/app/api/cron/autopilot` | Piloto automático: follow-up reminders instead of "Recordarle…" buttons (`followups.ts`), factual status messages (`status.ts`), WhatsApp templates (`templates.ts`), quiet hours, daily cap and opt-out (`plan.ts`, `optout.ts`), WhatsApp then email, never SMS (`channels.ts`), automatic sending after a review window through the one send path (`sending.ts`, `server.ts`), and the one-person work queue (`queue.ts`). See `docs/AUTOPILOT.md` |
| `supabase/migrations/0015_autopilot.sql` | The autopilot's settings (everything new starts off), the append-only outbound message log with a unique dedupe key, opt-outs, holds, rounds first seen ready |
| `supabase/migrations/0014_staff_records.sql` | The console's own records: `staff_notes`, `exception_marks`, `report_samples` (append-only, role-scoped reads), who imported each report, who sent each round and how, round results |
| `src/lib/supabase/config.ts` | The one demo rule: the app is on the database when `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set, the demo otherwise. Every client, store and data layer asks it |
| `src/lib/staff/load.ts`, `src/lib/staff/fromRows.ts` | The console on the database: rows read through the member's own connection (RLS decides), mapped to `StaffClient` in one pure module |
| `src/lib/staff/actions.ts`, `src/app/api/staff/{case,reports,rounds,mail,me}` | Staff writes: role checked on the server, the client checked through the member's own connection, written with the service role |
| `src/lib/rounds/` | The next round from database rows (`plan.ts`) and the one mailing path (`send.ts`) shared by the staff send and the self-serve approval: agreement gate, attestation, addresses, idempotent |
| `src/lib/clientCase/server.ts`, `src/app/api/{report,rounds,profile/address}`, `src/lib/ux/reportStore.ts` | The client app on the database: their report (or "Tu equipo está importando tu reporte"), their mailed round and letters, their mailing address |
| `src/lib/__tests__/db/` | The real migrations in PGlite with a supabase-js adapter: RLS per role, every staff route, and invite → sign → import → answers → send → tracking → charge |
| `src/lib/intake/`, `src/app/api/intake`, `src/app/api/staff/intake`, `supabase/migrations/0016_intake.sql` | AI intake (Claude): a report PDF or saved page read into the import preview with a citation per item and the doubtful ones marked; ID and proof of address checked automatically (a person sees only what fails); optional bureau letters. Round results come from the next report. See `docs/INTAKE.md` |
| `src/lib/case/`, `src/app/(app)/caso`, `src/app/api/case` | "Mi caso": the client's timeline and the one status sentence ("¿Qué está pasando?") on Home and behind the header's (i) button; demo example case; the database read (own rows only). See `docs/UX.md`, "Client experience" |
| `src/lib/learn/`, `src/app/(app)/aprende` | "Aprende": ten lessons with sources and two calculators (utilization, FCRA § 605 dates) — see `docs/LEARN.md` |
| `src/lib/pulse/`, `src/app/api/pulse`, `supabase/migrations/0018_client_experience.sql` | The "¿Cómo vamos?" satisfaction pulse and `pulseSummary` for the business dashboard |
| `src/lib/voice/`, `src/lib/ux/textSize.ts`, `src/lib/ux/plainLanguage.ts`, `src/lib/ux/firstWeek.ts` | Read-aloud voice adapter (`docs/VOICE.md`), "Letra grande", the plain-language check, first-week progress and timings |
| `src/lib/staff/i18n/`, `supabase/migrations/0025_staff_locale.sql` | The staff console's language: English by default, Spanish per member (saved on their preferences, quick switch in the menu); whatever goes to a client stays in the client's language. Saved answers carry a language — see `docs/STAFF.md`, «Language» |
| `src/lib/staff/drafts.ts`, `draftModel.ts`, `answers.ts`, `playbook.ts`, `digest.ts`, `src/app/equipo/{respuestas,perfil,bienvenida}`, `src/app/api/staff/{drafts,answers,preferences}`, `src/app/api/cron/staff-digest`, `supabase/migrations/0020_staff_assist.sql` | The one-person console: Alti's drafted replies (checked before they are shown), saved answers (Alti answers a close match with an approved one), «Cómo se resuelve» cards, the morning summary, new-hire mode, the phone layout — see `docs/STAFF.md` |
| `src/lib/domain/personalInfo.ts`, `src/lib/reports/reimport.ts`, `src/lib/reports/history.ts` | Re-imports: repeated personal info skipped (normalized per bureau), "Already disputed", "Reappeared" (FCRA § 611(a)(5)(B)), personal info changes; every report in one list (the staff Reports tab, the client's "My reports") |
| `src/lib/billing/cardBrands.ts`, `src/lib/household/`, `src/lib/staff/search.ts`, `supabase/migrations/0027_cards_households.sql` | Accepted card brands (Amex/Discover off by default), household signup (a member of their own, linked for the discount, no shared data), the console's search (Ctrl/Cmd+K) |
| `src/lib/rounds/timing.ts`, `supabase/migrations/0028_round_timing.sql` | When the next round is due, from the evidence: 30 days from receipt (certified delivery, else mailing + 5), + 5 for the answer, at most 45 days unless the window ends later; round 1 on the first working day after the cancellation window. Replaces the fixed 40 days everywhere — `docs/AUTOPILOT.md` |
| `src/lib/reviews/`, `src/app/equipo/resenas`, `src/app/opina`, `supabase/migrations/0029_reviews.sql` | Review requests: once per client at a milestone everyone reaches, never gated by sentiment, no incentives (FTC 16 C.F.R. Part 465); ratings typed in; Alti's reply drafts — `docs/REVIEWS.md` |
| `src/lib/compliance/stateRules.ts`, `src/app/equipo/estados`, `supabase/migrations/0030_state_openings.sql` | The 50-state + DC checklist (sourced, dated, verified or not), the per-state "opened" switch the app enforces (waitlist otherwise), state agreement documents — `docs/STATES.md` |
| `src/lib/aftercare/`, `src/app/(app)/construir`, `src/app/equipo/ofertas`, `src/app/api/aftercare`, `src/app/api/staff/offers`, `supabase/migrations/0031_aftercare.sql` | After-care: the build-your-credit plan for every client, partner offers (off by default, ranked by cost), the home-ready path with consented loan officer sharing and introductions, ITIN clients (the kind of number only, never the number), and graduation that stops billing — see `docs/AFTERCARE.md` |
| `src/app/registro`, `src/components/signup/`, `src/lib/signup/`, `src/lib/credit/softPull.ts`, `src/app/api/signup` | Sign up in one chat with Alti (the AI assistant, labelled as AI): five steps (Get started → Your info → Verify identity → Your report → Sign up), a case reference ("CR-7KQ4M") from the first screen, the same records as onboarding, the intake, the agreement and the phone login; the report in counts only; a soft-pull provider interface (`none` by default) — see `docs/SIGNUP-CHAT.md` |
| `src/lib/calls/`, `src/app/registro/llamada`, `src/app/equipo/llamadas`, `src/app/api/calls`, `src/app/api/staff/calls`, `supabase/migrations/0032_calls.sql` | "Schedule a call with a person", built and OFF (`NEXT_PUBLIC_CALLS_ENABLED`): the team's call hours, bookings with TCPA consent, confirmations and reminders by WhatsApp or email (never SMS), the calls in the team's queue with their case reference. Questions only: signup and payment happen afterwards, in writing (Telemarketing Sales Rule) — see `docs/SIGNUP-CHAT.md`. Migration 0032 also holds `signup_cases` |
| `docs/DATABASE.md`, `supabase/first-admin.sql` | The owner's checklist to go from demo to database, and the first administrator |

## Load-bearing invariants

1. **Attestation before inclusion.** No letter may include an item without a logged,
   timestamped "I believe this item is inaccurate, unverifiable, or outdated"
   attestation. Enforced in the plan builder AND re-checked in `src/lib/rounds/send.ts`,
   the one mailing path (the staff send and the self-serve approval).
2. **The client decides what is disputed; the team sends.** Which items are
   inaccurate, and why, is the client's answer alone. Under full service the
   team prepares and mails the letters and the client approves nothing; in
   self-serve mode letters mail only from the approval endpoint, on the
   client's explicit action.
3. **Claim guardrails.** No guaranteed deletions, no "X points in Y days", no
   removal-of-accurate-info claims, no "we remove / we fix", no "we dispute
   everything negative", no real-estate bait — linted at send time for
   WhatsApp, staff replies and coach output; use `assertClaimGuardrails` for
   any new copy surface.
4. **Monitoring gate.** The attack builder requires an active monitoring
   subscription (`monitoring_subscriptions.status = 'active'`).
5. **The AI may only reword prose.** A model-varied letter is mailed only if
   its item lines, header, signature and legal citations are identical to the
   template's (`variationProblems` in `src/lib/letters/variation.ts`);
   otherwise the template goes out verbatim.
6. **Ads make no outcome promises.** Ad scripts, captions and end cards must
   pass `checkMarketingCopy`; CI checks every spot in `content/spots/`.
7. **No work before the agreement allows it (full service).** A letter leaves
   only if the client acknowledged the disclosures, signed the contract, has
   not cancelled, and the 3-business-day cancellation window is over
   (`workMayStart` in `src/lib/agreement/gate.ts`), checked in
   `src/lib/rounds/send.ts` (every letter that leaves) and in the staff console's send rules. Unreviewed
   agreement text cannot be signed by a real client (`agreementReadiness`).

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in what you have; everything degrades gracefully
npm run dev
```

Without env vars the app runs in demo mode (demo report data, stubbed mail/WhatsApp,
coach disabled). With the Supabase env vars set and `supabase/setup.sql` applied,
the staff console and the client app run on the database; the owner's checklist
is `docs/DATABASE.md`.

```bash
npm test            # unit tests, plus the migrations run in PGlite (src/lib/__tests__/db)
npm run typecheck
npm run build
```

### Before going live

The owner's step-by-step list, with the messages to send and every account and
variable, is in `docs/GO-LIVE.md`. `GET /api/health` (with the shared secret)
reports what is configured and what is missing.


- Set `WHATSAPP_APP_SECRET`. With WhatsApp credentials present and no app secret,
  the inbound webhook refuses every request rather than accept unsigned ones.
- Set `ERROR_WEBHOOK_URL` so failures reach a person (Slack or an n8n webhook).
- `npm audit` reports no known vulnerabilities as of 2026-11-19 (Next 16, zod 4,
  vitest 5). Re-run it before each release.
- The rate limiter is in-memory and per server instance. Keep the host's own
  firewall / bot protection on in front of `/api/coach` and `/api/waitlist`.

## Build order & status (spec §7)

- [ ] **Phase 0 (gating, non-code):** monitoring provider chosen: **IdentityIQ**
  (partner onboarding and report access pending — `docs/IDENTITYIQ.md`) · attorney session (TX CSO, ToS, claim
  guardrails, TSR/funnel) · TX CSO registration + $10k bond (default: register)
- [x] **Phase 1:** onboarding UI, report import + parser, Supabase Auth (magic
  link, login gate in `src/proxy.ts`, RLS-backed persistence), monitoring adapter layer
  (`src/lib/monitoring/` — demo adapter live; Array skeleton awaits partner
  sandbox for payload mapping)
- [x] **Phase 2:** item finder (guided wizard), flagging + attestation
  (server-persisted via `/api/flags`), attack builder
- [x] **Phase 3:** letter engine + Lob + round loop, letter outcome tracking
  (`/api/letters/outcome`)
- [x] **Phase 4:** WhatsApp layer with journey deep links, Spanish coach, round
  automation endpoint (`/api/cron/rounds` — n8n hits it hourly with the shared
  secret; inbound WhatsApp webhook pending)
- [x] **Phase 5:** diff engine, deletion detection, retention loop (celebration
  fires inside the shared import pipeline)
- [~] **Phase 6:** mortgage goal track + ABA handoff — **built dark** behind
  `NEXT_PUBLIC_FEATURE_ABA_HANDOFF` (default off); flag flips only after
  attorney sign-off on the flow + disclosure text

## Open items (spec §8 — resolve, don't assume)

- Monitoring provider: IdentityIQ, paid by commission rather than by billing the
  customer. Open with IDIQ: partner terms, whether paid ads are allowed, how the
  app reads a report, ITIN enrollment. See `docs/IDENTITYIQ.md`.
- Full service with a monthly fee is a paid credit service: TX CSO registration
  and bond, the written agreement with its 3-business-day right to cancel, and
  no charge before the service it pays for has been performed. Attorney to
  confirm each — **the load-bearing legal questions; they need real answers**.
- Whether letters the team prepares and mails may go out in the client's name,
  and what the client must sign for that (`docs/LETTER-LIBRARY.md`).
- The monthly fee: amounts, and how it is billed. Not built.
- Bureau mailing addresses (`src/lib/domain/bureaus.ts`) were checked on
  2026-11-19 by web search against each company's site and the CFPB list; each
  entry carries `verifiedOn` and `source`. Two secondary addresses were out of
  date and corrected (Innovis, Clarity), SageStream was folded into LexisNexis,
  and ARS could not be confirmed and is not mailed. A person should open each
  source link once before the first real mailing.
- v1 = Texas only. Out-of-state is a legal project: each state is researched in `docs/STATES.md` and opened in `/equipo/estados` only with the attorney's review on record; its agreement documents must exist before anyone there can sign.

*This repository is not legal advice; the compliance features implement the spec's
"Armor" but Phase 0 attorney review gates launch.*
