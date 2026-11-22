import { AGREEMENT_TIME_ZONE, firstWorkingDay } from "../agreement/businessDays";
import { deadlineOf, workMayStart, type AgreementRecord } from "../agreement/gate";
import type { ChargeStatus } from "../billing/types";
import { formatCents } from "../billing/rules";
import { isCertified } from "../mail/classes";
import type { MailClass, MailStatus } from "../mail/types";

// "Mi caso": one honest timeline of the client's case, and the one sentence
// that says where it stands ("¿Qué está pasando?").
//
// Pure: every screen hands in the facts it has (the demo's device stores, or
// the client's own rows through GET /api/case) and gets the same events, the
// same "what comes next" and the same sentence back. The rules:
//
//  - Facts only. Every event is something on record, with its date. Nothing
//    is said about what a bureau will decide, and there are no scores here.
//  - The future is stated as the process's own dates ("alrededor del 3 de
//    enero"), never as an outcome.
//  - Short, plain sentences: every line passes the reading-level test
//    (src/lib/__tests__/plainLanguage.test.ts) and the claim guardrails.

export type L = "es" | "en";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The bureaus' reinvestigation window, in days (FCRA § 611). The same number the journey uses. */
export const CASE_RESPONSE_DAYS = 30;
/** The team prepares the next round about this many days after a mailing. */
export const CASE_NEXT_ROUND_DAYS = 40;

export interface CaseLetterFact {
  /** "Equifax", or the company's name. */
  recipient: string;
  mailClass: MailClass;
  status: MailStatus;
  mailedAt: string | null;
  deliveredAt: string | null;
  returnedAt: string | null;
}

export interface CaseRoundFact {
  number: number;
  /** When the team started preparing it (the round's record was created). */
  preparedAt: string | null;
  /** When the letters went out. Null while the team is still preparing them. */
  mailedAt: string | null;
  letters: CaseLetterFact[];
  /** Answers that came back: from a named bureau or company, or (from = null) "the bureaus" as a whole. */
  answers: Array<{ from: string | null; receivedAt: string }>;
}

export interface CaseChargeFact {
  roundNumber: number;
  /** Null when the amount is not to be printed (the demo without a configured fee). */
  amountCents: number | null;
  status: ChargeStatus;
  /** When it happened: the charge date, or the last try for one that did not go through. */
  at: string;
  /** The day the round it pays for was mailed. */
  workDate: string | null;
  refundedAt: string | null;
}

export type CaseDocumentKind = "government_id" | "proof_of_address";

export interface CaseDocumentFact {
  kind: CaseDocumentKind;
  receivedAt: string;
  /** When a person on the team checked it. Null until then. */
  checkedAt: string | null;
}

export interface CaseFacts {
  agreement: AgreementRecord | null;
  documents: CaseDocumentFact[];
  /** Every report import, any order. Empty while the team has not imported one. */
  reportImports: string[];
  review: {
    /** Items on the current report. */
    total: number;
    /** Items the client has answered, either way. */
    reviewed: number;
    /** Items the client confirmed as inaccurate. */
    confirmed: number;
    /** When the last answer was given, once every item is answered. */
    finishedAt: string | null;
  };
  rounds: CaseRoundFact[];
  charges: CaseChargeFact[];
}

export type CaseTone = "done" | "info" | "attention";

export type CaseEventKind =
  | "disclosures_read"
  | "agreement_signed"
  | "cancel_window_over"
  | "agreement_cancelled"
  | "service_end_requested"
  | "document_received"
  | "document_checked"
  | "report_imported"
  | "review_finished"
  | "round_prepared"
  | "round_mailed"
  | "letters_delivered"
  | "letter_returned"
  | "answer_received"
  | "charge"
  | "refund";

export type CaseIcon = "clipboard" | "doc" | "search" | "mail" | "check" | "clock" | "person";

