import { WHATSAPP_WINDOW_HOURS } from "../autopilot/channels";
import type { StaffLocale } from "../staff/i18n/locale";
import { PERSON_STAGES, type HandoffReason, type Lead, type LeadSourceKind, type LeadStage, type PersonStage } from "./types";

// The lead inbox's rules, pure (docs/CONTROL.md). What the screens and the
// alerts agree on: which stage a lead is in, whether it is waiting for a
// person and for how long, whether WhatsApp's 24-hour window is open, the
// order of the list and its filters.
//
// ONLY PEOPLE MOVE LEADS (ALTO Control's rule, kept): the stage a person chose
// is the stage. Two facts show on top of it, because they are not anyone's
// opinion: "Signed" once the agreement is signed, and "Invited" once the
// invitation went out (only over New, Contacted or Qualified: a person who
// closed the lead decided that). An archived lead who writes again shows in
// New, so nobody misses them; the stored stage does not change.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The stage the console shows. */
export function effectiveStage(lead: Pick<Lead, "stage" | "invitedAt" | "signedAt" | "lastInboundAt" | "stageAt">): LeadStage {
  if (lead.signedAt) return "signed";
  if (lead.stage === "archived" && lead.lastInboundAt && lead.stageAt && lead.lastInboundAt > lead.stageAt) return "new";
  if (lead.invitedAt && (lead.stage === "new" || lead.stage === "contacted" || lead.stage === "qualified")) return "invited";
  return lead.stage;
}

/** May a person put the lead in this stage? Invited and Signed are facts, never a choice. */
export function isPersonStage(stage: string): stage is PersonStage {
  return (PERSON_STAGES as readonly string[]).includes(stage);
}

/** The stages that are over: nobody waits on them. */
export function isClosed(stage: LeadStage): boolean {
  return stage === "signed" || stage === "not_interested" || stage === "closed_lost" || stage === "archived";
}

/**
 * Waiting on a person since when, or null. A lead waits when their last
 * message has no answer after it, from a person or the AI (the lead
 * autopilot, Alti's coach), and the lead is open and has not opted out.
 * Alti's one fixed greeting is not an answer.
 */
export function waitingSince(lead: Lead): string | null {
  if (!lead.lastInboundAt || lead.optedOutAt) return null;
  if (isClosed(effectiveStage(lead))) return null;
  if (lead.lastReplyAt && lead.lastReplyAt >= lead.lastInboundAt) return null;
  return lead.lastInboundAt;
}

export function waitingMinutes(lead: Lead, now: Date): number | null {
  const since = waitingSince(lead);
  return since ? Math.max(0, Math.floor((now.getTime() - Date.parse(since)) / MINUTE)) : null;
}

