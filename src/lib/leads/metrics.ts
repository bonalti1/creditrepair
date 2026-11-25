import { localDay } from "../autopilot/clock";
import { STAFF_TIME_ZONE } from "../staff/stage";
import type { StaffLocale } from "../staff/i18n/locale";
import { effectiveStage } from "./inbox";
import { LEAD_SOURCES, type Lead, type LeadSourceKind } from "./types";

// Lead quality numbers, from the records only (ALTO's "real numbers" lesson):
// a number with nothing behind it is "No data yet" and says why, never a 0
// that looks like a result. Pure.
//
//   - New leads today (Texas day) and in the last 7 days, by source.
//   - Median time to the first reply BY A PERSON (Alti's greeting and the
//     autopilot do not count), over leads that arrived in the last 30 days.
//   - Contacted, invited and signed, as a share of the leads that arrived in
//     the last 30 days (archived ones are not leads: left out).

const DAY = 24 * 60 * 60 * 1000;
export const QUALITY_WINDOW_DAYS = 30;

export interface Rate {
  /** 0–1, or null when there is no lead to count. */
  value: number | null;
  count: number;
  of: number;
}

export interface LeadQuality {
  today: { total: number; bySource: Partial<Record<LeadSourceKind, number>> };
  week: { total: number; bySource: Partial<Record<LeadSourceKind, number>> };
  /** Minutes; null when no lead of the window got a reply from a person. */
  medianFirstReplyMinutes: number | null;
  repliedCount: number;
  contacted: Rate;
  invited: Rate;
  signed: Rate;
  /** How many leads the rates are about. */
  windowLeads: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

const rate = (count: number, of: number): Rate => ({ count, of, value: of > 0 ? count / of : null });

export function isContacted(lead: Lead): boolean {
  if (lead.firstHumanReplyAt || lead.invitedAt || lead.signedAt) return true;
  return lead.stage === "contacted" || lead.stage === "qualified" || lead.stage === "not_interested";
}

export function leadQuality(leads: readonly Lead[], now: Date): LeadQuality {
  const today = localDay(now, STAFF_TIME_ZONE);
  const weekFrom = now.getTime() - 7 * DAY;
  const windowFrom = now.getTime() - QUALITY_WINDOW_DAYS * DAY;
  const count = (list: Lead[]) => {
    const bySource: Partial<Record<LeadSourceKind, number>> = {};
    for (const source of LEAD_SOURCES) {
      const n = list.filter((l) => l.source === source).length;
      if (n > 0) bySource[source] = n;
    }
    return { total: list.length, bySource };
  };
  const real = leads.filter((l) => effectiveStage(l) !== "archived");
  const inWindow = real.filter((l) => Date.parse(l.createdAt) >= windowFrom && Date.parse(l.createdAt) <= now.getTime());
  const replies = inWindow.flatMap((l) => (l.firstHumanReplyAt ? [Math.max(0, Math.round((Date.parse(l.firstHumanReplyAt) - Date.parse(l.createdAt)) / 60_000))] : []));
  return {
    today: count(real.filter((l) => localDay(new Date(l.createdAt), STAFF_TIME_ZONE) === today)),
    week: count(real.filter((l) => Date.parse(l.createdAt) >= weekFrom && Date.parse(l.createdAt) <= now.getTime())),
    medianFirstReplyMinutes: median(replies),
    repliedCount: replies.length,
    contacted: rate(inWindow.filter(isContacted).length, inWindow.length),
    invited: rate(inWindow.filter((l) => l.invitedAt || l.signedAt).length, inWindow.length),
    signed: rate(inWindow.filter((l) => l.signedAt).length, inWindow.length),
    windowLeads: inWindow.length,
  };
}

/** "42%" or null. */
export function percent(value: number | null): string | null {
  return value === null ? null : `${Math.round(value * 100)}%`;
}

/** "35 min", "2 h 10 min", "3 d". */
export function minutesText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  return `${Math.round(minutes / (24 * 60))} d`;
}

/** What each number means and why one may be missing, in the console's language. */
export const QUALITY_TEXT: Record<
  StaffLocale,
  {
    noData: string;
    noLeadsWhy: string;
    noRepliesWhy: string;
    definitions: { today: string; week: string; firstReply: string; contacted: string; invited: string; signed: string };
  }
> = {
  en: {
    noData: "No data yet",
    noLeadsWhy: `No lead arrived in the last ${QUALITY_WINDOW_DAYS} days.`,
    noRepliesWhy: `No lead of the last ${QUALITY_WINDOW_DAYS} days has had a reply from a person yet.`,
    definitions: {
      today: "Leads that arrived today (Texas time), by where they came from. Archived ones are not counted.",
      week: "Leads that arrived in the last 7 days, by where they came from.",
      firstReply: `Half of the leads of the last ${QUALITY_WINDOW_DAYS} days got their first reply from a person faster than this, counted from when they arrived. Alti's greeting and the autopilot do not count. Replies written inside HighLevel are not seen here.`,
      contacted: `Of the leads of the last ${QUALITY_WINDOW_DAYS} days: a person replied, the invitation went out, they signed, or a person moved them to Contacted, Qualified or Not interested.`,
      invited: `Of the leads of the last ${QUALITY_WINDOW_DAYS} days: the invitation was sent (or they signed).`,
      signed: `Of the leads of the last ${QUALITY_WINDOW_DAYS} days: they signed the service agreement.`,
    },
  },
  es: {
    noData: "Todavía sin datos",
    noLeadsWhy: `No llegó ningún prospecto en los últimos ${QUALITY_WINDOW_DAYS} días.`,
    noRepliesWhy: `Ningún prospecto de los últimos ${QUALITY_WINDOW_DAYS} días ha recibido todavía la respuesta de una persona.`,
    definitions: {
      today: "Prospectos que llegaron hoy (hora de Texas), según de dónde vinieron. No cuentan los archivados.",
      week: "Prospectos que llegaron en los últimos 7 días, según de dónde vinieron.",
      firstReply: `La mitad de los prospectos de los últimos ${QUALITY_WINDOW_DAYS} días recibió la primera respuesta de una persona antes de este tiempo, contado desde que llegaron. No cuentan el saludo de Alti ni el piloto automático. Lo que se escribe dentro de HighLevel no se ve aquí.`,
      contacted: `De los prospectos de los últimos ${QUALITY_WINDOW_DAYS} días: una persona respondió, salió la invitación, firmaron, o una persona los pasó a Contactado, Calificado o No le interesa.`,
      invited: `De los prospectos de los últimos ${QUALITY_WINDOW_DAYS} días: se envió la invitación (o ya firmaron).`,
      signed: `De los prospectos de los últimos ${QUALITY_WINDOW_DAYS} días: firmaron el acuerdo de servicio.`,
    },
  },
};