export interface CaseEvent {
  kind: CaseEventKind;
  /** ISO time it happened. */
  at: string;
  /** "12 de noviembre" */
  day: string;
  title: string;
  detail?: string;
  icon: CaseIcon;
  tone: CaseTone;
}

export interface CaseNext {
  key: string;
  /** ISO date, when the process gives one. */
  at: string | null;
  title: string;
  detail?: string;
  /** Where the client can see more or act. */
  href?: string;
}

/** Where the case stands: one value per sentence in caseStatusSentence. */
export type CaseState =
  | "no_agreement"
  | "disclosed"
  | "cancelled"
  | "end_requested"
  | "in_window"
  | "report_waiting"
  | "review_not_started"
  | "reviewing"
  | "nothing_to_send"
  | "preparing"
  | "mailed"
  | "delivered"
  | "letter_returned"
  | "answers_in"
  | "window_over"
  | "next_round_due";

export function caseDay(iso: string | Date, locale: L): string {
  return new Date(iso).toLocaleDateString(locale === "es" ? "es-MX" : "en-US", {
    day: "numeric",
    month: "long",
    timeZone: AGREEMENT_TIME_ZONE,
  });
}

const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : Number.NaN);
const valid = (iso: string | null | undefined): iso is string => typeof iso === "string" && !Number.isNaN(Date.parse(iso));
const addDays = (iso: string, days: number) => new Date(time(iso) + days * DAY_MS).toISOString();

/** The newest round that was mailed, if any. */
export function latestMailedRound(facts: CaseFacts): CaseRoundFact | null {
  return [...facts.rounds].filter((r) => valid(r.mailedAt)).sort((a, b) => b.number - a.number)[0] ?? null;
}

/**
 * When the bureaus' 30 days start for a round: the latest certified delivery
 * scan, else the mailing date (the same rule as mail/clientView.ts).
 */
export function responseWindowStart(round: CaseRoundFact): string {
  let start = time(round.mailedAt);
  for (const l of round.letters) {
    if (isCertified(l.mailClass) && l.status === "delivered" && time(l.deliveredAt) > start) start = time(l.deliveredAt);
  }
  return new Date(start).toISOString();
}

function lastDelivery(round: CaseRoundFact): string | null {
  const days = round.letters.filter((l) => l.status === "delivered" && valid(l.deliveredAt)).map((l) => time(l.deliveredAt));
  return days.length ? new Date(Math.max(...days)).toISOString() : null;
}

function returnedLetters(round: CaseRoundFact): CaseLetterFact[] {
  return round.letters.filter((l) => (l.status === "returned" || l.status === "undeliverable") && valid(l.returnedAt));
}

/** Where the case stands now. The order mirrors the journey (src/lib/ux/journey.ts). */
export function caseState(facts: CaseFacts, now: Date): CaseState {
  const gate = workMayStart(facts.agreement, now);
  if (!gate.allowed && gate.code === "disclosure_not_acknowledged") return "no_agreement";
  if (!gate.allowed && gate.code === "not_signed") return "disclosed";
  if (!gate.allowed && gate.code === "cancelled") return "cancelled";
  if (!gate.allowed && gate.code === "service_end_requested") return "end_requested";

  const mailed = latestMailedRound(facts);
  if (mailed && gate.allowed) {
    if (returnedLetters(mailed).length > 0) return "letter_returned";
    if (mailed.answers.length > 0) return "answers_in";
    const nextRoundAt = time(addDays(mailed.mailedAt!, CASE_NEXT_ROUND_DAYS));
    if (now.getTime() >= nextRoundAt) return "next_round_due";
    const due = time(addDays(responseWindowStart(mailed), CASE_RESPONSE_DAYS));
    if (now.getTime() >= due) return "window_over";
    return lastDelivery(mailed) ? "delivered" : "mailed";
  }
  if (!gate.allowed) return "in_window";
  if (facts.reportImports.length === 0) return "report_waiting";
  if (facts.review.reviewed === 0 && facts.review.total > 0) return "review_not_started";
  if (facts.review.reviewed < facts.review.total) return "reviewing";
  if (facts.review.confirmed === 0) return "nothing_to_send";
  return "preparing";
}

