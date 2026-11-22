import { BRAND } from "../brand";
import { firstWorkingDay } from "../agreement/businessDays";
import { deadlineOf, workMayStart, type AgreementRecord, type GateResult } from "../agreement/gate";
import { accountStanding, casePausedForPayment, unpaidCharge } from "../billing/dunning";
import { billingOutlook, type BillingOutlook } from "../billing/outlook";
import type { BillingContext } from "../billing/types";
import { ROUND_CYCLE_DAYS } from "../domain/attack";
import { FRESH_REPORT_DAYS } from "../monitoring/subscription";
import { RESPONSE_WINDOW_DAYS } from "../ux/journey";
import { itemLabel } from "../ux/itemDisplay";
import type { FurnisherEntry, FurnisherGapRecord } from "../mail/furnishers";
import type { LetterVersion } from "../letters/versions/versions";
import { addressBookHref, missingFurnisherAddresses } from "../mail/sendPlan";
import { responseWindowStart, returnReasonEs } from "../mail/tracking";
import { billingContextFor } from "./billing";
import { intakeExceptions } from "../intake/exceptions";
import { REQUIRED_DOCUMENTS, type DocumentKind, type StaffClient, type StaffLetter, type StaffRound } from "./types";

// Where is this client, what is wrong, and what happens next.
//
// Three pure functions answer those questions from the client record and the
// current time. The console is built on them: the home screen lists
// clientExceptions, the pipeline counts clientStage, and every "next step"
// line is nextAutomaticStep or, when that is null, the person being waited on.
//
// Day counts follow the rule already used for monitoring (subscription.ts):
// whole days elapsed, and "more than N days" means N + 1 whole days or more.

export { RESPONSE_WINDOW_DAYS };
/** A review still unfinished after this many days gets a person's attention. */
export const REVIEW_STALLED_DAYS = 5;
/** Days allowed after signing the agreement to upload ID and proof of address. */
export const DOCUMENTS_GRACE_DAYS = 3;
/** Days allowed after creating the account to sign the agreement. */
export const AGREEMENT_GRACE_DAYS = 3;
/** A handled exception stays quiet this long, then returns if nothing changed. */
export const HANDLED_QUIET_DAYS = 3;
/** Dates are written for the team's clock: Texas. */
export const STAFF_TIME_ZONE = "America/Chicago";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from `iso` to `now`; negative when `iso` is in the future. */
export function daysSince(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS);
}

export function addDays(iso: string, days: number): Date {
  return new Date(new Date(iso).getTime() + days * DAY_MS);
}

/** "28 de diciembre", on the team's calendar. */
export function formatDay(date: Date): string {
  return date.toLocaleDateString("es-MX", { day: "numeric", month: "long", timeZone: STAFF_TIME_ZONE });
}

function calendarDay(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: STAFF_TIME_ZONE });
}

/** "hoy" for today or an overdue date, otherwise "el 28 de diciembre". */
function onDay(date: Date, now: Date): string {
  return date.getTime() <= now.getTime() || calendarDay(date) === calendarDay(now) ? "hoy" : `el ${formatDay(date)}`;
}

function daysPhrase(days: number): string {
  return days === 1 ? "1 día" : `${days} días`;
}

// ── Stages ──────────────────────────────────────────────────────────────

export const STAGE_ORDER = [
  "lead",
  "agreement_pending",
  "cancellation_window",
  "documents_pending",
  "report_pending",
  "client_review_pending",
  "ready_to_send",
  "waiting_on_bureaus",
  "results_in",
  "next_round_ready",
  "paused",
  "cancelled",
] as const;

export type Stage = (typeof STAGE_ORDER)[number];

/** The stages of clients the team is working with. A client who cancelled is not among them. */
export const PIPELINE_STAGES: readonly Stage[] = STAGE_ORDER.filter((stage) => stage !== "cancelled");

/** Whose move it is. "staff" is the team running fulfillment; "sales" is whoever is talking with a lead. */
export type Actor = "system" | "client" | "staff" | "sales";

export const ACTOR_LABEL: Record<Actor, string> = {
  system: "El sistema",
  client: "El cliente",
  staff: "El equipo",
  sales: "Ventas",
};

export interface StageInfo {
  /** Chip text. */
  label: string;
  /** One or two words, for the pipeline strip. */
  short: string;
  /** One line: what happens next and who does it. */
  description: string;
  actor: Actor;
}

