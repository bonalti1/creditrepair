import { localDay } from "../autopilot/clock";
import { BRAND } from "../brand";
import { containsTaxpayerNumber } from "../aftercare/itin";
import { checkStaffReply, type ReplyProblem } from "../staff/conversation";
import { partnerKindOf, REFERRAL_STATUSES, type CareTeamMember, type PartnerKind, type PartnerReferral, type ReferralStatus } from "./rules";
import { partnerMilestones, type PartnerMilestone, type PartnerProgress } from "./sharing";

// The partner portal's pure rules (docs/PARTNERS.md, "The partner portal"):
// who on the team looks after a person and the team's promise (process
// words, never an outcome); when a partner may ask a person to share their
// progress; the weekly summary; the partner kit's ready-to-send messages; the
// checks a note between a partner and the team passes. English first, the
// same in Spanish. The database decides what a partner may read (migration
// 0033); this file only words it.

export type L = "es" | "en";

const brand = BRAND.name;
const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

// ── Who is taking care of your client ───────────────────────────────────

/** A teammate's role, as a partner reads it. */
export const CARE_ROLE_LABEL: Record<L, Record<CareTeamMember["role"], string>> = {
  en: { admin: "Team lead", specialist: "Credit specialist", sales: "Enrollment advisor" },
  es: { admin: "Líder del equipo", specialist: "Especialista de crédito", sales: "Asesor de inscripción" },
};

/** "Ana · Credit specialist, Credalti team" / "Ana · Especialista de crédito, equipo Credalti". */
export function careLine(care: CareTeamMember, locale: L): string {
  const role = CARE_ROLE_LABEL[locale][care.role];
  return locale === "es" ? `${care.firstName} · ${role}, equipo ${brand}` : `${care.firstName} · ${role}, ${brand} team`;
}

export function careFromRow(firstName: unknown, role: unknown): CareTeamMember | null {
  const name = typeof firstName === "string" ? firstName.trim() : "";
  if (!name || !["admin", "specialist", "sales"].includes(String(role))) return null;
  return { firstName: name.slice(0, 40), role: role as CareTeamMember["role"] };
}

/**
 * How quickly a person on the team answers, in business hours. The owner's
 * process promise (docs/PARTNERS.md asks the owner to confirm it); the
 * console's own deadline for a waiting question is 24 hours (autopilot/queue.ts).
 */
export const TEAM_RESPONSE_BUSINESS_DAYS = 1;

/** The team's promise, in process words: who reaches out, how soon. Never a result. */
export const TEAM_PROMISE: Record<L, { title: string; lines: string[] }> = {
  en: {
    title: "How the team takes care of your clients",
    lines: [
      `A person on the team reaches out to each new referral within ${TEAM_RESPONSE_BUSINESS_DAYS} business day, on WhatsApp.`,
      `Your client's questions get an answer from a person within ${TEAM_RESPONSE_BUSINESS_DAYS} business day, Monday to Friday.`,
      "Your client decides what to dispute. The team prepares and mails the letters and keeps them posted.",
      "Nobody can promise results. The bureaus decide.",
    ],
  },
  es: {
    title: "Cómo cuida el equipo a tus clientes",
    lines: [
      `Una persona del equipo escribe a cada nuevo referido en ${TEAM_RESPONSE_BUSINESS_DAYS} día hábil, por WhatsApp.`,
      `Las preguntas de tu cliente las responde una persona en ${TEAM_RESPONSE_BUSINESS_DAYS} día hábil, de lunes a viernes.`,
      "Tu cliente decide qué disputar. El equipo prepara y envía las cartas y le avisa de cada paso.",
      "Nadie puede prometer resultados. Los burós deciden.",
    ],
  },
};

// ── A referral from the database ────────────────────────────────────────

type Row = Record<string, unknown>;
const isoOrNull = (v: unknown): string | null => ((typeof v === "string" || v instanceof Date) && !Number.isNaN(new Date(v as string).getTime()) ? new Date(v as string).toISOString() : null);

/** One row of partner_referrals() (migration 0033). */
export function referralFromRow(r: Row): PartnerReferral {
  return {
    id: String(r.referral_id),
    firstName: String(r.first_name ?? ""),
    lastInitial: String(r.last_initial ?? ""),
    referredAt: isoOrNull(r.referred_at) ?? String(r.referred_at ?? ""),
    status: ((REFERRAL_STATUSES as readonly string[]).includes(String(r.status)) ? r.status : "contacted") as ReferralStatus,
    contactedAt: isoOrNull(r.contacted_at),
    care: careFromRow(r.care_first_name, r.care_role),
    hasAccount: r.has_account === true,
    sharedClientId: typeof r.shared_client_id === "string" && r.shared_client_id ? r.shared_client_id : null,
    shareRequestedAt: isoOrNull(r.share_requested_at),
  };
}

