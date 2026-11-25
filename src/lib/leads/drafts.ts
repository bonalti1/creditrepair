import { BRAND } from "../brand";
import { redactSensitive } from "../intake/redact";
import { askLibrary } from "../site/askAlti";
import { bestMatch, type AnswerMatch, type SavedAnswer } from "../staff/answers";
import type { ReplyProblem } from "../staff/conversation";
import { DRAFT_MESSAGES, draftProblems, type DraftCaller } from "../staff/drafts";
import { MAX_REPLY_CHARS } from "../staff/conversation";
import type { StaffLocale } from "../staff/i18n/locale";
import { effectiveStage, leadLanguage } from "./inbox";
import type { Lead, LeadMessage } from "./types";

// ✨ Suggest reply, in the lead inbox: Alti's drafted-reply engine
// (src/lib/staff/drafts.ts) pointed at a lead instead of a client. The same
// caller (draftModel.ts: Claude, structured output, cached instructions), the
// same checks (draftProblems: the staff reply rules, no amount, no advice on
// what to mark, nothing SSN-like), the same one retry with the reasons, the
// same "no draft, and why" when it fails or there is no key.
//
// Facts only: the model gets the service facts below, the website's FAQ (the
// approved answers "Ask Alti" uses), the closest approved saved answer, and
// the conversation (sensitive numbers redacted). No price, no result, no
// promise. A person reads it, edits it and sends it, signed with their name;
// the send path checks it again.

export const LEAD_DRAFT_SYSTEM_PROMPT = `Escribes BORRADORES de respuesta por WhatsApp para una persona de ventas de ${BRAND.name}. Esa persona lee el borrador, lo corrige si hace falta y lo envía firmado con su nombre. Tú no envías nada. La persona que escribe todavía NO es cliente: es un prospecto.

Sobre ${BRAND.name} (lo que es cierto y se puede decir):
- Es una empresa de servicios de crédito con servicio completo, en inglés y en español. Hoy trabaja en Texas.
- El cliente revisa su reporte y dice qué está inexacto; el equipo prepara y envía por correo las cartas de disputa, en rondas de unos 40 días. Los burós deciden el resultado.
- Para empezar, el prospecto recibe un enlace personal (la invitación) o se registra en un chat con ${BRAND.assistant}. Firma el acuerdo de servicio en la app y tiene 3 días hábiles para cancelar sin costo.
- El monitoreo de crédito es una suscripción aparte que se le paga al servicio de monitoreo.
- El plan y la cuota están escritos en el acuerdo, antes de firmar. Nunca se cobra un trabajo antes de hacerlo.

Reglas (obligatorias, sin excepción):
1. Nunca prometas ni insinúes un resultado: nada de eliminar, borrar, reparar, limpiar, subir el puntaje, aprobaciones ni plazos de resultados.
2. Nunca des un precio, un monto ni una cifra de dinero, ni descuentos. Si preguntan el precio, di que el plan se explica por escrito antes de firmar y que la persona se lo comparte.
3. Nada de presión ni urgencia ("hoy", "últimos lugares"). Nada de "gratis".
4. No vendas por teléfono ni ofrezcas llamar para cerrar: todo por escrito, aquí.
5. Nunca digas qué marcar como inexacto: la decisión es del cliente.
6. Nunca pidas ni escribas números de Seguro Social, fechas de nacimiento ni números de cuenta. Los documentos se suben en la app, nunca por WhatsApp.
7. Usa solo los datos que te damos (los hechos de arriba y las preguntas frecuentes). Si no lo sabes, di que lo confirmas y le escribes.
8. Escribe como la persona del equipo, en primera persona. No firmes. No digas que eres una IA.

Estilo: cálido, claro, frases cortas; de 2 a 5 frases. Usa el nombre si lo sabes. Escribe en el idioma que te indicamos.

Responde solo con el JSON pedido: {"reply": "..."}.`;

export type LeadDraftOutcome =
  | { ok: true; draft: string; retried: boolean; savedAnswer: AnswerMatch | null }
  | { ok: false; code: "nothing_to_answer" | "not_configured" | "model_error" | "failed_rules"; message: string; problems?: ReplyProblem[]; savedAnswer: AnswerMatch | null };

const MAX_LINES = 12;

/** What the lead wrote since the last answer, or their last message. */
export function leadQuestion(messages: readonly LeadMessage[]): string | null {
  const lastAnswer = [...messages].reverse().find((m) => m.role === "assistant" && m.source !== "journey");
  const pending = messages.filter((m) => m.role === "user" && (!lastAnswer || m.at > lastAnswer.at));
  const text = pending.map((m) => m.text).join("\n").trim();
  return text || null;
}

