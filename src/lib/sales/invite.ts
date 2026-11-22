import { ALL_STATES } from "../compliance/states";
import { BRAND } from "../brand";

// The handoff from sales to the software. A salesperson talks with the lead on
// WhatsApp, then sends a personal link. The link carries what the conversation
// already established (first name, goal, state, who sent it) so the customer
// does not answer the same questions twice.
//
// Everything in the link is treated as a suggestion, never as fact: values are
// validated here, the state gate still applies, and nothing in a link can skip
// what only the customer can do (signing the agreement, reviewing each item,
// the attestation). The link holds no phone number, address or account data.
//
// Language: the salesperson picks the language they talked with the client in
// (English by default). The link carries it as `lang`, so the client lands in
// that language (src/lib/i18n/detect.ts), and the message is written in it.
//
// The service is full service: the customer says what is inaccurate and the
// team prepares and mails the letters. The message below and the reminders for
// the salesperson (SALES_MAY_SAY, SALES_MAY_NOT_SAY) say exactly that.

// `label` is the Spanish label (the salesperson's page is Spanish-only);
// `labelEn` is the same goal for a customer reading in English.
export const GOALS = [
  { key: "mortgage", label: "Comprar una casa", labelEn: "Buy a house" },
  { key: "auto", label: "Comprar un auto", labelEn: "Buy a car" },
  { key: "card", label: "Calificar para mejores tarjetas", labelEn: "Qualify for better cards" },
  { key: "general", label: "Mejorar mi crédito en general", labelEn: "Improve my credit in general" },
] as const;

export type GoalKey = (typeof GOALS)[number]["key"];

export interface Invite {
  /** Customer's first name, for the greeting only. */
  name: string | null;
  goal: GoalKey | null;
  state: string | null;
  /** Salesperson's handle, for attribution: lowercase letters, digits, hyphens. */
  ref: string | null;
  /** Salesperson's first name as shown to the customer. */
  refName: string | null;
  /**
   * The referral partner's code (partners.referral_code, migration 0017), when
   * a partner referred the person. Optional: links made before partners
   * existed have none. The server credits it only to an approved partner, and
   * only if the client has no partner yet.
   */
  partner?: string | null;
  /** The client's language, as the salesperson chose it: the app opens in it (`lang`). */
  lang?: "es" | "en" | null;
}

