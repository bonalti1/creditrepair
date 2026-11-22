import { firstWorkingDay } from "../agreement/businessDays";
import { deadlineOf } from "../agreement/gate";
import { FRESH_REPORT_DAYS } from "../monitoring/subscription";
import {
  addDays,
  clientAgreement,
  clientBillingOutlook,
  documentNames,
  identityTheftItemsWithoutReport,
  latestRound,
  missingDocuments,
  overdueResponseRound,
  reviewProgress,
  workStartsAt,
  type ExceptionKind,
} from "../staff/stage";
import type { DocumentKind, StaffClient } from "../staff/types";
import { responseWindowStart } from "../mail/tracking";
import { RESPONSE_WINDOW_DAYS } from "../ux/journey";
import { chooseChannel, type ChannelChoice } from "./channels";
import { appLink, FOLLOWUP_TEMPLATES, renderTemplate, type MessageTemplate } from "./templates";
import { FOLLOWUP_KINDS, type AutopilotEnv, type FollowupKind, type MessageLocale, type OutboundMessage } from "./types";

// Automatic follow-ups: the reminders a person used to send by hand.
//
// Pure rules, from the client's record, the outbound log and the team's
// settings. For each situation the client is in (an unsigned agreement,
// missing documents, an unfinished review, monitoring that stopped sending
// reports, a missing payment method, an identity theft report to get), the
// system writes on a short schedule: three messages, a few days apart. Only
// when the schedule is used up and nothing changed does the situation become
// a person's ("Se le escribió 3 veces sin respuesta"), with everything the
// system already sent shown beside it (queue.ts).
//
// The schedule restarts by itself when the situation does: a client who
// answers more of their review, for example, starts a new, later schedule.
//
// Nothing is sent, and the item is a person's exactly as before, when:
//   - the reminders are off (the team's settings: all of them, or this one);
//   - the client asked for no automatic messages (BAJA / STOP / unsubscribe);
//   - a person put the client on hold;
//   - no channel can reach the client (channels.ts).
// No reminder ever goes to a client who cancelled or asked to end the service.
//
// Quiet hours and the daily cap are applied when messages are sent (plan.ts).

const HOUR_MS = 60 * 60 * 1000;
/** Two steps of one schedule are never closer than this, even when one was delayed. */
export const MIN_GAP_HOURS = 20;
/** After the last message, a day for the client to act before a person is asked to. */
export const GRACE_AFTER_LAST_HOURS = 24;

export interface FollowupSchedule {
  kind: FollowupKind;
  /** For the team: "Acuerdo sin firmar". */
  label: string;
  /** For the settings screen: when it starts and what the messages ask. */
  description: string;
  /** Days after the situation began on which each of the three messages is due. */
  stepDays: readonly [number, number, number];
  /** Days after the situation began when, still unchanged, it becomes a person's. */
  personAfterDays: number;
  /**
   * True when a person is needed from the start and the messages only help
   * (identity theft: the app told the client a person would write).
   */
  personFromStart: boolean;
  /** The screen in the client's app that fixes it. */
  path: string;
  /** The console's notices this situation stands for. */
  covers: readonly ExceptionKind[];
}