/** The round the team is working on next: one after the newest mailed round, or 1. */
function nextRoundNumber(facts: CaseFacts): number {
  const mailed = latestMailedRound(facts);
  return mailed ? mailed.number + 1 : Math.max(1, ...facts.rounds.filter((r) => !valid(r.mailedAt)).map((r) => r.number));
}

const STATUS = {
  es: {
    no_agreement: () => "Todavía no firmas tu acuerdo. Es el primer paso para empezar.",
    disclosed: () => "Ya leíste tus derechos. Ahora falta firmar tu contrato.",
    cancelled: (d: string) => `Cancelaste tu acuerdo el ${d}. No se hace ningún trabajo y no debes nada.`,
    end_requested: (d: string) => `Pediste terminar el servicio el ${d}. No se envía nada más. Alguien del equipo te va a escribir.`,
    in_window: (signed: string, starts: string) =>
      starts
        ? `Firmaste tu acuerdo el ${signed}. Tu equipo empieza el ${starts}, cuando termina tu plazo para cancelar.`
        : `Firmaste tu acuerdo el ${signed}. Tu equipo empieza cuando termina tu plazo para cancelar.`,
    report_waiting: () => "Tu equipo está trayendo tu reporte de crédito. Te avisamos cuando esté listo.",
    review_not_started: (n: number) => `Tu reporte está listo. Lo que sigue es revisarlo: son ${n} ${n === 1 ? "punto" : "puntos"}.`,
    reviewing: (left: number) => `Vas avanzando en tu revisión. Te ${left === 1 ? "falta 1 punto" : `faltan ${left} puntos`}.`,
    nothing_to_send: () => "Revisaste todo y no marcaste nada como inexacto. Por eso no hay cartas que preparar.",
    preparing: (round: number) => `Terminaste tu revisión. Tu equipo prepara las cartas de tu ronda ${round}.`,
    mailed: (round: number, d: string) =>
      `Tus cartas de la ronda ${round} se enviaron el ${d}. Los burós tienen unos ${CASE_RESPONSE_DAYS} días para responder.`,
    delivered: (round: number, d: string) =>
      `Tus cartas de la ronda ${round} llegaron el ${d}. Los burós tienen unos ${CASE_RESPONSE_DAYS} días para responder.`,
    letter_returned: (round: number) => `El correo devolvió una carta de tu ronda ${round}. Tu equipo la está revisando.`,
    answers_in: (round: number, from: string | null) =>
      from ? `Llegó la respuesta de ${from} a tu ronda ${round}. Tu equipo la está leyendo.` : `Llegaron respuestas a tu ronda ${round}. Tu equipo las está leyendo.`,
    window_over: (round: number, d: string) =>
      `Ya pasaron unos ${CASE_RESPONSE_DAYS} días desde tu ronda ${round}. Tu siguiente ronda se prepara alrededor del ${d}.`,
    next_round_due: (round: number) => `Tu equipo prepara tu ronda ${round}. Te avisamos cuando salgan las cartas.`,
  },
  en: {
    no_agreement: () => "You have not signed your agreement yet. It is the first step.",
    disclosed: () => "You read your rights. Signing your contract is next.",
    cancelled: (d: string) => `You cancelled your agreement on ${d}. No work is done and you owe nothing.`,
    end_requested: (d: string) => `You asked to end the service on ${d}. Nothing more is sent. Someone on the team will write to you.`,
    in_window: (signed: string, starts: string) =>
      starts
        ? `You signed your agreement on ${signed}. Your team starts on ${starts}, when your time to cancel ends.`
        : `You signed your agreement on ${signed}. Your team starts when your time to cancel ends.`,
    report_waiting: () => "Your team is bringing in your credit report. We will tell you when it is ready.",
    review_not_started: (n: number) => `Your report is ready. Reviewing it is next: ${n} ${n === 1 ? "item" : "items"}.`,
    reviewing: (left: number) => `Your review is moving along. ${left === 1 ? "1 item is" : `${left} items are`} left.`,
    nothing_to_send: () => "You reviewed everything and marked nothing as inaccurate. So there are no letters to prepare.",
    preparing: (round: number) => `You finished your review. Your team is preparing the letters for round ${round}.`,
    mailed: (round: number, d: string) =>
      `Your round ${round} letters were mailed on ${d}. The bureaus have about ${CASE_RESPONSE_DAYS} days to answer.`,
    delivered: (round: number, d: string) =>
      `Your round ${round} letters arrived on ${d}. The bureaus have about ${CASE_RESPONSE_DAYS} days to answer.`,
    letter_returned: (round: number) => `The post office sent back a letter from round ${round}. Your team is looking into it.`,
    answers_in: (round: number, from: string | null) =>
      from ? `${from}'s answer to your round ${round} came in. Your team is reading it.` : `Answers to your round ${round} came in. Your team is going over them.`,
    window_over: (round: number, d: string) =>
      `About ${CASE_RESPONSE_DAYS} days have passed since round ${round}. Your next round is prepared around ${d}.`,
    next_round_due: (round: number) => `Your team is preparing round ${round}. We will tell you when the letters go out.`,
  },
} as const;

