import { insideWhatsAppWindow, templateApproved } from "../autopilot/channels";
import { isQuietHour } from "../autopilot/clock";
import { FOOTER, type MessageTemplate } from "../autopilot/templates";
import type { ChannelAvailability } from "../autopilot/types";
import { BRAND } from "../brand";
import { endsAt, TEXAS_TZ, WEBINAR_QUIET, webinarTime, webinarWhen } from "./time";
import { REMINDER_KINDS, type Registration, type ReminderKind, type Webinar } from "./types";

// The webinar's reminders (docs/WEBINARS.md, «Reminders»), under the rules of
// every automatic message (docs/AUTOPILOT.md):
//
//   - only to a registrant who ticked the reminders box (never pre-ticked);
//   - WhatsApp first (plain text inside the 24-hour window, otherwise ONLY the
//     approved template below), email when WhatsApp cannot carry it, and
//     NEVER SMS (there is no SMS channel anywhere);
//   - nothing to a number that said STOP / BAJA, or a registration that used
//     the email's unsubscribe link;
//   - nothing in quiet hours, 9 p.m. to 8 a.m. Texas time (the message waits
//     for the morning only while its own window is still open);
//   - each reminder once per registration, under its dedupe key
//     (webinar:<registration>:<kind>), claimed before it is sent;
//   - the words pass the claim rules (and the content check in the tests),
//     never say "free", promise nothing and push nobody.
//
// The schedule, by the webinar's start S and end E. The windows never
// overlap, so at most one reminder is due at a time and a missed one is never
// sent late (a person who registers on the day gets the 1-hour reminder, not
// the week's):
//
//   week        [S − 7 days, S − 1 day)   only if registered before S − 7 days
//   day         [S − 1 day,  S − 1 hour)  only if registered before S − 1 day
//   hour        [S − 1 hour, S)           only if registered before S − 1 hour
//   live        [S, E)                    "we're live now", registered before S
//   replay      [E, S + 2 days)           once the replay link is set ("within an hour after")
//   followup_2  [S + 2 days, S + 3 days)  Texas registrants who have not signed up
//   followup_5  [S + 5 days, S + 6 days)  the same, and the last message: it stops after

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface ReminderWindow {
  from: number;
  until: number;
}

export function reminderWindow(kind: ReminderKind, webinar: Pick<Webinar, "startsAt" | "durationMinutes">): ReminderWindow {
  const s = Date.parse(webinar.startsAt);
  const e = Date.parse(endsAt(webinar));
  switch (kind) {
    case "week":
      return { from: s - 7 * DAY, until: s - DAY };
    case "day":
      return { from: s - DAY, until: s - HOUR };
    case "hour":
      return { from: s - HOUR, until: s };
    case "live":
      return { from: s, until: e };
    case "replay":
      return { from: e, until: s + 2 * DAY };
    case "followup_2":
      return { from: s + 2 * DAY, until: s + 3 * DAY };
    case "followup_5":
      return { from: s + 5 * DAY, until: s + 6 * DAY };
  }
}

// ── The templates (to be approved in Meta: docs/WEBINARS.md lists them) ──

const T = (name: string, purpose: string, params: string[], es: string, en: string): MessageTemplate => ({ name, purpose, params, body: { es, en } });

