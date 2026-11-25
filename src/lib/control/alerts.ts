import type { StaffLocale } from "../staff/i18n/locale";
import type { StaffRole } from "../staff/types";

// Staff phone alerts (docs/CONTROL.md, "Phone alerts"). Per topic and per
// person, and OFF until each person turns them on. Pure: who gets what, the
// words, the keys that make each alert happen once. The sweep that finds them
// is alertsServer.ts; delivery is web push (src/lib/push/webPush.ts) plus the
// list on /equipo/alertas.
//
// What an alert carries is the least that is useful: a first name and a last
// initial, where it came from, how long it has waited. Never a credit detail,
// never what the person wrote. The push itself carries nothing at all (the
// phone asks this app for the words), so no lead's name passes through
// Google's or Apple's push servers.

export const ALERT_TOPICS = ["new_lead", "lead_waiting", "complaint", "partner_note", "escalation"] as const;
export type AlertTopic = (typeof ALERT_TOPICS)[number];

export interface TopicPref {
  enabled: boolean;
  /** lead_waiting only: alert after this many minutes without an answer. */
  waitingMinutes: number;
}

export type AlertPrefs = Record<AlertTopic, TopicPref>;

export const DEFAULT_WAITING_MINUTES = 15;
export const WAITING_MINUTES_RANGE = [5, 240] as const;

/** Everything off: nobody is alerted until they choose to be. */
export const DEFAULT_ALERT_PREFS: AlertPrefs = {
  new_lead: { enabled: false, waitingMinutes: DEFAULT_WAITING_MINUTES },
  lead_waiting: { enabled: false, waitingMinutes: DEFAULT_WAITING_MINUTES },
  complaint: { enabled: false, waitingMinutes: DEFAULT_WAITING_MINUTES },
  partner_note: { enabled: false, waitingMinutes: DEFAULT_WAITING_MINUTES },
  escalation: { enabled: false, waitingMinutes: DEFAULT_WAITING_MINUTES },
};

/** Which topics a role may turn on: the ones about work it does. */
export function topicsFor(role: StaffRole | null | undefined): AlertTopic[] {
  if (role === "admin") return [...ALERT_TOPICS];
  if (role === "sales") return ["new_lead", "lead_waiting", "complaint"];
  if (role === "specialist") return ["complaint", "partner_note"];
  return [];
}

export function prefsFromRows(rows: ReadonlyArray<Record<string, unknown>>): AlertPrefs {
  const prefs: AlertPrefs = structuredClone(DEFAULT_ALERT_PREFS);
  for (const row of rows) {
    const topic = ALERT_TOPICS.find((t) => t === row.topic);
    if (!topic) continue;
    const minutes = typeof row.waiting_minutes === "number" ? row.waiting_minutes : DEFAULT_WAITING_MINUTES;
    prefs[topic] = { enabled: row.enabled === true, waitingMinutes: Math.min(WAITING_MINUTES_RANGE[1], Math.max(WAITING_MINUTES_RANGE[0], minutes)) };
  }
  return prefs;
}

// ── Who is told ─────────────────────────────────────────────────────────

export interface AlertMember {
  userId: string;
  handle: string;
  role: StaffRole;
  prefs: AlertPrefs;
}

export interface AlertSubject {
  topic: AlertTopic;
  /** The lead's salesperson, for lead topics (null: nobody yet, so all of sales). */
  salesperson?: string | null;
  /** The client's assigned specialist, for a client's complaint or a partner's note. */
  specialist?: string | null;
  /** lead_waiting: minutes waited so far. */
  waitedMinutes?: number;
}

/** The members who get this alert: the people whose work it is, who turned the topic on. */
export function alertRecipients(subject: AlertSubject, members: readonly AlertMember[]): AlertMember[] {
  return members.filter((member) => {
    if (!topicsFor(member.role).includes(subject.topic)) return false;
    const pref = member.prefs[subject.topic];
    if (!pref.enabled) return false;
    if (subject.topic === "lead_waiting" && (subject.waitedMinutes ?? 0) < pref.waitingMinutes) return false;
    if (member.role === "admin") return true;
    switch (subject.topic) {
      case "new_lead":
      case "lead_waiting":
        return member.role === "sales" && (!subject.salesperson || subject.salesperson === member.handle);
      case "complaint":
        return subject.salesperson !== undefined
          ? member.role === "sales" && (!subject.salesperson || subject.salesperson === member.handle)
          : member.role === "specialist" && subject.specialist === member.handle;
      case "partner_note":
        return member.role === "specialist" && subject.specialist === member.handle;
      default:
        return false;
    }
  });
}