export const STAGES: Record<Stage, StageInfo> = {
  lead: {
    label: "Prospecto",
    short: "Prospectos",
    description: "Todavía no crea su cuenta. Ventas sigue la conversación por WhatsApp y le envía su enlace de invitación.",
    actor: "sales",
  },
  agreement_pending: {
    label: "Falta el acuerdo",
    short: "Acuerdo",
    description: "El cliente tiene que firmar el acuerdo de servicio. Nada avanza hasta entonces.",
    actor: "client",
  },
  cancellation_window: {
    label: "En periodo de cancelación",
    short: "Cancelación",
    description:
      "Firmó el acuerdo y está en sus 3 días hábiles para cancelar sin costo. La ley no permite empezar ningún trabajo antes. Nadie tiene que hacer nada: el sistema avisa el día que se puede empezar.",
    actor: "system",
  },
  documents_pending: {
    label: "Faltan documentos",
    short: "Documentos",
    description:
      "El cliente tiene que subir su identificación y su comprobante de domicilio. Van dentro de cada carta.",
    actor: "client",
  },
  report_pending: {
    label: "Falta el reporte",
    short: "Reporte",
    description: "El cliente activa su monitoreo de crédito. El sistema importa el reporte en cuanto tiene acceso.",
    actor: "client",
  },
  client_review_pending: {
    label: "En revisión del cliente",
    short: "Revisión",
    description: `El cliente revisa su reporte con ${BRAND.assistant} y dice qué es inexacto. Solo el cliente puede responder.`,
    actor: "client",
  },
  ready_to_send: {
    label: "Lista para enviar",
    short: "Por enviar",
    description: "El cliente terminó su revisión y la primera ronda de cartas está preparada. El equipo la envía.",
    actor: "staff",
  },
  waiting_on_bureaus: {
    label: "Esperando a los burós",
    short: "Con los burós",
    description: `Las cartas van en camino. Los burós tienen ${RESPONSE_WINDOW_DAYS} días para responder y el sistema vuelve a importar el reporte solo.`,
    actor: "system",
  },
  results_in: {
    label: "Llegaron respuestas",
    short: "Respuestas",
    description: "Llegó el reporte nuevo. El sistema lo compara con el anterior y prepara la siguiente ronda.",
    actor: "system",
  },
  next_round_ready: {
    label: "Siguiente ronda lista",
    short: "Sig. ronda",
    description: "La siguiente ronda de cartas está preparada. El equipo la envía.",
    actor: "staff",
  },
  paused: {
    label: "En pausa",
    short: "En pausa",
    description:
      "No hay trabajo en curso: un cobro no pasó después de los reintentos, o el cliente no marcó nada como inexacto. Con un cobro sin resolver no se prepara ni se envía ninguna ronda; en cuanto el cliente paga, el caso sigue solo.",
    actor: "client",
  },
  cancelled: {
    label: "Canceló su acuerdo",
    short: "Cancelados",
    description:
      "El cliente canceló su acuerdo. No se hace ningún trabajo, no se envía ninguna carta y no se le cobra. Su registro se conserva.",
    actor: "staff",
  },
};

// ── The agreement ───────────────────────────────────────────────────────

/** The client's agreement as the gate reads it (src/lib/agreement/gate.ts). */
export function clientAgreement(client: StaffClient): AgreementRecord {
  return {
    // A record made before the acknowledgement was kept separately: the signing date stands in.
    disclosureAcknowledgedAt:
      client.disclosureAcknowledgedAt === undefined ? client.agreementSignedAt : client.disclosureAcknowledgedAt,
    signedAt: client.agreementSignedAt,
    cancellationDeadline: client.cancellationDeadline ?? null,
    cancelledAt: client.agreementCancelledAt ?? null,
    serviceEndRequestedAt: client.serviceEndRequestedAt ?? null,
  };
}

/** Whether work may be done for this client now (the same rule the letters endpoint applies). */
export function agreementGate(client: StaffClient, now: Date): GateResult {
  return workMayStart(clientAgreement(client), now);
}

/**
 * For a client inside the cancellation window: the first working day the team
 * may begin. Null for everyone else.
 */
export function workStartsAt(client: StaffClient, now: Date): Date | null {
  const gate = agreementGate(client, now);
  if (gate.allowed || gate.code !== "in_cancellation_window") return null;
  const deadline = deadlineOf(clientAgreement(client));
  return deadline ? firstWorkingDay(deadline) : null;
}

/** True once the client asked to end the service and has not been cancelled: a person has to settle it. */
function serviceEndPending(client: StaffClient): boolean {
  return Boolean(client.serviceEndRequestedAt) && !client.agreementCancelledAt;
}

/**
 * The agreement in one line, for the client page:
 * "En periodo de cancelación — se puede empezar el 25 de noviembre".
 */
export function agreementLine(client: StaffClient, now: Date): string {
  if (!client.agreementSignedAt) {
    return clientAgreement(client).disclosureAcknowledgedAt
      ? "Recibió la declaración de sus derechos; falta que firme el contrato"
      : "Sin firmar";
  }
  if (client.agreementCancelledAt) {
    return client.cancelledWithinWindow === false
      ? `Cancelado el ${formatDay(new Date(client.agreementCancelledAt))}, después del plazo`
      : `Cancelado el ${formatDay(new Date(client.agreementCancelledAt))}, dentro del plazo`;
  }
  const starts = workStartsAt(client, now);
  if (starts) return `En periodo de cancelación — se puede empezar el ${formatDay(starts)}`;
  if (serviceEndPending(client)) return `Vigente — pidió terminar el servicio el ${formatDay(new Date(client.serviceEndRequestedAt!))}`;
  return "Vigente — el periodo de cancelación ya terminó";
}

