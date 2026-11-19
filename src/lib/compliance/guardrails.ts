// Armor #3 (spec §3): marketing claim guardrails, enforced in the content
// pipeline (ES and EN). Used to lint any user-facing copy — landing pages,
// WhatsApp templates, coach output — before it ships or is sent.
//
// Two levels: checkClaimGuardrails (everything we send) and checkMarketingCopy
// (ads and sales copy, which adds outcome-promise rules).

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
  // Same promise in the first person or the future tense — how a mascot or a
  // salesperson would say it: "te voy a arreglar tu crédito", "I'll fix your credit".
  { pattern: /\b(voy|vamos)\s+a\s+(arreglar|reparar|limpiar|borrar|eliminar)/i, rule: "diy-positioning" },
  { pattern: /\b(arreglo|reparo|limpio|borro)\s+(tu|su|el)\s+(cr[eé]dito|reporte|historial)/i, rule: "diy-positioning" },
  { pattern: /\b(I|we)\s*('ll|\s+will|\s+can)\s+(fix|repair|clean\s+up|erase|delete)\b/i, rule: "diy-positioning" },
  // Never: real-estate / rent-to-own bait (the Lexington Law pattern)
  { pattern: /rent.to.own|renta\s+con\s+opci[oó]n\s+a\s+compra.*cr[eé]dito/i, rule: "no-real-estate-bait" },
];

// Extra rules for advertising and sales copy (ad scripts, captions, landing
// headlines, sales messages). Stricter than the base set: an ad may not promise
// or imply an outcome, even softly. Not applied to the coach, which has to be
// able to discuss scores and goals in conversation.
const MARKETING_RULES: Rule[] = [
  // Imperative outcome promises: "Mejora tu crédito hoy", "Aumenta tu puntaje".
  {
    pattern: /\b(aumenta|sube|mejora|repara|arregla|limpia)\s+tu\s+(puntaje|puntuaci[oó]n|score|cr[eé]dito|historial)/i,
    rule: "no-outcome-promise",
  },
  { pattern: /\b(raise|boost|improve|increase|fix|repair)\s+your\s+(credit|score)/i, rule: "no-outcome-promise" },
  { pattern: /resultados\s+(reales|garantizados|r[aá]pidos|inmediatos|asegurados)/i, rule: "no-outcome-promise" },
  { pattern: /\b(real|guaranteed|fast|instant)\s+results\b/i, rule: "no-outcome-promise" },
  // Implied purchase outcome: "para que vayas por el carro que siempre quisiste".
  {
    pattern: /para\s+que\s+(vayas|puedas|compres|saques|califiques|estrenes)\b[^.!?]*\b(carro|auto|troca|camioneta|casa|hipoteca|pr[eé]stamo|tarjeta)/i,
    rule: "no-outcome-promise",
  },
  { pattern: /\bso\s+you\s+can\s+(?:\w+\s+)?(buy|get|qualify)\b[^.!?]*\b(car|truck|house|home|mortgage|loan)/i, rule: "no-outcome-promise" },
  // Approval claims belong to lenders, not to us.
  { pattern: /\b(aprobaci[oó]n|aprobado)\s+(garantizad[oa]|segur[oa])|guaranteed\s+approval/i, rule: "no-approval-claims" },
];

function runRules(text: string, rules: Rule[]): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];
  for (const { pattern, rule } of rules) {
    const match = text.match(pattern);
    if (match) violations.push({ pattern: String(pattern), rule, match: match[0] });
  }
  return violations;
}

export function checkClaimGuardrails(text: string): GuardrailViolation[] {
  return runRules(text, RULES);
}

/** Base rules plus the advertising rules. Use for anything a prospect sees before signing up. */
export function checkMarketingCopy(text: string): GuardrailViolation[] {
  return runRules(text, [...RULES, ...MARKETING_RULES]);
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