/** The exact columns partner_referrals() returns. A test compares them with the migration. */
export const PARTNER_REFERRAL_COLUMNS = [
  "referral_id", "first_name", "last_initial", "referred_at", "status", "contacted_at", "care_first_name", "care_role",
  "has_account", "shared_client_id", "share_requested_at",
] as const;

// ── "Ask to follow progress" ────────────────────────────────────────────

/** A client is asked at most once in this many days (the database refuses a second request). */
export const SHARE_REQUEST_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ShareAskState =
  /** They share: open their page. */
  | "sharing"
  /** No account yet: they choose when they create it. */
  | "no_account"
  /** Did not continue: nothing to ask. */
  | "closed"
  /** Asked less than 14 days ago. */
  | "requested"
  | "can_ask";

export function shareAskState(r: Pick<PartnerReferral, "status" | "hasAccount" | "sharedClientId" | "shareRequestedAt">, now: Date): ShareAskState {
  if (r.sharedClientId) return "sharing";
  if (r.status === "not_continued") return "closed";
  if (!r.hasAccount) return "no_account";
  if (r.shareRequestedAt && now.getTime() - new Date(r.shareRequestedAt).getTime() < SHARE_REQUEST_DAYS * DAY_MS) return "requested";
  return "can_ask";
}

/** The WhatsApp template the client's message goes in (to be approved in Meta, en_US and es_MX). */
export const SHARE_REQUEST_TEMPLATE = "credalti_socio_pide_avance";

/** {{1}} the client's first name, {{2}} the partner as shown ("Laura Benítez, Benítez Realty"). */
export const SHARE_REQUEST_BODIES: Record<L, string> = {
  en: `Hi {{1}}, {{2}} asked to follow your progress with ${brand}. It is your choice: nothing is shared unless you turn it on, and you can stop any time. To decide, open your app: More, then Who can see your progress.`,
  es: `Hola {{1}}, {{2}} pidió seguir tu avance con ${brand}. Es tu decisión: no se comparte nada si no lo activas, y lo puedes quitar cuando quieras. Para decidir, abre tu app: Más, luego Quién puede ver tu progreso.`,
};

export function shareRequestText(locale: L, clientFirstName: string, partnerShown: string): string {
  return SHARE_REQUEST_BODIES[locale].replace("{{1}}", first(clientFirstName) || (locale === "es" ? "hola" : "there")).replace("{{2}}", partnerShown);
}

/** What the client's in-app card says. */
export const SHARE_REQUEST_CARD: Record<L, { title: (partner: string) => string; body: string; choose: string; later: string; asked: (partner: string, day: string) => string }> = {
  en: {
    title: (partner) => `${first(partner)} asked to follow your progress`,
    body: "It is your choice. Nothing is shared unless you turn it on, and they never see your credit report.",
    choose: "See what they would see",
    later: "Not now",
    asked: (partner, day) => `${first(partner)} asked on ${day} to follow your progress. Nothing is shared unless you choose it below.`,
  },
  es: {
    title: (partner) => `${first(partner)} pidió seguir tu avance`,
    body: "Es tu decisión. No se comparte nada si no lo activas, y nunca ve tu reporte de crédito.",
    choose: "Ver lo que vería",
    later: "Ahora no",
    asked: (partner, day) => `${first(partner)} pidió el ${day} seguir tu avance. No se comparte nada si no lo eliges abajo.`,
  },
};

/** An open request as the client's app reads it (their own rows). */
export interface ClientShareRequest {
  id: string;
  partnerId: string;
  partnerName: string;
  at: string;
  dismissedAt: string | null;
}

/**
 * Whether the card is shown: not dismissed, not older than the 14 days, and
 * the client has not made any choice for that partner since it was asked.
 */
export function openShareRequest(
  requests: readonly ClientShareRequest[],
  choices: ReadonlyArray<{ partnerId: string; at: string }>,
  levels: ReadonlyArray<{ partnerId: string; level: string }>,
  now: Date,
): ClientShareRequest | null {
  const newest = [...requests].sort((a, b) => b.at.localeCompare(a.at))[0];
  if (!newest || newest.dismissedAt) return null;
  if (now.getTime() - new Date(newest.at).getTime() > SHARE_REQUEST_DAYS * DAY_MS) return null;
  if (levels.some((l) => l.partnerId === newest.partnerId && l.level !== "none")) return null;
  if (choices.some((c) => c.partnerId === newest.partnerId && c.at >= newest.at)) return null;
  return newest;
}

