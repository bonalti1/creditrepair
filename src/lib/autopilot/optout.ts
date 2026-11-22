import { BRAND } from "../brand";
import type { MessageLocale } from "./types";

// "BAJA" / "STOP": the client asks for no more automatic messages. Honored
// from the next run on, recorded in message_opt_outs (migration 0015), and
// shown to the team. "ALTA" / "START" turns them back on.
//
// The words are the usual carrier keywords and the ones the FCC's 2024
// revocation rule names (stop, quit, end, revoke, opt out, cancel,
// unsubscribe), in Spanish and English. "CANCELAR" may mean the agreement:
// the reply says how to cancel that too.
//
// Only a message that is the keyword and nothing else counts, so "no puedo
// parar de pensar en esto" or "stop by tomorrow" is a message, not an opt-out.
// Accents, case, punctuation and spaces around it do not matter.
//
// The opt-out stops automatic messages only. The client can still write to
// us, and a person on the team can still answer them.

export const OPT_OUT_WORDS = ["BAJA", "STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPT OUT", "OPTOUT", "PARAR", "ALTO", "NO MAS", "NO MAS MENSAJES", "CANCELAR"] as const;
export const OPT_IN_WORDS = ["ALTA", "START", "UNSTOP", "SUSCRIBIR"] as const;

export type OptKeyword = { kind: "opt_out" | "opt_in"; keyword: string };

function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** The keyword the message is, or null when it is an ordinary message. */
export function parseOptKeyword(text: string): OptKeyword | null {
  const word = plain(text);
  if ((OPT_OUT_WORDS as readonly string[]).includes(word)) return { kind: "opt_out", keyword: word };
  if ((OPT_IN_WORDS as readonly string[]).includes(word)) return { kind: "opt_in", keyword: word };
  return null;
}

/** The one reply to a keyword (a reply inside the 24-hour window, so plain text is allowed). */
export function optReply(kind: OptKeyword["kind"], locale: MessageLocale): string {
  if (kind === "opt_out") {
    return locale === "es"
      ? `Listo. ${BRAND.name} ya no te enviará mensajes automáticos. Puedes seguir escribiéndonos cuando quieras y una persona del equipo te responde. Si cambias de opinión, escribe ALTA. Si lo que quieres es cancelar tu acuerdo de servicio, lo haces en la app, en «Mi acuerdo».`
      : `Done. ${BRAND.name} will not send you automated messages anymore. You can still write to us anytime and a person on our team will answer. If you change your mind, reply START. If you want to cancel your service agreement, you can do it in the app, under "My agreement".`;
  }
  return locale === "es"
    ? `Listo. Vuelves a recibir los avisos automáticos de ${BRAND.name}. Para dejar de recibirlos, escribe BAJA.`
    : `Done. You will receive ${BRAND.name}'s automated updates again. To stop them, reply STOP.`;
}

/**
 * The client's state from their records, newest last: opted out when the most
 * recent record is an opt-out.
 */
export function currentOptOut<T extends { kind: "opt_out" | "opt_in"; at: string }>(records: readonly T[]): T | null {
  const last = [...records].sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  return last && last.kind === "opt_out" ? last : null;
}
