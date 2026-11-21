# Credalti — credit dispute software

*(Company: Credalti, with the AI assistant "Capi". Called CreditCapi until November 2026. Internal/spec name: Bonalti Credit.)*

**What it is:** Credalti is a full-service credit services company,
Spanish-first, launching in Texas. A sales team talks to the lead first and
sends an invitation into the app. The client signs a service agreement,
uploads ID and proof of address, connects credit monitoring (IdentityIQ), and
reviews each item on their report, saying which ones are inaccurate and why.
From there Credalti's staff prepares and mails the dispute letters for the
client, in rounds about every 40 days, from the staff console at `/equipo`
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
the WhatsApp templates, Capi's instructions and one claim rule.

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
| `src/lib/coach/systemPrompt.ts` | Capi's instructions, Spanish-first, per service mode: explains the service, never promises a result, never picks items, never quotes a price, hands over to the team |
| `src/lib/integrations/lob.ts` | Lob mail client (stubbed without API key) |
| `src/lib/integrations/whatsapp.ts` | WhatsApp Cloud API sender; message copy runs through guardrails |
| `src/app/api/reports/import` | Import + parse + diff a monitoring pull; deletion celebration |
| `src/app/api/attacks/build` | Build the draft round plan (requires active monitoring subscription) |
| `src/app/api/attacks/approve` | The self-serve approval: re-verifies every attestation server-side, renders/varies letters, mails via Lob, schedules the ~40-day next round. The full-service client app has no approve button and does not call it |
| `src/app/api/coach` | Coach endpoint with post-hoc guardrail lint on output |
| `src/app/api/webhooks/n8n` | Round triggers / day-40 re-engagement (shared-secret auth) |
| `supabase/migrations/0001_init.sql` | Full schema with owner-only RLS on every table |
| `src/app/*` | Landing, onboarding (goal selector), dashboard, item finder + attestation, letters page (read-only under full service), rounds — demo-data backed until Phase 1 auth wiring |
| `src/lib/ux/teamRound.ts`, `src/lib/ux/reviewChatCopy.ts` | Full service in the client app: where the team's round stands (being prepared, mailed), and what Capi says once the review is finished |
| `src/app/api/chat`, `src/lib/chat/` | The thread with Capi, stored per user (`chat_messages`); AI replies are recorded by the server, never accepted from the browser |
| `src/lib/security/` | Rate limiter, constant-time secret checks, WhatsApp webhook signature verification |
| `src/lib/observability/errors.ts`, `src/instrumentation.ts` | Error log lines + optional alert webhook (`ERROR_WEBHOOK_URL`) |
| `src/lib/__tests__/`, `content/spots.test.ts` | Test suite (`npm test`), run in CI |
| `src/lib/monitoring/subscription.ts` | When a monitoring subscription counts as active: a report from the last 45 days, and no cancellation on record |
| `src/lib/letters/enclosures.ts` | ID and proof-of-address photos attached as pages behind each mailed letter |
| `supabase/setup.sql` | Every migration in order, for pasting into the Supabase SQL editor (a test keeps it in sync) |
| `src/lib/sales/`, `src/app/equipo/invitar` | Sales-first handoff: the salesperson's invite link and the page that builds it — see `docs/SALES-FLOW.md` |
| `src/lib/brand.ts` | Company name (Credalti), wordmark halves and the assistant's name (Capi); pages and messages read from here |
| `src/lib/staff/stage.ts` | Staff console logic: a client's stage, what needs a person (exceptions), and the system's next step with its date |
| `src/lib/staff/data.ts`, `src/lib/staff/demoClients.ts` | Where the console gets clients: the interface, the demo implementation (invented clients), and the marked place for the database one |
| `src/app/equipo/` | Staff console: home (exceptions, batch send, pipeline), client list, client page, invite. Open in the demo; staff-only when Supabase is configured |
| `supabase/migrations/0007_staff.sql` | `staff_members`, `is_staff()`, and read-only staff policies on client tables |
| `src/lib/letters/reasons.ts`, `src/lib/ux/disputeReason.ts`, `src/components/DisputeFields.tsx` | A stated reason for every disputed item: the catalogue, the rule that a reason (and a note for "other") is required to confirm, and the picker both review screens share. The letter prints the reason's sentence on the item's line; the client's own words are never printed |
| `supabase/migrations/0008_dispute_reason.sql` | `item_flags.reason_code` (nullable: answers confirmed earlier have none). Apply it before deploying the code that reads it |
| `src/lib/staff/printBatch.ts`, `src/app/equipo/imprimir` | Print a batch of letters locally (US Letter, #10 window envelope, cover sheet and enclosure slips) and mark the rounds as mailed |
| `src/lib/service/mode.ts` | How the service is delivered: full service (default) or self-serve (`NEXT_PUBLIC_SERVICE_MODE`) |
| `src/lib/agreement/` | The service agreement full service requires (CROA, Texas Finance Code ch. 393): the documents and the statutory text, the 3-business-day cancellation window, the gate that holds every letter until work may start, the business terms the owner fills in, and readiness — see `docs/AGREEMENT.md`. **Draft: no attorney has reviewed the text** |
| `src/app/(app)/acuerdo`, `src/app/api/agreement`, `src/lib/ux/agreementStore.ts` | The client's side: disclosures first, then the contract and signature, the printable copy, cancelling; the endpoints that record each step |
| `supabase/migrations/0010_service_agreements.sql` | `service_agreements`: acknowledgement, signature, cancellation. Read-only for clients and staff, written by the server, and unchangeable once written |
| `content/` | Ad content kit: locked mascot, spot files, claim gate, assembly and transcript check — see `content/README.md` |

## Load-bearing invariants

1. **Attestation before inclusion.** No letter may include an item without a logged,
   timestamped "I believe this item is inaccurate, unverifiable, or outdated"
   attestation. Enforced in the plan builder AND re-checked in `/api/attacks/approve`.
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
   `/api/attacks/approve` and in the staff console's send rules. Unreviewed
   agreement text cannot be signed by a real client (`agreementReadiness`).

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in what you have; everything degrades gracefully
npm run dev
```

Without env vars the app runs in demo mode (demo report data, stubbed mail/WhatsApp,
coach disabled). Apply the migrations in `supabase/migrations/` in order to a Supabase
project and set the Supabase env vars to enable persistence.

```bash
npm test            # unit tests (domain logic, compliance rules, security helpers, ad spots)
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
- v1 = Texas only. Out-of-state marketing is a legal project, not a config change.

*This repository is not legal advice; the compliance features implement the spec's
"Armor" but Phase 0 attorney review gates launch.*
