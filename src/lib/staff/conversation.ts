import { checkMarketingCopy } from "../compliance/guardrails";
import { BRAND } from "../brand";
import { MAX_MESSAGE_CHARS } from "../chat/history";
import type { EscalatedQuestion, StaffChatMessage, StaffClient } from "./types";

// The client's in-app conversation, as the team reads it and answers in it.
//
// Every message says who wrote it: the client, Capi (always marked as AI) or a
// teammate by name. A teammate's reply is checked against the claim rules
// before it is sent: staff may not promise results in writing, any more than
// an ad may.

export type ThreadVoice = "client" | "capi" | "team";

export interface ThreadAuthor {
  voice: ThreadVoice;
  /** "Cliente", "Capi (IA)" or the teammate's name. */
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

/** Who wrote a message, for the label above it. */
export function threadAuthor(message: StaffChatMessage): ThreadAuthor {
  if (message.role === "user") return { voice: "client", label: "Cliente" };
  if (message.source === "human") {
    return { voice: "team", label: displayName(message.authorName ?? "") || "Equipo" };
  }
  return { voice: "capi", label: `${BRAND.assistant} (IA)` };
}

/** Why each claim rule exists, in the words a teammate needs when a reply is held back. */
const RULE_REASON: Record<string, string> = {
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

export interface ReplyProblem {
  /** The words in the reply that trip the rule, as written. */
  phrase: string;
  /** Why they cannot be sent. */
  why: string;
}

/**
 * What stops a reply from being sent, or an empty list when it may go. The
 * same check ads and sales messages pass (compliance/guardrails.ts).
 */
export function checkStaffReply(text: string): ReplyProblem[] {
  const seen = new Set<string>();
  return checkMarketingCopy(text).flatMap((violation) => {
    const key = `${violation.rule}|${violation.match.toLowerCase()}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [
      {
        phrase: violation.match,
        why: RULE_REASON[violation.rule] ?? "Rompe una de las reglas sobre lo que podemos decir por escrito.",
      },
    ];
  });
}

export const MAX_REPLY_CHARS = MAX_MESSAGE_CHARS;

/** Questions Capi passed to the team that nobody has answered yet, oldest first. */
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
