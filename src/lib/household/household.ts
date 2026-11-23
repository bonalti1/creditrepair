import { BRAND } from "../brand";
import { buildInvitePath, type GoalKey } from "../sales/invite";
import { cleanPersonName, normalizeEmail, normalizePhone } from "../staff/team";

// Household signup (Credit Repair Cloud added it on Nov 12, 2026; our plans
// already had the household discount). A client, or sales on the invite,
// adds a spouse, partner or family member. That person becomes someone of
// their own: a prospect with their own invitation, then their own login,
// their own agreement and their own disputes. Nothing is shared between the
// two: the link only says they are a household, so the plan's household
// discount applies to each agreement (migration 0027), and the staff pages
// show "Household: <name>". Pausing, cancelling and billing stay per person.
//
// Here: what a household member is, the check of what was typed, and their
// invitation. Pure.

export const RELATIONSHIPS = ["spouse", "partner", "family"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export const RELATIONSHIP_LABEL: Record<"en" | "es", Record<Relationship, string>> = {
  en: { spouse: "Spouse", partner: "Partner", family: "Family member" },
  es: { spouse: "Cónyuge", partner: "Pareja", family: "Familiar" },
};

export interface HouseholdMemberInput {
  firstName: string;
  lastName: string;
  /** Their own WhatsApp number: their invitation and their own login. */
  phone: string;
  email?: string | null;
  relationship: string;
  /** Their language: their invitation and their app go in it. */
  locale: string;
}

export interface HouseholdMember {
  firstName: string;
  lastName: string;
  /** E.164. */
  phone: string;
  email: string | null;
  relationship: Relationship;
  locale: "en" | "es";
}

export type HouseholdField = "firstName" | "lastName" | "phone" | "email" | "relationship" | "locale";

export type HouseholdCheck =
  | { ok: true; value: HouseholdMember }
  | { ok: false; problems: Partial<Record<HouseholdField, { en: string; es: string }>> };

/**
 * Check what was typed for a household member. `primaryPhone` is the person
 * adding them: a household member has their own phone, because it is their
 * own login. `taken` are phones already used by a client or an open lead.
 */
export function checkHouseholdMember(input: HouseholdMemberInput, primaryPhone: string | null, taken: Iterable<string> = []): HouseholdCheck {
  const problems: Partial<Record<HouseholdField, { en: string; es: string }>> = {};
  const firstName = cleanPersonName(input.firstName, 40);
  const lastName = cleanPersonName(input.lastName, 40);
  const phone = normalizePhone(input.phone);
  const rawEmail = (input.email ?? "").trim();
  const email = rawEmail ? normalizeEmail(rawEmail) : null;
  if (!firstName) problems.firstName = { en: "Enter their first name.", es: "Escribe su nombre." };
  if (!lastName) problems.lastName = { en: "Enter their last name.", es: "Escribe su apellido." };
  if (!phone) problems.phone = { en: "Enter a 10-digit US phone number.", es: "Escribe un teléfono de 10 dígitos de EE. UU." };
  else if (primaryPhone && normalizePhone(primaryPhone) === phone) {
    problems.phone = {
      en: "Each person needs their own phone: it's their own login and their own invitation.",
      es: "Cada persona necesita su propio teléfono: es su propio acceso y su propia invitación.",
    };
  } else if ([...taken].some((p) => normalizePhone(p) === phone)) {
    problems.phone = {
      en: "Someone with this phone is already a client or a lead. The team can link existing clients as a household from Plans.",
      es: "Alguien con este teléfono ya es cliente o prospecto. El equipo puede ligar como hogar a clientes que ya existen desde Planes.",
    };
  }
  if (rawEmail && !email) problems.email = { en: "That email doesn't look right. You can leave it empty.", es: "Ese correo no parece válido. Puedes dejarlo vacío." };
  if (!(RELATIONSHIPS as readonly string[]).includes(input.relationship)) problems.relationship = { en: "Choose how they're related.", es: "Elige qué relación tienen." };
  if (input.locale !== "en" && input.locale !== "es") problems.locale = { en: "Choose their language.", es: "Elige su idioma." };
  if (Object.keys(problems).length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: { firstName: firstName!, lastName: lastName!, phone: phone!, email, relationship: input.relationship as Relationship, locale: input.locale as "en" | "es" },
  };
}

/** The household member's own invitation link: their name and language, the same state and salesperson as the person who added them. */
export function householdInvitePath(member: Pick<HouseholdMember, "firstName" | "locale">, from: { state?: string | null; goal?: GoalKey | null; ref?: string | null; refName?: string | null }): string {
  return buildInvitePath({ name: member.firstName, state: from.state ?? null, goal: from.goal ?? null, ref: from.ref ?? null, refName: from.refName ?? null, lang: member.locale });
}

/**
 * The message that goes with it, in the member's language. It says who added
 * them and that everything is their own. Passes the claim rules (no promise,
 * no price): it describes the process only.
 */
export function householdInviteMessage(memberFirstName: string, addedByFirstName: string, url: string, locale: "en" | "es"): string {
  return locale === "es"
    ? [
        `¡Hola, ${memberFirstName}! ${addedByFirstName} te agregó como parte de su hogar en ${BRAND.name}.`,
        "Aquí está tu propio enlace:",
        url,
        "Tu cuenta es solo tuya: tu propio acuerdo, tu propio reporte y tus propias decisiones. Nada de lo tuyo se comparte con tu hogar.",
        `Tú revisas tu reporte con ${BRAND.assistant}, el asistente con IA, y decides qué es inexacto y por qué; nuestro equipo prepara y envía las cartas por ti.`,
      ].join("\n\n")
    : [
        `Hi ${memberFirstName}! ${addedByFirstName} added you as part of their household at ${BRAND.name}.`,
        "Here is your own link:",
        url,
        "Your account is yours alone: your own agreement, your own report and your own decisions. Nothing of yours is shared with your household.",
        `You review your report with ${BRAND.assistant}, the AI assistant, and decide what is inaccurate and why; our team prepares and mails the letters for you.`,
      ].join("\n\n");
}

/** What the staff pages show for a client's household. */
export interface HouseholdLink {
  /** The other person's id in the console (a client's account id, or a prospect's). */
  partnerId: string;
  partnerName: string;
  relationship: Relationship | "household";
  /** "invited": the other person has no account yet. "linked": both have accounts and the discount link exists. */
  status: "invited" | "linked";
}