export const FOLLOWUP_SCHEDULES: Record<FollowupKind, FollowupSchedule> = {
  agreement_unsigned: {
    kind: "agreement_unsigned",
    label: "Acuerdo sin firmar",
    description: "Creó su cuenta y no ha firmado el acuerdo. Cuenta desde el día en que creó su cuenta.",
    stepDays: [1, 3, 5],
    personAfterDays: 6,
    personFromStart: false,
    path: "/acuerdo",
    covers: ["agreement_unsigned"],
  },
  documents_missing: {
    kind: "documents_missing",
    label: "Faltan documentos",
    description: "Falta su identificación o su comprobante de domicilio. Cuenta desde que termina su periodo de cancelación.",
    stepDays: [0, 2, 5],
    personAfterDays: 7,
    personFromStart: false,
    path: "/acuerdo#documentos",
    covers: ["documents_missing"],
  },
  review_unfinished: {
    kind: "review_unfinished",
    label: "Revisión sin terminar",
    description: "No ha terminado de revisar su reporte. Cuenta desde su última respuesta: si avanza, vuelve a empezar.",
    stepDays: [2, 5, 8],
    personAfterDays: 10,
    personFromStart: false,
    path: "/items",
    covers: ["review_stalled"],
  },
  monitoring_inactive: {
    kind: "monitoring_inactive",
    label: "Monitoreo sin reporte nuevo",
    description: `Su reporte tiene más de ${FRESH_REPORT_DAYS} días, o pasaron los ${RESPONSE_WINDOW_DAYS} días de respuesta de los burós sin reporte nuevo.`,
    stepDays: [0, 3, 7],
    personAfterDays: 9,
    personFromStart: false,
    path: "/onboarding?paso=monitoreo",
    covers: ["report_stale", "response_overdue"],
  },
  payment_method_missing: {
    kind: "payment_method_missing",
    label: "Falta su método de pago",
    description: "Se envió una ronda y no hay método de pago. El sistema de cobros ya le avisa el día del cobro; esto sigue después. Cuenta desde el envío.",
    stepDays: [3, 5, 8],
    personAfterDays: 10,
    personFromStart: false,
    path: "/pagos",
    covers: ["payment_method_missing"],
  },
  identity_theft_report_missing: {
    kind: "identity_theft_report_missing",
    label: "Reporte de robo de identidad",
    description:
      "Indicó robo de identidad y falta su reporte de la FTC. Le llegan los pasos de IdentityTheft.gov, pero una persona lo atiende desde el primer día: la app le dijo que alguien del equipo le escribiría.",
    stepDays: [0, 3, 7],
    personAfterDays: 0,
    personFromStart: true,
    path: "/asistente",
    covers: ["identity_theft_report_missing"],
  },
};

/** The follow-up situation that stands for a console notice, if any. */
export function followupKindOf(exception: ExceptionKind): FollowupKind | null {
  return FOLLOWUP_KINDS.find((kind) => FOLLOWUP_SCHEDULES[kind].covers.includes(exception)) ?? null;
}

// ── Situations ──────────────────────────────────────────────────────────

export interface Situation {
  kind: FollowupKind;
  /** This occurrence: the kind and when it began ("documents_missing:2026-11-20"). */
  key: string;
  startedAt: string;
  /** The template's values besides the name and the link, per language. */
  values: Record<MessageLocale, string[]>;
}

const DOCUMENT_EN: Record<DocumentKind, string> = {
  government_id: "photo ID",
  proof_of_address: "proof of address",
  ssn_card: "Social Security card",
  identity_theft_report: "identity theft report",
};

const day = (iso: string) => iso.slice(0, 10);
const later = (...isos: Array<string | null | undefined>): string | null =>
  isos.reduce<string | null>((max, v) => (v && (!max || v > max) ? v : max), null);

/** True once the client cancelled or asked to end the service: the system writes nothing more by itself. */
export function clientStoppedService(client: StaffClient): boolean {
  return Boolean(client.agreementCancelledAt) || Boolean(client.serviceEndRequestedAt);
}