// ── Billing ─────────────────────────────────────────────────────────────

/** Everything a billing decision about this client is made from (src/lib/billing). */
export function clientBilling(client: StaffClient): BillingContext {
  return billingContextFor(client, clientAgreement(client));
}

/**
 * What happens next with this client's money, in one sentence, from the same
 * rule that charges. Nobody on the team charges anyone: the system does, only
 * for a round that was mailed, and this says when.
 */
export function clientBillingOutlook(client: StaffClient, now: Date): BillingOutlook {
  return billingOutlook(clientBilling(client), now);
}

/** True while the case is paused for a charge that did not go through after every retry. */
export function pausedForPayment(client: StaffClient): boolean {
  return casePausedForPayment(client.billing);
}

export function latestRound(client: StaffClient): StaffRound | null {
  return client.rounds.reduce<StaffRound | null>((latest, r) => (!latest || r.number > latest.number ? r : latest), null);
}

/** The newest round that has been mailed (waiting or answered), if any. */
function lastMailedRound(client: StaffClient): StaffRound | null {
  return client.rounds
    .filter((r) => r.mailedAt && (r.status === "mailed" || r.status === "responded"))
    .reduce<StaffRound | null>((latest, r) => (!latest || r.number > latest.number ? r : latest), null);
}

export function missingDocuments(client: StaffClient): DocumentKind[] {
  return REQUIRED_DOCUMENTS.filter((kind) => !client.documents.includes(kind));
}

export interface ReviewProgress {
  total: number;
  answered: number;
  pending: number;
  inaccurate: number;
  correct: number;
}

/** How far the client is through their review of the current report. */
export function reviewProgress(client: StaffClient): ReviewProgress {
  const items = client.report?.items ?? [];
  let inaccurate = 0;
  let correct = 0;
  for (const item of items) {
    const answer = client.answers[item.fingerprint];
    if (answer?.status === "inaccurate") inaccurate += 1;
    else if (answer?.status === "correct") correct += 1;
  }
  const answered = inaccurate + correct;
  return { total: items.length, answered, pending: items.length - answered, inaccurate, correct };
}

/**
 * The one stage a client is in. Checked in the order work actually happens,
 * so the stage is always the earliest thing still missing.
 *
 * A stage depends on what has been recorded, with one exception that depends
 * on the date: the days right after signing, while the client can still cancel
 * without penalty and the law allows no work. `now` decides that one; left
 * out, the current time is used.
 */
export function clientStage(client: StaffClient, now: Date = new Date()): Stage {
  // A cancelled agreement ends everything, whatever else is on record.
  if (client.agreementCancelledAt) return "cancelled";
  // A charge that did not go through after every retry pauses the case. This
  // is read from the charges themselves, not from a flag someone sets, so it
  // lifts by itself the moment the charge is paid.
  if (pausedForPayment(client)) return "paused";
  if (!client.signedUpAt) return "lead";
  if (!client.agreementSignedAt) return "agreement_pending";
  if (workStartsAt(client, now)) return "cancellation_window";
  if (missingDocuments(client).length > 0) return "documents_pending";
  if (!client.report) return "report_pending";

  const latest = latestRound(client);
  if (latest?.status === "mailed") return "waiting_on_bureaus";
  if (latest?.status === "responded") return "results_in";
  if (latest && lastMailedRound(client)) {
    // A later round after one that was mailed: ready to go, or still being prepared.
    return latest.status === "ready" ? "next_round_ready" : "results_in";
  }

  // Nothing mailed yet: the first round.
  const review = reviewProgress(client);
  if (review.pending > 0) return "client_review_pending";
  if (review.inaccurate === 0) return "paused";
  return "ready_to_send";
}

// ── Exceptions ──────────────────────────────────────────────────────────

export const EXCEPTION_KINDS = [
  "review_stalled",
  "documents_missing",
  "report_stale",
  "payment_past_due",
  "payment_method_missing",
  "letter_returned",
  "question_waiting",
  "response_overdue",
  "agreement_unsigned",
  "identity_theft_report_missing",
  "service_end_requested",
  "furnisher_address_missing",
  // AI intake (src/lib/intake/exceptions.ts): only what the automatic check was not sure about.
  "document_check_needs_person",
  "bureau_letter_needs_person",
  // The post office's data could not confirm the client's own address (mail/verify.ts): the client is asked first.
  "client_address_unconfirmed",
] as const;

export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

export type Severity = "high" | "medium" | "low";