export const WEBINAR_TEMPLATES: Record<ReminderKind, MessageTemplate> = {
  week: T(
    "credalti_webinar_semana",
    "Recuerda, una semana antes, una clase en vivo a la que la persona se registró.",
    ["nombre", "clase", "fecha", "enlace"],
    `Hola {{1}}, te recordamos tu clase en vivo con ${BRAND.name}: «{{2}}», el {{3}}. Dura unos 45 minutos y puedes traer tus preguntas. Tu enlace: {{4}}`,
    `Hi {{1}}, a reminder of your live class with ${BRAND.name}: “{{2}}”, on {{3}}. It runs about 45 minutes and you can bring your questions. Your link: {{4}}`,
  ),
  day: T(
    "credalti_webinar_manana",
    "Recuerda la clase en vivo el día antes.",
    ["nombre", "clase", "hora", "enlace"],
    `Hola {{1}}, mañana es tu clase en vivo «{{2}}», a las {{3}}. Tu enlace: {{4}}`,
    `Hi {{1}}, your live class “{{2}}” is tomorrow at {{3}}. Your link: {{4}}`,
  ),
  hour: T(
    "credalti_webinar_una_hora",
    "Recuerda la clase en vivo una hora antes.",
    ["nombre", "clase", "hora", "enlace"],
    `Hola {{1}}, tu clase en vivo «{{2}}» empieza en una hora, a las {{3}}. Tu enlace: {{4}}`,
    `Hi {{1}}, your live class “{{2}}” starts in one hour, at {{3}}. Your link: {{4}}`,
  ),
  live: T(
    "credalti_webinar_en_vivo",
    "Avisa que la clase en vivo ya empezó.",
    ["nombre", "clase", "enlace"],
    `Hola {{1}}, ya estamos en vivo: «{{2}}». Entra aquí: {{3}}`,
    `Hi {{1}}, we're live now: “{{2}}”. Join here: {{3}}`,
  ),
  replay: T(
    "credalti_webinar_repeticion",
    "Manda la repetición de la clase, una vez terminada.",
    ["nombre", "clase", "enlace"],
    `Hola {{1}}, gracias por registrarte a «{{2}}». Aquí está la repetición: {{3}}. Si te quedó una pregunta, responde aquí y una persona del equipo te contesta.`,
    `Hi {{1}}, thank you for signing up for “{{2}}”. Here is the replay: {{3}}. If you have a question, reply here and a person on our team will answer.`,
  ),
  followup_2: T(
    "credalti_webinar_seguimiento_2",
    "Dos días después de la clase: una pregunta abierta y, si la persona quiere, cómo empezar su revisión.",
    ["nombre", "clase", "enlace"],
    `Hola {{1}}, ¿te quedó alguna pregunta de la clase «{{2}}»? Responde aquí y una persona del equipo te contesta. Si quieres empezar tu revisión, es un chat corto: {{3}}`,
    `Hi {{1}}, did the class “{{2}}” leave you with a question? Reply here and a person on our team will answer. If you want to start your review, it is a short chat: {{3}}`,
  ),
  followup_5: T(
    "credalti_webinar_seguimiento_5",
    "Cinco días después: el último mensaje sobre la clase, con la repetición y el registro.",
    ["nombre", "clase", "repeticion", "enlace"],
    `Hola {{1}}, una última nota sobre «{{2}}»: la repetición sigue aquí: {{3}}. Cuando quieras, puedes empezar tu revisión en un chat corto: {{4}}. Este es nuestro último mensaje sobre esta clase.`,
    `Hi {{1}}, one last note about “{{2}}”: the replay is still here: {{3}}. Whenever you like, you can start your review in a short chat: {{4}}. This is our last message about this class.`,
  ),
};

/** The template names, for the owner's list to approve in Meta (launch/checklist.ts WHATSAPP_TEMPLATE_NAMES). */
export const WEBINAR_TEMPLATE_NAMES: readonly string[] = REMINDER_KINDS.map((k) => WEBINAR_TEMPLATES[k].name);

/** The email's subject line. */
export const WEBINAR_EMAIL_SUBJECTS: Record<"en" | "es", Record<ReminderKind, string>> = {
  en: {
    week: "Your live class is in one week",
    day: "Your live class is tomorrow",
    hour: "Your live class starts in one hour",
    live: "We're live now",
    replay: "The replay of your live class",
    followup_2: "A question from the class?",
    followup_5: "One last note about the class",
  },
  es: {
    week: "Tu clase en vivo es en una semana",
    day: "Tu clase en vivo es mañana",
    hour: "Tu clase en vivo empieza en una hora",
    live: "Ya estamos en vivo",
    replay: "La repetición de tu clase en vivo",
    followup_2: "¿Te quedó una pregunta de la clase?",
    followup_5: "Una última nota sobre la clase",
  },
};

// ── Planning one registration ───────────────────────────────────────────

export interface ReminderLinks {
  /** The webinar's own page (/webinar/<slug>), where the join links and the replay are. */
  page: string;
  /** The chat signup (/registro), tagged with the webinar's campaign. */
  signup: string;
}

export interface ReminderContext {
  now: Date;
  /** The registration used the email's unsubscribe link, or its number's newest record says STOP / BAJA. */
  optedOut: boolean;
  /** Reminders already written for this registration (sent, failed or being sent). */
  written: ReadonlySet<ReminderKind>;
  /** The registrant's phone already belongs to a signed client: no follow-ups. */
  signedUp: boolean;
  channels: ChannelAvailability;
  /** Their last WhatsApp message to us (the 24-hour window), if any. */
  lastInboundAt?: string | null;
  /** Email can carry it: an address, and a signed unsubscribe link could be made. */
  emailReady: boolean;
}

export interface PlannedReminder {
  dedupeKey: string;
  kind: ReminderKind;
  channel: "whatsapp" | "email";
  /** "text" inside the 24-hour window, else the approved template; "email" for email. */
  mode: "text" | "template" | "email";
  template: MessageTemplate;
  params: string[];
  locale: "en" | "es";
  /** The words as the person reads them (with the automatic-message footer on WhatsApp). */
  body: string;
  subject: string;
}

/** Why nothing goes now (for the tests and the screen). */
export type NoReminder = "not_published" | "no_consent" | "opted_out" | "quiet_hours" | "nothing_due" | "already_sent" | "registered_after" | "no_replay_yet" | "out_of_state" | "signed_up" | "no_channel";

export function reminderDedupeKey(registrationId: string, kind: ReminderKind): string {
  return `webinar:${registrationId}:${kind}`;
}

