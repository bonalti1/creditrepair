import { clientTimeZone, isQuietHour } from "../autopilot/clock";
import { checkClaimGuardrails, checkMarketingCopy } from "../compliance/guardrails";
import { BRAND } from "../brand";
import { labelled } from "../leads/autopilot";
import { checkStaffReply } from "../staff/conversation";

// The automatic keyword reply (docs/LIVE-FUNNEL.md, step 2). Pure: the
// webhooks (WhatsApp; SMS when the owner turns it on) ask `decideKeywordReply`
// and send what it returns. Fixed words only, no model writes them: the link,
// that it is AI, that a person will answer, and how to stop.
//
// When it does not reply:
//   - the person said STOP / BAJA (on that channel, or on WhatsApp for SMS);
//   - the same person and the same keyword already got a reply in the window
//     (7 days): the conversation is a person's then;
//   - quiet hours (9 p.m. to 8 a.m. on their clock, Texas when unknown),
//     UNLESS it answers a message they sent in the last few minutes. That is
//     the rule the existing lead greeting follows (the WhatsApp webhook
//     answers a message the person just sent, whatever the hour): a reply to
//     the person's own message is a reply, not an outreach. A message that
//     arrives late (a retry, an outage) is left for a person instead.
//   - a client already (they have an account): the client's assistant answers.

export const REPLY_WINDOW_HOURS = 7 * 24;
/** A message this fresh counts as "just sent": the reply may go in quiet hours. */
export const FRESH_REPLY_MINUTES = 5;
export const FUNNEL_QUIET = { quietStartHour: 21, quietEndHour: 8 } as const;

export type ReplyChannel = "whatsapp" | "sms";

export type KeywordSkip = "client" | "opted_out" | "already_replied" | "quiet_hours" | "words";

export type KeywordDecision = { action: "send"; body: string } | { action: "skip"; reason: KeywordSkip };

export interface KeywordReplyInput {
  channel: ReplyChannel;
  /** The person has an account (a client): the funnel does not answer. */
  isClient: boolean;
  optedOut: boolean;
  /** When this person last got a reply to this keyword (any status but failed), or null. */
  lastReplyAt: string | null;
  /** When they sent the message (the provider's timestamp, else when it arrived). */
  inboundAt: string;
  /** Their state, for the clock; Texas when unknown. */
  state: string | null;
  locale: "en" | "es";
  link: string;
  now: Date;
}

const WORDS: Record<ReplyChannel, Record<"en" | "es", (link: string) => string>> = {
  whatsapp: {
    en: (link) =>
      `Thanks for writing to ${BRAND.name}! Here is your link to have our team review your credit report, at no cost: ${link}\n\nA person on our team will also answer you right here. Reply STOP if you don't want automatic messages.`,
    es: (link) =>
      `¡Gracias por escribir a ${BRAND.name}! Aquí está tu enlace para que nuestro equipo revise tu reporte de crédito, sin costo: ${link}\n\nUna persona de nuestro equipo también te responde aquí mismo. Si no quieres mensajes automáticos, responde BAJA.`,
  },
  // Short: one or two text segments. The STOP line is the carriers' rule.
  sms: {
    en: (link) => `${BRAND.name}: here is your link to have our team review your credit report, at no cost: ${link} Reply STOP to opt out.`,
    es: (link) => `${BRAND.name}: aquí está tu enlace para que nuestro equipo revise tu reporte de crédito, sin costo: ${link} Responde STOP para no recibir más.`,
  },
};

/** The reply's exact words, with the AI label first. */
export function keywordReplyText(channel: ReplyChannel, locale: "en" | "es", link: string): string {
  return labelled(WORDS[channel][locale](link), locale);
}

/** Why these words may not go out, or null. The claim rules, the advertising rules and the staff reply rules; never "free". */
export function funnelWordsProblem(text: string): string | null {
  const words = text.replace(/https?:\/\/\S+/g, "");
  if (checkClaimGuardrails(words).length > 0 || checkMarketingCopy(words).length > 0) return "claims";
  if (checkStaffReply(words, "en").length > 0) return "claims";
  if (/\bfree\b|gratis|gratuit/i.test(words)) return "free";
  if (/\b(ssn|social security|seguro social|date of birth|fecha de nacimiento|card number|n[uú]mero de (tu )?tarjeta)\b/i.test(words)) return "personal_data";
  return null;
}

export function decideKeywordReply(input: KeywordReplyInput): KeywordDecision {
  if (input.isClient) return { action: "skip", reason: "client" };
  if (input.optedOut) return { action: "skip", reason: "opted_out" };
  if (input.lastReplyAt && input.now.getTime() - Date.parse(input.lastReplyAt) < REPLY_WINDOW_HOURS * 3_600_000) return { action: "skip", reason: "already_replied" };
  if (isQuietHour(input.now, clientTimeZone(input.state), FUNNEL_QUIET)) {
    const age = input.now.getTime() - Date.parse(input.inboundAt);
    if (!(Number.isFinite(age) && age >= -60_000 && age <= FRESH_REPLY_MINUTES * 60_000)) return { action: "skip", reason: "quiet_hours" };
  }
  const body = keywordReplyText(input.channel, input.locale, input.link);
  if (funnelWordsProblem(body)) return { action: "skip", reason: "words" };
  return { action: "send", body };
}
