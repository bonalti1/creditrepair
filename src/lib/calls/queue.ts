import type { StaffLocale } from "../staff/i18n/locale";
import type { Channel } from "../autopilot/types";
import { STAFF_CALL_RULES } from "./config";
import { slotDay, slotTime, zoneLabel } from "./slots";

// Booked calls in the team's work queue (the style of
// src/lib/autopilot/queue.ts): one item per booking, in the order of the
// calls, each with the case reference, when (on the team's clock and the
// person's), what the system already sent, about how long it takes, and one
// button (call the number). Every item carries the rule: questions only.

export type CallStatus = "booked" | "cancelled" | "completed" | "no_answer";

export interface CallMessageRecord {
  kind: "confirmation" | "reminder";
  channel: Channel;
  status: "sending" | "sent" | "failed";
  sentAt: string | null;
}

export interface CallBooking {
  id: string;
  windowId: string;
  slotStart: string;
  slotEnd: string;
  caseRef: string | null;
  userId: string | null;
  firstName: string;
  phone: string;
  email: string | null;
  confirmChannel: Channel;
  locale: "es" | "en";
  timeZone: string;
  state: string | null;
  question: string | null;
  status: CallStatus;
  createdAt: string;
  closedAt: string | null;
  closedByName: string | null;
  staffNote: string | null;
  messages: CallMessageRecord[];
}

export interface CallQueueItem {
  id: string;
  booking: CallBooking;
  /** "Call Rosa · CR-7KQ4M". */
  title: string;
  /** When, on the team's clock, and on the person's when it differs. */
  when: string;
  why: string;
  /** What the system sent about it. */
  tried: string;
  minutes: number;
  dueBy: string;
  overdue: boolean;
  /** The call itself happens outside the app: a tel: link. */
  action: { kind: "call"; href: string; label: string };
  /** The rule, said on every item. */
  rule: string;
}

/** A call usually takes this long, with the note afterwards. An estimate. */
export const MINUTES_PER_CALL = 20;
/** A call stays in the queue this long after its time, to be marked done or not answered. */
export const OVERDUE_GRACE_HOURS = 12;

const TEAM_ZONE = "America/Chicago";

function sentLine(b: CallBooking, locale: StaffLocale): string {
  const es = locale === "es";
  const sent = b.messages.filter((m) => m.status === "sent");
  const failed = b.messages.filter((m) => m.status === "failed");
  const via = (c: Channel) => (c === "whatsapp" ? "WhatsApp" : es ? "correo" : "email");
  if (sent.length === 0 && failed.length === 0) return es ? "Todavía no se envió la confirmación." : "No confirmation sent yet.";
  const parts = sent.map((m) =>
    m.kind === "confirmation" ? (es ? `Confirmación por ${via(m.channel)}` : `Confirmation by ${via(m.channel)}`) : es ? `Recordatorio por ${via(m.channel)}` : `Reminder by ${via(m.channel)}`,
  );
  if (failed.length > 0) parts.push(es ? "un mensaje no salió" : "one message did not go out");
  return `${parts.join(es ? "; " : "; ")}.`;
}

/** The booked calls a person should make, soonest first. */
export function callQueue(bookings: readonly CallBooking[], now: Date, locale: StaffLocale = "en"): CallQueueItem[] {
  const es = locale === "es";
  return bookings
    .filter((b) => b.status === "booked" && new Date(b.slotStart).getTime() + OVERDUE_GRACE_HOURS * 3_600_000 > now.getTime())
    .sort((a, b) => a.slotStart.localeCompare(b.slotStart))
    .map((b) => {
      const team = `${slotDay(b.slotStart, TEAM_ZONE, locale)}, ${slotTime(b.slotStart, TEAM_ZONE, locale)} (${zoneLabel(b.slotStart, TEAM_ZONE, locale)})`;
      const theirs = b.timeZone !== TEAM_ZONE ? ` · ${es ? "su hora" : "their time"} ${slotTime(b.slotStart, b.timeZone, locale)} (${zoneLabel(b.slotStart, b.timeZone, locale)})` : "";
      const ref = b.caseRef ? ` · ${b.caseRef}` : "";
      const overdue = new Date(b.slotStart).getTime() < now.getTime();
      return {
        id: `call:${b.id}`,
        booking: b,
        title: es ? `Llamar a ${b.firstName}${ref}` : `Call ${b.firstName}${ref}`,
        when: `${team}${theirs}`,
        why: b.question
          ? es
            ? `Reservó una llamada para preguntas: «${b.question}»`
            : `Booked a call with questions: “${b.question}”`
          : es
            ? "Reservó una llamada para preguntas."
            : "Booked a call with questions.",
        tried: sentLine(b, locale),
        minutes: MINUTES_PER_CALL,
        dueBy: b.slotStart,
        overdue,
        action: { kind: "call", href: `tel:${b.phone}`, label: es ? "Llamar" : "Call" },
        rule: STAFF_CALL_RULES[locale][0],
      };
    });
}
