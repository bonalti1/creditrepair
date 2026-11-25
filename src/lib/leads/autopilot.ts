import { aiByline, BRAND } from "../brand";
import { clientTimeZone, isQuietHour, localDay } from "../autopilot/clock";
import { parseOptKeyword } from "../autopilot/optout";
import { checkClaimGuardrails, checkMarketingCopy } from "../compliance/guardrails";
import { containsPersonalData, isGreeting, libraryAnswer, replyProblem } from "../site/askAlti";
import { checkStaffReply } from "../staff/conversation";
import { STAFF_TIME_ZONE } from "../staff/stage";
import { effectiveStage, isClosed, leadLanguage, whatsappWindow } from "./inbox";
import type { HandoffReason, Lead, LeadAutopilotSettings, LeadMessage } from "./types";

// The lead autopilot (docs/CONTROL.md, "Autopilot for leads"). OFF until an
// administrator turns it on. Built on ALTO Control's lead autopilot, with the
// rules of credit repair on top. Pure: the run is autopilotServer.ts.
//
// It may only ever send three things, all fixed words or approved copy:
//   - a greeting that says it is AI and that a person will write;
//   - an answer from the website's FAQ (the same approved library "Ask Alti"
//     answers from), only when it matches the question closely;
//   - the link to sign up in the chat with Alti (/registro).
// No model writes these words: there is nothing to invent. Every message is
// labelled "Alti · AI assistant", passes the claim rules and the "Ask Alti"
// checks (no price, no "free", no promise, no personal data) before it goes,
// and gets an audit row (lead_auto_messages), sent or not.
//
// It never answers: before it was turned on (no backlog), sooner than the
// delay (a person can answer first), twice the same message, a chat a person
// wrote in during the last 6 hours, a closed or signed lead, a number that
// said STOP, outside WhatsApp's 24-hour window, in quiet hours, over the
// caps. It never moves a lead's stage. It never uses SMS.
//
// It hands the chat to a person, and sends nothing, on a complaint, money or
// cancelling, a legal question, results ("how many points"), a request for a
// person, personal data, or anything it has no approved answer for.

const HOUR = 60 * 60 * 1000;
/** Once a person writes in a chat, the autopilot leaves it alone this long. */
export const PERSON_QUIET_MS = 6 * HOUR;

export type AutoKind = "greeting" | "faq" | "signup_link";

export type SkipReason =
  | "off"
  | "client"
  | "closed"
  | "opted_out"
  | "no_message"
  | "answered"
  | "before_on"
  | "too_soon"
  | "person"
  | "done"
  | "window_closed"
  | "quiet_hours"
  | "lead_cap"
  | "daily_cap"
  | "keyword";

export type AutoDecision =
  | { action: "skip"; reason: SkipReason }
  | { action: "handoff"; reason: HandoffReason; inboundAt: string; dedupeKey: string }
  | { action: "send"; kind: AutoKind; body: string; inboundAt: string; dedupeKey: string };

export interface DecisionInput {
  lead: Lead;
  /** The conversation, oldest first. */
  messages: readonly LeadMessage[];
  settings: LeadAutopilotSettings;
  /** Automatic messages already sent today (Texas day): to this lead, and to everyone. */
  sentToday: { lead: number; all: number };
  /** Dedupe keys already on record for this lead (lead_auto_messages). */
  done: ReadonlySet<string>;
  now: Date;
  /** The app's address, for the signup link ("https://credalti.com"). */
  appUrl: string;
}

/** One automatic answer per inbound message, ever. */
export function autoDedupeKey(leadId: string, inboundAt: string): string {
  return `lead-auto:${leadId}:${inboundAt}`;
}

// ── Hand-off ────────────────────────────────────────────────────────────

const fold = (text: string) =>
  ` ${text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ$@\s]/g, " ")
    .replace(/\s+/g, " ")} `;

const HANDOFF_WORDS: ReadonlyArray<[HandoffReason, RegExp]> = [
  ["complaint", /\s(queja|quejar|reclam|estafa|fraude|scam|fraud|complain|complaint|angry|upset|molest|enojad|terrible|horrible|worst|peor|mentira|liar|lied|mintieron|abus|harass|acoso|ripoff|rip off)/],
  ["legal", /\s(abogad|lawyer|attorney|sue\s|demand|lawsuit|court|corte|juez|judge|cfpb|ftc|bbb|fiscal|legal\s|ley\s|law\s|derecho)/],
  ["billing", /\s(precio|price|cost|cuesta|cuanto cuesta|cuanto cobra|cuanto es|cuanto pago|how much|pago|pagar|pay\s|payment|cobr|charge|charg|refund|reembols|devoluc|cancel|tarjeta|card|fee|cuota|dinero|money|\$)/],
  ["results", /\s(garantiz|guarant|puntos|points|score|puntaje|subir|raise|boost|borrar|eliminar|delete|remove|quitar|how fast|que tan rapido|aprob|approv)/],
  ["wants_person", /\s(persona|humano|human|agent|agente|alguien|someone|somebody|representative|representante|llamame|llamenme|call me|call\s|llamada|hablar con|talk to|speak to)/],
];

