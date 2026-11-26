import { checkClaimGuardrails, checkMarketingCopy } from "../compliance/guardrails";

// The words of an idea Alti proposes, checked before anyone sees them (an
// idea a person types is theirs; it is checked again the day it becomes a
// piece of content, a message or an ad). Alti's words go through the claim
// rules every client-facing text goes through (src/lib/compliance/guardrails.ts),
// plus the house rules that an experiment must never break:
//
//   - no promise of results (the guardrails);
//   - nothing called free;
//   - no pressure (urgency, scarcity);
//   - never SMS: automatic messages are WhatsApp or email only;
//   - only Texas is open, and Georgia never (no idea to sell elsewhere);
//   - no number typed by the model: the numbers come from the server's
//     snapshot (signals.ts), so a figure in the words would be made up.

export interface WordsProblem {
  rule: string;
  match: string;
}

const HOUSE_RULES: Array<{ rule: string; pattern: RegExp }> = [
  { rule: "no-free", pattern: /\bfree\b|\bgratis\b|\bgratuit[oa]s?\b|\bno\s+cost\b|\bsin\s+costo\b/i },
  {
    rule: "no-pressure",
    pattern:
      /\b(act\s+now|limited\s+time|only\s+today|today\s+only|last\s+chance|hurry|don['’]t\s+wait|spots?\s+left|scarcity|countdown|urgency|ahora\s+mismo|solo\s+hoy|[uú]ltima\s+oportunidad|por\s+tiempo\s+limitado|no\s+esperes|ap[uú]rate|quedan\s+pocos|urgencia|cuenta\s+regresiva)\b/i,
  },
  { rule: "no-sms", pattern: /\bSMS\b|\btext\s+messag\w*|\btexting\b|\bmensajes?\s+de\s+texto\b/i },
  {
    rule: "texas-only",
    pattern:
      /\b(Georgia|Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New\s+Hampshire|New\s+Jersey|New\s+Mexico|New\s+York|North\s+Carolina|North\s+Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode\s+Island|South\s+Carolina|South\s+Dakota|Tennessee|Utah|Vermont|Virginia|Washington|West\s+Virginia|Wisconsin|Wyoming|other\s+states|new\s+states|otros\s+estados|nuevos\s+estados)\b/i,
  },
  { rule: "no-typed-numbers", pattern: /\d/ },
];

/** Every problem in the words of a proposal; empty when they may be shown. */
export function proposalWordsProblems(text: string): WordsProblem[] {
  const out: WordsProblem[] = [];
  for (const v of [...checkMarketingCopy(text), ...checkClaimGuardrails(text)]) {
    if (!out.some((p) => p.rule === v.rule)) out.push({ rule: v.rule, match: v.match });
  }
  for (const { rule, pattern } of HOUSE_RULES) {
    const m = text.match(pattern);
    if (m) out.push({ rule, match: m[0] });
  }
  return out;
}

/** Lowercase words of three letters or more, without accents. */
function words(text: string): Set<string> {
  return new Set(
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3),
  );
}

/** How alike two titles are: shared words over the shorter title's words (0–1). */
export function titleOverlap(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared += 1;
  return shared / Math.min(x.size, y.size);
}

/** Ideas already on the board (or already learned from) with a title like this one: shown before adding a repeat. */
export function similarTitles<T extends { title: string }>(title: string, existing: readonly T[], threshold = 0.6): T[] {
  if (words(title).size < 2) return [];
  return existing.filter((idea) => titleOverlap(title, idea.title) >= threshold);
}
