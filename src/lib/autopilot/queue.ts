import { exceptionMessage, whatsappHref } from "../staff/messages";
import { exceptionVisibleTo } from "../staff/permissions";
import { clientExceptions, formatDay, STAFF_TIME_ZONE, type ExceptionKind, type Severity, type StaffContext, type StaffException } from "../staff/stage";
import { fullName, type StaffClient, type StaffRole } from "../staff/types";
import { CHANNEL_LABEL } from "./channels";
import { BLOCK_TEXT, FOLLOWUP_SCHEDULES, followupKindOf, followupStates, type FollowupState } from "./followups";
import type { AutopilotEnv, OutboundMessage } from "./types";
import { furnisherGaps, type AddressSuggestion } from "../mail/gaps";

// The one-person work queue: everything that truly needs a human, in the
// order to do it, each with why, what the system already tried, roughly how
// long it takes, how long it has waited and when it is due.
//
// It is the console's notices (staff/stage.ts: clientExceptions) with one
// change: a notice the automatic follow-ups are still working on is not a
// person's yet. It becomes one when the schedule is used up and nothing
// changed, or at once when the system cannot write (reminders off, the client
// opted out or is on hold, no channel). Everything else is exactly as before,
// and so is every gate: what may be sent is decided in stage.ts and
// rounds/send.ts, never here.

/** Minutes a person usually needs for each kind of notice. Estimates, written down so they can be checked. */
export const MINUTES_BY_KIND: Record<ExceptionKind, number> = {
  review_stalled: 6,
  documents_missing: 5,
  report_stale: 6,
  payment_past_due: 8,
  payment_method_missing: 5,
  letter_returned: 10,
  question_waiting: 5,
  response_overdue: 6,
  agreement_unsigned: 5,
  identity_theft_report_missing: 12,
  service_end_requested: 10,
  furnisher_address_missing: 8,
  // AI intake (src/lib/intake): look at a document the AI could not accept, or a bureau letter that asks for something.
  document_check_needs_person: 4,
  bureau_letter_needs_person: 10,
  // Reaches a person only after the client did not confirm (or a second check failed): a call, and the address on the client page.
  client_address_unconfirmed: 6,
};

/** The severity each kind of notice carries (as stage.ts writes them), for the settings screen. */
export const SEVERITY_BY_KIND: Record<ExceptionKind, Severity> = {
  review_stalled: "medium",
  documents_missing: "medium",
  report_stale: "medium",
  payment_past_due: "high",
  payment_method_missing: "high",
  letter_returned: "high",
  question_waiting: "high",
  response_overdue: "medium",
  agreement_unsigned: "low",
  identity_theft_report_missing: "high",
  service_end_requested: "high",
  furnisher_address_missing: "high",
  document_check_needs_person: "medium",
  bureau_letter_needs_person: "high",
  client_address_unconfirmed: "high",
};

/** How soon a notice should be handled once it is a person's (hours). */
export const SLA_HOURS: Record<Severity, number> = { high: 24, medium: 48, low: 72 };

const HOUR_MS = 60 * 60 * 1000;
const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export interface TriedLine {
  at: string;
  text: string;
}

export interface QueueAction {
  kind: "whatsapp" | "call" | "open";
  label: string;
  href: string;
}

export interface QueueItem {
  /** "clientId:exceptionKey", stable. */
  id: string;
  client: StaffClient;
  exception: StaffException;
  /** Why it needs a person, in one or two sentences. */
  why: string;
  /** What the system already did about it, oldest first. */
  tried: TriedLine[];
  /** "Se le escribió 3 veces sin respuesta." Null when the system did nothing. */
  triedSummary: string | null;
  minutes: number;
  /** When it became a person's (ISO). */
  since: string;
  /** When it should be handled by (ISO). */
  dueBy: string;
  overdue: boolean;
  action: QueueAction;
  /**
   * The exact words the client was sent about this, oldest first (money:
   * billing's notices with the «Actualizar mi tarjeta» link, and the
   * reminders). Absent when nothing was sent.
   */
  messages?: Array<{ at: string; channel: string | null; status: OutboundMessage["status"]; body: string }>;
  /**
   * One item for a company several clients wait on (a missing dispute
   * address): the company, every client waiting, and the addresses the
   * reports print for it, as unverified suggestions.
   */
  group?: {
    company: string;
    waiting: Array<{ client: StaffClient; roundNumber: number }>;
    suggestions: AddressSuggestion[];
    nearMatches: Array<{ id: string; name: string }>;
  };
}

