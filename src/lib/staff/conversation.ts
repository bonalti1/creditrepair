import { checkMarketingCopy } from "../compliance/guardrails";
import { BRAND } from "../brand";
import { MAX_MESSAGE_CHARS } from "../chat/history";
import type { EscalatedQuestion, StaffChatMessage, StaffClient } from "./types";
import { type StaffLocale, staffLocaleFallback } from "./i18n/locale";

// The client's in-app conversation, as the team reads it and answers in it.
//
// Every message says who wrote it: the client, the assistant (always marked as AI) or a
// teammate by name. A teammate's reply is checked against the claim rules
// before it is sent: staff may not promise results in writing, any more than
// an ad may. The check reads English and Spanish alike (the claim rules carry
// both); only the reason shown to the teammate follows the console's language.

export type ThreadVoice = "client" | "assistant" | "team";

export interface ThreadAuthor {
  voice: ThreadVoice;
  /** "Client"/"Cliente", the assistant's name with "(AI)"/"(IA)", or the teammate's name. */
  label: string;
}

/** "ana lópez" → "Ana López". Names are typed by hand, often in lower case. */
export function displayName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase("es") + word.slice(1))
    .join(" ");
}

const AUTHOR_WORDS: Record<StaffLocale, { client: string; team: string; ai: string }> = {
  en: { client: "Client", team: "Team", ai: "AI" },
  es: { client: "Cliente", team: "Equipo", ai: "IA" },
};

/** Who wrote a message, for the label above it. */
export function threadAuthor(message: StaffChatMessage, locale: StaffLocale = staffLocaleFallback()): ThreadAuthor {
  const words = AUTHOR_WORDS[locale];
  if (message.role === "user") return { voice: "client", label: words.client };
  if (message.source === "human") {
    return { voice: "team", label: displayName(message.authorName ?? "") || words.team };
  }
  return { voice: "assistant", label: `${BRAND.assistant} (${words.ai})` };
}

/** Why each claim rule exists, in the words a teammate needs when a reply is held back. */
const RULE_REASON_ES: Record<string, string> = {
  "no-guaranteed-deletions": "No se puede garantizar que algo se elimine de un reporte. Lo deciden los burós.",
  "no-points-in-days": "No se prometen puntos ni plazos. Los resultados varían.",
  "no-accurate-removal": "No se ofrece quitar información que es correcta.",
  "diy-positioning": "No se dice que eliminamos, reparamos, arreglamos o borramos algo: es prometer un resultado.",
  "no-real-estate-bait": "No se usa la compra o renta de una casa como gancho.",
  "no-outcome-promise": "No se prometen resultados sobre su crédito o su puntaje.",
  "no-approval-claims": "No se promete una aprobación: eso lo decide quien presta.",
  "client-decides": "No se dice que disputamos todo lo negativo ni que el equipo decide qué disputar: solo se disputa lo que el cliente dice que es inexacto.",
  "self-serve-positioning": "En este modo el cliente envía sus propias cartas: no se dice que disputamos por él.",
};

const RULE_REASON_EN: Record<string, string> = {
  "no-guaranteed-deletions": "Nobody can guarantee that something comes off a report. The bureaus decide.",
  "no-points-in-days": "No promises of points or timelines. Results vary.",
  "no-accurate-removal": "We never offer to remove information that is correct.",
  "diy-positioning": "We don't say we remove, repair, fix or delete anything: that promises a result.",
  "no-real-estate-bait": "We don't use buying or renting a home as bait.",
  "no-outcome-promise": "No promises about their credit or their score.",
  "no-approval-claims": "No promises of approval: the lender decides that.",
  "client-decides": "We don't say we dispute everything negative or that the team decides what to dispute: we only dispute what the client says is inaccurate.",
  "self-serve-positioning": "In this mode the client mails their own letters: we don't say we dispute for them.",
};

const RULE_REASON: Record<StaffLocale, Record<string, string>> = { en: RULE_REASON_EN, es: RULE_REASON_ES };

const OTHER_RULE: Record<StaffLocale, string> = {
  en: "It breaks one of the rules about what we can say in writing.",
  es: "Rompe una de las reglas sobre lo que podemos decir por escrito.",
};

/** Every rule reason, for the tests that check both languages. */
export const RULE_REASONS = RULE_REASON;

