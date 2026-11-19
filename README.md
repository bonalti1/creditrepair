# CreditCapi — DIY Credit Dispute SaaS

*(Consumer brand: CreditCapi, with the AI assistant "Capi". Internal/spec name: Bonalti Credit.)*

Consumer-facing DIY credit dispute software. Spanish-first, Texas launch.
The software is free; revenue is the required credit monitoring subscription
(IdentityIQ, paid to us as a referral commission). Implements the spec in `Bonalti Credit SaaS — Spec v2`
(Dispute Beast architecture + Armor).

**Positioning rule (enforced in code):** the USER disputes — we provide the tool.
All copy says "tu ataque", "tú envías", "tus disputas". Never "we remove / we fix /
we dispute for you". See `src/lib/compliance/guardrails.ts`, which lints copy in
the content pipeline (WhatsApp messages, coach output).

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
| `src/lib/compliance/guardrails.ts` | Armor #3: marketing claim guardrails (ES + EN), throwing linter |
| `src/lib/letters/templates.ts` | Merge-field letter templates (§611, MOV, §623 furnisher-direct, §609, personal-info) |
| `src/lib/letters/variation.ts` | Claude-powered per-letter wording variation (e-OSCAR countermeasure) |
| `src/lib/letters/fonts.ts` | Print/handwritten font rotation, deterministic per letter |
| `src/lib/coach/systemPrompt.ts` | Spanish-first AI Credit Coach prompt with hard-coded claim guardrails |
| `src/lib/integrations/lob.ts` | Lob mail client (stubbed without API key) |
| `src/lib/integrations/whatsapp.ts` | WhatsApp Cloud API sender; message copy runs through guardrails |
| `src/app/api/reports/import` | Import + parse + diff a monitoring pull; deletion celebration |
| `src/app/api/attacks/build` | Build the draft round plan (requires active monitoring subscription) |
| `src/app/api/attacks/approve` | **The DIY moment.** Re-verifies every attestation server-side, renders/varies letters, mails via Lob, schedules the ~40-day next round |
| `src/app/api/coach` | Coach endpoint with post-hoc guardrail lint on output |
| `src/app/api/webhooks/n8n` | Round triggers / day-40 re-engagement (shared-secret auth) |
| `supabase/migrations/0001_init.sql` | Full schema with owner-only RLS on every table |
| `src/app/*` | Landing, onboarding (goal selector), dashboard, item finder + attestation, attack builder, rounds — demo-data backed until Phase 1 auth wiring |
| `src/app/api/chat`, `src/lib/chat/` | The thread with Capi, stored per user (`chat_messages`); AI replies are recorded by the server, never accepted from the browser |
| `src/lib/security/` | Rate limiter, constant-time secret checks, WhatsApp webhook signature verification |
| `src/lib/observability/errors.ts`, `src/instrumentation.ts` | Error log lines + optional alert webhook (`ERROR_WEBHOOK_URL`) |
| `src/lib/__tests__/`, `content/spots.test.ts` | Test suite (`npm test`), run in CI |
| `content/` | Ad content kit: locked mascot, spot files, claim gate, assembly and transcript check — see `content/README.md` |

## Load-bearing invariants

1. **Attestation before inclusion.** No letter may include an item without a logged,
   timestamped "I believe this item is inaccurate, unverifiable, or outdated"
   attestation. Enforced in the plan builder AND re-checked in `/api/attacks/approve`.
2. **The user presses the button.** Letters render and mail only from the approval
   endpoint, triggered by explicit user action.
3. **Claim guardrails.** No guaranteed deletions, no "X points in Y days", no
   removal-of-accurate-info claims, no real-estate bait — linted at send time for
   WhatsApp and coach output; use `assertClaimGuardrails` for any new copy surface.
4. **Monitoring gate.** The attack builder requires an active monitoring
   subscription (`monitoring_subscriptions.status = 'active'`).
5. **The AI may only reword prose.** A model-varied letter is mailed only if
   its item lines, header, signature and legal citations are identical to the
   template's (`variationProblems` in `src/lib/letters/variation.ts`);
   otherwise the template goes out verbatim.
6. **Ads make no outcome promises.** Ad scripts, captions and end cards must
   pass `checkMarketingCopy`; CI checks every spot in `content/spots/`.

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
- TX CSO applicability to the $0-software model (default: register regardless).
- Whether requiring paid monitoring re-characterizes the "free" software as a paid
  credit service — **the load-bearing legal question; needs a real answer**.
- Bureau mailing addresses (`src/lib/domain/bureaus.ts`) were checked on
  2026-11-19 by web search against each company's site and the CFPB list; each
  entry carries `verifiedOn` and `source`. Two secondary addresses were out of
  date and corrected (Innovis, Clarity), SageStream was folded into LexisNexis,
  and ARS could not be confirmed and is not mailed. A person should open each
  source link once before the first real mailing.
- v1 = Texas only. Out-of-state marketing is a legal project, not a config change.

*This repository is not legal advice; the compliance features implement the spec's
"Armor" but Phase 0 attorney review gates launch.*
