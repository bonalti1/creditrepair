import { aiByline, teamByline } from "../brand";
import { containsTaxpayerNumber } from "../aftercare/itin";

// A person joins Alti's signup chat (docs/SIGNUP-CHAT.md, «A person joins
// the chat»; migration 0044: signup_chat_threads, signup_chat_messages).
//
// In /registro the person can ask for a human at any time ("Chat with a
// person here"). The thread opens as REQUESTED and shows in the console's
// «Live chats» (/equipo/chats, leads.work: administrators and sales) with
// the case reference, and as a red circle on Lead Manager. A teammate taps
// «Join the chat» (JOINED): the person sees "Rolando · Credalti team
// joined", every message of theirs is labelled with their name
// (teamByline), and Alti PAUSES: he answers nothing while a person is in
// the chat. «Hand back to Alti» (HANDED_BACK) brings him back. The person
// can keep signing up in the same chat the whole time.
//
// Alti in this thread answers only from the website's own library (the FAQ,
// site/askAlti.ts answerWithoutModel): no model writes here, so nothing
// unchecked reaches the person; with no match he says a person will answer.
// A teammate's reply passes checkStaffReply (the claim rules every staff
// reply passes) on the server before it is saved. Numbers that look like a
// Social Security number or an account are taken out of the person's
// messages before they are stored.

export const LIVE_CHAT_STATUSES = ["requested", "joined", "handed_back"] as const;
export type LiveChatStatus = (typeof LIVE_CHAT_STATUSES)[number];

export type LiveChatAuthor = "person" | "staff" | "alti" | "system";

/** System lines are stored as codes and written in each reader's language. */
export const SYSTEM_EVENTS = ["requested", "joined", "handed_back"] as const;
export type SystemEvent = (typeof SYSTEM_EVENTS)[number];

export interface LiveChatMessage {
  id: string;
  at: string;
  author: LiveChatAuthor;
  /** A teammate's first name (staff lines, and the "joined" line). */
  staffName: string | null;
  /** The words; for a system line, its event code. */
  text: string;
}

export interface LiveChatThread {
  caseRef: string;
  status: LiveChatStatus;
  requestedAt: string;
  joinedAt: string | null;
  /** The first name of the teammate in the chat now (or last). */
  joinedBy: string | null;
  handedBackAt: string | null;
  locale: "en" | "es";
  /** From the signup's record: where they are, their state. Nothing else about the person. */
  step: string | null;
  state: string | null;
  lastPersonAt: string | null;
  messages: LiveChatMessage[];
  /** Demo threads are labelled as samples on the console. */
  sample?: boolean;
}

export const LIVE_CHAT_LIMITS = { maxChars: 1000, personPerMinute: 8 } as const;

/** How often each side looks for new messages (no realtime is used in the app: polling, docs/SIGNUP-CHAT.md). */
export const POLL_MS = { person: 3_000, staffThread: 3_000, staffList: 5_000 } as const;

/** Numbers that could be an SSN, an ITIN or an account, taken out before the message is stored. */
export function redactPersonText(text: string): string {
  let out = text.replace(/\s+/g, " ").trim().slice(0, LIVE_CHAT_LIMITS.maxChars);
  out = out.replace(/(?<!\d)\d{3}[-\s]?\d{2}[-\s]?\d{4}(?!\d)/g, "•••");
  out = out.replace(/\d[\d\s-]{7,}\d/g, (m) => (m.replace(/\D/g, "").length >= 8 ? "•••" : m));
  return out;
}

export function hadNumberRemoved(original: string): boolean {
  return containsTaxpayerNumber(original) || /\d{8,}/.test(original.replace(/[\s-]/g, ""));
}

/** Alti answers only while no person is in the chat. */
export function altiPaused(status: LiveChatStatus | null | undefined): boolean {
  return status === "joined";
}

/** Who wrote a line, as it is labelled: "Alti · AI assistant", "Rolando · Credalti team". */
export function bylineOf(message: Pick<LiveChatMessage, "author" | "staffName">, locale: "en" | "es"): string | null {
  if (message.author === "alti") return aiByline(locale);
  if (message.author === "staff") return teamByline(message.staffName ?? "", locale);
  return null;
}

