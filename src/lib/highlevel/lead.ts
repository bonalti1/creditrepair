import { z } from "zod";
import { ALL_STATES } from "../compliance/states";
import { GOALS, toRefSlug, type GoalKey } from "../sales/invite";
import { cleanPersonName, normalizeEmail, normalizePhone } from "../staff/team";
import type { LeadUtm } from "../leads/source";

// A lead handed over by a HighLevel workflow (POST /api/webhooks/highlevel).
//
// HighLevel's "Custom Webhook" workflow action lets us write the JSON body
// with its merge fields, so the shape below is ours (docs/HIGHLEVEL.md has the
// exact body to paste). The plain "Webhook" action sends HighLevel's own
// contact payload instead ("contact_id", "first_name", "phone", and the
// workflow's custom values under "customData"); both are read here.
//
// What a lead may carry: name, phone, email, state, goal, the consent the
// person gave on the form, the campaign and UTM tags, the salesperson
// HighLevel assigned, and a partner's referral code. What it may never carry
// is a Social Security number or a date of birth: such a field is dropped
// before anything else reads the body, and only its NAME is kept, to log that
// it was dropped. Its value is never stored, logged or returned.

/** Largest body accepted. A real lead is well under 2 KB. */
export const MAX_LEAD_BYTES = 16_000;

/** Field names that look like a Social Security number or a date of birth, in English or Spanish. */
const FORBIDDEN_WORDS = /(?<![a-z])(ssn|itin|dob|social|ss_?num(ber)?)(?![a-z])|social[\s_-]*security|seguro[\s_-]*social|tax[\s_-]*id|birth|nacimiento|fecha[\s_-]*(de[\s_-]*)?nac|cumplea/;

/** True when a field's name says it holds an SSN or a date of birth ("ssn", "dateOfBirth", "fecha_nacimiento", "Seguro Social"). */
export function isForbiddenFieldName(key: string): boolean {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return FORBIDDEN_WORDS.test(words);
}

/** A value that looks like an SSN wherever it sits (a free-text field, a custom value). */
const SSN_VALUE = /\b\d{3}-\d{2}-\d{4}\b|^\s*\d{9}\s*$/;

export interface StrippedBody {
  body: Record<string, unknown>;
  /** Names (paths) of fields that were removed. Never their values. */
  dropped: string[];
}

/**
 * Removes every field whose name looks like an SSN or a date of birth, and any
 * string value that looks like an SSN, at any depth. Returns the rest and the
 * names of what was removed.
 */
export function stripForbiddenFields(input: unknown): StrippedBody {
  const dropped: string[] = [];
  const walk = (value: unknown, path: string, depth: number): unknown => {
    if (depth > 4) return undefined;
    if (Array.isArray(value)) return value.slice(0, 20).map((v, i) => walk(v, `${path}[${i}]`, depth + 1)).filter((v) => v !== undefined);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
        const here = path ? `${path}.${key}` : key;
        if (isForbiddenFieldName(key)) {
          dropped.push(here);
          continue;
        }
        const kept = walk(v, here, depth + 1);
        if (kept !== undefined) out[key] = kept;
      }
      return out;
    }
    if (typeof value === "string" && SSN_VALUE.test(value) && !/phone|tel|cel|contact|id$/i.test(path)) {
      // A 123-45-6789 or a bare nine-digit value outside a phone or id field.
      dropped.push(path);
      return undefined;
    }
    return value;
  };
  const body = walk(input, "", 0);
  return { body: body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {}, dropped };
}

const text = (max: number) => z.string().trim().max(max).optional().nullable();

/** The fields read, under our names and HighLevel's own. Anything else is ignored. */
const leadSchema = z.object({
  contactId: text(64),
  contact_id: text(64),
  id: text(64),
  firstName: text(80),
  first_name: text(80),
  lastName: text(80),
  last_name: text(80),
  name: text(120),
  full_name: text(120),
  phone: text(40),
  email: text(200),
  state: text(40),
  goal: text(80),
  consentText: text(1000),
  consent_text: text(1000),
  consentAt: text(40),
  consent_at: text(40),
  source: text(80),
  campaign: text(120),
  utm: z
    .object({ source: text(120), medium: text(120), campaign: text(120), content: text(120), term: text(120) })
    .partial()
    .optional()
    .nullable(),
  utmSource: text(120),
  utmMedium: text(120),
  utmCampaign: text(120),
  utmContent: text(120),
  utmTerm: text(120),
  // The Meta ad a form lead came from ({{ad.id}} in the ad's URL parameters), and whether a Facebook click id was there (never its value).
  adId: text(40),
  ad_id: text(40),
  fbclid: text(500),
  assignedTo: text(200),
  assigned_to: text(200),
  partnerCode: text(40),
  partner_code: text(40),
  socio: text(40),
});

export interface HighLevelLead {
  contactId: string | null;
  firstName: string;
  lastName: string;
  /** E.164, US. */
  phone: string;
  email: string | null;
  state: string;
  goal: GoalKey;
  consentText: string | null;
  consentAt: string | null;
  campaign: string | null;
  utm: LeadUtm | null;
  /** The Meta ad, when the form passed its id (migration 0037: the lead's first touch). */
  ad: { adId?: string; fbclid?: true; via: "form" } | null;
  /** What HighLevel says about the assigned user: a handle, an email or a name. Matched to the team later. */
  assignedTo: string | null;
  partnerCode: string | null;
}

export type LeadField = "contactId" | "name" | "phone" | "email" | "state" | "consent";

export type LeadParse =
  | { ok: true; lead: HighLevelLead; dropped: string[] }
  | { ok: false; problems: Partial<Record<LeadField, string>>; dropped: string[] };