/** What the queue needs besides the clients. */
export interface QueueContext extends StaffContext {
  autopilot: AutopilotEnv;
}

export interface PersonException {
  exception: StaffException;
  /** The follow-up behind it, when the notice is one the system writes about. */
  followup: FollowupState | null;
}

function dayAndHour(iso: string): string {
  const date = new Date(iso);
  return `${formatDay(date)}, ${date.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit", timeZone: STAFF_TIME_ZONE })}`;
}

/** "Recordatorio 2 de 3 por WhatsApp" — one line of what the system sent. */
export function outboundLine(message: OutboundMessage): string {
  const via = message.channel ? ` por ${CHANNEL_LABEL[message.channel]}` : "";
  const what =
    message.kind === "followup"
      ? `Recordatorio ${message.step ?? 1} de 3${via}`
      : `${STATUS_LABEL[message.topic as keyof typeof STATUS_LABEL] ?? "Aviso"}${via}`;
  const how =
    message.status === "failed"
      ? " (no se pudo entregar)"
      : message.status === "simulated"
        ? " (demo)"
        : message.status === "sending"
          ? " (sin confirmar)"
          : message.status === "cancelled"
            ? " (no se envió)"
            : message.status === "queued"
              ? " (en espera)"
              : "";
  return `${what}${how}`;
}

export const STATUS_LABEL = {
  letters_mailed: "Aviso: cartas enviadas",
  certified_delivered: "Aviso: carta certificada entregada",
  report_changes: "Aviso: reporte nuevo",
  next_round_prepared: "Aviso: siguiente ronda preparada",
  payment_receipt: "Recibo de pago",
  payment_declined: "Aviso: cobro no pasó, con el enlace «Actualizar mi tarjeta»",
  payment_method_needed: "Aviso: falta su método de pago, con el enlace «Actualizar mi tarjeta»",
  letter_remailed: "Aviso: carta enviada de nuevo",
} as const;

/**
 * The client's notices that need a person now, with the follow-up behind
 * each when there is one. A notice the follow-ups are still working on is left out.
 */
export function personExceptions(client: StaffClient, now: Date, context: QueueContext): PersonException[] {
  const states = followupStates(client, now, context.autopilot);
  return clientExceptions(client, now, context).flatMap((exception): PersonException[] => {
    const kind = followupKindOf(exception.kind);
    const followup = kind
      ? (states.find((s) => s.situation.kind === kind && (!s.situation.exceptionKey || s.situation.exceptionKey === exception.key)) ?? null)
      : null;
    if (!followup) return [{ exception, followup: null }];
    // The system cannot write: a person's, as before.
    if (followup.block) return [{ exception, followup }];
    // A person from the start (identity theft); the messages only help.
    if (followup.schedule.personFromStart) return [{ exception, followup }];
    return followup.exhausted ? [{ exception, followup }] : [];
  });
}

/** The follow-ups the system is working on for this client (not a person's yet). */
export function followupsInProgress(client: StaffClient, now: Date, env: AutopilotEnv): FollowupState[] {
  return followupStates(client, now, env).filter((s) => !s.block && !s.exhausted && !s.schedule.personFromStart);
}

function triedSummary(client: StaffClient, followup: FollowupState | null): string | null {
  if (!followup) return null;
  const delivered = followup.sent.filter((m) => m.status !== "failed");
  if (followup.block === "opted_out" && client.optOut) {
    const what = `Pidió no recibir mensajes automáticos (${client.optOut.keyword}) el ${formatDay(new Date(client.optOut.at))}.`;
    return delivered.length > 0 ? `${what} Antes se le escribió ${times(delivered.length)}.` : what;
  }
  if (followup.block && followup.block !== "disabled") {
    return delivered.length > 0 ? `${BLOCK_TEXT[followup.block]} Antes se le escribió ${times(delivered.length)}.` : BLOCK_TEXT[followup.block];
  }
  if (delivered.length === 0) return null;
  if (followup.schedule.personFromStart) return `El sistema ya le envió ${delivered.length === 1 ? "los pasos" : `${delivered.length} mensajes`}; falta que una persona le escriba.`;
  const first = delivered[0]!;
  const replied = client.lastInboundAt && client.lastInboundAt > (first.sentAt ?? first.queuedAt);
  return replied ? `Se le escribió ${times(delivered.length)}; respondió, pero sigue pendiente.` : `Se le escribió ${times(delivered.length)} sin respuesta.`;
}

