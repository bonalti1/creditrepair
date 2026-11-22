import { BRAND } from "../brand";
import { isQuietHour, localDay } from "../autopilot/clock";
import { chooseChannel, templateApproved } from "../autopilot/channels";
import { sentBetween, workQueue, workSummary, type QueueContext, type QueueItem } from "../autopilot/queue";
import type { ChannelAvailability, AutopilotSettings } from "../autopilot/types";
import { count } from "./format";
import { visibleClients, type Viewer } from "./permissions";
import { EXCEPTION_LABEL } from "./stage";
import type { DigestChannel, StaffPreferences } from "./preferences";
import type { StaffClient } from "./types";

// The morning summary: one message a day to a member of the team who asked
// for it, at the time they chose (8:30 a.m. Texas by default), by WhatsApp
// or email. It says how much work is waiting for them today, the first three
// things, what the system did overnight, and links to "Siguiente".
//
// Pure: the cron route (digestServer.ts) decides who gets it and sends it;
// the profile page shows the same words as a preview.
//
// Clients are named by first name and the initial of the last name only: the
// message leaves the app (WhatsApp, an inbox) and does not need more.

export const DIGEST_TEMPLATE = "credalti_resumen_equipo";
/** "What the system did overnight": the last this many hours. */
export const OVERNIGHT_HOURS = 24;

export interface MorningSummary {
  /** The member's first name. */
  name: string;
  count: number;
  minutes: number;
  overdue: number;
  top: Array<{ client: string; label: string; minutes: number }>;
  overnight: { messages: number; rounds: number };
  focusUrl: string;
  /** The whole message, as an email or a WhatsApp message inside the 24-hour window carries it. */
  text: string;
  /** The approved WhatsApp template's values, {{1}} first (no line breaks: Meta refuses them in a value). */
  params: string[];
}

/** "Itzel Bahena" → "Itzel B." */
export function shortClientName(client: Pick<StaffClient, "firstName" | "lastName">): string {
  const initial = client.lastName.trim().charAt(0);
  return initial ? `${client.firstName.trim()} ${initial.toUpperCase()}.` : client.firstName.trim();
}

/** Rounds mailed by the system itself (sent by "sistema") between two moments. */
function roundsMailedBySystem(clients: readonly StaffClient[], from: Date, to: Date): number {
  return clients.reduce(
    (n, client) =>
      n +
      client.rounds.filter((r) => r.mailedAt && r.sentBy === "sistema" && new Date(r.mailedAt) >= from && new Date(r.mailedAt) <= to).length,
    0,
  );
}

function overnightPhrase(overnight: { messages: number; rounds: number }): string {
  if (overnight.messages === 0 && overnight.rounds === 0) return "no envió nada";
  const parts = [
    ...(overnight.messages > 0 ? [`envió ${count(overnight.messages, "mensaje", "mensajes")} a clientes`] : []),
    ...(overnight.rounds > 0 ? [`mandó por correo ${count(overnight.rounds, "ronda de cartas", "rondas de cartas")}`] : []),
  ];
  return parts.join(" y ");
}

/**
 * The summary for one member, from the clients their role lets them see
 * (the same scopes the database applies: permissions.ts canSeeClient).
 */
export function morningSummary(viewer: Viewer, clients: readonly StaffClient[], now: Date, context: QueueContext, base = ""): MorningSummary {
  const mine = visibleClients(viewer, [...clients]);
  const queue: QueueItem[] = workQueue(mine, now, context, viewer.role);
  const work = workSummary(queue);
  const since = new Date(now.getTime() - OVERNIGHT_HOURS * 60 * 60 * 1000);
  const overnight = {
    messages: sentBetween(mine, since, now).length,
    rounds: roundsMailedBySystem(mine, since, now),
  };
  const top = queue.slice(0, 3).map((item) => ({ client: shortClientName(item.client), label: EXCEPTION_LABEL[item.exception.kind], minutes: item.minutes }));
  const name = viewer.name.split(" ")[0] ?? viewer.name;
  const focusUrl = `${base.replace(/\/$/, "")}/equipo?siguiente=1`;
  const head = `Buenos días, ${name}. Hoy: ${count(work.count, "cosa", "cosas")} · ~${work.minutes} minutos.`;
  const lines = [
    head,
    ...(work.overdue > 0 ? [`${count(work.overdue, "ya pasó su plazo", "ya pasaron su plazo")}.`] : []),
    ...(top.length > 0 ? ["", "Lo primero:", ...top.map((t, i) => `${i + 1}. ${t.client} · ${t.label} (~${t.minutes} min)`)] : ["", "Nada necesita una persona por ahora."]),
    "",
    `En las últimas ${OVERNIGHT_HOURS} horas el sistema ${overnightPhrase(overnight)}.`,
    "",
    `Empieza aquí: ${focusUrl}`,
    "",
    `— Resumen de la mañana de ${BRAND.name}. Lo apagas en tu perfil.`,
  ];
  return {
    name,
    count: work.count,
    minutes: work.minutes,
    overdue: work.overdue,
    top,
    overnight,
    focusUrl,
    text: lines.join("\n"),
    params: [
      name,
      String(work.count),
      String(work.minutes),
      top.length > 0 ? top.map((t) => `${t.client} (${t.label.toLowerCase()})`).join("; ") : "nada necesita una persona",
      overnightPhrase(overnight),
      focusUrl,
    ],
  };
}

