import { BRAND } from "../brand";
import { sensitiveIn } from "../intake/redact";
import type { DraftCaller } from "../staff/drafts";
import { reviewCopyProblems, type L } from "./reviews";

// Alti's draft of a public reply to a review someone left on Google,
// Trustpilot or BBB. A person pastes the review, reads the draft, edits it
// and posts it on the platform themselves: nothing here posts anything.
//
// The rules a reply must pass (replyProblems):
//   - no private information. A public reply must not confirm that the
//     reviewer is our client, nor say anything about their case: no report,
//     items, letters, rounds, bureaus' answers, dates of their service,
//     payments, account or phone numbers. (Being the client of a credit repair
//     company is itself private: GLBA's privacy rule treats a customer
//     relationship with a financial institution as nonpublic information.)
//     Only the first name the reviewer used publicly, if any.
//   - no promise: no result, no refund or credit, nothing in exchange for
//     changing or removing the review, no "we will fix it" (the claim rules);
//   - never asks to remove or change the review (16 C.F.R. § 465.7, review
//     suppression), and never argues with the reviewer;
//   - invites them to continue in private, with the company's contact;
//   - short: at most REPLY_MAX characters.
// A draft that fails is written again once with the reasons; if that fails
// too, the safe fallback (fallbackReply) is offered instead.

export const REPLY_MAX = 900;
export const REVIEW_TEXT_MAX = 4000;

