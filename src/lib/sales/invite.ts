import { ALL_STATES } from "../compliance/states";
import { BRAND } from "../brand";

// The handoff from sales to the software. A salesperson talks with the lead on
// WhatsApp, then sends a personal link. The link carries what the conversation
// already established (first name, goal, state, who sent it) so the customer
// does not answer the same questions twice.
//
// Everything in the link is treated as a suggestion, never as fact: values are
// validated here, the state gate still applies, and nothing in a link can skip
// the customer's own decisions (reviewing items, the attestation, approving
// letters). The link holds no phone number, address or account data.

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
  const qs = query.toString();
  return qs ? `/onboarding?${qs}` : "/onboarding";
}

/** The WhatsApp message the salesperson sends with the link. Passes the claim rules. */
export function inviteMessageEs(invite: Partial<Invite>, url: string): string {
  const name = cleanName(invite.name);
  const greeting = name ? `¡Listo, ${name}!` : "¡Listo!";
  return [
    `${greeting} Aquí está tu enlace para entrar a ${BRAND.name}:`,
    url,
    `Ahí ves tu reporte y ${BRAND.assistant}, el asistente con IA, te explica cada punto. Tú decides qué disputar y tú apruebas cada carta. Yo sigo aquí por si tienes dudas.`,
  ].join("\n\n");
}