/** The approved template's body, with {{n}} where the values go: what to create in WhatsApp Manager. */
export const DIGEST_TEMPLATE_BODY =
  "Buenos días, {{1}}. Hoy: {{2}} cosas · ~{{3}} minutos. Lo primero: {{4}}. En las últimas 24 horas el sistema {{5}}. Empieza aquí: {{6}}";

// ── When it goes ────────────────────────────────────────────────────────

function minutesOfDay(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", hourCycle: "h23" })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return (Number(parts.hour) % 24) * 60 + Number(parts.minute);
}

export type DigestWait = "off" | "not_yet" | "quiet_hours" | "already_sent";

/**
 * Whether the summary is due now for this member: on, past their time today
 * on their clock, outside quiet hours, and not already sent today. A run that
 * comes late still sends it that day; a day already sent never gets a second.
 */
export function digestDue(
  prefs: Pick<StaffPreferences, "digestEnabled" | "digestTime" | "timeZone">,
  now: Date,
  quiet: Pick<AutopilotSettings, "quietStartHour" | "quietEndHour">,
  sentDays: ReadonlySet<string>,
): { due: true; day: string } | { due: false; why: DigestWait; day: string } {
  const day = localDay(now, prefs.timeZone);
  if (!prefs.digestEnabled) return { due: false, why: "off", day };
  if (sentDays.has(day)) return { due: false, why: "already_sent", day };
  const [h, m] = prefs.digestTime.split(":").map(Number) as [number, number];
  if (minutesOfDay(now, prefs.timeZone) < h * 60 + m) return { due: false, why: "not_yet", day };
  if (isQuietHour(now, prefs.timeZone, quiet)) return { due: false, why: "quiet_hours", day };
  return { due: true, day };
}

export type DigestChoice = { channel: "whatsapp"; mode: "text" | "template" } | { channel: "email" } | { channel: null; reason: string };

/**
 * The channel for a member's summary: the one they chose, else the other.
 * WhatsApp outside the 24-hour window needs the approved template (the same
 * rule the autopilot follows); email needs the legal footer configured. Never SMS.
 */
export function digestChannel(
  preferred: DigestChannel,
  member: { phone: string | null; email: string | null },
  channels: ChannelAvailability,
  now: Date,
): DigestChoice {
  const viaWhatsApp = chooseChannel({ phone: member.phone, email: null, lastInboundAt: null }, DIGEST_TEMPLATE, channels, now);
  const viaEmail = chooseChannel({ phone: null, email: member.email, lastInboundAt: null }, DIGEST_TEMPLATE, channels, now);
  const order = preferred === "email" ? [viaEmail, viaWhatsApp] : [viaWhatsApp, viaEmail];
  const pick = order.find((c) => c.channel !== null);
  if (pick && pick.channel === "whatsapp") return { channel: "whatsapp", mode: pick.mode };
  if (pick && pick.channel === "email") return { channel: "email" };
  if (preferred === "whatsapp" && member.phone && channels.whatsapp && !templateApproved(DIGEST_TEMPLATE, channels)) {
    return { channel: null, reason: `Falta aprobar en Meta la plantilla ${DIGEST_TEMPLATE}, y no hay correo configurado.` };
  }
  return { channel: null, reason: "No hay un canal para enviarlo: falta tu teléfono o correo, o el canal no está configurado." };
}