// ── The words ───────────────────────────────────────────────────────────

/** "Rosa G." from "Rosa Elena Gutiérrez"; "a new number" when there is no name. */
export function shortName(name: string | null | undefined, locale: StaffLocale): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return locale === "es" ? "un número nuevo" : "a new number";
  const last = parts.length > 1 ? ` ${parts[parts.length - 1]![0]!.toUpperCase()}.` : "";
  return `${parts[0]}${last}`;
}

export interface AlertText {
  title: string;
  body: string;
}

export const TOPIC_TEXT: Record<StaffLocale, Record<AlertTopic, { label: string; help: string }>> = {
  en: {
    new_lead: { label: "New lead", help: "Someone new wrote on WhatsApp, or arrived from HighLevel, a partner or the chat signup." },
    lead_waiting: { label: "Lead waiting", help: "A lead's message has had no answer for longer than the minutes you choose." },
    complaint: { label: "Complaint", help: "A lead or a client wrote something that sounds like a complaint, or the lead autopilot handed one to a person." },
    partner_note: { label: "Partner note", help: "A referral partner wrote a note to the team about a client." },
    escalation: { label: "Escalated to you", help: "Someone on the team pressed “Escalate to the owner” on an item of the Today list." },
  },
  es: {
    new_lead: { label: "Prospecto nuevo", help: "Alguien nuevo escribió por WhatsApp, o llegó de HighLevel, de un socio o del registro con Alti." },
    lead_waiting: { label: "Prospecto esperando", help: "El mensaje de un prospecto lleva sin respuesta más de los minutos que elijas." },
    complaint: { label: "Queja", help: "Un prospecto o un cliente escribió algo que parece una queja, o el piloto automático se la pasó a una persona." },
    partner_note: { label: "Nota de un socio", help: "Un socio que refiere clientes le escribió una nota al equipo sobre un cliente." },
    escalation: { label: "Te lo pasaron a ti", help: "Alguien del equipo tocó «Pasar al dueño» en algo de la lista de Hoy." },
  },
};

export function newLeadText(input: { name: string | null; source: string }, locale: StaffLocale): AlertText {
  return locale === "es"
    ? { title: `Prospecto nuevo: ${shortName(input.name, locale)}`, body: `Llegó por ${input.source}. Ábrelo en Prospectos.` }
    : { title: `New lead: ${shortName(input.name, locale)}`, body: `Came in through ${input.source}. Open it in Leads.` };
}

export function waitingText(input: { name: string | null; minutes: number }, locale: StaffLocale): AlertText {
  return locale === "es"
    ? { title: `${shortName(input.name, locale)} espera respuesta`, body: `Lleva ${input.minutes} min sin respuesta.` }
    : { title: `${shortName(input.name, locale)} is waiting`, body: `No answer for ${input.minutes} min.` };
}

export function complaintText(input: { name: string | null; lead: boolean }, locale: StaffLocale): AlertText {
  return locale === "es"
    ? { title: `Posible queja: ${shortName(input.name, locale)}`, body: input.lead ? "Un prospecto. Respóndele una persona." : "Un cliente. Revisa su conversación." }
    : { title: `Possible complaint: ${shortName(input.name, locale)}`, body: input.lead ? "A lead. A person should answer." : "A client. Check their conversation." };
}

export function partnerNoteText(input: { partnerFirstName: string; clientName: string | null }, locale: StaffLocale): AlertText {
  return locale === "es"
    ? { title: `Nota de ${input.partnerFirstName}`, body: `Sobre ${shortName(input.clientName, locale)}. Respóndele en la página del cliente.` }
    : { title: `Note from ${input.partnerFirstName}`, body: `About ${shortName(input.clientName, locale)}. Answer on the client's page.` };
}

export function escalationText(input: { by: string; title: string }, locale: StaffLocale): AlertText {
  return locale === "es" ? { title: `${input.by} necesita al dueño`, body: input.title.slice(0, 200) } : { title: `${input.by} needs the owner`, body: input.title.slice(0, 200) };
}

// ── Keys: each thing alerts each person once ────────────────────────────

export const alertKey = {
  newLead: (leadId: string) => `new_lead:${leadId}`,
  waiting: (leadId: string, since: string) => `lead_waiting:${leadId}:${since}`,
  complaint: (id: string) => `complaint:${id}`,
  partnerNote: (noteId: string) => `partner_note:${noteId}`,
  escalation: (id: string) => `escalation:${id}`,
};