const STATE_NAMES: Record<string, string> = {
  texas: "TX",
  california: "CA",
  florida: "FL",
  "new york": "NY",
  "nueva york": "NY",
  arizona: "AZ",
  illinois: "IL",
  georgia: "GA",
  "new mexico": "NM",
  "nuevo mexico": "NM",
  "nuevo méxico": "NM",
  colorado: "CO",
  nevada: "NV",
};

export function readState(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if ((ALL_STATES as readonly string[]).includes(upper)) return upper;
  return STATE_NAMES[raw.toLowerCase()] ?? null;
}

/** A goal key from what a form may send: our keys, or the words a person picks. Unknown → "general". */
export function readGoal(value: string | null | undefined): GoalKey {
  const raw = (value ?? "").trim().toLowerCase();
  if (GOALS.some((g) => g.key === raw)) return raw as GoalKey;
  if (/casa|house|home|hipoteca|mortgage/.test(raw)) return "mortgage";
  if (/auto|carro|coche|car\b|truck|troca|camioneta/.test(raw)) return "auto";
  if (/tarjeta|card/.test(raw)) return "card";
  return "general";
}

const CONTACT_ID = /^[A-Za-z0-9_-]{4,64}$/;

/** "2026-11-20T15:04:05Z" or a date HighLevel prints; null when unreadable. Never in the future by more than a day. */
function readDate(value: string | null | undefined, now: Date): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t) || t > now.getTime() + 24 * 60 * 60 * 1000) return null;
  return new Date(t).toISOString();
}

const tidy = (value: string | null | undefined, max: number): string | null => {
  const cleaned = (value ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  return cleaned || null;
};

/**
 * Reads a HighLevel delivery: drops forbidden fields, validates the rest.
 * The consent text is required: a lead whose form did not show and record it
 * is refused (docs/HIGHLEVEL.md has the text the form must show).
 */
export function parseHighLevelLead(input: unknown, now: Date = new Date()): LeadParse {
  const { body, dropped } = stripForbiddenFields(input);
  // HighLevel's own payload puts the workflow's custom values under customData.
  const custom = body.customData && typeof body.customData === "object" ? (body.customData as Record<string, unknown>) : {};
  const merged = { ...body, ...custom };
  const parsed = leadSchema.safeParse(merged);
  if (!parsed.success) return { ok: false, problems: { name: "Campos con un formato que no se puede leer." }, dropped };
  const b = parsed.data;
  const problems: Partial<Record<LeadField, string>> = {};

  const contactRaw = (b.contactId || b.contact_id || b.id || "").trim();
  const contactId = contactRaw ? (CONTACT_ID.test(contactRaw) ? contactRaw : null) : null;
  if (contactRaw && !contactId) problems.contactId = "El id de contacto de HighLevel no tiene un formato válido.";

  const full = (b.full_name || b.name || "").trim();
  const [fullFirst, ...fullRest] = full.split(/\s+/);
  const firstName = cleanPersonName(b.firstName || b.first_name || fullFirst, 40);
  const lastName = cleanPersonName(b.lastName || b.last_name || fullRest.join(" "), 40) ?? (firstName ? "-" : null);
  if (!firstName) problems.name = "Falta el nombre.";

  const phone = normalizePhone(b.phone);
  if (!phone) problems.phone = "Falta un teléfono de 10 dígitos de EE. UU.";

  const rawEmail = (b.email ?? "").trim();
  const email = rawEmail ? normalizeEmail(rawEmail) : null;

  const state = readState(b.state);
  if (!state) problems.state = "Falta el estado (dos letras, por ejemplo TX).";

  const consentText = tidy(b.consentText || b.consent_text, 1000);
  if (!consentText || consentText.length < 10) problems.consent = "Falta el texto de consentimiento que aceptó la persona.";

  if (Object.keys(problems).length > 0) return { ok: false, problems, dropped };

  const utm: LeadUtm = {};
  const u = b.utm ?? {};
  const put = (key: keyof LeadUtm, value: string | null | undefined) => {
    const v = tidy(value, 120);
    if (v) utm[key] = v;
  };
  put("source", u.source || b.utmSource || b.source);
  put("medium", u.medium || b.utmMedium);
  put("campaign", u.campaign || b.utmCampaign);
  put("content", u.content || b.utmContent);
  put("term", u.term || b.utmTerm);

  const adId = (b.adId || b.ad_id || "").trim();
  const ad = /^\d{3,25}$/.test(adId) || (b.fbclid ?? "").trim() ? { ...(/^\d{3,25}$/.test(adId) ? { adId } : {}), ...((b.fbclid ?? "").trim() ? { fbclid: true as const } : {}), via: "form" as const } : null;

  const code = toRefSlug(b.partnerCode || b.partner_code || b.socio);
  return {
    ok: true,
    dropped,
    lead: {
      contactId,
      firstName: firstName!,
      // "-" is not a valid last name for the database (2 characters): use the initial-free placeholder.
      lastName: lastName === "-" ? "(sin apellido)".slice(0, 40) : lastName!,
      phone: phone!,
      email,
      state: state!,
      goal: readGoal(b.goal),
      consentText,
      consentAt: readDate(b.consentAt || b.consent_at, now) ?? now.toISOString(),
      campaign: tidy(b.campaign, 120),
      utm: Object.keys(utm).length > 0 ? utm : null,
      ad,
      assignedTo: tidy(b.assignedTo || b.assigned_to, 200),
      partnerCode: code && code.length >= 3 ? code : null,
    },
  };
}
