import { SERVICE_MODE, type ServiceMode } from "../service/mode";

// Armor #3 (spec §3): claim guardrails, enforced in the content pipeline (ES
// and EN). Used to lint anything a client or a prospect reads: landing pages,
// WhatsApp templates, Capi's replies, staff replies, ad scripts.
//
// Two levels: checkClaimGuardrails (everything we send) and checkMarketingCopy
// (ads and sales copy, which adds outcome-promise rules).
//
// What the rules separate is PROCESS from OUTCOME.
//
//  - Outcome is banned in every service mode. We never say or imply that
//    something comes off a report, that a score goes up, or by when: "we
//    remove", "eliminamos", "limpiamos tu reporte", "te subimos el puntaje",
//    guarantees, points, timeframes, approvals. The bureaus decide.
//  - Process is what we actually do, and what may be said depends on the mode
//    (src/lib/service/mode.ts). Under full service the team prepares and mails
//    the letters, so "preparamos y enviamos tus cartas" and "disputamos por ti
//    los puntos que tú nos indicas" are true and allowed. Under self-serve the
//    client sends their own letters, so "we dispute" is false and banned.
//  - In every mode the client decides what is inaccurate. "We dispute
//    everything negative" and "we decide what to dispute" are banned.
//
// A plain denial is not a claim: "no eliminamos nada", "no garantizamos
// resultados", "we do not guarantee results" pass. "No solo eliminamos…" is
// not a denial and does not.

export interface GuardrailViolation {
  pattern: string;
  rule: string;
  match: string;
}

interface Rule {
  pattern: RegExp;
  rule: string;
  /** The modes the rule applies in. Left out: every mode. */
  modes?: readonly ServiceMode[];
}

// "no", "nunca", "ni" right before the verb, with or without a pronoun between
// them ("no te garantizamos").
const NOT_ES = String.raw`(?<!\b(?:no|nunca|jam[aá]s|ni)\s+(?:(?:te|le|les|se|lo|la|los|las|nos)\s+)?)`;
// "do not", "don't", "never", "cannot" right before the verb.
const NOT_EN = String.raw`(?<!\b(?:not|never|cannot)\s+|n['’]t\s+)`;

const re = (source: string) => new RegExp(source, "i");