/** Every situation the client is in now, oldest first. */
export function openSituations(client: StaffClient, now: Date): Situation[] {
  if (!client.signedUpAt || clientStoppedService(client)) return [];
  const found: Situation[] = [];
  const add = (kind: FollowupKind, startedAt: string, key: string, values: Record<MessageLocale, string[]> = { es: [], en: [] }) =>
    found.push({ kind, key: `${kind}:${key}`, startedAt, values });

  if (!client.agreementSignedAt) {
    add("agreement_unsigned", client.signedUpAt, day(client.signedUpAt));
  }

  // Documents: from the first day work may start (the cancellation window is
  // three days in which nothing is asked of the client).
  const missing = missingDocuments(client);
  if (client.agreementSignedAt && missing.length > 0 && !workStartsAt(client, now)) {
    const deadline = deadlineOf(clientAgreement(client));
    const start = deadline ? firstWorkingDay(deadline).toISOString() : client.agreementSignedAt;
    add("documents_missing", start, day(start), {
      es: [documentNames(missing)],
      en: [missing.map((k) => DOCUMENT_EN[k]).join(" and ")],
    });
  }

  if (client.report) {
    const review = reviewProgress(client);
    const firstRoundNotBuilt = !client.rounds.some((r) => r.status !== "draft");
    if (firstRoundNotBuilt && review.pending > 0 && client.agreementSignedAt) {
      // Any answer restarts the schedule: a client who is moving is not reminded.
      const lastAnswer = later(
        ...Object.values(client.answers).map((a) => (a.status === "inaccurate" ? a.confirmedAt : a.status === "correct" ? a.answeredAt : null)),
      );
      const start = later(client.report.pulledAt, lastAnswer)!;
      const n = review.pending;
      add("review_unfinished", start, start.slice(0, 16), {
        es: [n === 1 ? "1 punto" : `${n} puntos`],
        en: [n === 1 ? "1 item" : `${n} items`],
      });
    }

    const reportAge = (now.getTime() - new Date(client.report.pulledAt).getTime()) / (24 * HOUR_MS);
    const overdue = overdueResponseRound(client, now);
    if (overdue?.mailedAt) {
      const start = addDays(responseWindowStart(overdue) ?? overdue.mailedAt, RESPONSE_WINDOW_DAYS).toISOString();
      add("monitoring_inactive", start, `r${overdue.number}`);
    } else if (Math.floor(reportAge) > FRESH_REPORT_DAYS && latestRound(client)?.status !== "mailed") {
      const start = addDays(client.report.pulledAt, FRESH_REPORT_DAYS).toISOString();
      add("monitoring_inactive", start, day(client.report.pulledAt));
    }
  }

  const outlook = clientBillingOutlook(client, now);
  if (outlook.kind === "payment_method_missing" && outlook.roundNumber !== null) {
    const round = client.rounds.find((r) => r.number === outlook.roundNumber);
    if (round?.mailedAt) add("payment_method_missing", round.mailedAt, `r${round.number}`, { es: [String(round.number)], en: [String(round.number)] });
  }

  const theft = identityTheftItemsWithoutReport(client);
  if (theft.length > 0) {
    const start = theft.map((t) => t.confirmedAt).sort()[0]!;
    add("identity_theft_report_missing", start, day(start));
  }

  return found.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

// ── Where each situation stands ─────────────────────────────────────────

export type FollowupBlock = "disabled" | "opted_out" | "held" | "no_channel" | "template_not_approved";

export const BLOCK_TEXT: Record<FollowupBlock, string> = {
  disabled: "Los recordatorios automáticos de esto están apagados.",
  opted_out: "Pidió no recibir mensajes automáticos.",
  held: "El piloto automático está detenido para este cliente.",
  no_channel: "No hay un canal para escribirle solo (WhatsApp o correo).",
  template_not_approved: "Falta aprobar en Meta la plantilla de WhatsApp de este mensaje, y no tiene correo.",
};

export interface FollowupState {
  situation: Situation;
  schedule: FollowupSchedule;
  /** What the system already sent for this situation, by step (failed attempts included). */
  sent: OutboundMessage[];
  /** The next message and when it is due; null when all three went. */
  next: { step: number; dueAt: string } | null;
  /** All three went, the grace day passed, and nothing changed. */
  exhausted: boolean;
  /** When it became (or becomes) a person's. */
  personSince: string;
  /** Why the system cannot write (the item is then a person's as before). */
  block: FollowupBlock | null;
}

export function dedupeKeyFor(clientId: string, situationKey: string, step: number): string {
  return `followup:${clientId}:${situationKey}:${step}`;
}

/** The open hold on the client, if any. */
export function openHold(client: StaffClient) {
  return (client.holds ?? []).find((h) => !h.releasedAt) ?? null;
}

export function followupTemplate(kind: FollowupKind, step: number): MessageTemplate {
  return FOLLOWUP_TEMPLATES[kind][Math.min(Math.max(step, 1), 3) - 1]!;
}

function contactOf(client: StaffClient) {
  return { phone: client.phone, email: client.email ?? null, lastInboundAt: client.lastInboundAt ?? null };
}

export function followupStates(client: StaffClient, now: Date, env: AutopilotEnv): FollowupState[] {
  const log = client.outbound ?? [];
  return openSituations(client, now).map((situation) => {
    const schedule = FOLLOWUP_SCHEDULES[situation.kind];
    const prefix = `followup:${client.id}:${situation.key}:`;
    const sent = log.filter((m) => m.dedupeKey.startsWith(prefix) && m.status !== "cancelled" && m.status !== "queued").sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
    const start = new Date(situation.startedAt);
    const lastAt = sent.length > 0 ? new Date(sent[sent.length - 1]!.sentAt ?? sent[sent.length - 1]!.queuedAt) : null;

    let next: FollowupState["next"] = null;
    if (sent.length < schedule.stepDays.length) {
      const step = sent.length + 1;
      const byDay = addDays(situation.startedAt, schedule.stepDays[step - 1]!).getTime();
      const byGap = lastAt ? lastAt.getTime() + MIN_GAP_HOURS * HOUR_MS : 0;
      next = { step, dueAt: new Date(Math.max(byDay, byGap)).toISOString() };
    }

    const personAt = schedule.personFromStart
      ? start.getTime()
      : Math.max(addDays(situation.startedAt, schedule.personAfterDays).getTime(), lastAt ? lastAt.getTime() + GRACE_AFTER_LAST_HOURS * HOUR_MS : 0);
    const exhausted = !schedule.personFromStart && next === null && now.getTime() >= personAt;

    let block: FollowupBlock | null = null;
    if (!env.settings.followupsEnabled || !env.settings.followups[situation.kind]) block = "disabled";
    else if (client.optOut) block = "opted_out";
    else if (openHold(client)) block = "held";
    else if (next) {
      const choice = chooseChannel(contactOf(client), followupTemplate(situation.kind, next.step).name, env.channels, now);
      if (choice.channel === null) block = choice.reason;
    }

    return { situation, schedule, sent, next, exhausted, personSince: new Date(personAt).toISOString(), block };
  });
}

// ── The messages due now ────────────────────────────────────────────────

/** One message ready to go: its words, its template, and the channel it would take. */
export interface PlannedMessage {
  dedupeKey: string;
  kind: "followup" | "status";
  topic: string;
  step: number | null;
  locale: MessageLocale;
  template: MessageTemplate;
  /** The template's values, {{1}} first. */
  params: string[];
  body: string;
  link: string | null;
  /** The queued row it came from (status messages). */
  outboundId: string | null;
  choice: ChannelChoice;
}

export function clientLocale(client: StaffClient): MessageLocale {
  return client.locale === "en" ? "en" : "es";
}

/** The follow-up messages due now, before quiet hours and the daily cap (plan.ts applies those). */
export function dueFollowups(client: StaffClient, now: Date, env: AutopilotEnv, base?: string): PlannedMessage[] {
  const locale = clientLocale(client);
  return followupStates(client, now, env).flatMap((state) => {
    if (state.block || !state.next || new Date(state.next.dueAt).getTime() > now.getTime()) return [];
    const template = followupTemplate(state.situation.kind, state.next.step);
    const link = appLink(state.schedule.path, base);
    const params = [client.firstName, ...state.situation.values[locale], link];
    return [
      {
        dedupeKey: dedupeKeyFor(client.id, state.situation.key, state.next.step),
        kind: "followup" as const,
        topic: state.situation.kind,
        step: state.next.step,
        locale,
        template,
        params,
        body: renderTemplate(template, locale, params),
        link,
        outboundId: null,
        choice: chooseChannel(contactOf(client), template.name, env.channels, now),
      },
    ];
  });
}