/** "¿Qué está pasando?": the one plain sentence of status. */
export function caseStatusSentence(facts: CaseFacts, locale: L, now: Date = new Date()): string {
  const s = STATUS[locale];
  const state = caseState(facts, now);
  const a = facts.agreement;
  const mailed = latestMailedRound(facts);
  switch (state) {
    case "no_agreement":
      return s.no_agreement();
    case "disclosed":
      return s.disclosed();
    case "cancelled":
      return s.cancelled(caseDay(a!.cancelledAt!, locale));
    case "end_requested":
      return s.end_requested(caseDay(a!.serviceEndRequestedAt!, locale));
    case "in_window": {
      const gate = workMayStart(a, now);
      const starts = !gate.allowed && gate.startsAt ? caseDay(gate.startsAt, locale) : "";
      return s.in_window(caseDay(a!.signedAt!, locale), starts);
    }
    case "report_waiting":
      return s.report_waiting();
    case "review_not_started":
      return s.review_not_started(facts.review.total);
    case "reviewing":
      return s.reviewing(facts.review.total - facts.review.reviewed);
    case "nothing_to_send":
      return s.nothing_to_send();
    case "preparing":
      return s.preparing(nextRoundNumber(facts));
    case "mailed":
      return s.mailed(mailed!.number, caseDay(mailed!.mailedAt!, locale));
    case "delivered":
      return s.delivered(mailed!.number, caseDay(lastDelivery(mailed!)!, locale));
    case "letter_returned":
      return s.letter_returned(mailed!.number);
    case "answers_in": {
      const latest = [...mailed!.answers].sort((x, y) => time(y.receivedAt) - time(x.receivedAt))[0];
      return s.answers_in(mailed!.number, latest?.from ?? null);
    }
    case "window_over":
      return s.window_over(mailed!.number, caseDay(addDays(mailed!.mailedAt!, CASE_NEXT_ROUND_DAYS), locale));
    case "next_round_due":
      return s.next_round_due(mailed!.number + 1);
  }
}

// ── The timeline ─────────────────────────────────────────────────────────