/** Why a person must take this chat, or null. */
export function handoffReason(text: string): HandoffReason | null {
  if (containsPersonalData(text)) return "personal_data";
  const t = fold(text);
  for (const [reason, pattern] of HANDOFF_WORDS) if (pattern.test(t)) return reason;
  return null;
}

const SIGNUP_WORDS = /\s(sign up|signup|register|registr|inscrib|empez|start|comenz|link|enlace|where do i|donde|como empiezo|how do i begin|how do i start|unirme|join)/;

// ── The words ───────────────────────────────────────────────────────────

const GREETING: Record<"en" | "es", string> = {
  en: `Hi! I'm ${BRAND.assistant}, ${BRAND.name}'s AI assistant, not a person. Thanks for writing. A person on our team will answer you here. If you have a question about how the service works, write it and I'll share what our FAQ says.`,
  es: `¡Hola! Soy ${BRAND.assistant}, el asistente con IA de ${BRAND.name}, no una persona. Gracias por escribir. Una persona de nuestro equipo te responde aquí. Si tienes una pregunta sobre cómo funciona el servicio, escríbela y te comparto lo que dicen nuestras preguntas frecuentes.`,
};

const FAQ_INTRO: Record<"en" | "es", string> = {
  en: "From our FAQ:",
  es: "De nuestras preguntas frecuentes:",
};

const FAQ_OUTRO: Record<"en" | "es", string> = {
  en: "A person on our team can answer anything else here.",
  es: "Una persona de nuestro equipo te puede responder lo demás aquí.",
};

const SIGNUP: Record<"en" | "es", (url: string) => string> = {
  en: (url) => `You can sign up in a chat with me, at your own pace, in about 10 minutes: ${url} You read the agreement before signing and have 3 business days to cancel. A person on our team can also answer your questions here first.`,
  es: (url) => `Puedes registrarte en un chat conmigo, a tu ritmo, en unos 10 minutos: ${url} Lees el acuerdo antes de firmar y tienes 3 días hábiles para cancelar. Si prefieres, una persona de nuestro equipo te responde primero aquí.`,
};

/** "🤖 Alti · AI assistant" on its own line, then the words: every automatic message says it is AI. */
export function labelled(text: string, locale: "en" | "es"): string {
  return `🤖 ${aiByline(locale)}\n${text}`;
}

/** The signup link, crediting the lead's salesperson when there is one. */
export function signupUrl(appUrl: string, salesperson: string | null, locale: "en" | "es"): string {
  const base = appUrl.replace(/\/+$/, "") || "https://credalti.com";
  const params = new URLSearchParams();
  if (salesperson) params.set("r", salesperson);
  params.set("lang", locale);
  return `${base}/registro?${params.toString()}`;
}

/** Why automatic words may not go out, or null. The claim rules, the staff reply rules and "Ask Alti"'s checks. */
export function autoWordsProblem(text: string): string | null {
  if (checkClaimGuardrails(text).length > 0 || checkMarketingCopy(text).length > 0) return "claims";
  if (checkStaffReply(text, "en").length > 0) return "claims";
  // The link and the label are ours; the words around them are checked as "Ask Alti" checks a reply.
  const words = text.replace(/https?:\/\/\S+/g, "").replace(/🤖[^\n]*\n/, "");
  return replyProblem(words) === "too_long" ? null : replyProblem(words);
}

/** The words for an automatic answer to `text`, or why there are none (a hand-off). */
export function composeAutoReply(
  text: string,
  context: { firstAnswer: boolean; locale: "en" | "es"; sendSignupLink: boolean; appUrl: string; salesperson: string | null },
): { kind: AutoKind; body: string } | { handoff: HandoffReason } {
  const reason = handoffReason(text);
  if (reason) return { handoff: reason };
  const { locale } = context;
  const t = fold(text);
  let reply: { kind: AutoKind; words: string } | null = null;
  if (context.sendSignupLink && SIGNUP_WORDS.test(t)) {
    reply = { kind: "signup_link", words: SIGNUP[locale](signupUrl(context.appUrl, context.salesperson, locale)) };
  } else {
    const faq = isGreeting(text) ? null : libraryAnswer(text, locale);
    if (faq) reply = { kind: "faq", words: `${FAQ_INTRO[locale]} ${faq.a}\n\n${FAQ_OUTRO[locale]}` };
    else if (context.firstAnswer) reply = { kind: "greeting", words: GREETING[locale] };
  }
  if (!reply) return { handoff: "no_fact" };
  const body = labelled(reply.words, locale);
  if (autoWordsProblem(body)) return { handoff: "guardrails" };
  return { kind: reply.kind, body };
}

