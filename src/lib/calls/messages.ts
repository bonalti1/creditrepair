import { insideWhatsAppWindow, templateApproved } from "../autopilot/channels";
import { isQuietHour, nextAllowedTime } from "../autopilot/clock";
import { FOOTER, type MessageTemplate } from "../autopilot/templates";
import type { Channel, ChannelAvailability } from "../autopilot/types";
import { BRAND } from "../brand";
import { QUESTIONS_ONLY } from "./config";
import { slotDay, slotTime, zoneLabel } from "./slots";

// The confirmation and the reminder of a booked call (docs/SIGNUP-CHAT.md),
// under the same rules as every automatic message (docs/AUTOPILOT.md):
//
//   - WhatsApp or email, never SMS (there is no SMS channel here at all);
//   - nothing to a number or account that opted out (BAJA / STOP);
//   - nothing in quiet hours on the person's clock: the confirmation waits
//     for the morning, the reminder is skipped if it would come too late;
//   - each message once, under its dedupe key (call:<booking>:<kind>);
//   - every line says the call is for questions only, and the words pass the
//     claim rules before they are sent (whatsapp.ts / email.ts check again).
//
// WhatsApp outside the 24-hour window needs a template Meta approved; these
// two are listed for approval with the others (WHATSAPP_APPROVED_TEMPLATES).
// Email needs an account (the unsubscribe link is signed with its id), so a
// person without one is confirmed on WhatsApp.

export type CallMessageKind = "confirmation" | "reminder";

/** The reminder goes this long before the call. */
export const REMINDER_HOURS_BEFORE = 3;
/** A reminder that cannot go (quiet hours) at least this long before the call is skipped. */
export const REMINDER_MIN_MINUTES_BEFORE = 30;

const T = (name: string, purpose: string, params: string[], es: string, en: string): MessageTemplate => ({ name, purpose, params, body: { es, en } });

export const CALL_TEMPLATES: Record<CallMessageKind, MessageTemplate> = {
  confirmation: T(
    "credalti_llamada_confirmada",
    "Confirma una llamada que la persona reservó. Solo preguntas; nada se vende en la llamada.",
    ["nombre", "dia", "hora", "referencia"],
    `Hola {{1}}, tu llamada con el equipo de ${BRAND.name} quedó para el {{2}} a las {{3}}. ${QUESTIONS_ONLY.es.short} Tu número de caso: {{4}}. Para cambiarla, responde aquí.`,
    `Hi {{1}}, your call with the ${BRAND.name} team is set for {{2}} at {{3}}. ${QUESTIONS_ONLY.en.short} Your case number: {{4}}. To change it, reply here.`,
  ),
  reminder: T(
    "credalti_llamada_recordatorio",
    "Recuerda la llamada unas horas antes. Solo preguntas.",
    ["nombre", "hora", "referencia"],
    `Hola {{1}}, te recordamos tu llamada con el equipo de ${BRAND.name} hoy a las {{2}}. ${QUESTIONS_ONLY.es.short} Caso {{3}}. Si ya no puedes, responde aquí.`,
    `Hi {{1}}, a reminder of your call with the ${BRAND.name} team today at {{2}}. ${QUESTIONS_ONLY.en.short} Case {{3}}. If you can no longer make it, reply here.`,
  ),
};

export interface BookingForMessages {
  id: string;
  firstName: string;
  phone: string;
  email: string | null;
  userId: string | null;
  confirmChannel: Channel;
  locale: "es" | "en";
  timeZone: string;
  slotStart: string;
  createdAt: string;
  caseRef: string | null;
  status: "booked" | "cancelled" | "completed" | "no_answer";
  /** The person's last WhatsApp message to us, if any (the 24-hour window). */
  lastInboundAt?: string | null;
}

export interface CallMessageContext {
  quiet: { quietStartHour: number; quietEndHour: number };
  /** The newest opt-out record of the number or the account says "out". */
  optedOut: boolean;
  /** Dedupe keys already written (sent, failed or being sent). */
  written: ReadonlySet<string>;
  channels: ChannelAvailability;
}

export interface PlannedCallMessage {
  dedupeKey: string;
  kind: CallMessageKind;
  channel: Channel;
  /** "text" inside the 24-hour window, else the approved template. */
  mode: "text" | "template" | "email";
  template: MessageTemplate;
  params: string[];
  locale: "es" | "en";
  body: string;
}