export const LIVE_CHAT_COPY = {
  en: {
    ask: "Chat with a person here",
    askSub: "Someone on our team joins this chat, with your case number.",
    waiting: "A person on our team will join this chat. You can keep signing up while you wait.",
    personalInfo: "Please don't write your Social Security number, account numbers or card numbers here.",
    numberRemoved: "We took a number out of your message to keep it safe.",
    joined: (name: string) => `${name} from the Credalti team joined the chat. Alti is paused while a person is here.`,
    handedBack: "The team handed the chat back to Alti. You can ask for a person again any time.",
    requested: "You asked for a person.",
    requestedStaff: "They asked for a person.",
    handedBackStaff: "Handed back to Alti.",
    placeholder: "Write a message",
    send: "Send",
    title: "Chat with a person",
    altiPaused: "Alti is paused while a person is in the chat.",
    altiNoMatch: "I passed your message to the team. A person will answer here.",
    close: "Hide",
    error: "The message didn't go. Please try again.",
    sampleTeammate: "Rolando",
    sampleHello: "Hi! I'm Rolando from the team. I'm here if you have a question about signing up.",
  },
  es: {
    ask: "Chatear con una persona aquí",
    askSub: "Alguien del equipo entra a este chat, con tu número de caso.",
    waiting: "Una persona del equipo va a entrar a este chat. Puedes seguir con tu registro mientras esperas.",
    personalInfo: "Por favor no escribas aquí tu número de Seguro Social, números de cuenta ni de tarjeta.",
    numberRemoved: "Quitamos un número de tu mensaje para cuidarlo.",
    joined: (name: string) => `${name}, del equipo Credalti, entró al chat. Alti está en pausa mientras hay una persona aquí.`,
    handedBack: "El equipo le devolvió el chat a Alti. Puedes pedir una persona otra vez cuando quieras.",
    requested: "Pediste hablar con una persona.",
    requestedStaff: "Pidió hablar con una persona.",
    handedBackStaff: "Devuelto a Alti.",
    placeholder: "Escribe un mensaje",
    send: "Enviar",
    title: "Chat con una persona",
    altiPaused: "Alti está en pausa mientras hay una persona en el chat.",
    altiNoMatch: "Le pasé tu mensaje al equipo. Una persona te responde aquí.",
    close: "Ocultar",
    error: "El mensaje no se envió. Inténtalo de nuevo.",
    sampleTeammate: "Rolando",
    sampleHello: "¡Hola! Soy Rolando, del equipo. Aquí estoy si tienes una pregunta sobre tu registro.",
  },
} as const;

/** A system line in a reader's language: the person's own words, or the team's ("They asked for a person"). */
export function systemLine(message: Pick<LiveChatMessage, "text" | "staffName">, locale: "en" | "es", reader: "person" | "staff" = "person"): string {
  const c = LIVE_CHAT_COPY[locale];
  if (message.text === "joined") return c.joined(message.staffName ?? (locale === "es" ? "Una persona" : "A person"));
  if (message.text === "handed_back") return reader === "staff" ? c.handedBackStaff : c.handedBack;
  return reader === "staff" ? c.requestedStaff : c.requested;
}

type Row = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const iso = (v: unknown): string | null => {
  if (v instanceof Date) return v.toISOString();
  const s = text(v);
  return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null;
};

export function liveChatMessageFromRow(r: Row): LiveChatMessage {
  const author = (["person", "staff", "alti", "system"] as const).find((a) => a === r.author) ?? "system";
  return { id: text(r.id), at: iso(r.created_at) ?? new Date(0).toISOString(), author, staffName: r.staff_name ? text(r.staff_name) : null, text: text(r.body) };
}

export function liveChatThreadFromRow(r: Row, caseRow: Row | null, messages: LiveChatMessage[]): LiveChatThread {
  const status = (LIVE_CHAT_STATUSES as readonly string[]).includes(text(r.status)) ? (text(r.status) as LiveChatStatus) : "requested";
  const t = iso;
  return {
    caseRef: text(r.case_ref),
    status,
    requestedAt: t(r.requested_at) ?? new Date(0).toISOString(),
    joinedAt: t(r.joined_at),
    joinedBy: r.joined_by_name ? text(r.joined_by_name) : null,
    handedBackAt: t(r.handed_back_at),
    locale: (caseRow?.locale ?? r.locale) === "es" ? "es" : "en",
    step: caseRow?.step ? text(caseRow.step) : null,
    state: caseRow?.state ? text(caseRow.state) : null,
    lastPersonAt: t(r.last_person_at),
    messages,
  };
}