// ── The weekly summary ──────────────────────────────────────────────────

/** The WhatsApp template of the weekly summary (to be approved in Meta). */
export const DIGEST_TEMPLATE = "credalti_socio_resumen";
/** {{1}} the partner's first name; {{2}} the week's milestones, one sentence each, joined by " · ". */
export const DIGEST_BODIES: Record<L, string> = {
  en: "Hi, {{1}}. Your weekly Credalti summary: {{2}} More details in your Credalti partner portal.",
  es: "Hola, {{1}}. Tu resumen semanal de Credalti: {{2}} Más detalles en tu portal de socios de Credalti.",
};

/** The summary goes on Mondays from 9:00 on the partner's clock (outside quiet hours). */
export const DIGEST_WEEKDAY = 1;
export const DIGEST_HOUR = 9;
const DIGEST_MAX_ITEMS = 12;

/** "2026-W48": the ISO week of the partner's local date. */
export function digestWeekKey(now: Date, timeZone: string): string {
  const [y, m, d] = localDay(now, timeZone).split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Is it Monday from 9:00 on the partner's clock? */
export function digestTime(now: Date, timeZone: string): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return weekday === "Mon" && hour >= DIGEST_HOUR;
}

/** The last 7 days' milestones of each client who shares, since they began sharing, oldest first. */
export function digestItems(clients: readonly PartnerProgress[], now: Date): Array<PartnerMilestone & { clientId: string }> {
  const since = now.getTime() - 7 * DAY_MS;
  return clients
    .flatMap((c) => partnerMilestones(c, now).filter((m) => new Date(m.at).getTime() >= Math.max(since, new Date(c.sharedAt).getTime())).map((m) => ({ ...m, clientId: c.clientId })))
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-DIGEST_MAX_ITEMS);
}

/** The template's two parameters: the partner's first name and the milestones (WhatsApp parameters hold no line breaks). */
export function digestParams(partner: { name: string; locale?: L }, items: readonly PartnerMilestone[]): [string, string] {
  const locale = partner.locale === "es" ? "es" : "en";
  return [first(partner.name), items.map((i) => i.text[locale]).join(" · ")];
}

export function digestText(partner: { name: string; locale?: L }, items: readonly PartnerMilestone[]): string {
  const [name, list] = digestParams(partner, items);
  return DIGEST_BODIES[partner.locale === "es" ? "es" : "en"].replace("{{1}}", name).replace("{{2}}", list);
}

// ── The partner kit: ready-to-send messages ─────────────────────────────

export interface KitMessage {
  key: "text" | "email" | "post";
  locale: L;
  title: string;
  text: string;
}

/** Whether the partner is paid, said plainly (FTC Endorsement Guides). */
export function kitFeesLine(locale: L, commissionsEnabled: boolean): string {
  if (locale === "es") return commissionsEnabled ? `Recibo una comisión si te refiero a ${brand}.` : `No recibo ningún pago por recomendarte ${brand}.`;
  return commissionsEnabled ? `I receive a commission if I refer you to ${brand}.` : `I receive no payment for recommending ${brand}.`;
}

/** What a partner does, in a phrase that fits "As a …" ("As a car dealer, …"), for every kind. */
const KIND_INTRO: Record<L, Record<PartnerKind, string>> = {
  en: {
    realtor: "I help people buy homes",
    loan_officer: "I help people with loans",
    tax_preparer: "I help people with their taxes",
    car_dealer: "I help people buy cars",
    attorney: "I work with people on their legal matters",
    other: "I work with people on money decisions",
  },
  es: {
    realtor: "Ayudo a personas a comprar casa",
    loan_officer: "Ayudo a personas con sus préstamos",
    tax_preparer: "Ayudo a personas con sus impuestos",
    car_dealer: "Ayudo a personas a comprar carro",
    attorney: "Trabajo con personas en sus asuntos legales",
    other: "Trabajo con personas en sus decisiones de dinero",
  },
};

/**
 * Three messages a partner can copy, in English and in Spanish: a short text
 * for WhatsApp, an email, and a social post. Process words only: the team
 * explains, the person decides, nobody promises results; the fee line says
 * whether the partner is paid. Each passes checkMarketingCopy (a test).
 */