export const EXCEPTION_LABEL: Record<ExceptionKind, string> = {
  review_stalled: "Revisión detenida",
  documents_missing: "Faltan documentos",
  report_stale: "Reporte vencido",
  payment_past_due: "Pago sin resolver",
  payment_method_missing: "Falta su método de pago",
  letter_returned: "Carta devuelta",
  question_waiting: "Pregunta sin responder",
  response_overdue: "Sin reporte nuevo",
  agreement_unsigned: "Acuerdo sin firmar",
  identity_theft_report_missing: "Robo de identidad sin reporte",
  service_end_requested: "Pidió terminar el servicio",
  furnisher_address_missing: "Falta la dirección de un acreedor",
  document_check_needs_person: "Documento para revisar",
  bureau_letter_needs_person: "Carta de un buró para revisar",
  client_address_unconfirmed: "Dirección del cliente sin confirmar",
};

export interface StaffException {
  /** Stable id of this exception on this client, used to mark it handled. */
  key: string;
  kind: ExceptionKind;
  severity: Severity;
  /** What is wrong, in one or two plain sentences. */
  sentence: string;
  /** Text of the one button that fixes it. */
  actionLabel: string;
  /** How the fix is carried out: a WhatsApp message to the client, or a look at the client's page. */
  action: "whatsapp" | "open_client";
  /** When the situation began (ISO), oldest first within a severity. Null when unknown. */
  since: string | null;
  /** Where the button goes, when it is not the client's letters (open_client) or a WhatsApp chat. */
  href?: string;
}

/**
 * What the exceptions and the send rules may also consult. The furnisher
 * address book lives outside the client record; without it, the checks that
 * need it are skipped, so every place that SENDS passes it (data.ts).
 */
export interface StaffContext {
  furnishers?: readonly FurnisherEntry[];
  /** The approved letter texts (letters/versions): printed and previewed letters use them. */
  letterVersions?: readonly LetterVersion[];
  /** Companies whose dispute address is missing, as first seen for every client (furnisher_gaps). The queue's clock for them. */
  furnisherGaps?: readonly FurnisherGapRecord[];
}

/** The request to the client to confirm their address, while it is open (neither confirmed nor closed). */
export function openAddressCheck(client: StaffClient): NonNullable<StaffClient["addressCheck"]> | null {
  const check = client.addressCheck;
  return check && !check.confirmedAt && !check.closedAt ? check : null;
}

