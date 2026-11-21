import { ROUND_CYCLE_DAYS } from "../domain/attack";
import { FRESH_REPORT_DAYS } from "../monitoring/subscription";
import { RESPONSE_WINDOW_DAYS } from "../ux/journey";
import { itemLabel } from "../ux/itemDisplay";
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
  "documents_pending",
  "report_pending",
  "client_review_pending",
  "ready_to_send",
  "waiting_on_bureaus",
  "results_in",
  "next_round_ready",
  "paused",
] as const;

export type Stage = (typeof STAGE_ORDER)[number];

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
    description: "El cliente revisa su reporte con Capi y dice qué es inexacto. Solo el cliente puede responder.",
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
      "No hay trabajo en curso: pago vencido, servicio cancelado o nada marcado como inexacto por el cliente. El equipo decide cómo seguir.",
    actor: "staff",
  },
};

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
 * `now` is accepted so all three functions are called the same way. It is
 * not used: a stage depends on what has been recorded, not on the date.
 */
export function clientStage(client: StaffClient, _now?: Date): Stage {
  if (client.billing === "canceled" || client.billing === "past_due") return "paused";
  if (!client.signedUpAt) return "lead";
  if (!client.agreementSignedAt) return "agreement_pending";
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
  "letter_returned",
  "question_waiting",
  "response_overdue",
  "agreement_unsigned",
  "identity_theft_report_missing",
] as const;

export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

export type Severity = "high" | "medium" | "low";

export const EXCEPTION_LABEL: Record<ExceptionKind, string> = {
  review_stalled: "Revisión detenida",
  documents_missing: "Faltan documentos",
  report_stale: "Reporte vencido",
  payment_past_due: "Pago vencido",
  letter_returned: "Carta devuelta",
  question_waiting: "Pregunta sin responder",
  response_overdue: "Sin reporte nuevo",
  agreement_unsigned: "Acuerdo sin firmar",
  identity_theft_report_missing: "Robo de identidad sin reporte",
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
  if (daysSince(latest.mailedAt, now) <= RESPONSE_WINDOW_DAYS) return null;
  // A report pulled once the window closed would already show the answers.
  const windowEnd = addDays(latest.mailedAt, RESPONSE_WINDOW_DAYS);
  if (client.report && new Date(client.report.pulledAt).getTime() >= windowEnd.getTime()) return null;
  return latest;
}

/** Every exception that applies right now, whether or not someone marked it handled. */
function openExceptions(client: StaffClient, now: Date): StaffException[] {
  // A cancelled client has nothing in flight, so nothing can be wrong with it.
  if (client.billing === "canceled") return [];

  const found: StaffException[] = [];

  if (client.billing === "past_due") {
    found.push({
      key: "payment_past_due",
      kind: "payment_past_due",
      severity: "high",
      sentence: "Su pago está vencido. Su caso queda en pausa hasta que se ponga al corriente.",
      actionLabel: "Escribirle sobre el pago",
      action: "whatsapp",
      since: null,
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
      found.push({
        key: `letter_returned:${letter.id}`,
        kind: "letter_returned",
        severity: "high",
        sentence:
          letter.mailStatus === "returned"
            ? `El correo devolvió la carta para ${letter.recipient.name} de la ronda ${round.number}.`
            : `El correo no pudo entregar la carta para ${letter.recipient.name} de la ronda ${round.number}.`,
        actionLabel: "Revisar la carta",
        action: "open_client",
        since: round.mailedAt,
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
      sentence: `Hizo una pregunta que Capi pasó al equipo: «${clip(question.text, 110)}» ${waiting}`,
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
export function clientExceptions(client: StaffClient, now: Date): StaffException[] {
  return openExceptions(client, now).filter((e) => !isQuiet(client, e.key, now));
}

export interface HandledException extends StaffException {
  handledAt: string;
  /** The day it returns to the list if the situation is still the same (ISO). */
  returnsAt: string;
}

/** Exceptions that still apply but that someone marked as handled, and are quiet for now. */
export function handledExceptions(client: StaffClient, now: Date): HandledException[] {
  return openExceptions(client, now)
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
  const stage = clientStage(client, now);

  if (stage === "waiting_on_bureaus") {
    const round = latestRound(client);
    if (!round?.mailedAt || responseOverdue(client, now)) return null;
    const due = addDays(round.mailedAt, RESPONSE_WINDOW_DAYS);
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

  switch (stage) {
    case "lead":
      return person("sales", "Seguir la conversación y enviarle su enlace");
    case "agreement_pending":
      return person("client", "Firmar el acuerdo de servicio");
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
      if (client.billing === "past_due") return person("client", "Poner su pago al corriente");
      if (client.billing === "canceled") return person("staff", "Servicio cancelado: nada pendiente");
      return person("staff", "Nada marcado como inexacto: nada que enviar");
  }
}

// ── Sending ─────────────────────────────────────────────────────────────

/**
 * Why a prepared round must not be mailed yet, or null when it may. Letters go
 * out on a current report only; a handled mark does not lift this.
 */
export function sendBlockReason(client: StaffClient, now: Date): string | null {
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
  return null;
}

/** The round that can be mailed now, or null. This is what "Listas para enviar" lists. */
export function sendableRound(client: StaffClient, now: Date): StaffRound | null {
  const stage = clientStage(client, now);
  if (stage !== "ready_to_send" && stage !== "next_round_ready") return null;
  const round = latestRound(client);
  if (!round || round.status !== "ready" || round.letters.length === 0) return null;
  return sendBlockReason(client, now) ? null : round;
}

/** Distinct report items a round's letters cover. */
export function roundItemCount(round: StaffRound): number {
  return new Set(round.letters.flatMap((l) => l.items.map((i) => i.fingerprint))).size;
}

/** "Dirección: 123 Old Street…, Capital One" — what a letter is about, in the report's own words. */
export function letterCovers(letter: StaffLetter): string {
  return letter.items.map((item) => itemLabel(item, "es")).join(" · ");
}