export interface ReplyProblem {
  /** The words in the reply that trip the rule, as written. */
  phrase: string;
  /** Why they cannot be sent. */
  why: string;
}

/**
 * What stops a reply from being sent, or an empty list when it may go. The
 * same check ads and sales messages pass (compliance/guardrails.ts), on a
 * reply in English or in Spanish; `locale` is only the language of the reasons.
 */
export function checkStaffReply(text: string, locale: StaffLocale = staffLocaleFallback()): ReplyProblem[] {
  const seen = new Set<string>();
  const violations = [
    ...checkMarketingCopy(text),
    ...REPLY_PROMISES.flatMap(([rule, pattern]) => {
      const match = text.match(pattern);
      return match ? [{ rule, match: match[0] }] : [];
    }),
  ];
  return violations.flatMap((violation) => {
    const key = `${violation.rule}|${violation.match.toLowerCase()}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [
      {
        phrase: violation.match,
        why: RULE_REASON[locale][violation.rule] ?? OTHER_RULE[locale],
      },
    ];
  });
}

/**
 * Promises a one-to-one reply makes in plain words that an ad rarely does
 * ("the collection will be deleted", "you'll be approved"), in English and in
 * Spanish, on top of the claim rules. Said with a "not", an "if" or "nobody
 * can" before them, they are honest and pass.
 */
const HEDGE_EN = String.raw`(?<!\b(?:not|never|no one can|nobody can|can['’]t|cannot|don['’]t|do not|won['’]t|if|whether|unless)\b[^.!?]{0,40})`;
const HEDGE_ES = String.raw`(?<!\b(?:no|nunca|nadie puede|si|aunque)\b[^.!?]{0,40})`;
const REPLY_PROMISES: ReadonlyArray<[string, RegExp]> = [
  ["no-guaranteed-deletions", new RegExp(`${HEDGE_EN}\\b(?:guarantee|promise)[ds]?\\b[^.!?]{0,60}\\b(?:delet|remov|eras|come\\s+off|taken\\s+off|disappear)\\w*`, "i")],
  ["no-guaranteed-deletions", new RegExp(`${HEDGE_EN}\\b(?:will|is going to|are going to)\\s+(?:definitely\\s+|surely\\s+)?(?:be\\s+)?(?:deleted|removed|erased|taken\\s+off)\\b`, "i")],
  ["no-approval-claims", new RegExp(`${HEDGE_EN}\\byou(?:['’]ll|\\s+will|\\s+are\\s+going\\s+to)\\s+(?:be\\s+|get\\s+)?(?:approved|qualify)\\b`, "i")],
  ["no-outcome-promise", new RegExp(`${HEDGE_EN}\\byour\\s+(?:credit\\s+)?(?:score|credit)\\s+will\\s+(?:go\\s+up|rise|improve|increase|climb)\\b`, "i")],
  ["no-guaranteed-deletions", new RegExp(`${HEDGE_ES}\\b(?:se\\s+va|se\\s+van|va|van)\\s+a\\s+(?:eliminar|borrar|quitar|desaparecer)\\b`, "i")],
  ["no-approval-claims", new RegExp(`${HEDGE_ES}\\b(?:te\\s+van\\s+a\\s+aprobar|vas\\s+a\\s+(?:calificar|ser\\s+aprobad[oa]))\\b`, "i")],
  ["no-outcome-promise", new RegExp(`${HEDGE_ES}\\btu\\s+puntaje\\s+va\\s+a\\s+(?:subir|mejorar)\\b`, "i")],
];

export const MAX_REPLY_CHARS = MAX_MESSAGE_CHARS;

/** Questions the assistant passed to the team that nobody has answered yet, oldest first. */
export function openQuestions(client: Pick<StaffClient, "questions">): EscalatedQuestion[] {
  return client.questions.filter((q) => !q.answeredAt).sort((a, b) => a.askedAt.localeCompare(b.askedAt));
}

/** The newest message a teammate wrote, if any. */
export function lastTeamMessage(thread: readonly StaffChatMessage[]): StaffChatMessage | null {
  for (let i = thread.length - 1; i >= 0; i -= 1) {
    const message = thread[i]!;
    if (message.role === "assistant" && message.source === "human") return message;
  }
  return null;
}