const times = (n: number) => (n === 1 ? "1 vez" : `${n} veces`);

function actionFor(client: StaffClient, exception: StaffException, followup: FollowupState | null): QueueAction {
  // The automatic messages did not work: a call is the next thing a person can do that they could not.
  if (followup?.exhausted && followup.sent.length > 0 && !followup.block) {
    return { kind: "call", label: "Llamarle", href: `tel:${client.phone}` };
  }
  if (exception.action === "whatsapp") return { kind: "whatsapp", label: exception.actionLabel, href: whatsappHref(client.phone, exceptionMessage(client, exception)) };
  return { kind: "open", label: exception.actionLabel, href: exception.href ?? `/equipo/clientes/${client.id}#cartas` };
}

export function queueItems(client: StaffClient, now: Date, context: QueueContext, role?: StaffRole | null): QueueItem[] {
  return personExceptions(client, now, context)
    .filter(({ exception }) => role === undefined || exceptionVisibleTo(role, exception.kind))
    .map(({ exception, followup }) => {
      // Billing's own notices about this (sent through the outbound log since migration 0022), besides any reminders.
      const notices = relatedNotices(client, exception);
      const sentForIt = [...(followup?.sent ?? []), ...notices].sort((a, b) => (a.sentAt ?? a.queuedAt).localeCompare(b.sentAt ?? b.queuedAt));
      const tried: TriedLine[] = sentForIt.map((m) => ({ at: m.sentAt ?? m.queuedAt, text: outboundLine(m) }));
      const summary = triedSummary(client, followup) ?? noticesSummary(notices);
      const messages = sentForIt.filter((m) => m.status !== "cancelled" && m.status !== "queued").map((m) => ({ at: m.sentAt ?? m.queuedAt, channel: m.channel, status: m.status, body: m.body }));
      // When it became a person's: the end of the schedule, else when the situation began, else now.
      const since =
        followup && followup.exhausted && !followup.block
          ? followup.personSince
          : (exception.since ?? followup?.situation.startedAt ?? now.toISOString());
      const dueBy = new Date(new Date(since).getTime() + SLA_HOURS[exception.severity] * HOUR_MS).toISOString();
      return {
        id: `${client.id}:${exception.key}`,
        client,
        exception,
        why: exception.sentence,
        tried,
        triedSummary: summary,
        minutes: MINUTES_BY_KIND[exception.kind],
        since,
        dueBy,
        overdue: new Date(dueBy).getTime() < now.getTime(),
        action: actionFor(client, exception, followup),
        ...(messages.length > 0 ? { messages } : {}),
      };
    });
}

/** Billing's notices about this exact notice: a declined charge's messages, or the missing-method message of that round. */
function relatedNotices(client: StaffClient, exception: StaffException): OutboundMessage[] {
  const log = client.outbound ?? [];
  if (exception.kind === "payment_past_due") {
    const chargeId = exception.key.split(":")[1] ?? "";
    return log.filter((m) => m.topic === "payment_declined" && m.dedupeKey.includes(`:${chargeId}:`));
  }
  if (exception.kind === "payment_method_missing") {
    const round = exception.key.split(":")[1] ?? "";
    return log.filter((m) => m.topic === "payment_method_needed" && m.dedupeKey.endsWith(`:r${round}`));
  }
  return [];
}

function noticesSummary(notices: readonly OutboundMessage[]): string | null {
  const delivered = notices.filter((m) => m.status === "sent" || m.status === "simulated");
  if (delivered.length === 0) return null;
  return `Se le avisó ${times(delivered.length)} con el enlace para actualizar su tarjeta (el cobro se intenta solo al actualizarla) y no lo hizo.`;
}

/**
 * The missing-address notices of many clients, as ONE item per company:
 * the address book is shared, so a person adds the address once and every
 * waiting round can go. The other items are left as they are.
 */