/** The kind whose window holds `now`, or null. */
export function kindDueAt(webinar: Pick<Webinar, "startsAt" | "durationMinutes">, now: Date): ReminderKind | null {
  const t = now.getTime();
  return REMINDER_KINDS.find((k) => {
    const w = reminderWindow(k, webinar);
    return t >= w.from && t < w.until;
  }) ?? null;
}

function titleOf(webinar: Pick<Webinar, "title">, locale: "en" | "es"): string {
  return (locale === "es" ? webinar.title.es : webinar.title.en).trim() || webinar.title.en || webinar.title.es;
}

export function reminderParams(kind: ReminderKind, webinar: Webinar, registration: Pick<Registration, "firstName" | "locale">, links: ReminderLinks): string[] {
  const locale = registration.locale;
  const name = registration.firstName.trim().split(/\s+/)[0] ?? "";
  const title = titleOf(webinar, locale);
  const time = `${webinarTime(webinar.startsAt, locale)} (${locale === "es" ? "hora de Texas" : "Texas time"})`;
  switch (kind) {
    case "week":
      return [name, title, webinarWhen(webinar.startsAt, locale), links.page];
    case "day":
    case "hour":
      return [name, title, time, links.page];
    case "live":
    case "replay":
      return [name, title, links.page];
    case "followup_2":
      return [name, title, links.signup];
    case "followup_5":
      return [name, title, links.page, links.signup];
  }
}

/** The template's words with its parameters filled in (no footer). */
export function fillTemplate(template: MessageTemplate, locale: "en" | "es", params: readonly string[]): string {
  return template.body[locale].replace(/\{\{(\d+)\}\}/g, (_, n: string) => (params[Number(n) - 1] ?? "").trim());
}

/**
 * What to send this registration now: one reminder, or why none. Pure: the
 * cron (server.ts runWebinarReminders) claims it under its dedupe key, sends
 * it and records the result once.
 */
export function planReminder(webinar: Webinar, registration: Registration, links: ReminderLinks, ctx: ReminderContext): { ok: true; reminder: PlannedReminder } | { ok: false; why: NoReminder } {
  if (webinar.status !== "published") return { ok: false, why: "not_published" };
  if (!registration.remindersConsent) return { ok: false, why: "no_consent" };
  if (ctx.optedOut || registration.optedOutAt) return { ok: false, why: "opted_out" };
  const kind = kindDueAt(webinar, ctx.now);
  if (!kind) return { ok: false, why: "nothing_due" };
  if (ctx.written.has(kind)) return { ok: false, why: "already_sent" };
  const window = reminderWindow(kind, webinar);
  const created = Date.parse(registration.createdAt);
  if ((kind === "week" || kind === "day" || kind === "hour") && created >= window.from) return { ok: false, why: "registered_after" };
  if (kind === "live" && created >= window.from) return { ok: false, why: "registered_after" };
  if (kind === "replay" && !webinar.replayUrl) return { ok: false, why: "no_replay_yet" };
  if ((kind === "followup_2" || kind === "followup_5") && registration.served !== "texas") return { ok: false, why: "out_of_state" };
  if ((kind === "followup_2" || kind === "followup_5") && ctx.signedUp) return { ok: false, why: "signed_up" };
  if (isQuietHour(ctx.now, TEXAS_TZ, WEBINAR_QUIET)) return { ok: false, why: "quiet_hours" };

  const template = WEBINAR_TEMPLATES[kind];
  const locale = registration.locale;
  const params = reminderParams(kind, webinar, registration, links);
  const words = fillTemplate(template, locale, params);
  const subject = WEBINAR_EMAIL_SUBJECTS[locale][kind];
  const base = { dedupeKey: reminderDedupeKey(registration.id, kind), kind, template, params, locale, subject };
  if (ctx.channels.whatsapp && /^\+[1-9]\d{7,14}$/.test(registration.phone)) {
    if (insideWhatsAppWindow(ctx.lastInboundAt ?? null, ctx.now)) return { ok: true, reminder: { ...base, channel: "whatsapp", mode: "text", body: `${words}\n\n${FOOTER[locale]}` } };
    if (templateApproved(template.name, ctx.channels)) return { ok: true, reminder: { ...base, channel: "whatsapp", mode: "template", body: `${words}\n\n${FOOTER[locale]}` } };
  }
  if (ctx.channels.email && ctx.emailReady && registration.email) return { ok: true, reminder: { ...base, channel: "email", mode: "email", body: words } };
  return { ok: false, why: "no_channel" };
}

/** Every reminder's words in both languages, filled with sample values (for the tests and the docs). */
export function sampleReminderTexts(): Array<{ kind: ReminderKind; locale: "en" | "es"; text: string }> {
  const sample = ["Rosa", "Your credit report, explained", "Thursday, December 10 · 7:00 PM (Texas time)", "https://credalti.com/webinar/credito-dic"];
  return REMINDER_KINDS.flatMap((kind) => (["en", "es"] as const).map((locale) => ({ kind, locale, text: `${fillTemplate(WEBINAR_TEMPLATES[kind], locale, sample)}\n\n${FOOTER[locale]}` })));
}