const DOC_NAME: Record<CaseDocumentKind, { es: string; en: string }> = {
  government_id: { es: "tu identificación", en: "your ID" },
  proof_of_address: { es: "tu comprobante de domicilio", en: "your proof of address" },
};

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Every event on record, newest first. */
export function caseEvents(facts: CaseFacts, locale: L, now: Date = new Date()): CaseEvent[] {
  const es = locale === "es";
  const out: Array<Omit<CaseEvent, "day">> = [];
  const a = facts.agreement;

  if (a && valid(a.disclosureAcknowledgedAt)) {
    out.push({
      kind: "disclosures_read",
      at: a.disclosureAcknowledgedAt,
      title: es ? "Leíste tus derechos" : "You read your rights",
      detail: es ? "Confirmaste que recibiste las declaraciones que pide la ley." : "You confirmed you received the statements the law requires.",
      icon: "clipboard",
      tone: "done",
    });
  }
  if (a && valid(a.signedAt)) {
    const deadline = deadlineOf(a);
    out.push({
      kind: "agreement_signed",
      at: a.signedAt,
      title: es ? "Firmaste tu acuerdo" : "You signed your agreement",
      detail: deadline
        ? es
          ? `Podías cancelar sin costo hasta el ${caseDay(deadline, "es")}.`
          : `You could cancel at no cost until ${caseDay(deadline, "en")}.`
        : undefined,
      icon: "clipboard",
      tone: "done",
    });
    if (deadline && deadline.getTime() < now.getTime() && !a.cancelledAt) {
      out.push({
        kind: "cancel_window_over",
        at: deadline.toISOString(),
        title: es ? "Terminó tu plazo para cancelar sin costo" : "Your time to cancel at no cost ended",
        detail: es ? "Desde aquí tu equipo puede trabajar. Puedes terminar el servicio cuando quieras." : "From here your team can work. You can end the service whenever you want.",
        icon: "clock",
        tone: "info",
      });
    }
  }
  if (a && valid(a.cancelledAt)) {
    out.push({
      kind: "agreement_cancelled",
      at: a.cancelledAt,
      title: es ? "Cancelaste tu acuerdo" : "You cancelled your agreement",
      detail: es ? "No se hace ningún trabajo y no debes nada." : "No work is done and you owe nothing.",
      icon: "clipboard",
      tone: "info",
    });
  }
  if (a && valid(a.serviceEndRequestedAt)) {
    out.push({
      kind: "service_end_requested",
      at: a.serviceEndRequestedAt,
      title: es ? "Pediste terminar el servicio" : "You asked to end the service",
      detail: es ? "No se envía nada más. Alguien del equipo te escribe para confirmarlo." : "Nothing more is sent. Someone on the team writes to you to confirm it.",
      icon: "clipboard",
      tone: "info",
    });
  }

  for (const doc of facts.documents) {
    if (valid(doc.receivedAt)) {
      out.push({
        kind: "document_received",
        at: doc.receivedAt,
        title: es ? `Recibimos ${DOC_NAME[doc.kind].es}` : `We received ${DOC_NAME[doc.kind].en}`,
        detail: es ? "Va junto con tus cartas, para que el buró sepa que eres tú." : "It goes with your letters, so the bureau knows it is you.",
        icon: "doc",
        tone: "done",
      });
    }
    if (valid(doc.checkedAt)) {
      out.push({
        kind: "document_checked",
        at: doc.checkedAt,
        title: es ? `Tu equipo revisó ${DOC_NAME[doc.kind].es}` : `Your team checked ${DOC_NAME[doc.kind].en}`,
        detail: es ? "Se lee bien y está completo." : "It is clear and complete.",
        icon: "check",
        tone: "done",
      });
    }
  }

  const imports = [...facts.reportImports].filter(valid).sort((x, y) => time(x) - time(y));
  imports.forEach((at, index) => {
    out.push({
      kind: "report_imported",
      at,
      title: index === 0 ? (es ? "Tu equipo trajo tu reporte de crédito" : "Your team brought in your credit report") : es ? "Llegó un reporte nuevo" : "A new report came in",
      detail:
        index === 0
          ? es
            ? "Es tu reporte de los 3 burós, de tu servicio de monitoreo."
            : "It is your 3-bureau report, from your monitoring service."
          : es
            ? "Tu equipo lo compara con el anterior."
            : "Your team compares it with the last one.",
      icon: "search",
      tone: "done",
    });
  });

  if (valid(facts.review.finishedAt) && facts.review.reviewed >= facts.review.total && facts.review.total > 0) {
    const n = facts.review.confirmed;
    out.push({
      kind: "review_finished",
      at: facts.review.finishedAt,
      title: es ? "Terminaste tu revisión" : "You finished your review",
      detail:
        n === 0
          ? es
            ? "No marcaste nada como inexacto."
            : "You marked nothing as inaccurate."
          : es
            ? `Marcaste ${count(n, "punto", "puntos")} como inexacto${n === 1 ? "" : "s"}. Solo tú decides eso.`
            : `You marked ${count(n, "item", "items")} as inaccurate. Only you decide that.`,
      icon: "search",
      tone: "done",
    });
  }

  for (const round of facts.rounds) {
    if (valid(round.preparedAt)) {
      out.push({
        kind: "round_prepared",
        at: round.preparedAt,
        title: es ? `Tu equipo empezó a preparar tu ronda ${round.number}` : `Your team started preparing round ${round.number}`,
        detail: es ? "Las cartas son sobre los puntos que tú marcaste." : "The letters are about the items you marked.",
        icon: "doc",
        tone: "info",
      });
    }
    if (valid(round.mailedAt)) {
      const n = round.letters.length;
      const certified = round.letters.filter((l) => isCertified(l.mailClass)).length;
      out.push({
        kind: "round_mailed",
        at: round.mailedAt,
        title: es ? `Se enviaron las cartas de tu ronda ${round.number}` : `Your round ${round.number} letters were mailed`,
        detail:
          n === 0
            ? undefined
            : es
              ? `${count(n, "carta", "cartas")}${certified ? `, ${certified === n ? (n === 1 ? "certificada" : "todas certificadas") : `${certified} certificada${certified === 1 ? "" : "s"}`}` : ""}. Los burós tienen unos ${CASE_RESPONSE_DAYS} días para responder.`
              : `${count(n, "letter", "letters")}${certified ? `, ${certified === n ? (n === 1 ? "certified" : "all certified") : `${certified} certified`}` : ""}. The bureaus have about ${CASE_RESPONSE_DAYS} days to answer.`,
        icon: "mail",
        tone: "done",
      });
    }
    // Deliveries, one line per day.
    const byDay = new Map<string, CaseLetterFact[]>();
    for (const l of round.letters) {
      if (l.status !== "delivered" || !valid(l.deliveredAt)) continue;
      const key = caseDay(l.deliveredAt, locale);
      byDay.set(key, [...(byDay.get(key) ?? []), l]);
    }
    for (const letters of byDay.values()) {
      const at = new Date(Math.max(...letters.map((l) => time(l.deliveredAt)))).toISOString();
      const names = letters.map((l) => l.recipient).join(", ");
      const estimate = letters.every((l) => !isCertified(l.mailClass));
      out.push({
        kind: "letters_delivered",
        at,
        title: es
          ? `${letters.length === 1 ? "Llegó 1 carta" : `Llegaron ${letters.length} cartas`} de tu ronda ${round.number}`
          : `${letters.length === 1 ? "1 letter" : `${letters.length} letters`} from round ${round.number} arrived`,
        detail: es
          ? `A ${names}.${estimate ? " Es la fecha que calcula el correo." : " El correo lo confirmó."}`
          : `To ${names}.${estimate ? " This is the post office's estimate." : " The post office confirmed it."}`,
        icon: "check",
        tone: "done",
      });
    }
    for (const l of returnedLetters(round)) {
      out.push({
        kind: "letter_returned",
        at: l.returnedAt!,
        title: es ? `El correo devolvió una carta de tu ronda ${round.number}` : `The post office sent back a round ${round.number} letter`,
        detail: es ? `Era para ${l.recipient}. Tu equipo la revisa y la vuelve a enviar si hace falta.` : `It was for ${l.recipient}. Your team checks it and sends it again if needed.`,
        icon: "mail",
        tone: "attention",
      });
    }
    for (const answer of round.answers) {
      if (!valid(answer.receivedAt)) continue;
      out.push({
        kind: "answer_received",
        at: answer.receivedAt,
        title: answer.from
          ? es
            ? `Llegó la respuesta de ${answer.from}`
            : `${answer.from}'s answer came in`
          : es
            ? `Llegaron respuestas a tu ronda ${round.number}`
            : `Answers to round ${round.number} came in`,
        detail: es ? "Tu equipo la lee y te cuenta qué dice." : "Your team reads it and tells you what it says.",
        icon: "doc",
        tone: "info",
      });
    }
  }

  for (const charge of facts.charges) {
    if (!valid(charge.at)) continue;
    const amount = charge.amountCents !== null ? formatCents(charge.amountCents) : null;
    const work = valid(charge.workDate) ? caseDay(charge.workDate, locale) : null;
    const paidFor = es
      ? `Paga el trabajo de tu ronda ${charge.roundNumber}${work ? `: las cartas que se enviaron el ${work}` : ""}.`
      : `It pays for your round ${charge.roundNumber} work${work ? `: the letters mailed on ${work}` : ""}.`;
    const title =
      charge.status === "failed"
        ? es
          ? `Un cobro por tu ronda ${charge.roundNumber} no pasó`
          : `A charge for round ${charge.roundNumber} did not go through`
        : charge.status === "pending"
          ? es
            ? `Cobro en proceso por tu ronda ${charge.roundNumber}`
            : `Charge in progress for round ${charge.roundNumber}`
          : es
            ? `Cobro${amount ? ` de ${amount}` : ""} por tu ronda ${charge.roundNumber}`
            : `Charge${amount ? ` of ${amount}` : ""} for round ${charge.roundNumber}`;
    out.push({
      kind: "charge",
      at: charge.at,
      title,
      detail: charge.status === "failed" ? (es ? "Puedes verlo en Mis pagos." : "You can see it in My payments.") : paidFor,
      icon: "doc",
      tone: charge.status === "failed" ? "attention" : "done",
    });
    if (valid(charge.refundedAt)) {
      out.push({
        kind: "refund",
        at: charge.refundedAt,
        title: es ? `Te devolvimos el cobro de tu ronda ${charge.roundNumber}` : `Your round ${charge.roundNumber} charge was refunded`,
        detail: es ? "El dinero vuelve a tu tarjeta en unos días." : "The money goes back to your card in a few days.",
        icon: "doc",
        tone: "info",
      });
    }
  }

  return out
    .filter((e) => time(e.at) <= now.getTime())
    .sort((x, y) => time(y.at) - time(x.at))
    .map((e) => ({ ...e, day: caseDay(e.at, locale) }));
}