export function groupFurnisherGaps(items: QueueItem[], clients: readonly StaffClient[], now: Date, context: QueueContext): QueueItem[] {
  const gapItems = items.filter((i) => i.exception.kind === "furnisher_address_missing");
  if (gapItems.length === 0 || !context.furnishers) return items;
  const waitingClients = [...new Map(gapItems.map((i) => [i.client.id, i.client])).values()];
  const gaps = furnisherGaps(waitingClients, context.furnishers, context.furnisherGaps ?? [], clients);
  const grouped: QueueItem[] = [];
  for (const gap of gaps) {
    const mine = gapItems.filter((i) => gap.waiting.some((w) => w.client.id === i.client.id) && i.exception.key === `furnisher_address_missing:${gap.company}`);
    if (mine.length === 0) continue;
    const first = mine[0]!;
    const names = gap.waiting.map((w) => `${w.client.firstName} ${w.client.lastName.charAt(0)}.`);
    const since = gap.firstSeenAt ?? first.since;
    const dueBy = new Date(new Date(since).getTime() + SLA_HOURS[first.exception.severity] * HOUR_MS).toISOString();
    const who = gap.waiting.length === 1 ? "1 cliente espera" : `${gap.waiting.length} clientes esperan`;
    grouped.push({
      ...first,
      id: `furnisher:${gap.normalizedName}`,
      exception: { ...first.exception, key: `furnisher_address_missing:${gap.company}`, since, href: gap.href },
      why: `${who} la dirección para disputas de ${gap.company} (${names.join(", ")}). La libreta es una sola para todos: se agrega una vez, con su fuente, y salen todas sus rondas.${
        gap.suggestions.length > 0 ? ` Los reportes imprimen ${gap.suggestions.length === 1 ? "una dirección" : `${gap.suggestions.length} direcciones`} para ${gap.company}: sugerencia sin verificar.` : ""
      }`,
      since,
      dueBy,
      overdue: new Date(dueBy).getTime() < now.getTime(),
      action: { kind: "open", label: gap.suggestions.length > 0 ? "Verificar y agregar" : "Agregar la dirección", href: gap.href },
      group: { company: gap.company, waiting: gap.waiting.map((w) => ({ client: w.client, roundNumber: w.roundNumber })), suggestions: gap.suggestions, nearMatches: gap.nearMatches },
    });
  }
  return [...items.filter((i) => i.exception.kind !== "furnisher_address_missing"), ...grouped];
}

/** The whole queue, in the order to work it: overdue first, then by due time, then by severity. */
export function workQueue(clients: StaffClient[], now: Date, context: QueueContext, role?: StaffRole | null): QueueItem[] {
  return groupFurnisherGaps(
    clients.flatMap((client) => queueItems(client, now, context, role)),
    clients,
    now,
    context,
  ).sort(
      (a, b) =>
        Number(b.overdue) - Number(a.overdue) ||
        a.dueBy.localeCompare(b.dueBy) ||
        SEVERITY_RANK[a.exception.severity] - SEVERITY_RANK[b.exception.severity] ||
        fullName(a.client).localeCompare(fullName(b.client), "es"),
    );
}

export interface WorkSummary {
  count: number;
  minutes: number;
  overdue: number;
}

export function workSummary(items: readonly QueueItem[]): WorkSummary {
  return { count: items.length, minutes: items.reduce((n, i) => n + i.minutes, 0), overdue: items.filter((i) => i.overdue).length };
}

/** "hace 3 h", "hace 2 días". */
export function waitedText(since: string, now: Date): string {
  const hours = Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / HOUR_MS));
  if (hours < 1) return "desde hace menos de una hora";
  if (hours < 24) return `desde hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `desde hace ${days === 1 ? "1 día" : `${days} días`}`;
}

/** "vence hoy, 3:00 p. m." / "venció el 20 de noviembre". */
export function dueText(dueBy: string, now: Date): string {
  const due = new Date(dueBy);
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: STAFF_TIME_ZONE });
  const hour = due.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit", timeZone: STAFF_TIME_ZONE });
  if (due.getTime() < now.getTime()) return day(due) === day(now) ? `venció hoy, ${hour}` : `venció el ${formatDay(due)}`;
  if (day(due) === day(now)) return `vence hoy, ${hour}`;
  if (day(due) === day(new Date(now.getTime() + 24 * HOUR_MS))) return `vence mañana, ${hour}`;
  return `vence el ${dayAndHour(dueBy)}`;
}

/** What the system did today, across clients: for "El sistema ya trabajó". */
export function sentBetween(clients: StaffClient[], from: Date, to: Date): Array<{ client: StaffClient; message: OutboundMessage }> {
  return clients
    .flatMap((client) =>
      (client.outbound ?? [])
        .filter((m) => (m.status === "sent" || m.status === "simulated") && m.sentAt && m.sentAt >= from.toISOString() && m.sentAt <= to.toISOString())
        .map((message) => ({ client, message })),
    )
    .sort((a, b) => (b.message.sentAt ?? "").localeCompare(a.message.sentAt ?? ""));
}

export { FOLLOWUP_SCHEDULES };
