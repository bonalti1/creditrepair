// Armor #3 (spec §3): marketing claim guardrails, enforced in the content
// pipeline (ES and EN). Used to lint any user-facing copy — landing pages,
// WhatsApp templates, coach output — before it ships or is sent.

export interface GuardrailViolation {
  pattern: string;
  rule: string;
  match: string;
}

interface Rule {
  pattern: RegExp;
  rule: string;
}

const RULES: Rule[] = [
  // Never: guaranteed deletions
  { pattern: /guarantee[ds]?\s+(deletion|removal|result)/i, rule: "no-guaranteed-deletions" },
  { pattern: /garantiza(mos|do|da)?s?\s+(la\s+)?(eliminaci[oó]n|borrado|resultado)/i, rule: "no-guaranteed-deletions" },
  { pattern: /\b(eliminaci[oó]n|borrado)\s+garantizad[oa]s?\b/i, rule: "no-guaranteed-deletions" },
  // Never: "X points in Y days"
  { pattern: /\d+\s*(points?|puntos?)\s*(in|en)\s*\d+\s*(days?|d[ií]as?|weeks?|semanas?|months?|meses?)/i, rule: "no-points-in-days" },
  // Never: removal of accurate info
  { pattern: /remove\s+(accurate|correct|valid)\s+(info|information|items?)/i, rule: "no-accurate-removal" },
  { pattern: /elimina(r|mos)?\s+informaci[oó]n\s+(correcta|exacta|v[aá]lida)/i, rule: "no-accurate-removal" },
  // Never: "we remove / we fix / we dispute for you" — DIY positioning (spec §1)
  { pattern: /\bwe\s+(remove|fix|repair|dispute|delete)\b/i, rule: "diy-positioning" },
  { pattern: /\b(nosotros\s+)?(eliminamos|reparamos|disputamos|arreglamos|borramos)\b/i, rule: "diy-positioning" },
  // Never: real-estate / rent-to-own bait (the Lexington Law pattern)
  { pattern: /rent.to.own|renta\s+con\s+opci[oó]n\s+a\s+compra.*cr[eé]dito/i, rule: "no-real-estate-bait" },
];

export function checkClaimGuardrails(text: string): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];
  for (const { pattern, rule } of RULES) {
    const match = text.match(pattern);
    if (match) violations.push({ pattern: String(pattern), rule, match: match[0] });
  }
  return violations;
}

/** Throwing variant for the content pipeline: refuse to ship copy that violates guardrails. */
export function assertClaimGuardrails(text: string, context: string): void {
  const violations = checkClaimGuardrails(text);
  if (violations.length > 0) {
    throw new Error(
      `Claim guardrail violation in ${context}: ${violations.map((v) => `${v.rule} ("${v.match}")`).join("; ")}`,
    );
  }
}