const RULES: Rule[] = [
  // Never: guaranteed deletions or results.
  { pattern: re(String.raw`${NOT_EN}\bguarantee[ds]?\s+(deletion|removal|result)`), rule: "no-guaranteed-deletions" },
  {
    pattern: re(String.raw`${NOT_ES}\bgarantiza(mos|do|da)?s?\s+(la\s+)?(eliminaci[oó]n|borrado|resultado)`),
    rule: "no-guaranteed-deletions",
  },
  { pattern: /\b(eliminaci[oó]n|borrado)\s+garantizad[oa]s?\b/i, rule: "no-guaranteed-deletions" },
  // Never: "X points in Y days".
  { pattern: /\d+\s*(points?|puntos?)\s*(in|en)\s*\d+\s*(days?|d[ií]as?|weeks?|semanas?|months?|meses?)/i, rule: "no-points-in-days" },
  // Never: removal of accurate information.
  { pattern: /remove\s+(accurate|correct|valid)\s+(info|information|items?)/i, rule: "no-accurate-removal" },
  { pattern: /elimina(r|mos)?\s+informaci[oó]n\s+(correcta|exacta|v[aá]lida)/i, rule: "no-accurate-removal" },

  // Never, in any mode: "we" as the one who produces the result. Removing,
  // fixing, repairing, deleting, cleaning up a report and raising a score are
  // outcomes, and outcomes are the bureaus' to decide.
  // (The id "diy-positioning" is from when the product was self-serve only. It
  // is kept because the staff reply check, the ad gate and the tests key on it.)
  { pattern: /\bwe\s+(remove|fix|repair|delete|erase|clean\s+up)\b/i, rule: "diy-positioning" },
  {
    pattern: re(String.raw`${NOT_ES}\b(nosotros\s+)?(eliminamos|reparamos|arreglamos|borramos|limpiamos)\b`),
    rule: "diy-positioning",
  },
  // The same promise in the first person or the future tense, the way a mascot
  // or a salesperson would say it: "te voy a arreglar tu crédito", "I'll fix your credit".
  { pattern: re(String.raw`${NOT_ES}\b(voy|vamos)\s+a\s+(arreglar|reparar|limpiar|borrar|eliminar)`), rule: "diy-positioning" },
  { pattern: /\b(arreglo|reparo|limpio|borro)\s+(tu|su|el)\s+(cr[eé]dito|reporte|historial)/i, rule: "diy-positioning" },
  { pattern: /\b(I|we)\s*('ll|’ll|\s+will|\s+can)\s+(remove|fix|repair|clean\s+up|erase|delete)\b/i, rule: "diy-positioning" },
  // Raising a score is an outcome too: "te subimos el puntaje", "we'll raise your score".
  {
    pattern: re(
      String.raw`${NOT_ES}\b(subimos|aumentamos|mejoramos)\s+(tu|el|su)\s+(puntaje|puntuaci[oó]n|score|cr[eé]dito|historial|perfil)`,
    ),
    rule: "diy-positioning",
  },
  {
    pattern: re(
      String.raw`${NOT_ES}\b(voy|vamos)\s+a\s+(subir|aumentar|mejorar)(te|le)?\s+(tu|el|su)\s+(puntaje|puntuaci[oó]n|score|cr[eé]dito|historial)`,
    ),
    rule: "diy-positioning",
  },
  {
    pattern: /\b(I|we)\s*('ll|’ll|\s+will|\s+can)?\s+(raise|boost|increase|improve)\s+your\s+(credit|score)/i,
    rule: "diy-positioning",
  },

  // Never, in any mode: the client's decisions made by someone else. Only what
  // the client says is inaccurate is disputed, so "we dispute everything
  // negative" is false, and so is any wording where the team picks the items
  // or tells the client which ones to mark.
  {
    pattern: re(
      String.raw`${NOT_ES}\b(disputamos|disputaremos|disputo|disputar[eé]|(voy|vamos)\s+a\s+disputar|podemos\s+disputar|se\s+disputa)\s+(por\s+ti\s+)?(todo\b(?!\s+lo\s+que)|lo\s+(negativo|malo)|tod[oa]s\s+(l[oa]s\s+)?(\w+\s+)?(negativ[oa]s|mal[oa]s))`,
    ),
    rule: "client-decides",
  },
  {
    pattern:
      /\b(we|I|our\s+team|the\s+team)(\s+will|'ll|’ll|\s+can)?\s+disputes?\s+(for\s+you\s+)?(everything\b(?!\s+(you|that\s+you))|every\s+(negative|bad)\s+\w+|all\s+(of\s+)?(your\s+|the\s+)?(negative|bad|derogatory)\b|anything\s+negative|the\s+negatives?\b)/i,
    rule: "client-decides",
  },
  {
    pattern: re(
      String.raw`${NOT_ES}\b(decidimos|elegimos|escogemos|seleccionamos|decido|elijo|escojo)\s+(por\s+ti\s+)?(qu[eé]|cu[aá]l(es)?|lo\s+que)\s+(\w+\s+)?(se\s+)?(disput\w+|marc\w+|es\s+inexact\w+|son\s+inexact\w+|est[aá]\s+mal)`,
    ),
    rule: "client-decides",
  },
  {
    pattern:
      /\b(el|nuestro|tu)\s+equipo\s+(decide|elige|escoge|selecciona)\s+(por\s+ti\s+)?(qu[eé]|cu[aá]l(es)?|lo\s+que)\s+(\w+\s+)?(se\s+)?(disput\w+|marc\w+|es\s+inexact\w+|son\s+inexact\w+|est[aá]\s+mal)/i,
    rule: "client-decides",
  },
  {
    pattern:
      /(?<!\b(?:no|nunca|jam[aá]s|ni)\s+)\bte\s+(decimos|digo|diremos|indicamos|recomendamos|sugerimos)\s+(qu[eé]|cu[aá]l(es)?)\s+(\w+\s+)?(disputar|marcar)/i,
    rule: "client-decides",
  },
  {
    pattern:
      /\b(we|I|our\s+team|the\s+team|staff)\s+(decide|choose|pick|select)s?\s+(what|which)\b[^.!?]*\b(disput\w+|inaccurate|wrong|flag|mark)/i,
    rule: "client-decides",
  },
  { pattern: /\bwe('ll|’ll|\s+will|\s+can)?\s+tell\s+you\s+(what|which)\b[^.!?]*\b(dispute|flag|mark)/i, rule: "client-decides" },

  // Self-serve only: there the client sends their own letters, so saying that
  // we dispute is false. Under full service it describes the work and is allowed.
  { pattern: /\bwe\s+dispute\b/i, rule: "self-serve-positioning", modes: ["self_serve"] },
  {
    pattern: re(String.raw`${NOT_ES}\b(nosotros\s+)?disputamos\b`),
    rule: "self-serve-positioning",
    modes: ["self_serve"],
  },

  // Never: real-estate / rent-to-own bait (the Lexington Law pattern)
  { pattern: /rent.to.own|renta\s+con\s+opci[oó]n\s+a\s+compra.*cr[eé]dito/i, rule: "no-real-estate-bait" },
];

// Extra rules for advertising and sales copy (ad scripts, captions, landing
// headlines, sales messages, staff replies). Stricter than the base set: an ad
// may not promise or imply an outcome, even softly. Not applied to the coach,
// which has to be able to discuss scores and goals in conversation.
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

function runRules(text: string, rules: Rule[], mode: ServiceMode): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];
  for (const { pattern, rule, modes } of rules) {
    if (modes && !modes.includes(mode)) continue;
    const match = text.match(pattern);
    if (match) violations.push({ pattern: String(pattern), rule, match: match[0] });
  }
  return violations;
}

/**
 * The rules for everything we send. `mode` is how the service is delivered;
 * leave it out to use the mode the app is running in.
 */
export function checkClaimGuardrails(text: string, mode: ServiceMode = SERVICE_MODE): GuardrailViolation[] {
  return runRules(text, RULES, mode);
}

/** Base rules plus the advertising rules. Use for anything a prospect sees before signing up. */
export function checkMarketingCopy(text: string, mode: ServiceMode = SERVICE_MODE): GuardrailViolation[] {
  return runRules(text, [...RULES, ...MARKETING_RULES], mode);
}

/** Throwing variant for the content pipeline: refuse to ship copy that violates guardrails. */
export function assertClaimGuardrails(text: string, context: string, mode: ServiceMode = SERVICE_MODE): void {
  const violations = checkClaimGuardrails(text, mode);
  if (violations.length > 0) {
    throw new Error(
      `Claim guardrail violation in ${context}: ${violations.map((v) => `${v.rule} ("${v.match}")`).join("; ")}`,
    );
  }
}