/** What comes next, with the process's own dates. At most two lines, the nearest first. */
export function caseNext(facts: CaseFacts, locale: L, now: Date = new Date()): CaseNext[] {
  const es = locale === "es";
  const state = caseState(facts, now);
  const mailed = latestMailedRound(facts);
  const round = nextRoundNumber(facts);
  switch (state) {
    case "no_agreement":
    case "disclosed":
      return [{ key: "sign", at: null, title: es ? "Firmar tu acuerdo" : "Sign your agreement", detail: es ? "Toma unos minutos." : "It takes a few minutes.", href: "/acuerdo" }];
    case "cancelled":
    case "end_requested":
      return [];
    case "in_window": {
      const deadline = deadlineOf(facts.agreement!);
      const starts = deadline ? firstWorkingDay(deadline).toISOString() : null;
      return [
        ...(deadline
          ? [{ key: "cancel-until", at: deadline.toISOString(), title: es ? "Último día para cancelar sin costo" : "Last day to cancel at no cost", href: "/acuerdo" }]
          : []),
        { key: "team-starts", at: starts, title: es ? "Tu equipo empieza a trabajar" : "Your team starts working" },
      ];
    }
    case "report_waiting":
      return [{ key: "report", at: null, title: es ? "Tu equipo trae tu reporte" : "Your team brings in your report" }];
    case "review_not_started":
    case "reviewing": {
      const left = facts.review.total - facts.review.reviewed;
      return [
        {
          key: "review",
          at: null,
          title: es ? `Revisar tu reporte: ${left === 1 ? "falta 1 punto" : `faltan ${left} puntos`}` : `Review your report: ${left} left`,
          href: "/asistente",
        },
      ];
    }
    case "nothing_to_send":
      return [];
    case "preparing":
      return [{ key: "mail", at: null, title: es ? `Tu equipo envía las cartas de tu ronda ${round}` : `Your team mails your round ${round} letters`, detail: es ? "Te avisamos por WhatsApp cuando salgan." : "You get a WhatsApp message when they go out." }];
    case "mailed":
    case "delivered":
    case "letter_returned":
    case "answers_in":
    case "window_over": {
      const due = addDays(responseWindowStart(mailed!), CASE_RESPONSE_DAYS);
      const nextRound = addDays(mailed!.mailedAt!, CASE_NEXT_ROUND_DAYS);
      const lines: CaseNext[] = [];
      if (time(due) > now.getTime()) {
        lines.push({ key: "answer-window", at: due, title: es ? "Fin del plazo de los burós para responder" : "End of the bureaus' time to answer", detail: es ? "Son unos 30 días. La ley les da ese tiempo." : "About 30 days. The law gives them that time." });
      }
      lines.push({
        key: "next-round",
        at: nextRound,
        title: es ? `Tu siguiente ronda se prepara alrededor del ${caseDay(nextRound, "es")}` : `Your next round is prepared around ${caseDay(nextRound, "en")}`,
        detail: es ? "Antes, tu equipo vuelve a mirar tu reporte." : "Before that, your team looks at your report again.",
      });
      return lines;
    }
    case "next_round_due":
      return [{ key: "mail", at: null, title: es ? `Tu equipo prepara tu ronda ${mailed!.number + 1}` : `Your team prepares round ${mailed!.number + 1}` }];
  }
}