// ── The decision ────────────────────────────────────────────────────────

/** What the autopilot does about this lead now: nothing (and why), hand it to a person, or send. */
export function decideAutoReply(input: DecisionInput): AutoDecision {
  const { lead, messages, settings, now } = input;
  if (!settings.enabled) return { action: "skip", reason: "off" };
  if (lead.signedAt || lead.clientUserId) return { action: "skip", reason: "client" };
  if (isClosed(effectiveStage(lead))) return { action: "skip", reason: "closed" };
  if (lead.optedOutAt) return { action: "skip", reason: "opted_out" };

  const real = messages.filter((m) => m.source !== "highlevel");
  const last = real[real.length - 1];
  if (!last) return { action: "skip", reason: "no_message" };
  if (last.role !== "user") return { action: "skip", reason: "answered" };
  const inboundAt = last.at;
  if (!settings.enabledAt || inboundAt < settings.enabledAt) return { action: "skip", reason: "before_on" };
  if (now.getTime() - Date.parse(inboundAt) < settings.replyDelaySeconds * 1000) return { action: "skip", reason: "too_soon" };
  const dedupeKey = autoDedupeKey(lead.id, inboundAt);
  if (input.done.has(dedupeKey)) return { action: "skip", reason: "done" };
  const personSince = Math.max(Date.parse(settings.enabledAt), now.getTime() - PERSON_QUIET_MS);
  if (real.some((m) => m.source === "human" && Date.parse(m.at) >= personSince)) return { action: "skip", reason: "person" };
  if (whatsappWindow(inboundAt, now).state === "closed") return { action: "skip", reason: "window_closed" };

  // The lead's own words since the last answer: several short messages get one answer.
  const lastAnswer = [...real].reverse().find((m) => m.role === "assistant");
  const pending = real.filter((m) => m.role === "user" && (!lastAnswer || m.at > lastAnswer.at));
  const text = pending.map((m) => m.text).join("\n").slice(0, 2000);
  if (parseOptKeyword(text.trim())) return { action: "skip", reason: "keyword" };

  // A hand-off is never held back by quiet hours or caps: a person must know.
  const locale = leadLanguage(lead);
  const reply = composeAutoReply(text, {
    firstAnswer: !real.some((m) => m.role === "assistant"),
    locale,
    sendSignupLink: settings.sendSignupLink,
    appUrl: input.appUrl,
    salesperson: lead.salesperson,
  });
  if ("handoff" in reply) return { action: "handoff", reason: reply.handoff, inboundAt, dedupeKey };

  if (isQuietHour(now, clientTimeZone(lead.state ?? null), settings)) return { action: "skip", reason: "quiet_hours" };
  if (input.sentToday.lead >= settings.perLeadDailyCap) return { action: "skip", reason: "lead_cap" };
  if (input.sentToday.all >= settings.dailyCap) return { action: "skip", reason: "daily_cap" };
  return { action: "send", kind: reply.kind, body: reply.body, inboundAt, dedupeKey };
}

/** The Texas day an automatic message counts against. */
export function capDay(at: Date | string): string {
  return localDay(typeof at === "string" ? new Date(at) : at, STAFF_TIME_ZONE);
}

/** What the switch screen says each skip means, for the audit list. */
export const SKIP_TEXT: Record<"en" | "es", Partial<Record<SkipReason, string>>> = {
  en: { quiet_hours: "Waiting for the end of quiet hours", lead_cap: "This lead reached today's limit", daily_cap: "Today's limit for everyone reached" },
  es: { quiet_hours: "Espera a que terminen las horas de silencio", lead_cap: "Este prospecto llegó al límite de hoy", daily_cap: "Se llegó al límite de hoy para todos" },
};

/** The three things it may say, as the settings screen lists them (the exact words, in both languages). */
export function autopilotSamples(appUrl: string): Record<"en" | "es", { greeting: string; signup: string; faqIntro: string }> {
  return {
    en: { greeting: labelled(GREETING.en, "en"), signup: labelled(SIGNUP.en(signupUrl(appUrl, null, "en")), "en"), faqIntro: FAQ_INTRO.en },
    es: { greeting: labelled(GREETING.es, "es"), signup: labelled(SIGNUP.es(signupUrl(appUrl, null, "es")), "es"), faqIntro: FAQ_INTRO.es },
  };
}
