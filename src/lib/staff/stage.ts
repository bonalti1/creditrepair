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
import { responseWindowStart, returnReason } from "../mail/tracking";
import { billingContextFor } from "./billing";
import { intakeExceptions } from "../intake/exceptions";
import { REQUIRED_DOCUMENTS, type DocumentKind, type StaffClient, type StaffLetter, type StaffRound } from "./types";
import { dateLocale, listJoin, type StaffLocale, staffLocaleFallback } from "./i18n/locale";

// Where is this client, what is wrong, and what happens next.
//
// Three pure functions answer those questions from the client record and the
// current time. The console is built on them: the home screen lists
// clientExceptions, the pipeline counts clientStage, and every "next step"
// line is nextAutomaticStep or, when that is null, the person being waited on.
//
// Day counts follow the rule already used for monitoring (subscription.ts):
// whole days elapsed, and "more than N days" means N + 1 whole days or more.
//
// Every sentence here is for the team, in the console's language (i18n/
// locale.ts): English unless the member chose Spanish. The Spanish is exactly
// what the console always said.

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

/** "28 de diciembre" / "December 28", on the team's calendar. Spanish unless told otherwise (client messages use it too). */
export function formatDay(date: Date, locale: StaffLocale = "es"): string {
  return date.toLocaleDateString(dateLocale(locale), { day: "numeric", month: "long", timeZone: STAFF_TIME_ZONE });
}

function calendarDay(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: STAFF_TIME_ZONE });
}

/** "hoy"/"today" for today or an overdue date, otherwise "el 28 de diciembre"/"on December 28". */
function onDay(date: Date, now: Date, locale: StaffLocale): string {
  const today = date.getTime() <= now.getTime() || calendarDay(date) === calendarDay(now);
  if (locale === "es") return today ? "hoy" : `el ${formatDay(date, "es")}`;
  return today ? "today" : `on ${formatDay(date, "en")}`;
}