/** "25 min", "3 h", "2 d" (the same in both languages). */
export function shortWait(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / (24 * 60))} d`;
}

export type WindowState = { state: "open"; hoursLeft: number; closing: boolean } | { state: "closed" };

/**
 * WhatsApp's 24-hour rule: inside 24 hours of the lead's last message, any
 * text; after that, only a template approved in Meta. "Closing" in the last 4 hours.
 */
export function whatsappWindow(lastInboundAt: string | null, now: Date): WindowState {
  if (!lastInboundAt) return { state: "closed" };
  const left = Date.parse(lastInboundAt) + WHATSAPP_WINDOW_HOURS * HOUR - now.getTime();
  if (left <= 0) return { state: "closed" };
  return { state: "open", hoursLeft: Math.max(1, Math.ceil(left / HOUR)), closing: left <= 4 * HOUR };
}

// ── The list ────────────────────────────────────────────────────────────

/**
 * Newest conversation first (ALTO's lesson: no hidden ranking in the list;
 * waiting, hand-offs and the window are tags on the row). The Today list is
 * where order by urgency lives.
 */
export function sortLeads(leads: readonly Lead[]): Lead[] {
  const key = (l: Lead) => l.lastMessage?.at ?? l.createdAt;
  return [...leads].sort((a, b) => key(b).localeCompare(key(a)));
}

export type LeadFilter = "all" | "waiting" | "mine" | "unassigned" | LeadStage;

/** The filter chips, in the order the list shows them. "All" leaves out Archived. */
export const LEAD_FILTERS_ORDER: readonly LeadFilter[] = ["all", "waiting", "mine", "unassigned", "new", "contacted", "qualified", "invited", "signed", "not_interested", "closed_lost", "archived"];

export function filterLeads(leads: readonly Lead[], filter: LeadFilter, viewerHandle: string | null, search = ""): Lead[] {
  const q = search.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  return leads.filter((lead) => {
    const stage = effectiveStage(lead);
    if (filter === "waiting" && !waitingSince(lead)) return false;
    if (filter === "mine" && lead.salesperson !== viewerHandle) return false;
    if (filter === "unassigned" && lead.salesperson) return false;
    if (filter === "all" && stage === "archived") return false;
    if (filter !== "all" && filter !== "waiting" && filter !== "mine" && filter !== "unassigned" && stage !== filter) return false;
    if (!q) return true;
    const name = (lead.name ?? "").toLowerCase();
    return name.includes(q) || (digits.length >= 3 && lead.phone.replace(/\D/g, "").includes(digits)) || (lead.firstTouch.caseRef ?? "").toLowerCase().includes(q);
  });
}

export function countByStage(leads: readonly Lead[]): Record<LeadStage, number> {
  const out = { new: 0, contacted: 0, qualified: 0, invited: 0, signed: 0, not_interested: 0, closed_lost: 0, archived: 0 } as Record<LeadStage, number>;
  for (const lead of leads) out[effectiveStage(lead)] += 1;
  return out;
}

/** "(713) 555-0140" for a US number, the number as stored otherwise. */
export function leadPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : phone;
}

/** The lead's name, or their number when they only wrote on WhatsApp. */
export function leadName(lead: Pick<Lead, "name" | "phone">): string {
  return lead.name?.trim() || leadPhone(lead.phone);
}

// ── Words ───────────────────────────────────────────────────────────────

export const STAGE_LABELS: Record<StaffLocale, Record<LeadStage, string>> = {
  en: {
    new: "New",
    contacted: "Contacted",
    qualified: "Qualified",
    invited: "Invited",
    signed: "Signed",
    not_interested: "Not interested",
    closed_lost: "Closed-lost",
    archived: "Archived",
  },
  es: {
    new: "Nuevo",
    contacted: "Contactado",
    qualified: "Calificado",
    invited: "Invitado",
    signed: "Firmó",
    not_interested: "No le interesa",
    closed_lost: "Perdido",
    archived: "Archivado",
  },
};

/** One line per stage: what it means, and who moves it there. */
export const STAGE_HELP: Record<StaffLocale, Record<LeadStage, string>> = {
  en: {
    new: "Wrote or arrived, and nobody on the team has talked with them yet.",
    contacted: "Someone on the team is talking with them.",
    qualified: "Lives in a state we serve and wants the service; ready for an invitation.",
    invited: "Moves here by itself when the invitation is sent from “Prepare invitation”.",
    signed: "Moves here by itself when they sign the service agreement.",
    not_interested: "Said they don't want the service now.",
    closed_lost: "Stopped answering, or we can't serve them (state, situation).",
    archived: "Not a lead (a wrong number, spam). Shows in New again if they write.",
  },
  es: {
    new: "Escribió o llegó, y nadie del equipo ha hablado con esta persona todavía.",
    contacted: "Alguien del equipo está hablando con esta persona.",
    qualified: "Vive en un estado donde trabajamos y quiere el servicio; lista para la invitación.",
    invited: "Pasa aquí sola cuando se envía la invitación desde «Preparar su invitación».",
    signed: "Pasa aquí sola cuando firma el acuerdo de servicio.",
    not_interested: "Dijo que ahora no quiere el servicio.",
    closed_lost: "Dejó de responder, o no podemos atenderla (estado, situación).",
    archived: "No es un prospecto (número equivocado, spam). Vuelve a «Nuevo» si escribe.",
  },
};

export const SOURCE_LABELS: Record<StaffLocale, Record<LeadSourceKind, string>> = {
  en: { whatsapp: "WhatsApp", highlevel: "HighLevel", partner: "Partner", signup_chat: "Chat signup", manual: "Added by hand", household: "Household", crc_import: "From Credit Repair Cloud", live: "Live funnel" },
  es: { whatsapp: "WhatsApp", highlevel: "HighLevel", partner: "Socio", signup_chat: "Registro con Alti", manual: "Agregado a mano", household: "Hogar", crc_import: "De Credit Repair Cloud", live: "Embudo en vivo" },
};

/** "HighLevel · Casa nov" / "Partner · Laura Benítez" / "Chat signup · CR-7KQ4M" / "WhatsApp". */
export function firstTouchLine(lead: Pick<Lead, "source" | "firstTouch">, locale: StaffLocale): string {
  const parts = [SOURCE_LABELS[locale][lead.source]];
  const touch = lead.firstTouch;
  const campaign = touch.campaign || touch.utm?.campaign;
  if (campaign) parts.push(campaign);
  if (touch.partnerName || touch.partnerCode) {
    if (lead.source !== "partner") parts.push(locale === "es" ? "socio" : "partner");
    parts.push(touch.partnerName || touch.partnerCode || "");
  }
  if (touch.caseRef) parts.push(touch.caseRef);
  return parts.filter(Boolean).join(" · ");
}

export const HANDOFF_LABELS: Record<StaffLocale, Record<HandoffReason, string>> = {
  en: {
    complaint: "A complaint",
    billing: "About money or cancelling",
    legal: "A legal question",
    wants_person: "Asked for a person",
    results: "Asked about results",
    personal_data: "Sent personal data",
    no_fact: "Nothing in the FAQ answers it",
    guardrails: "The reply did not pass the rules",
  },
  es: {
    complaint: "Una queja",
    billing: "Sobre dinero o cancelar",
    legal: "Una pregunta legal",
    wants_person: "Pidió una persona",
    results: "Preguntó por resultados",
    personal_data: "Mandó datos personales",
    no_fact: "Nada en las preguntas frecuentes lo responde",
    guardrails: "La respuesta no pasó las reglas",
  },
};

/** The language a lead writes in, from their words, when nothing is saved. */
export function guessLanguage(text: string | null | undefined): "en" | "es" | null {
  if (!text) return null;
  const t = ` ${text.toLowerCase()} `;
  if (/[ñ¿¡áéíóú]/.test(t) || /\s(hola|gracias|quiero|necesito|crédito|credito|buenas|buenos|cómo|como|cuánto|cuanto|ayuda|información|informacion|por favor|mi|tengo)\s/.test(t)) return "es";
  if (/\s(hi|hello|thanks|thank|want|need|credit|how|help|please|my|have|the)\s/.test(t)) return "en";
  return null;
}

/** The language to write to them in: saved, else what they wrote in, else English. */
export function leadLanguage(lead: Pick<Lead, "locale" | "lastMessage">): "en" | "es" {
  return lead.locale ?? (lead.lastMessage?.role === "user" ? guessLanguage(lead.lastMessage.excerpt) : null) ?? "en";
}
