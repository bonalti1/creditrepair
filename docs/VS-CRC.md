# Bonalti vs. Credit Repair Cloud — consumer-direct feature parity

CRC is B2B: it sells agencies the tools, and the agency resells the outcome at
$99–149/mo with human labor and full CROA exposure. Bonalti delivers the same
capabilities straight to the consumer for the cost of monitoring. This maps
every consumer-relevant CRC capability to ours.

| CRC capability (agency-side) | Bonalti consumer-direct equivalent | Status |
| --- | --- | --- |
| **Credit Audit report** — the sales weapon agencies use to close clients | `/audit`: severity-ranked findings, per-bureau scores with deltas, cross-bureau inconsistency matrix, plain-language notes, printable. Shown to the user directly after import | ✅ |
| **Dispute Wizard** (agent picks letter type + items) | Guided review wizard + attack engine: escalation and letter-type selection are automatic (§611 → MOV → furnisher/§809), the human decision is the legally meaningful one (what's inaccurate) | ✅ better |
| **Letter library (100–150 templates)** | 10 legally distinct instruments: §611 disputes ×3 categories, MOV, §623 furnisher, FDCPA §809(b) debt validation (auto-selected for collections), FCRA §605B identity-theft block, goodwill, §609 file request, personal-info cleanup. Claude varies wording per letter, which is what CRC's template count approximates manually | ✅ different, stronger |
| **Client portal** (progress for the agency's client) | The entire app IS the portal: journey engine, round timelines, FCRA clocks, letter archive | ✅ better |
| **3-bureau score tracking** | Scores in the parser/normalized format, dashboard deltas, audit page summary (real data once partner flows) | ✅ scaffolded |
| **Bureau response logging** (agency staff data entry) | Response logger on rounds page: consumer taps the outcome per item when the mail arrives; a logged "verified" is what justifies MOV escalation. Persists via letter outcomes API when authed | ✅ |
| **Automation/sequences** (agency reminders) | n8n round loop + WhatsApp with deep links | ✅ |
| **Credit education** | Spanish-first explainers, jargon glossary, AI coach with guardrails | ✅ better |
| CRM, lead pages, affiliate tracking, client billing | Not applicable — there is no agency. That overhead (and the $179–599/mo CRC fee, and the CROA exposure) is the margin we return to the consumer | n/a by design |

## What CRC structurally cannot do

1. Serve the consumer directly — its customer is the agency; the consumer pays
   the agency's markup for labor our software automates.
2. Escape CROA/TSR — its agencies charge for the regulated service; the DIY
   model moves the regulated act to the consumer.
3. Spanish-first, WhatsApp-native, mobile-first — none of it exists in the
   CRC agency stack.

## Deliberate non-goals

- No AI pre-selection of dispute items (CRC-world norm): the consumer decides
  and attests. This is Armor #2 and the model's legal foundation.
- No template-count arms race: letter *types* are legal instruments; wording
  variety is Claude's job, not a menu the consumer must understand.