/** True for a letter that came back and has been sent again (a later letter of the same round re-mails it). */
export function letterRemailed(round: Pick<StaffRound, "letters">, letterId: string): boolean {
  return round.letters.some((l) => l.remailOf === letterId);
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

const DOCUMENT_NAME: Record<DocumentKind, string> = {
  government_id: "identificación",
  proof_of_address: "comprobante de domicilio",
  ssn_card: "tarjeta de Seguro Social",
  identity_theft_report: "reporte de robo de identidad",
};

function listEs(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

export function documentNames(kinds: DocumentKind[]): string {
  return listEs(kinds.map((k) => DOCUMENT_NAME[k]));
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Items on the current report the client confirmed as inaccurate with the
 * reason "identity theft", while no identity theft report (FTC) is on file.
 * The client was told a teammate would follow up, so a person has to.
 */
export function identityTheftItemsWithoutReport(client: StaffClient): Array<{ label: string; confirmedAt: string }> {
  if (!client.report || client.documents.includes("identity_theft_report")) return [];
  return client.report.items.flatMap((item) => {
    const answer = client.answers[item.fingerprint];
    return answer?.status === "inaccurate" && answer.reasonCode === "identity_theft"
      ? [{ label: itemLabel(item, "es"), confirmedAt: answer.confirmedAt }]
      : [];
  });
}

function responseOverdue(client: StaffClient, now: Date): StaffRound | null {
  const latest = latestRound(client);
  if (!latest || latest.status !== "mailed" || !latest.mailedAt) return null;
  // The window runs from receipt when the post office recorded it (mail/tracking.ts: responseWindowStart).
  const start = responseWindowStart(latest) ?? latest.mailedAt;
  if (daysSince(start, now) <= RESPONSE_WINDOW_DAYS) return null;
  // A report pulled once the window closed would already show the answers.
  const windowEnd = addDays(start, RESPONSE_WINDOW_DAYS);
  if (client.report && new Date(client.report.pulledAt).getTime() >= windowEnd.getTime()) return null;
  return latest;
}

/**
 * The mailed round whose answers are overdue (no new report after the response
 * window), or null. The automatic follow-ups (autopilot/followups.ts) read it.
 */
export function overdueResponseRound(client: StaffClient, now: Date): StaffRound | null {
  return responseOverdue(client, now);
}

/** Every exception that applies right now, whether or not someone marked it handled. */
function openExceptions(client: StaffClient, now: Date, context: StaffContext = {}): StaffException[] {
  // A cancelled client has nothing in flight, so nothing can be wrong with it.
  if (client.agreementCancelledAt) return [];

  const found: StaffException[] = [];

  // Past the cancellation window the client asked to stop. Nothing more is
  // sent (sendBlockReason), and a person confirms it with them.
  if (serviceEndPending(client)) {
    const why = client.serviceEndReason?.trim();
    found.push({
      key: "service_end_requested",
      kind: "service_end_requested",
      severity: "high",
      sentence: `Pidió terminar el servicio${why ? `: «${clip(why, 110)}»` : ""}. No se envía nada más hasta que alguien del equipo lo confirme con el cliente.`,
      actionLabel: "Confirmarle por WhatsApp",
      action: "whatsapp",
      since: client.serviceEndRequestedAt ?? null,
    });
  }

  // Money. A declined payment is the system's job while it is still retrying
  // (it shows as the next automatic step); it becomes a person's only when the
  // retries are used up. A charge that is due with no payment method on file
  // is a person's from the start. Nothing here asks anyone to charge by hand.
  const failed = unpaidCharge(client.billing);
  const outlook = clientBillingOutlook(client, now);
  if (failed && accountStanding(client.billing) === "past_due" && !serviceEndPending(client)) {
    const tries = failed.attempts === 1 ? "1 intento" : `${failed.attempts} intentos`;
    found.push({
      key: `payment_past_due:${failed.id}`,
      kind: "payment_past_due",
      severity: "high",
      sentence: `El cobro de la ronda ${failed.roundNumber} no pasó en ${tries} y el sistema ya no lo intenta. Su caso está en pausa hasta que actualice su método de pago; al pagar, sigue solo.`,
      actionLabel: "Escribirle sobre el pago",
      action: "whatsapp",
      since: failed.lastAttemptAt,
    });
  } else if (outlook.kind === "payment_method_missing") {
    const round = client.rounds.find((r) => r.number === outlook.roundNumber);
    found.push({
      key: `payment_method_missing:${outlook.roundNumber}`,
      kind: "payment_method_missing",
      severity: "high",
      sentence: `Falta su método de pago. La ronda ${outlook.roundNumber} se envió${round?.mailedAt ? ` el ${formatDay(new Date(round.mailedAt))}` : ""} y el sistema no tiene con qué cobrarla.`,
      actionLabel: "Pedirle su método de pago",
      action: "whatsapp",
      since: round?.mailedAt ?? null,
    });
  }

  if (client.signedUpAt && !client.agreementSignedAt) {
    const days = daysSince(client.signedUpAt, now);
    if (days > AGREEMENT_GRACE_DAYS) {
      found.push({
        key: "agreement_unsigned",
        kind: "agreement_unsigned",
        severity: "low",
        sentence: `No ha firmado el acuerdo de servicio. Creó su cuenta hace ${daysPhrase(days)}.`,
        actionLabel: "Recordarle el acuerdo",
        action: "whatsapp",
        since: client.signedUpAt,
      });
    }
  }

  const missing = missingDocuments(client);
  if (client.agreementSignedAt && missing.length > 0) {
    const days = daysSince(client.agreementSignedAt, now);
    if (days > DOCUMENTS_GRACE_DAYS) {
      found.push({
        key: "documents_missing",
        kind: "documents_missing",
        severity: "medium",
        sentence: `Falta su ${documentNames(missing)}. Firmó el acuerdo hace ${daysPhrase(days)}.`,
        actionLabel: "Pedirle los documentos",
        action: "whatsapp",
        since: client.agreementSignedAt,
      });
    }
  }

  const overdueRound = responseOverdue(client, now);
  const firstRoundNotBuilt = !client.rounds.some((r) => r.status !== "draft");

  if (client.report) {
    const reportAge = daysSince(client.report.pulledAt, now);
    const review = reviewProgress(client);

    if (firstRoundNotBuilt && review.pending > 0 && reportAge > REVIEW_STALLED_DAYS) {
      found.push({
        key: "review_stalled",
        kind: "review_stalled",
        severity: "medium",
        sentence: `No ha terminado su revisión: le faltan ${review.pending} de ${review.total} puntos. Su reporte llegó hace ${daysPhrase(reportAge)}.`,
        actionLabel: "Recordarle su revisión",
        action: "whatsapp",
        since: client.report.pulledAt,
      });
    }

    // While letters are out, the response window decides when a new report is
    // due, so an old report is only a problem before sending or after answers.
    if (reportAge > FRESH_REPORT_DAYS && latestRound(client)?.status !== "mailed") {
      found.push({
        key: "report_stale",
        kind: "report_stale",
        severity: "medium",
        sentence: `Su reporte tiene ${daysPhrase(reportAge)} y no se actualizó solo. Puede que su monitoreo esté inactivo.`,
        actionLabel: "Pedirle que revise su monitoreo",
        action: "whatsapp",
        since: addDays(client.report.pulledAt, FRESH_REPORT_DAYS).toISOString(),
      });
    }
  }

  const theft = identityTheftItemsWithoutReport(client);
  if (theft.length > 0) {
    const names = [...new Set(theft.map((t) => t.label))];
    const which = names.length <= 2 ? ` (${clip(names.join(" y "), 90)})` : "";
    found.push({
      key: "identity_theft_report_missing",
      kind: "identity_theft_report_missing",
      severity: "high",
      sentence: `Dijo que ${theft.length === 1 ? "1 punto es" : `${theft.length} puntos son`} resultado de robo de identidad${which} y no hay un reporte de robo de identidad de la FTC en archivo. La app le avisó que una persona del equipo lo contactaría.`,
      actionLabel: "Pedirle el reporte de robo de identidad",
      action: "whatsapp",
      since: theft.map((t) => t.confirmedAt).sort()[0] ?? null,
    });
  }

  for (const round of client.rounds) {
    for (const letter of round.letters) {
      if (letter.mailStatus !== "returned" && letter.mailStatus !== "undeliverable") continue;
      // Settled by the system: sent again to the corrected address (once; the re-mail is tracked as its own letter).
      if (letterRemailed(round, letter.id)) continue;
      // Waiting on the client: they were asked to confirm their address because of this letter.
      if (openAddressCheck(client)?.letterId === letter.id) continue;
      found.push({
        key: `letter_returned:${letter.id}`,
        kind: "letter_returned",
        severity: "high",
        sentence:
          (letter.mailStatus === "returned"
            ? `El correo devolvió la carta para ${letter.recipient.name} de la ronda ${round.number}.`
            : `El correo no pudo entregar la carta para ${letter.recipient.name} de la ronda ${round.number}.`) +
          (letter.mail?.returnReason ? ` Motivo: ${returnReasonEs(letter.mail.returnReason)}.` : ""),
        actionLabel: "Revisar la carta",
        action: "open_client",
        since: letter.mail?.returnedAt ?? round.mailedAt,
      });
    }
  }

  // A prepared round with a letter to a creditor or collector whose dispute
  // address is not in the book (or not checked): it cannot go until a person
  // adds it. The button opens the address book with the company filled in.
  const pending = latestRound(client);
  if (context.furnishers && pending && pending.status === "ready") {
    for (const gap of missingFurnisherAddresses(pending, context.furnishers)) {
      found.push({
        key: `furnisher_address_missing:${gap.company}`,
        kind: "furnisher_address_missing",
        severity: "high",
        sentence: `La ronda ${pending.number} tiene una carta para ${gap.company} y falta su dirección verificada para disputas. La ronda no se envía hasta tenerla.`,
        actionLabel: "Agregar la dirección",
        action: "open_client",
        since: null,
        href: addressBookHref(gap.company, gap.entryId),
      });
    }
  }

  for (const question of client.questions) {
    if (question.answeredAt) continue;
    const days = Math.max(0, daysSince(question.askedAt, now));
    const waiting = days === 0 ? "Espera desde hoy." : `Espera desde hace ${daysPhrase(days)}.`;
    found.push({
      key: `question:${question.id}`,
      kind: "question_waiting",
      severity: "high",
      sentence: `Hizo una pregunta que ${BRAND.assistant} pasó al equipo: «${clip(question.text, 110)}» ${waiting}`,
      actionLabel: "Responderle por WhatsApp",
      action: "whatsapp",
      since: question.askedAt,
    });
  }

  if (overdueRound?.mailedAt) {
    const days = daysSince(overdueRound.mailedAt, now);
    found.push({
      key: `response_overdue:${overdueRound.number}`,
      kind: "response_overdue",
      severity: "medium",
      sentence: `La ronda ${overdueRound.number} se envió hace ${daysPhrase(days)} y no ha llegado un reporte nuevo. Sin él no se sabe qué respondieron los burós.`,
      actionLabel: "Pedirle que revise su monitoreo",
      action: "whatsapp",
      since: addDays(overdueRound.mailedAt, RESPONSE_WINDOW_DAYS).toISOString(),
    });
  }

  found.push(...intakeExceptions(client.intake, client.id));

  // The post office's data could not confirm the client's own address (the
  // check before mailing, or a letter that came back). The client was asked
  // to confirm it with one tap; the automatic follow-ups carry it, and it is a
  // person's only when they do not answer, or when it fails a second time.
  const addressCheck = openAddressCheck(client);
  if (addressCheck) {
    const what = addressCheck.finding === "ambiguous" ? "parece que falta o sobra el número de departamento" : "el correo no entrega en esa dirección";
    const again = addressCheck.requests > 1 ? " Es la segunda vez: la dirección que confirmó tampoco pasó." : "";
    found.push({
      key: `client_address_unconfirmed:${addressCheck.id}`,
      kind: "client_address_unconfirmed",
      severity: "high",
      sentence: `El correo no pudo confirmar su dirección (${what}): ${clip(addressCheck.inputLines.join(", "), 90)}. Sus cartas esperan a que la confirme.${again}`,
      actionLabel: "Revisar su dirección",
      action: "open_client",
      since: addressCheck.requestedAt,
      href: `/equipo/clientes/${client.id}#cartas`,
    });
  }

  return found.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return (a.since ?? "").localeCompare(b.since ?? "");
  });
}

/** True while a handled mark still keeps this exception off the list. */
function isQuiet(client: StaffClient, key: string, now: Date): boolean {
  const handledAt = client.handled[key];
  return handledAt !== undefined && daysSince(handledAt, now) < HANDLED_QUIET_DAYS;
}

/**
 * What needs a person for this client, most serious first. Empty when nothing
 * does. An exception someone marked as handled stays out for
 * HANDLED_QUIET_DAYS and returns if the situation is still the same.
 */
export function clientExceptions(client: StaffClient, now: Date, context: StaffContext = {}): StaffException[] {
  return openExceptions(client, now, context).filter((e) => !isQuiet(client, e.key, now));
}

export interface HandledException extends StaffException {
  handledAt: string;
  /** The day it returns to the list if the situation is still the same (ISO). */
  returnsAt: string;
}

/** Exceptions that still apply but that someone marked as handled, and are quiet for now. */
export function handledExceptions(client: StaffClient, now: Date, context: StaffContext = {}): HandledException[] {
  return openExceptions(client, now, context)
    .filter((e) => isQuiet(client, e.key, now))
    .map((e) => {
      const handledAt = client.handled[e.key]!;
      return { ...e, handledAt, returnsAt: addDays(handledAt, HANDLED_QUIET_DAYS).toISOString() };
    });
}

// ── What happens next ───────────────────────────────────────────────────

export interface AutomaticStep {
  /** For example "Re-importar el reporte el 28 de diciembre". */
  text: string;
  /** When the system will do it (ISO). */
  at: string;
}

/**
 * What the system will do next for this client, and when. Null when the next
 * move belongs to a person (the client or the team).
 */
export function nextAutomaticStep(client: StaffClient, now: Date): AutomaticStep | null {
  // The client asked to stop: the system does nothing more on its own.
  if (serviceEndPending(client)) return null;

  // Whichever comes first: the next step of the work, or the next step of billing.
  const work = nextWorkStep(client, now);
  const money = nextBillingStep(client, now);
  if (work && money) return new Date(money.at).getTime() < new Date(work.at).getTime() ? money : work;
  return work ?? money;
}

/**
 * The next thing billing does by itself: charge a mailed round, or try a
 * declined charge again. Null when billing is waiting on a person or has
 * nothing to do.
 */
export function nextBillingStep(client: StaffClient, now: Date): AutomaticStep | null {
  if (client.agreementCancelledAt) return null;
  const outlook = clientBillingOutlook(client, now);
  if (!outlook.at || outlook.roundNumber === null) return null;
  const at = new Date(outlook.at);
  if (outlook.kind === "retry_scheduled") {
    return { text: `Reintentar el cobro de la ronda ${outlook.roundNumber} ${onDay(at, now)}`, at: outlook.at };
  }
  // A charge with no payment method on file is announced only once it is due, as an exception.
  if (outlook.kind === "charge_scheduled" && client.billing.paymentMethod) {
    return { text: `Cobrar la ronda ${outlook.roundNumber} ${onDay(at, now)}`, at: outlook.at };
  }
  return null;
}

function nextWorkStep(client: StaffClient, now: Date): AutomaticStep | null {
  const stage = clientStage(client, now);

  if (stage === "cancellation_window") {
    // Nobody acts: the system waits out the cancellation period, then work may begin.
    const starts = workStartsAt(client, now);
    return starts ? { text: `Empezar el ${formatDay(starts)}`, at: starts.toISOString() } : null;
  }

  if (stage === "waiting_on_bureaus") {
    const round = latestRound(client);
    if (!round?.mailedAt || responseOverdue(client, now)) return null;
    const due = addDays(responseWindowStart(round) ?? round.mailedAt, RESPONSE_WINDOW_DAYS);
    return { text: `Re-importar el reporte ${onDay(due, now)}`, at: due.toISOString() };
  }

  if (stage === "results_in") {
    const mailed = lastMailedRound(client);
    if (!mailed?.mailedAt) return null;
    const cycleEnd = addDays(mailed.mailedAt, ROUND_CYCLE_DAYS);
    const due = cycleEnd.getTime() > now.getTime() ? cycleEnd : now;
    return { text: `Preparar las cartas de la ronda ${mailed.number + 1} ${onDay(due, now)}`, at: due.toISOString() };
  }

  if (stage === "ready_to_send" && latestRound(client)?.status !== "ready") {
    // The review just finished and the letters are still being written.
    return { text: "Preparar las cartas de la ronda 1 hoy", at: now.toISOString() };
  }

  return null;
}

export interface NextStep {
  actor: Actor;
  text: string;
  /** Set when the system has a date for it. */
  at: string | null;
}

/** The next move in a few words, whoever makes it: for lists and the client header. */
export function nextStep(client: StaffClient, now: Date): NextStep {
  const automatic = nextAutomaticStep(client, now);
  if (automatic) return { actor: "system", text: automatic.text, at: automatic.at };

  const stage = clientStage(client, now);
  const person = (actor: Actor, text: string): NextStep => ({ actor, text, at: null });

  if (serviceEndPending(client)) return person("staff", "Confirmar con el cliente que termina el servicio");

  switch (stage) {
    case "lead":
      return person("sales", "Seguir la conversación y enviarle su enlace");
    case "agreement_pending":
      return person("client", "Firmar el acuerdo de servicio");
    case "cancellation_window":
      return person("system", "Esperar a que termine su periodo de cancelación");
    case "cancelled":
      return person("staff", "Canceló su acuerdo: nada pendiente");
    case "documents_pending":
      return person("client", `Subir su ${documentNames(missingDocuments(client))}`);
    case "report_pending":
      return person("client", "Activar su monitoreo de crédito");
    case "client_review_pending": {
      const review = reviewProgress(client);
      return person("client", `Terminar su revisión (faltan ${review.pending} de ${review.total})`);
    }
    case "ready_to_send":
    case "next_round_ready": {
      const round = latestRound(client);
      if (sendBlockReason(client, now)) return person("client", "Actualizar su reporte antes de enviar");
      return person("staff", `Enviar la ronda ${round?.number ?? 1}`);
    }
    case "waiting_on_bureaus":
      return person("client", "Revisar su monitoreo: falta el reporte nuevo");
    case "results_in":
      return person("staff", "Revisar el caso");
    case "paused":
      if (pausedForPayment(client)) return person("client", "Actualizar su método de pago");
      return person("staff", "Nada marcado como inexacto: nada que enviar");
  }
}

// ── Sending ─────────────────────────────────────────────────────────────

/**
 * Why a prepared round must not be mailed yet, or null when it may. Letters go
 * out only under an agreement that allows work to start, and on a current
 * report only; a handled mark does not lift this.
 */
export function sendBlockReason(client: StaffClient, now: Date, context: StaffContext = {}): string | null {
  // The agreement comes before everything else: no signature, a cancellation,
  // the cancellation window or a request to stop each hold every letter.
  const gate = agreementGate(client, now);
  if (!gate.allowed) {
    if (gate.code === "in_cancellation_window") {
      const starts = workStartsAt(client, now);
      return `El cliente está en su periodo de cancelación de 3 días hábiles y la ley no permite empezar antes.${
        starts ? ` Se puede enviar a partir del ${formatDay(starts)}.` : ""
      }`;
    }
    if (gate.code === "cancelled") return "El cliente canceló su acuerdo. Sus cartas no se envían.";
    return gate.reason.es;
  }
  const stale = openExceptions(client, now).find((e) => e.kind === "report_stale");
  if (stale) {
    return `El reporte tiene más de ${FRESH_REPORT_DAYS} días. Hace falta uno reciente antes de enviar cartas.`;
  }
  // A letter that says "this is identity theft" must not go out until the
  // client's identity theft report is on file to back it and to enclose.
  const identityTheft = openExceptions(client, now).find((e) => e.kind === "identity_theft_report_missing");
  if (identityTheft) {
    return "El cliente indicó robo de identidad y falta su reporte de robo de identidad (FTC). No se envían cartas hasta tenerlo en archivo.";
  }
  // Never to a guessed address: a creditor or collector letter needs a checked one.
  const round = latestRound(client);
  if (context.furnishers && round?.status === "ready") {
    const gaps = missingFurnisherAddresses(round, context.furnishers);
    if (gaps.length > 0) {
      return `Falta la dirección verificada para disputas de ${listEs(gaps.map((g) => g.company))}. Agrégala en Acreedores y la ronda queda lista.`;
    }
  }
  // Added with the address verification (migration 0022): the client's own address waits for their confirmation.
  if (openAddressCheck(client)) {
    return "El correo no pudo confirmar la dirección del cliente. Se le pidió confirmarla; la ronda sale cuando la confirme.";
  }
  return null;
}

/** The round that can be mailed now, or null. This is what "Listas para enviar" lists. */
export function sendableRound(client: StaffClient, now: Date, context: StaffContext = {}): StaffRound | null {
  const stage = clientStage(client, now);
  if (stage !== "ready_to_send" && stage !== "next_round_ready") return null;
  const round = latestRound(client);
  if (!round || round.status !== "ready" || round.letters.length === 0) return null;
  return sendBlockReason(client, now, context) ? null : round;
}

/** Distinct report items a round's letters cover. */
export function roundItemCount(round: StaffRound): number {
  return new Set(round.letters.flatMap((l) => l.items.map((i) => i.fingerprint))).size;
}

/** "Dirección: 123 Old Street…, Capital One" — what a letter is about, in the report's own words. */
export function letterCovers(letter: StaffLetter): string {
  return letter.items.map((item) => itemLabel(item, "es")).join(" · ");
}