export function kitMessages(partner: { name: string; kind: string }, link: string, commissionsEnabled: boolean): KitMessage[] {
  const kind = partnerKindOf(partner.kind);
  const name = first(partner.name);
  const out: KitMessage[] = [];
  for (const locale of ["en", "es"] as const) {
    const fees = kitFeesLine(locale, commissionsEnabled);
    if (locale === "en") {
      out.push(
        {
          key: "text",
          locale,
          title: "Short message (WhatsApp)",
          text: `Hi! If something on your credit report looks wrong, ${brand} can help. Their team explains everything in English or Spanish, you decide what to dispute, and they prepare and mail the letters. Nobody can promise results. Start here: ${link}\n${fees}`,
        },
        {
          key: "email",
          locale,
          title: "Email",
          text: `Subject: Help with your credit report\n\nHi,\n\n${KIND_INTRO.en[kind]}, and many of my clients ask about their credit report. I recommend ${brand}: a team that reviews your report with you, in English or Spanish. You decide what looks wrong; they prepare and mail the dispute letters and keep you posted with dates. They explain the plan and its price in writing before you sign anything, and you have 3 business days to cancel at no cost. Nobody can promise results: the bureaus decide.\n\nIf you want, you can let me follow your progress (steps and dates only, never your credit report). That is your choice.\n\nStart here: ${link}\n\n${fees}\n\n${name}`,
        },
        {
          key: "post",
          locale,
          title: "Social post",
          text: `Questions about your credit report? I work with ${brand}, a team that helps you dispute what you say is wrong, in English or Spanish. You decide; they prepare and mail the letters. Results vary and nobody can promise them. ${link}\n${fees}`,
        },
      );
    } else {
      out.push(
        {
          key: "text",
          locale,
          title: "Mensaje corto (WhatsApp)",
          text: `¡Hola! Si algo en tu reporte de crédito se ve mal, ${brand} te puede ayudar. Su equipo te explica todo en inglés o en español, tú decides qué disputar, y ellos preparan y envían las cartas. Nadie puede prometer resultados. Empieza aquí: ${link}\n${fees}`,
        },
        {
          key: "email",
          locale,
          title: "Correo",
          text: `Asunto: Ayuda con tu reporte de crédito\n\nHola:\n\n${KIND_INTRO.es[kind]}, y muchos de mis clientes preguntan por su reporte de crédito. Te recomiendo ${brand}: un equipo que revisa tu reporte contigo, en inglés o en español. Tú decides qué está mal; ellos preparan y envían las cartas de disputa y te avisan de cada paso con fechas. Te explican el plan y su precio por escrito antes de que firmes, y tienes 3 días hábiles para cancelar sin costo. Nadie puede prometer resultados: los burós deciden.\n\nSi quieres, puedes dejar que yo siga tu avance (solo pasos y fechas, nunca tu reporte). Es tu decisión.\n\nEmpieza aquí: ${link}\n\n${fees}\n\n${name}`,
        },
        {
          key: "post",
          locale,
          title: "Publicación en redes",
          text: `¿Dudas sobre tu reporte de crédito? Trabajo con ${brand}, un equipo que te ayuda a disputar lo que tú digas que está mal, en inglés o en español. Tú decides; ellos preparan y envían las cartas. Los resultados varían y nadie los puede prometer. ${link}\n${fees}`,
        },
      );
    }
  }
  return out;
}

/** The printable flyer's words (/conoce/<code>/imprimir). */
export function flyerCopy(locale: L, partner: { name: string; company: string | null }, commissionsEnabled: boolean) {
  const who = partner.company ? `${partner.name}, ${partner.company}` : partner.name;
  if (locale === "es") {
    return {
      eyebrow: `Te lo recomienda ${who}`,
      title: "¿Algo en tu reporte de crédito se ve mal?",
      lead: `${brand} revisa tu reporte contigo, en inglés o en español. Tú decides qué está mal; el equipo prepara y envía tus cartas de disputa y te avisa de cada paso.`,
      points: [
        "Te explican el plan y su precio por escrito, antes de firmar.",
        "Tienes 3 días hábiles para cancelar sin costo.",
        "Nunca des tu número de Seguro Social a nadie más: lo das tú, en tu propia cuenta.",
        "Nadie puede prometer resultados. Los burós deciden.",
      ],
      scan: "Escanea para empezar",
      alti: `${BRAND.assistant} te guía en la app`,
      fees: kitFeesLine("es", commissionsEnabled),
      print: "Imprimir",
      back: "Volver al portal",
    };
  }
  return {
    eyebrow: `Recommended by ${who}`,
    title: "Does something on your credit report look wrong?",
    lead: `${brand} reviews your report with you, in English or Spanish. You decide what is wrong; the team prepares and mails your dispute letters and keeps you posted at every step.`,
    points: [
      "They explain the plan and its price in writing, before you sign.",
      "You have 3 business days to cancel at no cost.",
      "Never give your Social Security number to anyone else: you enter it yourself, in your own account.",
      "Nobody can promise results. The bureaus decide.",
    ],
    scan: "Scan to get started",
    alti: `${BRAND.assistant} guides you in the app`,
    fees: kitFeesLine("en", commissionsEnabled),
    print: "Print",
    back: "Back to the portal",
  };
}

