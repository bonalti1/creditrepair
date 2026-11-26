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
  openAddressCheck,
  overdueResponseRound,
  reviewProgress,
  roundRepullAt,
  workStartsAt,
  type ExceptionKind,
} from "../staff/stage";
import type { DocumentKind, StaffClient } from "../staff/types";
import { responseWindowStart } from "../mail/tracking";
import { DOCUMENT_NAME, failuresSinceAccepted, reuploadRequest } from "../intake/reupload";
import { RESPONSE_WINDOW_DAYS } from "../ux/journey";
import { channelsFor, settingsOf } from "../fulfillment/notifications";
import { dueText, earlyMonitoringReminder } from "../fulfillment/monitoring";
import { latestRejectionAt } from "../fulfillment/documents";
import { chooseChannel, type ChannelChoice } from "./channels";
import { appLink, EXTRA_FOLLOWUP_TEMPLATES, FOLLOWUP_TEMPLATES, MONITORING_BEFORE_DUE_TEMPLATE, renderTemplate, type MessageTemplate } from "./templates";
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
    // The documents screen: what is missing, what our team did not accept and why, and the upload buttons.
    path: "/documentos",
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
    // The one-tap card page (the processor's hosted fields); a charge waiting on it is tried at once.
    path: "/pagos/tarjeta",
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
  address_unconfirmed: {
    kind: "address_unconfirmed",
    label: "Dirección por confirmar",
    description:
      "El correo no pudo confirmar la dirección del cliente (antes de enviar, o por una carta devuelta). Se le pide confirmarla o corregirla con un toque. Cuenta desde la solicitud; si la que confirma tampoco pasa, es de una persona.",
    stepDays: [0, 2, 4],
    personAfterDays: 6,
    personFromStart: false,
    path: "/confirmar-direccion",
    covers: ["client_address_unconfirmed"],
  },
  document_reupload: {
    kind: "document_reupload",
    label: "Documento por subir de nuevo",
    description:
      "La revisión automática no aceptó su identificación o su comprobante por algo que el cliente puede corregir (foto borrosa, comprobante viejo). Se le dice el motivo y se le pide otro. Un segundo rechazo, o un motivo que no se corrige con otra foto, es de una persona.",
    stepDays: [0, 2, 5],
    personAfterDays: 7,
    personFromStart: false,
    path: "/documentos",
    covers: ["document_check_needs_person"],
  },
};

/** Each follow-up's name and description for the staff console in English (the Spanish ones are in FOLLOWUP_SCHEDULES). */
export const FOLLOWUP_TEXT_EN: Record<FollowupKind, { label: string; description: string }> = {
  agreement_unsigned: { label: "Agreement not signed", description: "Created their account and hasn't signed the agreement. Counts from the day they created their account." },
  documents_missing: { label: "Documents missing", description: "Their ID or proof of address is missing. Counts from the end of their cancellation period." },
  review_unfinished: { label: "Review not finished", description: "Hasn't finished reviewing their report. Counts from their last answer: if they make progress, it starts over." },
  monitoring_inactive: {
    label: "Monitoring with no new report",
    description: `Their report is more than ${FRESH_REPORT_DAYS} days old, or the bureaus' ${RESPONSE_WINDOW_DAYS} days to answer passed with no new report.`,
  },
  payment_method_missing: {
    label: "No payment method",
    description: "A round went out and there's no payment method. Billing already tells them on the day of the charge; this follows after. Counts from the mailing.",
  },
  identity_theft_report_missing: {
    label: "Identity theft report",
    description:
      "Reported identity theft and their FTC report is missing. They get the IdentityTheft.gov steps, but a person handles it from day one: the app told them someone on the team would write.",
  },
  address_unconfirmed: {
    label: "Address to confirm",
    description:
      "The post office couldn't confirm the client's address (before mailing, or because a letter came back). They're asked to confirm or correct it with one tap. Counts from the request; if the one they confirm doesn't pass either, it goes to a person.",
  },
  document_reupload: {
    label: "Document to upload again",
    description:
      "The automatic check didn't accept their ID or proof of address for something the client can fix (a blurry photo, an old bill). They're told the reason and asked for another. A second rejection, or a reason another photo won't fix, goes to a person.",
  },
};