function daysPhrase(days: number, locale: StaffLocale): string {
  if (locale === "es") return days === 1 ? "1 día" : `${days} días`;
  return days === 1 ? "1 day" : `${days} days`;
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

export const ACTOR_LABELS: Record<StaffLocale, Record<Actor, string>> = {
  en: { system: "The system", client: "The client", staff: "The team", sales: "Sales" },
  es: { system: "El sistema", client: "El cliente", staff: "El equipo", sales: "Ventas" },
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

const STAGES_ES: Record<Stage, StageInfo> = {
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

const STAGES_EN: Record<Stage, StageInfo> = {
  lead: {
    label: "Lead",
    short: "Leads",
    description: "Hasn't created an account yet. Sales keeps the WhatsApp conversation going and sends their invite link.",
    actor: "sales",
  },
  agreement_pending: {
    label: "Agreement not signed",
    short: "Agreement",
    description: "The client needs to sign the service agreement. Nothing moves until then.",
    actor: "client",
  },
  cancellation_window: {
    label: "In cancellation period",
    short: "Cancellation",
    description:
      "Signed the agreement and is in their 3 business days to cancel at no cost. The law doesn't allow any work before then. Nobody needs to do anything: the system flags the day work can start.",
    actor: "system",
  },
  documents_pending: {
    label: "Documents missing",
    short: "Documents",
    description: "The client needs to upload their ID and proof of address. They go inside every letter.",
    actor: "client",
  },
  report_pending: {
    label: "Report missing",
    short: "Report",
    description: "The client turns on their credit monitoring. The system imports the report as soon as it has access.",
    actor: "client",
  },
  client_review_pending: {
    label: "Client reviewing",
    short: "Review",
    description: `The client goes through their report with ${BRAND.assistant} and says what's inaccurate. Only the client can answer.`,
    actor: "client",
  },
  ready_to_send: {
    label: "Ready to send",
    short: "To send",
    description: "The client finished their review and the first round of letters is ready. The team sends it.",
    actor: "staff",
  },
  waiting_on_bureaus: {
    label: "Waiting on the bureaus",
    short: "With bureaus",
    description: `The letters are on their way. The bureaus have ${RESPONSE_WINDOW_DAYS} days to answer, and the system pulls the report again on its own.`,
    actor: "system",
  },
  results_in: {
    label: "Answers are in",
    short: "Answers",
    description: "The new report is in. The system compares it with the last one and prepares the next round.",
    actor: "system",
  },
  next_round_ready: {
    label: "Next round ready",
    short: "Next round",
    description: "The next round of letters is ready. The team sends it.",
    actor: "staff",
  },
  paused: {
    label: "Paused",
    short: "Paused",
    description:
      "No work in progress: a charge didn't go through after the retries, or the client didn't mark anything as inaccurate. With an unpaid charge, no round is prepared or sent; once the client pays, the case moves on by itself.",
    actor: "client",
  },
  cancelled: {
    label: "Cancelled their agreement",
    short: "Cancelled",
    description: "The client cancelled their agreement. No work is done, no letter is sent and they aren't charged. Their record is kept.",
    actor: "staff",
  },
};

/** Each stage's chip, short name and one-line meaning, in each language. */
export const STAGE_TEXT: Record<StaffLocale, Record<Stage, StageInfo>> = { en: STAGES_EN, es: STAGES_ES };

/** One stage, in the console's language. */
export function stageInfo(stage: Stage, locale: StaffLocale): StageInfo {
  return STAGE_TEXT[locale][stage];
}

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
 * "In cancellation period — work can start December 1" /
 * "En periodo de cancelación — se puede empezar el 25 de noviembre".
 */
export function agreementLine(client: StaffClient, now: Date, locale: StaffLocale = staffLocaleFallback()): string {
  const es = locale === "es";
  const day = (iso: string | Date) => formatDay(new Date(iso), locale);
  if (!client.agreementSignedAt) {
    if (clientAgreement(client).disclosureAcknowledgedAt) {
      return es ? "Recibió la declaración de sus derechos; falta que firme el contrato" : "Received the statement of their rights; hasn't signed the contract yet";
    }
    return es ? "Sin firmar" : "Not signed";
  }
  if (client.agreementCancelledAt) {
    if (es) {
      return client.cancelledWithinWindow === false
        ? `Cancelado el ${day(client.agreementCancelledAt)}, después del plazo`
        : `Cancelado el ${day(client.agreementCancelledAt)}, dentro del plazo`;
    }
    return client.cancelledWithinWindow === false
      ? `Cancelled ${day(client.agreementCancelledAt)}, after the deadline`
      : `Cancelled ${day(client.agreementCancelledAt)}, within the deadline`;
  }
  const starts = workStartsAt(client, now);
  if (starts) return es ? `En periodo de cancelación — se puede empezar el ${day(starts)}` : `In cancellation period — work can start ${day(starts)}`;
  if (serviceEndPending(client)) {
    return es
      ? `Vigente — pidió terminar el servicio el ${day(client.serviceEndRequestedAt!)}`
      : `In effect — asked to end the service on ${day(client.serviceEndRequestedAt!)}`;
  }
  return es ? "Vigente — el periodo de cancelación ya terminó" : "In effect — the cancellation period is over";
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

const EXCEPTION_LABEL_ES: Record<ExceptionKind, string> = {
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

const EXCEPTION_LABEL_EN: Record<ExceptionKind, string> = {
  review_stalled: "Review stalled",
  documents_missing: "Documents missing",
  report_stale: "Report out of date",
  payment_past_due: "Unpaid charge",
  payment_method_missing: "No payment method",
  letter_returned: "Letter returned",
  question_waiting: "Unanswered question",
  response_overdue: "No new report",
  agreement_unsigned: "Agreement not signed",
  identity_theft_report_missing: "Identity theft, no report",
  service_end_requested: "Asked to end service",
  furnisher_address_missing: "Creditor address missing",
  document_check_needs_person: "Document to review",
  bureau_letter_needs_person: "Bureau letter to review",
  client_address_unconfirmed: "Client address unconfirmed",
};

/** Each kind of notice's short name, in each language. */
export const EXCEPTION_LABELS: Record<StaffLocale, Record<ExceptionKind, string>> = { en: EXCEPTION_LABEL_EN, es: EXCEPTION_LABEL_ES };

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
  /** The language sentences are written in (the console's). English when left out. */
  locale?: StaffLocale;
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

export const DOCUMENT_NAMES: Record<StaffLocale, Record<DocumentKind, string>> = {
  es: {
    government_id: "identificación",
    proof_of_address: "comprobante de domicilio",
    ssn_card: "tarjeta de Seguro Social",
    identity_theft_report: "reporte de robo de identidad",
  },
  en: {
    government_id: "ID",
    proof_of_address: "proof of address",
    ssn_card: "Social Security card",
    identity_theft_report: "identity theft report",
  },
};

/** "identificación y comprobante de domicilio" / "ID and proof of address". Spanish unless told otherwise (client messages use it too). */
export function documentNames(kinds: DocumentKind[], locale: StaffLocale = "es"): string {
  return listJoin(
    kinds.map((k) => DOCUMENT_NAMES[locale][k]),
    locale,
  );
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
export function identityTheftItemsWithoutReport(client: StaffClient, locale: StaffLocale = staffLocaleFallback()): Array<{ label: string; confirmedAt: string }> {
  if (!client.report || client.documents.includes("identity_theft_report")) return [];
  return client.report.items.flatMap((item) => {
    const answer = client.answers[item.fingerprint];
    return answer?.status === "inaccurate" && answer.reasonCode === "identity_theft"
      ? [{ label: itemLabel(item, locale), confirmedAt: answer.confirmedAt }]
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

  const locale = context.locale ?? staffLocaleFallback();
  const es = locale === "es";
  const L = (spanish: string, english: string) => (es ? spanish : english);
  const day = (iso: string | Date) => formatDay(new Date(iso), locale);
  const found: StaffException[] = [];

  // Past the cancellation window the client asked to stop. Nothing more is
  // sent (sendBlockReason), and a person confirms it with them.
  if (serviceEndPending(client)) {
    const why = client.serviceEndReason?.trim();
    found.push({
      key: "service_end_requested",
      kind: "service_end_requested",
      severity: "high",
      sentence: L(
        `Pidió terminar el servicio${why ? `: «${clip(why, 110)}»` : ""}. No se envía nada más hasta que alguien del equipo lo confirme con el cliente.`,
        `Asked to end the service${why ? `: “${clip(why, 110)}”` : ""}. Nothing else goes out until someone on the team confirms it with the client.`,
      ),
      actionLabel: L("Confirmarle por WhatsApp", "Confirm on WhatsApp"),
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
    const tries = es ? (failed.attempts === 1 ? "1 intento" : `${failed.attempts} intentos`) : failed.attempts === 1 ? "1 try" : `${failed.attempts} tries`;
    found.push({
      key: `payment_past_due:${failed.id}`,
      kind: "payment_past_due",
      severity: "high",
      sentence: L(
        `El cobro de la ronda ${failed.roundNumber} no pasó en ${tries} y el sistema ya no lo intenta. Su caso está en pausa hasta que actualice su método de pago; al pagar, sigue solo.`,
        `The charge for round ${failed.roundNumber} failed after ${tries} and the system has stopped trying. The case is paused until they update their payment method; once they pay, it moves on by itself.`,
      ),
      actionLabel: L("Escribirle sobre el pago", "Message them about the payment"),
      action: "whatsapp",
      since: failed.lastAttemptAt,
    });
  } else if (outlook.kind === "payment_method_missing") {
    const round = client.rounds.find((r) => r.number === outlook.roundNumber);
    found.push({
      key: `payment_method_missing:${outlook.roundNumber}`,
      kind: "payment_method_missing",
      severity: "high",
      sentence: L(
        `Falta su método de pago. La ronda ${outlook.roundNumber} se envió${round?.mailedAt ? ` el ${day(round.mailedAt)}` : ""} y el sistema no tiene con qué cobrarla.`,
        `No payment method on file. Round ${outlook.roundNumber} went out${round?.mailedAt ? ` on ${day(round.mailedAt)}` : ""} and the system has nothing to charge it to.`,
      ),
      actionLabel: L("Pedirle su método de pago", "Ask for their payment method"),
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
        sentence: L(
          `No ha firmado el acuerdo de servicio. Creó su cuenta hace ${daysPhrase(days, "es")}.`,
          `Hasn't signed the service agreement. Created their account ${daysPhrase(days, "en")} ago.`,
        ),
        actionLabel: L("Recordarle el acuerdo", "Remind them about the agreement"),
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
        sentence: L(
          `Falta su ${documentNames(missing, "es")}. Firmó el acuerdo hace ${daysPhrase(days, "es")}.`,
          `Their ${documentNames(missing, "en")} ${missing.length === 1 ? "is" : "are"} missing. Signed the agreement ${daysPhrase(days, "en")} ago.`,
        ),
        actionLabel: L("Pedirle los documentos", "Ask for the documents"),
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
        sentence: L(
          `No ha terminado su revisión: le faltan ${review.pending} de ${review.total} puntos. Su reporte llegó hace ${daysPhrase(reportAge, "es")}.`,
          `Hasn't finished their review: ${review.pending} of ${review.total} items left. Their report came in ${daysPhrase(reportAge, "en")} ago.`,
        ),
        actionLabel: L("Recordarle su revisión", "Remind them about their review"),
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
        sentence: L(
          `Su reporte tiene ${daysPhrase(reportAge, "es")} y no se actualizó solo. Puede que su monitoreo esté inactivo.`,
          `Their report is ${daysPhrase(reportAge, "en")} old and didn't refresh on its own. Their monitoring may be inactive.`,
        ),
        actionLabel: L("Pedirle que revise su monitoreo", "Ask them to check their monitoring"),
        action: "whatsapp",
        since: addDays(client.report.pulledAt, FRESH_REPORT_DAYS).toISOString(),
      });
    }
  }

  const theft = identityTheftItemsWithoutReport(client, locale);
  if (theft.length > 0) {
    const names = [...new Set(theft.map((t) => t.label))];
    const which = names.length <= 2 ? ` (${clip(names.join(es ? " y " : " and "), 90)})` : "";
    found.push({
      key: "identity_theft_report_missing",
      kind: "identity_theft_report_missing",
      severity: "high",
      sentence: L(
        `Dijo que ${theft.length === 1 ? "1 punto es" : `${theft.length} puntos son`} resultado de robo de identidad${which} y no hay un reporte de robo de identidad de la FTC en archivo. La app le avisó que una persona del equipo lo contactaría.`,
        `Said ${theft.length === 1 ? "1 item is" : `${theft.length} items are`} the result of identity theft${which} and there's no FTC identity theft report on file. The app told them someone on the team would reach out.`,
      ),
      actionLabel: L("Pedirle el reporte de robo de identidad", "Ask for the identity theft report"),
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
        sentence: es
          ? (letter.mailStatus === "returned"
              ? `El correo devolvió la carta para ${letter.recipient.name} de la ronda ${round.number}.`
              : `El correo no pudo entregar la carta para ${letter.recipient.name} de la ronda ${round.number}.`) +
            (letter.mail?.returnReason ? ` Motivo: ${returnReason(letter.mail.returnReason, "es")}.` : "")
          : (letter.mailStatus === "returned"
              ? `The post office returned the round ${round.number} letter to ${letter.recipient.name}.`
              : `The post office couldn't deliver the round ${round.number} letter to ${letter.recipient.name}.`) +
            (letter.mail?.returnReason ? ` Reason: ${returnReason(letter.mail.returnReason, "en")}.` : ""),
        actionLabel: L("Revisar la carta", "Check the letter"),
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
        sentence: L(
          `La ronda ${pending.number} tiene una carta para ${gap.company} y falta su dirección verificada para disputas. La ronda no se envía hasta tenerla.`,
          `Round ${pending.number} has a letter to ${gap.company}, and its verified dispute address is missing. The round can't go out until it's added.`,
        ),
        actionLabel: L("Agregar la dirección", "Add the address"),
        action: "open_client",
        since: null,
        href: addressBookHref(gap.company, gap.entryId),
      });
    }
  }

  for (const question of client.questions) {
    if (question.answeredAt) continue;
    const days = Math.max(0, daysSince(question.askedAt, now));
    const waiting = es
      ? days === 0
        ? "Espera desde hoy."
        : `Espera desde hace ${daysPhrase(days, "es")}.`
      : days === 0
        ? "Waiting since today."
        : `Waiting for ${daysPhrase(days, "en")}.`;
    found.push({
      key: `question:${question.id}`,
      kind: "question_waiting",
      severity: "high",
      sentence: L(
        `Hizo una pregunta que ${BRAND.assistant} pasó al equipo: «${clip(question.text, 110)}» ${waiting}`,
        `Asked a question ${BRAND.assistant} passed to the team: “${clip(question.text, 110)}” ${waiting}`,
      ),
      actionLabel: L("Responderle por WhatsApp", "Reply on WhatsApp"),
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
      sentence: L(
        `La ronda ${overdueRound.number} se envió hace ${daysPhrase(days, "es")} y no ha llegado un reporte nuevo. Sin él no se sabe qué respondieron los burós.`,
        `Round ${overdueRound.number} went out ${daysPhrase(days, "en")} ago and no new report has come in. Without it, we can't tell what the bureaus answered.`,
      ),
      actionLabel: L("Pedirle que revise su monitoreo", "Ask them to check their monitoring"),
      action: "whatsapp",
      since: addDays(overdueRound.mailedAt, RESPONSE_WINDOW_DAYS).toISOString(),
    });
  }

  found.push(...intakeExceptions(client.intake, client.id, locale));

  // The post office's data could not confirm the client's own address (the
  // check before mailing, or a letter that came back). The client was asked
  // to confirm it with one tap; the automatic follow-ups carry it, and it is a
  // person's only when they do not answer, or when it fails a second time.
  const addressCheck = openAddressCheck(client);
  if (addressCheck) {
    const what =
      addressCheck.finding === "ambiguous"
        ? L("parece que falta o sobra el número de departamento", "the apartment number seems to be missing or extra")
        : L("el correo no entrega en esa dirección", "the post office doesn't deliver to that address");
    const again = addressCheck.requests > 1 ? L(" Es la segunda vez: la dirección que confirmó tampoco pasó.", " This is the second time: the address they confirmed didn't pass either.") : "";
    found.push({
      key: `client_address_unconfirmed:${addressCheck.id}`,
      kind: "client_address_unconfirmed",
      severity: "high",
      sentence: L(
        `El correo no pudo confirmar su dirección (${what}): ${clip(addressCheck.inputLines.join(", "), 90)}. Sus cartas esperan a que la confirme.${again}`,
        `The post office couldn't confirm their address (${what}): ${clip(addressCheck.inputLines.join(", "), 90)}. Their letters wait until they confirm it.${again}`,
      ),
      actionLabel: L("Revisar su dirección", "Check their address"),
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
  /** For example "Pull the report again on December 28" / "Re-importar el reporte el 28 de diciembre". */
  text: string;
  /** When the system will do it (ISO). */
  at: string;
}

/**
 * What the system will do next for this client, and when. Null when the next
 * move belongs to a person (the client or the team).
 */
export function nextAutomaticStep(client: StaffClient, now: Date, locale: StaffLocale = staffLocaleFallback()): AutomaticStep | null {
  // The client asked to stop: the system does nothing more on its own.
  if (serviceEndPending(client)) return null;

  // Whichever comes first: the next step of the work, or the next step of billing.
  const work = nextWorkStep(client, now, locale);
  const money = nextBillingStep(client, now, locale);
  if (work && money) return new Date(money.at).getTime() < new Date(work.at).getTime() ? money : work;
  return work ?? money;
}

/**
 * The next thing billing does by itself: charge a mailed round, or try a
 * declined charge again. Null when billing is waiting on a person or has
 * nothing to do.
 */
export function nextBillingStep(client: StaffClient, now: Date, locale: StaffLocale = staffLocaleFallback()): AutomaticStep | null {
  if (client.agreementCancelledAt) return null;
  const outlook = clientBillingOutlook(client, now);
  if (!outlook.at || outlook.roundNumber === null) return null;
  const at = new Date(outlook.at);
  const when = onDay(at, now, locale);
  if (outlook.kind === "retry_scheduled") {
    const text = locale === "es" ? `Reintentar el cobro de la ronda ${outlook.roundNumber} ${when}` : `Retry the round ${outlook.roundNumber} charge ${when}`;
    return { text, at: outlook.at };
  }
  // A charge with no payment method on file is announced only once it is due, as an exception.
  if (outlook.kind === "charge_scheduled" && client.billing.paymentMethod) {
    const text = locale === "es" ? `Cobrar la ronda ${outlook.roundNumber} ${when}` : `Charge for round ${outlook.roundNumber} ${when}`;
    return { text, at: outlook.at };
  }
  return null;
}

function nextWorkStep(client: StaffClient, now: Date, locale: StaffLocale): AutomaticStep | null {
  const stage = clientStage(client, now);
  const es = locale === "es";

  if (stage === "cancellation_window") {
    // Nobody acts: the system waits out the cancellation period, then work may begin.
    const starts = workStartsAt(client, now);
    if (!starts) return null;
    return { text: es ? `Empezar el ${formatDay(starts, "es")}` : `Start on ${formatDay(starts, "en")}`, at: starts.toISOString() };
  }

  if (stage === "waiting_on_bureaus") {
    const round = latestRound(client);
    if (!round?.mailedAt || responseOverdue(client, now)) return null;
    const due = addDays(responseWindowStart(round) ?? round.mailedAt, RESPONSE_WINDOW_DAYS);
    const when = onDay(due, now, locale);
    return { text: es ? `Re-importar el reporte ${when}` : `Pull the report again ${when}`, at: due.toISOString() };
  }

  if (stage === "results_in") {
    const mailed = lastMailedRound(client);
    if (!mailed?.mailedAt) return null;
    const cycleEnd = addDays(mailed.mailedAt, ROUND_CYCLE_DAYS);
    const due = cycleEnd.getTime() > now.getTime() ? cycleEnd : now;
    const when = onDay(due, now, locale);
    return {
      text: es ? `Preparar las cartas de la ronda ${mailed.number + 1} ${when}` : `Prepare the round ${mailed.number + 1} letters ${when}`,
      at: due.toISOString(),
    };
  }

  if (stage === "ready_to_send" && latestRound(client)?.status !== "ready") {
    // The review just finished and the letters are still being written.
    return { text: es ? "Preparar las cartas de la ronda 1 hoy" : "Prepare the round 1 letters today", at: now.toISOString() };
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
export function nextStep(client: StaffClient, now: Date, locale: StaffLocale = staffLocaleFallback()): NextStep {
  const automatic = nextAutomaticStep(client, now, locale);
  if (automatic) return { actor: "system", text: automatic.text, at: automatic.at };

  const stage = clientStage(client, now);
  const L = (spanish: string, english: string) => (locale === "es" ? spanish : english);
  const person = (actor: Actor, text: string): NextStep => ({ actor, text, at: null });

  if (serviceEndPending(client)) return person("staff", L("Confirmar con el cliente que termina el servicio", "Confirm with the client that the service is ending"));

  switch (stage) {
    case "lead":
      return person("sales", L("Seguir la conversación y enviarle su enlace", "Keep the conversation going and send their link"));
    case "agreement_pending":
      return person("client", L("Firmar el acuerdo de servicio", "Sign the service agreement"));
    case "cancellation_window":
      return person("system", L("Esperar a que termine su periodo de cancelación", "Wait for their cancellation period to end"));
    case "cancelled":
      return person("staff", L("Canceló su acuerdo: nada pendiente", "Cancelled their agreement: nothing pending"));
    case "documents_pending": {
      const kinds = missingDocuments(client);
      return person("client", L(`Subir su ${documentNames(kinds, "es")}`, `Upload their ${documentNames(kinds, "en")}`));
    }
    case "report_pending":
      return person("client", L("Activar su monitoreo de crédito", "Turn on their credit monitoring"));
    case "client_review_pending": {
      const review = reviewProgress(client);
      return person("client", L(`Terminar su revisión (faltan ${review.pending} de ${review.total})`, `Finish their review (${review.pending} of ${review.total} left)`));
    }
    case "ready_to_send":
    case "next_round_ready": {
      const round = latestRound(client);
      if (sendBlockReason(client, now)) return person("client", L("Actualizar su reporte antes de enviar", "Refresh their report before sending"));
      return person("staff", L(`Enviar la ronda ${round?.number ?? 1}`, `Send round ${round?.number ?? 1}`));
    }
    case "waiting_on_bureaus":
      return person("client", L("Revisar su monitoreo: falta el reporte nuevo", "Check their monitoring: the new report is missing"));
    case "results_in":
      return person("staff", L("Revisar el caso", "Review the case"));
    case "paused":
      if (pausedForPayment(client)) return person("client", L("Actualizar su método de pago", "Update their payment method"));
      return person("staff", L("Nada marcado como inexacto: nada que enviar", "Nothing marked inaccurate: nothing to send"));
  }
}

// ── Sending ─────────────────────────────────────────────────────────────

/**
 * Why a prepared round must not be mailed yet, or null when it may. Letters go
 * out only under an agreement that allows work to start, and on a current
 * report only; a handled mark does not lift this.
 */
export function sendBlockReason(client: StaffClient, now: Date, context: StaffContext = {}): string | null {
  const locale = context.locale ?? staffLocaleFallback();
  const L = (spanish: string, english: string) => (locale === "es" ? spanish : english);
  // The agreement comes before everything else: no signature, a cancellation,
  // the cancellation window or a request to stop each hold every letter.
  const gate = agreementGate(client, now);
  if (!gate.allowed) {
    if (gate.code === "in_cancellation_window") {
      const starts = workStartsAt(client, now);
      return L(
        `El cliente está en su periodo de cancelación de 3 días hábiles y la ley no permite empezar antes.${starts ? ` Se puede enviar a partir del ${formatDay(starts, "es")}.` : ""}`,
        `The client is in their 3-business-day cancellation period and the law doesn't allow starting earlier.${starts ? ` Letters can go out from ${formatDay(starts, "en")}.` : ""}`,
      );
    }
    if (gate.code === "cancelled") return L("El cliente canceló su acuerdo. Sus cartas no se envían.", "The client cancelled their agreement. Their letters don't go out.");
    return gate.reason[locale];
  }
  const stale = openExceptions(client, now).find((e) => e.kind === "report_stale");
  if (stale) {
    return L(
      `El reporte tiene más de ${FRESH_REPORT_DAYS} días. Hace falta uno reciente antes de enviar cartas.`,
      `The report is more than ${FRESH_REPORT_DAYS} days old. A recent one is needed before letters go out.`,
    );
  }
  // A letter that says "this is identity theft" must not go out until the
  // client's identity theft report is on file to back it and to enclose.
  const identityTheft = openExceptions(client, now).find((e) => e.kind === "identity_theft_report_missing");
  if (identityTheft) {
    return L(
      "El cliente indicó robo de identidad y falta su reporte de robo de identidad (FTC). No se envían cartas hasta tenerlo en archivo.",
      "The client reported identity theft and their FTC identity theft report is missing. No letters go out until it's on file.",
    );
  }
  // Never to a guessed address: a creditor or collector letter needs a checked one.
  const round = latestRound(client);
  if (context.furnishers && round?.status === "ready") {
    const gaps = missingFurnisherAddresses(round, context.furnishers);
    if (gaps.length > 0) {
      const companies = listJoin(
        gaps.map((g) => g.company),
        locale,
      );
      return L(
        `Falta la dirección verificada para disputas de ${companies}. Agrégala en Acreedores y la ronda queda lista.`,
        `The verified dispute address for ${companies} is missing. Add it under Creditors and the round is ready.`,
      );
    }
  }
  // Added with the address verification (migration 0022): the client's own address waits for their confirmation.
  if (openAddressCheck(client)) {
    return L(
      "El correo no pudo confirmar la dirección del cliente. Se le pidió confirmarla; la ronda sale cuando la confirme.",
      "The post office couldn't confirm the client's address. They were asked to confirm it; the round goes out once they do.",
    );
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

/** "Address: 123 Old Street…, Capital One" — what a letter is about, in the report's own words. */
export function letterCovers(letter: StaffLetter, locale: StaffLocale = staffLocaleFallback()): string {
  return letter.items.map((item) => itemLabel(item, locale)).join(" · ");
}