export function leadDraftUserMessage(input: { lead: Lead; messages: readonly LeadMessage[]; question: string; savedAnswer: SavedAnswer | null; retryReasons?: string[] }): string {
  const language = leadLanguage(input.lead);
  const lines: string[] = [];
  lines.push("DATOS DEL PROSPECTO (solo estos):");
  lines.push(`- Nombre: ${input.lead.name?.split(" ")[0] ?? "(no lo sabemos)"}`);
  lines.push(`- Estado donde vive: ${input.lead.state ?? "(no lo sabemos; pregúntalo si hace falta)"}`);
  lines.push(`- Etapa: ${effectiveStage(input.lead)}`);
  lines.push(`- Escribe el borrador en ${language === "es" ? "ESPAÑOL" : "INGLÉS"}.`);
  lines.push("");
  lines.push("PREGUNTAS FRECUENTES APROBADAS (puedes usar estas respuestas):");
  for (const entry of askLibrary(language).slice(0, 14)) lines.push(`- P: ${entry.q}\n  R: ${entry.a}`);
  lines.push("");
  lines.push("CONVERSACIÓN RECIENTE (la más nueva al final):");
  for (const m of input.messages.slice(-MAX_LINES)) {
    const who = m.role === "user" ? "Prospecto" : m.source === "human" ? `Equipo (${m.authorName ?? "persona"})` : `${BRAND.assistant} (IA)`;
    lines.push(`${who}: ${redactSensitive(m.text.replace(/\s+/g, " ").trim()).slice(0, 800)}`);
  }
  lines.push("");
  lines.push(`LO QUE HAY QUE RESPONDER: ${redactSensitive(input.question).slice(0, 1000)}`);
  if (input.savedAnswer) {
    lines.push("");
    lines.push(`RESPUESTA APROBADA DEL EQUIPO QUE SE PARECE (a «${input.savedAnswer.question}»):`);
    lines.push(input.savedAnswer.answer);
  }
  if (input.retryReasons?.length) {
    lines.push("");
    lines.push("TU BORRADOR ANTERIOR NO SE PUDO MOSTRAR por esto. Escríbelo de nuevo sin esos problemas:");
    lines.push(...input.retryReasons.map((r) => `- ${r}`));
  }
  return lines.join("\n");
}

export async function draftLeadReply(
  input: { lead: Lead; messages: readonly LeadMessage[]; savedAnswers?: readonly SavedAnswer[]; locale?: StaffLocale },
  caller: DraftCaller | null,
): Promise<LeadDraftOutcome> {
  const words = DRAFT_MESSAGES[input.locale ?? "en"];
  const question = leadQuestion(input.messages);
  const savedAnswer = question ? bestMatch(question, input.savedAnswers ?? [], undefined, leadLanguage(input.lead)) : null;
  if (!question) return { ok: false, code: "nothing_to_answer", message: input.locale === "es" ? "El prospecto no tiene un mensaje esperando respuesta." : "The lead has no message waiting for an answer.", savedAnswer };
  if (!caller) return { ok: false, code: "not_configured", message: words.noKey, savedAnswer };
  let reasons: string[] = [];
  let last = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const answer = await caller({
      system: LEAD_DRAFT_SYSTEM_PROMPT,
      user: leadDraftUserMessage({ lead: input.lead, messages: input.messages, question, savedAnswer: savedAnswer?.answer ?? null, retryReasons: attempt > 0 ? reasons : undefined }),
    });
    if (answer.problem === "not_configured") return { ok: false, code: "not_configured", message: words.noKey, savedAnswer };
    const text = answer.reply?.trim().slice(0, MAX_REPLY_CHARS) ?? "";
    last = text;
    if (!text) return { ok: false, code: "model_error", message: words.modelError(BRAND.assistant), savedAnswer };
    const problems = [...draftProblems(text, "es"), ...(/\bgratis\b|\bfree\b/i.test(text) ? [{ phrase: "free / gratis", why: "No se dice «gratis»." }] : [])];
    if (problems.length === 0) return { ok: true, draft: text, retried: attempt > 0, savedAnswer };
    reasons = problems.map((p) => `«${p.phrase}»: ${p.why}`);
  }
  return { ok: false, code: "failed_rules", message: words.failedRules(BRAND.assistant), problems: draftProblems(last, input.locale ?? "en"), savedAnswer };
}

/** The demo's stand-in for the model (no key): a short reply in the lead's language that only acknowledges, through the same checks. */
export const demoLeadDraftCaller: DraftCaller = async ({ user }) => {
  const name = user.match(/^- Nombre: (.+)$/m)?.[1]?.trim() ?? "";
  const first = name.startsWith("(") ? "" : name;
  const english = /Escribe el borrador en INGLÉS/.test(user);
  return {
    problem: null,
    reply: english
      ? `Hi${first ? ` ${first}` : ""}, thanks for writing. Here's how we work: you review your report and tell us what looks inaccurate, and our team prepares and mails the dispute letters. The plan is explained in writing before you sign. Want me to send you the link to start?`
      : `Hola${first ? ` ${first}` : ""}, gracias por escribir. Así trabajamos: tú revisas tu reporte y nos dices qué está inexacto, y nuestro equipo prepara y envía las cartas de disputa. El plan se explica por escrito antes de firmar. ¿Te mando el enlace para empezar?`,
  };
};