export interface CaseTimeline {
  state: CaseState;
  sentence: string;
  events: CaseEvent[];
  next: CaseNext[];
}

export function caseTimeline(facts: CaseFacts, locale: L, now: Date = new Date()): CaseTimeline {
  return {
    state: caseState(facts, now),
    sentence: caseStatusSentence(facts, locale, now),
    events: caseEvents(facts, locale, now),
    next: caseNext(facts, locale, now),
  };
}

/** The whole timeline as one text, for "Escuchar". */
export function caseReadAloud(timeline: CaseTimeline, locale: L): string {
  const es = locale === "es";
  const next = timeline.next.map((n) => (n.at && !n.title.includes(caseDay(n.at, locale)) ? `${n.title}: ${caseDay(n.at, locale)}.` : `${n.title}.`));
  const past = timeline.events.map((e) => `${e.day}: ${e.title}.`);
  return [timeline.sentence, next.length ? (es ? "Lo que sigue." : "What comes next.") : "", ...next, past.length ? (es ? "Lo que ya pasó." : "What already happened.") : "", ...past]
    .filter(Boolean)
    .join(" ");
}

export const EMPTY_CASE_FACTS: CaseFacts = {
  agreement: null,
  documents: [],
  reportImports: [],
  review: { total: 0, reviewed: 0, confirmed: 0, finishedAt: null },
  rounds: [],
  charges: [],
};