const cleanName = (value: string | null | undefined): string | null => {
  if (!value) return null;
  // Letters (any alphabet), spaces, apostrophes and hyphens only; no markup, no digits.
  const cleaned = value.replace(/[^\p{L}\s'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 30);
  return cleaned.length >= 2 ? cleaned : null;
};

export const toRefSlug = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const slug = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return slug.length >= 2 ? slug : null;
};

/** A partner's referral code: 3 to 30 lowercase letters, digits and hyphens. */
export const toPartnerCode = (value: string | null | undefined): string | null => {
  const code = (value ?? "").trim().toLowerCase();
  return /^[a-z0-9-]{3,30}$/.test(code) ? code : null;
};

export function parseInvite(params: { get(name: string): string | null }): Invite | null {
  const goal = params.get("g");
  const state = params.get("s")?.toUpperCase() ?? null;
  const invite: Invite = {
    name: cleanName(params.get("n")),
    goal: GOALS.some((g) => g.key === goal) ? (goal as GoalKey) : null,
    state: state && (ALL_STATES as readonly string[]).includes(state) ? state : null,
    ref: toRefSlug(params.get("r")),
    refName: cleanName(params.get("rn")),
  };
  const partner = toPartnerCode(params.get("p"));
  if (partner) invite.partner = partner;
  const lang = params.get("lang");
  if (lang === "es" || lang === "en") invite.lang = lang;
  // A link with nothing usable in it is just the ordinary onboarding.
  return invite.name || invite.goal || invite.state || invite.ref ? invite : null;
}

export function buildInvitePath(invite: Partial<Invite>): string {
  const query = new URLSearchParams();
  const name = cleanName(invite.name);
  const refName = cleanName(invite.refName);
  const ref = toRefSlug(invite.ref ?? invite.refName);
  if (name) query.set("n", name);
  if (invite.goal) query.set("g", invite.goal);
  if (invite.state) query.set("s", invite.state.toUpperCase());
  if (ref) query.set("r", ref);
  if (refName) query.set("rn", refName);
  const partner = toPartnerCode(invite.partner);
  if (partner) query.set("p", partner);
  if (invite.lang === "es" || invite.lang === "en") query.set("lang", invite.lang);
  const qs = query.toString();
  return qs ? `/onboarding?${qs}` : "/onboarding";
}

/** The WhatsApp message the salesperson sends with the link, in the client's language. Passes the claim rules. */
export function inviteMessage(invite: Partial<Invite>, url: string, locale: "es" | "en" = invite.lang === "es" ? "es" : "en"): string {
  return locale === "es" ? inviteMessageEs(invite, url) : inviteMessageEn(invite, url);
}

export function inviteMessageEn(invite: Partial<Invite>, url: string): string {
  const name = cleanName(invite.name);
  const greeting = name ? `All set, ${name}!` : "All set!";
  return [
    `${greeting} Here is your link to ${BRAND.name}:`,
    url,
    "There you sign your service agreement, upload your ID and a proof of address, and connect your credit monitoring.",
    `Then you review your report with ${BRAND.assistant}, the AI assistant. You decide what is inaccurate and why; our team prepares and mails the letters for you. I'm still here if you have questions.`,
  ].join("\n\n");
}

export function inviteMessageEs(invite: Partial<Invite>, url: string): string {
  const name = cleanName(invite.name);
  const greeting = name ? `¡Listo, ${name}!` : "¡Listo!";
  return [
    `${greeting} Aquí está tu enlace para entrar a ${BRAND.name}:`,
    url,
    "Ahí firmas tu acuerdo de servicio, subes tu identificación y un comprobante de domicilio, y conectas tu monitoreo de crédito.",
    `Después revisas tu reporte con ${BRAND.assistant}, el asistente con IA. Tú decides qué es inexacto y por qué; nuestro equipo prepara y envía las cartas por ti. Yo sigo aquí por si tienes dudas.`,
  ].join("\n\n");
}

// What a salesperson may and may not say. Shown on the invite page and repeated
// in docs/SALES-FLOW.md. Short on purpose: each line is something to do or not
// do in the next conversation. The first list describes the process, which is
// true and may be said; the second is what turns a description into a promise,
// a decision made for the customer, or pressure.

export const SALES_MAY_SAY: readonly string[] = [
  "Cómo trabajamos: el cliente revisa su reporte y dice qué es inexacto; nuestro equipo prepara y envía las cartas, en rondas de unos 40 días.",
  "Lo que le toca al cliente: firmar el acuerdo, subir su identificación y un comprobante de domicilio, conectar su monitoreo y revisar su reporte.",
  "El monitoreo es una suscripción aparte: el cliente se la paga al servicio de monitoreo, no a nosotros.",
  "El plan se explica antes de firmar, tal como está en el acuerdo. No se cobra un servicio antes de haberlo hecho.",
  "Después de firmar, el cliente tiene 3 días hábiles para cancelar sin costo.",
];

export const SALES_MAY_NOT_SAY: readonly string[] = [
  "Resultados, puntos, fechas o aprobaciones. Nada de «eliminamos», «borramos» o «te subimos el puntaje»: los burós deciden y los resultados varían.",
  "Qué marcar. Las respuestas son del cliente: no las des por él, y no digas que disputamos todo lo negativo.",
  "Precios o descuentos que no estén en el plan.",
  "Presión: nada de «solo hoy» ni «últimos lugares». El cliente decide con calma.",
  "Cobros por teléfono. Todo por escrito en WhatsApp: no cierres ventas ni tomes pagos por llamada.",
];
