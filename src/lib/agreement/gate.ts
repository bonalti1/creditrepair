import { AGREEMENT_TIME_ZONE, cancellationDeadline, firstWorkingDay } from "./businessDays";

// The gate. No work may be done for a client until all of this is true:
//
//   1. the client acknowledged the federal disclosure, as its own step,
//      before the contract (15 U.S.C. §1679c(b));
//   2. the client signed the written contract (§1679d(a)(1));
//   3. the client has not cancelled it;
//   4. the 3-business-day cancellation period has ended (§1679d(a)(2)).
//
// "Work" here is what the team does: preparing and mailing letters. Every
// place a letter can leave from asks this file first (the approval endpoint,
// the staff console's send rules).
//
// Pure functions of the record and the clock, so they run the same on the
// server, in the browser (demo) and in the staff console.

/** What is on record about one client's agreement. All timestamps are ISO strings. */
export interface AgreementRecord {
  /** When the client acknowledged receiving the disclosure statements. */
  disclosureAcknowledgedAt: string | null;
  /** When the client signed the contract. */
  signedAt: string | null;
  /** The end of the cancellation window, as computed when the contract was signed. */
  cancellationDeadline: string | null;
  /** When the client cancelled inside the window. */
  cancelledAt: string | null;
  /** When the client asked to end the service after the window. */
  serviceEndRequestedAt: string | null;
}

export const NO_AGREEMENT: AgreementRecord = {
  disclosureAcknowledgedAt: null,
  signedAt: null,
  cancellationDeadline: null,
  cancelledAt: null,
  serviceEndRequestedAt: null,
};

export type GateBlock =
  | "disclosure_not_acknowledged"
  | "not_signed"
  | "cancelled"
  | "in_cancellation_window"
  | "service_end_requested";

export type GateResult =
  | { allowed: true }
  | {
      allowed: false;
      code: GateBlock;
      /** One plain sentence for the screen, in both languages. */
      reason: { es: string; en: string };
      /** For "in_cancellation_window": the first working day the team may begin (ISO). */
      startsAt?: string;
    };

/** "miércoles 25 de noviembre" / "Wednesday, November 25", on the Texas calendar. */
export function formatAgreementDay(date: Date, locale: "es" | "en", timeZone: string = AGREEMENT_TIME_ZONE): string {
  return date.toLocaleDateString(locale === "es" ? "es-MX" : "en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  });
}

/**
 * The end of the cancellation window for a signed agreement: the deadline
 * recorded at signing, or, for a record without one, the deadline computed
 * from the signing time. Null when the contract is not signed.
 */
export function deadlineOf(agreement: AgreementRecord): Date | null {
  if (!agreement.signedAt) return null;
  if (agreement.cancellationDeadline) {
    const stored = new Date(agreement.cancellationDeadline);
    if (!Number.isNaN(stored.getTime())) return stored;
  }
  const signed = new Date(agreement.signedAt);
  return Number.isNaN(signed.getTime()) ? null : cancellationDeadline(signed);
}

/** True while the client can still cancel without penalty or obligation. */
export function canCancelWithoutPenalty(agreement: AgreementRecord | null | undefined, now: Date): boolean {
  if (!agreement?.signedAt || agreement.cancelledAt) return false;
  const deadline = deadlineOf(agreement);
  return deadline !== null && now.getTime() <= deadline.getTime();
}

/** Whether the team may do any work for this client right now, and if not, why. */
export function workMayStart(agreement: AgreementRecord | null | undefined, now: Date): GateResult {
  if (!agreement?.disclosureAcknowledgedAt) {
    return {
      allowed: false,
      code: "disclosure_not_acknowledged",
      reason: {
        es: "Falta que el cliente reciba y confirme la declaración de sus derechos. Va antes del contrato.",
        en: "The client has not yet received and acknowledged the statement of their rights. It comes before the contract.",
      },
    };
  }
  if (!agreement.signedAt) {
    return {
      allowed: false,
      code: "not_signed",
      reason: {
        es: "El acuerdo de servicio todavía no está firmado. No se puede empezar ningún trabajo sin él.",
        en: "The service agreement is not signed yet. No work can begin without it.",
      },
    };
  }
  if (agreement.cancelledAt) {
    return {
      allowed: false,
      code: "cancelled",
      reason: {
        es: "El cliente canceló el acuerdo. No se hace ningún trabajo ni se envía ninguna carta.",
        en: "The client cancelled the agreement. No work is done and no letter is sent.",
      },
    };
  }
  const deadline = deadlineOf(agreement);
  // A signed record whose dates cannot be read is treated as still inside the window.
  if (!deadline || now.getTime() <= deadline.getTime()) {
    const starts = deadline ? firstWorkingDay(deadline) : null;
    return {
      allowed: false,
      code: "in_cancellation_window",
      reason: starts
        ? {
            es: `Está en su periodo de cancelación de 3 días hábiles. La ley no permite empezar antes; el trabajo puede empezar el ${formatAgreementDay(starts, "es")}.`,
            en: `The 3-business-day cancellation period is still open. The law does not allow starting earlier; work can begin on ${formatAgreementDay(starts, "en")}.`,
          }
        : {
            es: "Está en su periodo de cancelación de 3 días hábiles. La ley no permite empezar antes.",
            en: "The 3-business-day cancellation period is still open. The law does not allow starting earlier.",
          },
      ...(starts ? { startsAt: starts.toISOString() } : {}),
    };
  }
  if (agreement.serviceEndRequestedAt) {
    return {
      allowed: false,
      code: "service_end_requested",
      reason: {
        es: "El cliente pidió terminar el servicio. No se envía nada más hasta que el equipo lo resuelva con el cliente.",
        en: "The client asked to end the service. Nothing more is sent until the team settles it with the client.",
      },
    };
  }
  return { allowed: true };
}

export type AgreementPhase =
  /** Nothing on record. */
  | "none"
  /** Disclosure acknowledged; the contract is next. */
  | "disclosed"
  /** Signed, and the client can still cancel without penalty. */
  | "in_window"
  /** Signed and past the window: work may proceed. */
  | "active"
  /** Cancelled by the client inside the window. */
  | "cancelled"
  /** Past the window, and the client asked to end the service. */
  | "end_requested";

/** Where an agreement stands, in one word. */
export function agreementPhase(agreement: AgreementRecord | null | undefined, now: Date): AgreementPhase {
  if (!agreement?.disclosureAcknowledgedAt) return "none";
  if (!agreement.signedAt) return "disclosed";
  if (agreement.cancelledAt) return "cancelled";
  const gate = workMayStart(agreement, now);
  if (!gate.allowed && gate.code === "in_cancellation_window") return "in_window";
  if (agreement.serviceEndRequestedAt) return "end_requested";
  return "active";
}