// ── Notes between a partner and the team ────────────────────────────────

export interface TeamNote {
  id: string;
  authorKind: "partner" | "staff";
  authorFirstName: string;
  /** A teammate's role; null for the partner. */
  authorRole: CareTeamMember["role"] | null;
  body: string;
  at: string;
}

export function teamNoteFromRow(r: Row): TeamNote {
  return {
    id: String(r.note_id ?? r.id),
    authorKind: r.author_kind === "staff" ? "staff" : "partner",
    authorFirstName: String(r.author_first_name ?? ""),
    authorRole: ["admin", "specialist", "sales"].includes(String(r.author_role)) ? (r.author_role as CareTeamMember["role"]) : null,
    body: String(r.body ?? ""),
    at: isoOrNull(r.created_at) ?? new Date(0).toISOString(),
  };
}

const MONEY = /\$\s?\d|\b\d+(?:[.,]\d+)?\s?(d[oó]lares|dollars|usd)\b/i;
const LONG_NUMBER = /(?<!\d)\d{5,}(?!\d)/;
const SCORE = /\b(scores?|puntajes?|puntuaci[oó]n|fico|vantage\w*)\b/i;
const BIRTH = /\b(date of birth|fecha de nacimiento|dob)\b|\b\d{1,2}\/\d{1,2}\/(19|20)\d{2}\b/i;
const ACCOUNT = /\b(account (number|no\.?|#)|n[uú]mero de cuenta|routing)\b/i;

const NOTE_WHY: Record<L, Record<"money" | "number" | "score" | "ssn" | "birth" | "account", string>> = {
  en: {
    money: "It has an amount. Prices and payments stay between the client and the team.",
    number: "It has a long number (an account, a phone or a case number). Leave it out.",
    score: "It mentions scores. Notes about a client never carry credit data.",
    ssn: "It looks like a Social Security number or an ITIN. Never send one here.",
    birth: "It has a date of birth. Never send one here.",
    account: "It mentions an account number. Notes never carry credit data.",
  },
  es: {
    money: "Lleva un monto. Precios y pagos quedan entre el cliente y el equipo.",
    number: "Lleva un número largo (de cuenta, teléfono o caso). Quítalo.",
    score: "Menciona puntajes. Las notas sobre un cliente nunca llevan datos de crédito.",
    ssn: "Parece un número de Seguro Social o un ITIN. Nunca lo envíes aquí.",
    birth: "Lleva una fecha de nacimiento. Nunca la envíes aquí.",
    account: "Menciona un número de cuenta. Las notas nunca llevan datos de crédito.",
  },
};

/**
 * Why a note between a partner and the team cannot go, or an empty list: the
 * claim rules every staff reply passes (no promises of results, points, dates
 * or approvals), and no credit data (no score, amount, account or long
 * number, Social Security number or date of birth). The same checks for both
 * sides: a partner's note and a teammate's reply.
 */
export function teamNoteProblems(text: string, locale: L = "en"): ReplyProblem[] {
  const why = NOTE_WHY[locale];
  const problems: ReplyProblem[] = [...checkStaffReply(text, locale)];
  if (containsTaxpayerNumber(text)) problems.push({ phrase: locale === "es" ? "número de 9 dígitos" : "9-digit number", why: why.ssn });
  const checks: Array<[RegExp, keyof typeof why]> = [
    [MONEY, "money"],
    [SCORE, "score"],
    [BIRTH, "birth"],
    [ACCOUNT, "account"],
  ];
  for (const [pattern, key] of checks) {
    const m = text.match(pattern);
    if (m) problems.push({ phrase: m[0], why: why[key] });
  }
  if (!containsTaxpayerNumber(text)) {
    const m = text.match(LONG_NUMBER);
    if (m) problems.push({ phrase: m[0], why: why.number });
  }
  return problems;
}