/** A follow-up's name and description in the console's language. */
export function followupText(kind: FollowupKind, locale: "es" | "en"): { label: string; description: string } {
  return locale === "en" ? FOLLOWUP_TEXT_EN[kind] : { label: FOLLOWUP_SCHEDULES[kind].label, description: FOLLOWUP_SCHEDULES[kind].description };
}

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
  /**
   * The one console notice this occurrence stands for, when a kind can have
   * several at once (a re-upload request per document). Absent: any notice of
   * the kinds the schedule covers.
   */
  exceptionKey?: string;
  /**
   * Monitoring only: when the next report is due, for a series the team's
   * check started early (fulfillment/monitoring.ts). Before that day its
   * message says when the report is due.
   */
  dueAt?: string;
  dueText?: Record<MessageLocale, string>;
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
    const windowEnd = deadline ? firstWorkingDay(deadline).toISOString() : client.agreementSignedAt;
    // A document a person did not accept starts a new series from that review (fulfillment/documents.ts).
    const rejectedAt = latestRejectionAt(client, missing);
    const start = rejectedAt && rejectedAt > windowEnd ? rejectedAt : windowEnd;
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
    // The team found the monitoring cancelled and a report is due soon (fulfillment/monitoring.ts):
    // the same series, under the same key, starts early and says when the report is due.
    const early = earlyMonitoringReminder(client, now);
    const addMonitoring = (start: string, key: string) => {
      const sooner = early && early.key === key && early.startAt < start ? early : null;
      add("monitoring_inactive", sooner ? sooner.startAt : start, key);
      if (sooner) Object.assign(found[found.length - 1]!, { dueAt: sooner.dueAt, dueText: dueText(sooner.dueAt) });
    };
    if (overdue?.mailedAt) {
      // From the system's own re-pull date (rounds/timing.ts): before it, no new report is expected.
      const start = (roundRepullAt(overdue) ?? addDays(responseWindowStart(overdue) ?? overdue.mailedAt, RESPONSE_WINDOW_DAYS)).toISOString();
      addMonitoring(start, `r${overdue.number}`);
    } else if (Math.floor(reportAge) > FRESH_REPORT_DAYS && latestRound(client)?.status !== "mailed") {
      const start = addDays(client.report.pulledAt, FRESH_REPORT_DAYS).toISOString();
      addMonitoring(start, day(client.report.pulledAt));
    } else if (early) {
      add("monitoring_inactive", early.startAt, early.key);
      Object.assign(found[found.length - 1]!, { dueAt: early.dueAt, dueText: dueText(early.dueAt) });
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

  // The client's own address, which the post office could not confirm: the
  // first request only. If the address they confirm fails again, a person.
  const check = openAddressCheck(client);
  if (check && check.requests <= 1) {
    add("address_unconfirmed", check.requestedAt, check.id);
    found[found.length - 1]!.exceptionKey = `client_address_unconfirmed:${check.id}`;
  }

  // A document the automatic check did not accept, for reasons the client can
  // fix: the first time only. A second failure goes to a person.
  for (const kind of ["government_id", "proof_of_address"] as const) {
    const failures = failuresSinceAccepted(client.intake ?? [], kind);
    const newest = failures[0];
    if (!newest || failures.length > 1) continue;
    const request = reuploadRequest(newest);
    if (!request) continue;
    add("document_reupload", newest.at, `${kind}:${newest.id}`, {
      es: [DOCUMENT_NAME[kind].es, request.motivo.es],
      en: [DOCUMENT_NAME[kind].en, request.motivo.en],
    });
    found[found.length - 1]!.exceptionKey = `document_check_needs_person:${newest.id}`;
  }

  return found.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

// ── Where each situation stands ─────────────────────────────────────────

export type FollowupBlock = "disabled" | "opted_out" | "reminders_off" | "held" | "no_channel" | "template_not_approved";

export const BLOCK_TEXT: Record<FollowupBlock, string> = {
  disabled: "Los recordatorios automáticos de esto están apagados.",
  opted_out: "Pidió no recibir mensajes automáticos.",
  reminders_off: "Apagó los recordatorios en sus avisos: una persona le escribe o le llama.",
  held: "El piloto automático está detenido para este cliente.",
  no_channel: "No hay un canal para escribirle solo (WhatsApp o correo).",
  template_not_approved: "Falta aprobar en Meta la plantilla de WhatsApp de este mensaje, y no tiene correo.",
};

/** The same, for the staff console in English. */
export const BLOCK_TEXT_EN: Record<FollowupBlock, string> = {
  disabled: "Automatic reminders for this are turned off.",
  opted_out: "Asked not to get automatic messages.",
  reminders_off: "Turned reminders off in their notification settings: a person writes or calls instead.",
  held: "The autopilot is on hold for this client.",
  no_channel: "There's no channel to message them automatically (WhatsApp or email).",
  template_not_approved: "This message's WhatsApp template still needs Meta's approval, and they have no email.",
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

/** The template for this step of this occurrence: the early monitoring message before its report is due, else the usual one. */
export function followupTemplateFor(situation: Situation, step: number, now: Date): MessageTemplate {
  if (situation.kind === "monitoring_inactive" && situation.dueAt && step < 3 && now.getTime() < new Date(situation.dueAt).getTime()) {
    return EXTRA_FOLLOWUP_TEMPLATES.find((t) => t.name === MONITORING_BEFORE_DUE_TEMPLATE)!;
  }
  return followupTemplate(situation.kind, step);
}

export { MONITORING_BEFORE_DUE_TEMPLATE };

function contactOf(client: StaffClient) {
  return { phone: client.phone, email: client.email ?? null, lastInboundAt: client.lastInboundAt ?? null };
}

/**
 * The channel for one of this client's automatic messages: the team's
 * channels narrowed to the ones the client kept in their notification
 * settings (fulfillment/notifications.ts).
 */
export function clientChannel(client: StaffClient, template: string, env: AutopilotEnv, now: Date): ChannelChoice {
  return chooseChannel(contactOf(client), template, channelsFor(settingsOf(client), env.channels), now);
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
    else if (!settingsOf(client).reminders) block = "reminders_off";
    else if (openHold(client)) block = "held";
    else if (next) {
      const choice = clientChannel(client, followupTemplateFor(situation, next.step, now).name, env, now);
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
  return client.locale === "es" ? "es" : "en";
}

/** The follow-up messages due now, before quiet hours and the daily cap (plan.ts applies those). */
export function dueFollowups(client: StaffClient, now: Date, env: AutopilotEnv, base?: string): PlannedMessage[] {
  const locale = clientLocale(client);
  return followupStates(client, now, env).flatMap((state) => {
    if (state.block || !state.next || new Date(state.next.dueAt).getTime() > now.getTime()) return [];
    const template = followupTemplateFor(state.situation, state.next.step, now);
    const link = appLink(state.schedule.path, base);
    // The early monitoring message carries the report's date; the others the situation's values.
    const values = template.name === MONITORING_BEFORE_DUE_TEMPLATE ? [state.situation.dueText?.[locale] ?? ""] : state.situation.values[locale];
    const params = [client.firstName, ...values, link];
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
        choice: clientChannel(client, template.name, env, now),
      },
    ];
  });
}