const PRIVATE = [
  /\b(your|tu|su)\s+(case|caso|report|reporte|file|expediente|account|cuenta|letters?|cartas?|round|ronda|dispute|disputa|items?|puntos?|score|puntaje|payment|pago|charge|cobro|contract|contrato)\b/i,
  /\b(equifax|experian|transunion|bureau|bur[oó]s?)\b/i,
  /\b(round|ronda)\s+\d/i,
  /\b(our|nuestros?)\s+(records|registros)\b/i,
  /\b(as\s+our\s+client|como\s+(nuestro|nuestra)\s+cliente|since\s+you\s+(joined|signed)|desde\s+que\s+(firmaste|te\s+inscribiste))\b/i,
  /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/,
];
const PROMISE = [
  /\b(refund|reembols\w*|credit\s+to\s+your|cr[eé]dito\s+a\s+tu|free\s+(month|service)|mes\s+gratis|compensat\w+|compens\w+)\b/i,
  /\b(we('ll|\s+will)\s+(make\s+it\s+right|fix\s+this)|lo\s+(vamos\s+a\s+)?(arreglar|solucionar)emos?)\b/i,
];
const SUPPRESSION = [
  /\b(remove|delete|take\s+down|update|change|edit)\s+(your|this|the)\s+review\b/i,
  /\b(quitar|borrar|eliminar|cambiar|editar|modificar)\s+(tu|su|la|esta)\s+rese[nñ]a\b/i,
  /\b(defamat\w+|difamaci\w+|lawyer|abogad\w+|legal\s+action|acci[oó]n\s+legal)\b/i,
];

/** Everything wrong with a reply, as short codes. Empty: a person may post it. */
export function replyProblems(reply: string): string[] {
  const text = reply.trim();
  const problems = reviewCopyProblems(text);
  if (!text) problems.push("empty");
  if (text.length > REPLY_MAX) problems.push("too_long");
  for (const p of PRIVATE) if (p.test(text)) problems.push(`private:${text.match(p)![0]}`);
  for (const p of PROMISE) if (p.test(text)) problems.push(`promise:${text.match(p)![0]}`);
  for (const p of SUPPRESSION) if (p.test(text)) problems.push(`suppression:${text.match(p)![0]}`);
  if (sensitiveIn(text).length > 0) problems.push("sensitive_number");
  if (/\+?\d[\d\s().-]{8,}\d/.test(text.replace(contactPhone() ?? "\u0000", ""))) problems.push("phone_number");
  return problems;
}

function contactPhone(): string | null {
  return process.env.NEXT_PUBLIC_COMPANY_PHONE?.trim() || null;
}

function contactLine(locale: L): string {
  const email = process.env.NEXT_PUBLIC_COMPANY_EMAIL?.trim();
  const phone = contactPhone();
  const how = [email, phone].filter(Boolean).join(locale === "es" ? " o al " : " or ");
  if (locale === "es") return how ? `Escríbenos a ${how} y una persona del equipo te atiende.` : "Escríbenos por los datos de contacto de nuestra página y una persona del equipo te atiende.";
  return how ? `Please reach us at ${how} and a person on our team will help.` : "Please reach us through the contact details on our website and a person on our team will help.";
}

/** A first name the reviewer showed publicly, or null. Only letters; never a surname. */
export function publicFirstName(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return /^[\p{L}'-]{2,20}$/u.test(first) ? first : null;
}

/** The safe reply when no draft passes: thanks, no details, an invitation to talk in private. */
export function fallbackReply(input: { stars: number | null; name: string | null; locale: L }): string {
  const name = publicFirstName(input.name);
  const es = input.locale === "es";
  const hi = name ? (es ? `Hola, ${name}. ` : `Hi ${name}, `) : es ? "Hola. " : "Hi, ";
  const positive = (input.stars ?? 0) >= 4;
  if (es) {
    return positive
      ? `${hi}gracias por tomarte el tiempo de escribir. Nos alegra leerte. ${contactLine("es")}`
      : `${hi}gracias por tomarte el tiempo de escribir; lo leemos con atención. Por privacidad no hablamos de ningún caso aquí. ${contactLine("es")}`;
  }
  return positive
    ? `${hi}thank you for taking the time to write. We are glad to read it. ${contactLine("en")}`
    : `${hi}thank you for taking the time to write; we read it carefully. For privacy, we do not discuss anyone's situation here. ${contactLine("en")}`;
}

export interface ReplyInput {
  review: string;
  stars: number | null;
  reviewerName: string | null;
  platform: string;
  locale: L;
}

/** What the model is told. Fixed instructions (cached), the review in the user turn. */
export function replyPrompt(input: ReplyInput): { system: string; user: string } {
  const system = `Eres ${BRAND.assistant}, el asistente de ${BRAND.name}, una empresa de servicios de crédito. Redactas la respuesta PÚBLICA de la empresa a una reseña publicada en un sitio de reseñas. Una persona del equipo la lee, la corrige y la publica.

Reglas que no se rompen:
- Nunca confirmes que la persona es o fue cliente, ni digas nada de su caso: ni reporte, ni puntos, ni cartas, ni rondas, ni burós, ni fechas, ni pagos, ni cobros, ni contrato. Por privacidad, no hablamos de ningún caso en público.
- Nunca prometas un resultado, un reembolso, un crédito, un descuento ni nada a cambio. Nunca pidas que quiten, cambien o editen la reseña. Nunca discutas ni culpes a la persona. Nunca menciones abogados ni acciones legales.
- Nunca digas que la empresa elimina, arregla o repara crédito, ni que sube el puntaje.
- Agradece, reconoce lo que la persona dijo en términos generales, e invítala a seguir en privado: ${contactLine(input.locale)}
- Breve: 2 a 4 frases, menos de 600 caracteres. Sin emojis.
- Escribe en ${input.locale === "es" ? "español" : "inglés"}.
- Usa como mucho el primer nombre que la persona mostró en la reseña; nunca un apellido.`;
  const user = `Sitio: ${input.platform}
Estrellas: ${input.stars ?? "no se indicó"}
Nombre público del autor: ${publicFirstName(input.reviewerName) ?? "(no usar nombre)"}
Reseña:
"""
${input.review.slice(0, REVIEW_TEXT_MAX)}
"""

Devuelve solo la respuesta.`;
  return { system, user };
}

export type ReplyOutcome =
  | { draft: string; source: "model" | "fallback"; problems: string[]; reason: string | null };

/**
 * A reply to post: the model's draft when it passes every rule (once more
 * with the reasons if the first fails), else the safe fallback. With no model
 * configured (caller null): the fallback, said so.
 */
export async function draftReviewReply(input: ReplyInput, caller: DraftCaller | null): Promise<ReplyOutcome> {
  const fallback = () => fallbackReply({ stars: input.stars, name: input.reviewerName, locale: input.locale });
  if (!caller) return { draft: fallback(), source: "fallback", problems: [], reason: "not_configured" };
  const prompt = replyPrompt(input);
  let reasons: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const user = attempt === 0 ? prompt.user : `${prompt.user}\n\nTu borrador anterior no se puede publicar por: ${reasons.join("; ")}. Escríbelo otra vez sin eso.`;
    const result = await caller({ system: prompt.system, user });
    if (!result.reply) return { draft: fallback(), source: "fallback", problems: [], reason: result.problem ?? "empty" };
    reasons = replyProblems(result.reply);
    if (reasons.length === 0) return { draft: result.reply.trim(), source: "model", problems: [], reason: null };
  }
  return { draft: fallback(), source: "fallback", problems: reasons, reason: "failed_checks" };
}