export function callDedupeKey(bookingId: string, kind: CallMessageKind): string {
  return `call:${bookingId}:${kind}`;
}

export function callMessageParams(booking: BookingForMessages, kind: CallMessageKind): string[] {
  const time = `${slotTime(booking.slotStart, booking.timeZone, booking.locale)} (${zoneLabel(booking.slotStart, booking.timeZone, booking.locale)})`;
  const ref = booking.caseRef ?? "—";
  return kind === "confirmation"
    ? [booking.firstName, slotDay(booking.slotStart, booking.timeZone, booking.locale), time, ref]
    : [booking.firstName, time, ref];
}

/** The words as WhatsApp shows them: the body and the automatic-message footer (reply STOP). */
export function renderCallMessage(kind: CallMessageKind, locale: "es" | "en", params: readonly string[]): string {
  const body = CALL_TEMPLATES[kind].body[locale].replace(/\{\{(\d+)\}\}/g, (_, n: string) => (params[Number(n) - 1] ?? "").trim());
  return `${body}\n\n${FOOTER[locale]}`;
}

/** When each message is due, before quiet hours are applied. */
export function dueAt(booking: BookingForMessages, kind: CallMessageKind): Date {
  if (kind === "confirmation") return new Date(booking.createdAt);
  return new Date(new Date(booking.slotStart).getTime() - REMINDER_HOURS_BEFORE * 60 * 60 * 1000);
}

function channelFor(booking: BookingForMessages, template: MessageTemplate, channels: ChannelAvailability, now: Date): { channel: Channel; mode: PlannedCallMessage["mode"] } | null {
  const whatsapp = () => {
    if (!channels.whatsapp) return null;
    if (insideWhatsAppWindow(booking.lastInboundAt ?? null, now)) return { channel: "whatsapp" as const, mode: "text" as const };
    return templateApproved(template.name, channels) ? { channel: "whatsapp" as const, mode: "template" as const } : null;
  };
  const email = () => (channels.email && booking.email && booking.userId ? { channel: "email" as const, mode: "email" as const } : null);
  // The person's choice first; the other channel only when theirs cannot carry it.
  return booking.confirmChannel === "email" ? (email() ?? whatsapp()) : (whatsapp() ?? email());
}

/**
 * What to send for one booking now. Empty when it is not booked any more,
 * the person opted out, it is quiet hours, nothing is due, or it was sent.
 */
export function planCallMessages(booking: BookingForMessages, now: Date, ctx: CallMessageContext): PlannedCallMessage[] {
  if (booking.status !== "booked" || ctx.optedOut) return [];
  const start = new Date(booking.slotStart).getTime();
  if (start <= now.getTime()) return [];
  const out: PlannedCallMessage[] = [];
  for (const kind of ["confirmation", "reminder"] as const) {
    const key = callDedupeKey(booking.id, kind);
    if (ctx.written.has(key)) continue;
    const due = dueAt(booking, kind);
    // A booking made inside the reminder's window gets the confirmation only.
    if (kind === "reminder" && new Date(booking.createdAt).getTime() >= due.getTime()) continue;
    // When the message may go: once due, outside quiet hours on the person's clock.
    const allowed = nextAllowedTime(due, booking.timeZone, ctx.quiet);
    if (allowed.getTime() > now.getTime() || isQuietHour(now, booking.timeZone, ctx.quiet)) continue;
    if (kind === "reminder" && start - now.getTime() < REMINDER_MIN_MINUTES_BEFORE * 60 * 1000) continue;
    // A reminder never goes before the confirmation has been written.
    if (kind === "reminder" && !ctx.written.has(callDedupeKey(booking.id, "confirmation"))) continue;
    const template = CALL_TEMPLATES[kind];
    const choice = channelFor(booking, template, ctx.channels, now);
    if (!choice) continue;
    const params = callMessageParams(booking, kind);
    out.push({ dedupeKey: key, kind, channel: choice.channel, mode: choice.mode, template, params, locale: booking.locale, body: renderCallMessage(kind, booking.locale, params) });
    // One message per run: the reminder follows on a later run.
    break;
  }
  return out;
}
