import { AGREEMENT_TIME_ZONE } from "../agreement/businessDays";
import { workMayStart } from "../agreement/gate";
import type { Bilingual, BillableRound, BillingCharge, BillingContext, L } from "./types";

// When may a client be charged?
//
// Federal law (the Credit Repair Organizations Act, 15 U.S.C. §1679b(b)) says a
// credit repair organization may not charge or receive any money for a service
// before that service is fully performed. So this is not a subscription that
// bills on a calendar: the only thing that can be charged for is a round of
// letters that was actually mailed, after it was mailed.
//
// chargeEligibility is the whole rule, as one pure function of what is on
// record and the clock. Everything that charges asks it first; the database
// trigger in migration 0011 enforces the same core again, so a mistake here or
// in a route still cannot produce a charge for work that was not done.
//
// Not legal advice: whether "mailed" is "fully performed" is the attorney's
// call (docs/BILLING.md, question 1).

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A round is charged no earlier than this many days after it was mailed, so a
 * round marked as sent by mistake can be corrected before any money moves.
 */
export const CHARGE_DELAY_DAYS = 1;

/**
 * A new charge needs at least this many days since the work date of the last
 * round that was charged: a client is never billed more often than monthly,
 * whatever happens with rounds.
 */
export const MIN_DAYS_BETWEEN_CHARGES = 30;

/**
 * After a client asks to end the service, may work that was already performed
 * and not yet billed still be charged? That is a question for the attorney
 * (docs/BILLING.md, question 3). Until it is answered: no. It goes to a person.
 * The database trigger says the same; change both together.
 */
export const BILL_PERFORMED_WORK_AFTER_END_REQUEST = false;

export type IneligibleCode =
  /** No signed agreement on record. */
  | "agreement_not_signed"
  /** Inside the 3-business-day cancellation window: nothing may be charged. */
  | "in_cancellation_window"
  /** The client cancelled. Nothing is ever charged. */
  | "agreement_cancelled"
  /** No round has been mailed yet: there is no work to charge for. */
  | "nothing_mailed"
  /** Every mailed round already has its charge. */
  | "nothing_unbilled"
  /** The client asked to end the service and a mailed round is unbilled. A person decides. */
  | "service_end_requested"
  /** Every letter of the round came back from the post office. A person decides. */
  | "all_letters_returned"
  /** A member of staff paused billing for this client. */
  | "billing_paused"
  /** An earlier charge is still unpaid: it is settled first. */
  | "earlier_charge_unpaid"
  /** The signed agreement carries no usable fee. A person has to look. */
  | "no_amount"
  /** Mailed too recently: the correction delay has not passed. */
  | "too_soon_after_mailing"
  /** Fewer than 30 days since the work date of the last charged round. */
  | "too_soon_after_last_charge"
  /** The charge is due and there is no payment method on file. */
  | "no_payment_method";

export type ChargeEligibility =
  | {
      eligible: true;
      roundNumber: number;
      /** The fee in the signed agreement, in cents. */
      amountCents: number;
      /** The round's mailing date: the day the work was done (ISO). */
      workDate: string;
    }
  | {
      eligible: false;
      code: IneligibleCode;
      /** One plain sentence, for staff, in both languages. */
      reason: Bilingual;
      /** The round the answer is about, when there is one. */
      roundNumber?: number;
      /** When the answer is only "not yet": the moment it can be charged (ISO). */
      availableAt?: string;
      /** True when the system will not resolve this by waiting: a person has to act. */
      needsPerson: boolean;
    };

// ── Money and dates ─────────────────────────────────────────────────────

/** "89.00" → 8900. Null for anything that is not a positive amount with at most two decimals. */
export function feeToCents(fee: string | null | undefined): number | null {
  if (typeof fee !== "string" || !/^\d{1,6}(\.\d{1,2})?$/.test(fee.trim())) return null;
  const [whole, fraction = ""] = fee.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

/** 8900 → "$89.00". */
export function formatCents(cents: number): string {
  const whole = Math.floor(Math.abs(cents) / 100).toLocaleString("en-US");
  const fraction = String(Math.abs(cents) % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}$${whole}.${fraction}`;
}

/** "4 de noviembre" / "November 4", on the Texas calendar. */
export function billingDay(iso: string | Date, locale: L): string {
  return new Date(iso).toLocaleDateString(locale === "es" ? "es-MX" : "en-US", {
    day: "numeric",
    month: "long",
    timeZone: AGREEMENT_TIME_ZONE,
  });
}

/** "4 de noviembre de 2026" / "November 4, 2026". */
export function billingDate(iso: string | Date, locale: L): string {
  return new Date(iso).toLocaleDateString(locale === "es" ? "es-MX" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: AGREEMENT_TIME_ZONE,
  });
}

function addDays(iso: string, days: number): Date {
  return new Date(new Date(iso).getTime() + days * DAY_MS);
}

// ── Performed work ──────────────────────────────────────────────────────

/**
 * True when the round is recorded as mailed, with a mailing date that is not
 * in the future. This is the only thing that counts as performed work.
 */
export function isPerformed(round: BillableRound, now: Date): boolean {
  if (!round.mailed || !round.mailedAt) return false;
  const mailed = new Date(round.mailedAt).getTime();
  return !Number.isNaN(mailed) && mailed <= now.getTime();
}

/** The rounds whose work is done, oldest first. */
export function performedRounds(rounds: BillableRound[], now: Date): BillableRound[] {
  return rounds.filter((round) => isPerformed(round, now)).sort((a, b) => a.number - b.number);
}

/** True when the round has letters and the post office returned every one of them. */
export function allLettersReturned(round: BillableRound): boolean {
  return round.letters.length > 0 && round.letters.every((letter) => letter.returned);
}

/** The oldest mailed round that has no charge yet, or null. */
export function nextUnbilledRound(context: BillingContext, now: Date): BillableRound | null {
  const charged = new Set(context.account.charges.map((charge) => charge.roundNumber));
  return performedRounds(context.rounds, now).find((round) => !charged.has(round.number)) ?? null;
}

/** The charge whose work date is the most recent, whatever became of it. */
export function lastChargedWork(charges: BillingCharge[]): BillingCharge | null {
  return charges.reduce<BillingCharge | null>(
    (latest, charge) => (!latest || charge.workDate > latest.workDate ? charge : latest),
    null,
  );
}

/** A charge that still has money owing on it: waiting on the processor, or declined. */
export function isUnpaid(charge: BillingCharge): boolean {
  return charge.status === "pending" || charge.status === "failed";
}

// ── The rule ────────────────────────────────────────────────────────────

const no = (
  code: IneligibleCode,
  reason: Bilingual,
  extra: { roundNumber?: number; availableAt?: string; needsPerson?: boolean } = {},
): ChargeEligibility => ({
  eligible: false,
  code,
  reason,
  needsPerson: extra.needsPerson ?? false,
  ...(extra.roundNumber !== undefined ? { roundNumber: extra.roundNumber } : {}),
  ...(extra.availableAt ? { availableAt: extra.availableAt } : {}),
});

/**
 * May the system create a charge for this client right now, and for which
 * round? Allowed only when ALL of this holds:
 *
 *   1. the agreement is signed, not cancelled and past its cancellation window;
 *   2. a round is recorded as mailed, with a mailing date in the past;
 *   3. that round has no charge yet (one charge per round, ever: a failed
 *      payment retries the same charge, it never creates a second one);
 *   4. the client has not asked to end the service (then a person decides);
 *   5. the post office did not return every letter of the round;
 *   6. staff have not paused billing, and no earlier charge is still unpaid;
 *   7. the signed agreement carries a positive fee: that is the amount;
 *   8. the correction delay after mailing has passed;
 *   9. at least 30 days have passed since the work date of the last charged round;
 *  10. a payment method is on file, with the client's recurring authorization.
 */
export function chargeEligibility(context: BillingContext, now: Date): ChargeEligibility {
  const { agreement, account } = context;

  // 1. The agreement. The same gate that holds the letters holds the money.
  const gate = workMayStart(agreement, now);
  if (!gate.allowed && (gate.code === "disclosure_not_acknowledged" || gate.code === "not_signed")) {
    return no("agreement_not_signed", {
      es: "No se cobra: no hay un acuerdo de servicio firmado.",
      en: "Nothing is charged: there is no signed service agreement.",
    });
  }
  if (!gate.allowed && gate.code === "cancelled") {
    return no("agreement_cancelled", {
      es: "No se cobra: el cliente canceló su acuerdo.",
      en: "Nothing is charged: the client cancelled their agreement.",
    });
  }
  if (!gate.allowed && gate.code === "in_cancellation_window") {
    return no(
      "in_cancellation_window",
      {
        es: "No se cobra: está en su periodo de cancelación.",
        en: "Nothing is charged: the client is inside the cancellation period.",
      },
      gate.startsAt ? { availableAt: gate.startsAt } : {},
    );
  }

  // 2 and 3. Work that was done and has not been charged.
  const round = nextUnbilledRound(context, now);
  if (!round || !round.mailedAt) {
    return performedRounds(context.rounds, now).length === 0
      ? no("nothing_mailed", {
          es: "No hay nada que cobrar: todavía no se envía ninguna ronda.",
          en: "There is nothing to charge: no round has been mailed yet.",
        })
      : no("nothing_unbilled", {
          es: "No hay nada que cobrar: cada ronda enviada ya tiene su cobro.",
          en: "There is nothing to charge: every mailed round already has its charge.",
        });
  }
  const roundNumber = round.number;

  // 4. The client asked to stop. Work already done and unbilled goes to a person.
  if (!gate.allowed && gate.code === "service_end_requested" && !BILL_PERFORMED_WORK_AFTER_END_REQUEST) {
    return no(
      "service_end_requested",
      {
        es: `No se cobra solo: el cliente pidió terminar el servicio y la ronda ${roundNumber} quedó sin cobrar. Lo decide una persona.`,
        en: `Not charged automatically: the client asked to end the service and round ${roundNumber} is unbilled. A person decides.`,
      },
      { roundNumber, needsPerson: true },
    );
  }

  // 5. Nothing reached anyone: not billed without a person looking.
  if (allLettersReturned(round)) {
    return no(
      "all_letters_returned",
      {
        es: `No se cobra sola: el correo devolvió todas las cartas de la ronda ${roundNumber}. La revisa una persona.`,
        en: `Not charged automatically: the post office returned every letter of round ${roundNumber}. A person reviews it.`,
      },
      { roundNumber, needsPerson: true },
    );
  }

  // 6. Held by the team, or an earlier charge still open.
  if (account.pause) {
    return no(
      "billing_paused",
      {
        es: `No se cobra: el equipo puso los cobros en pausa («${account.pause.reason}»).`,
        en: `Nothing is charged: the team paused billing ("${account.pause.reason}").`,
      },
      { roundNumber },
    );
  }
  const unpaid = account.charges.find(isUnpaid);
  if (unpaid) {
    return no(
      "earlier_charge_unpaid",
      {
        es: `No se crea un cobro nuevo: el de la ronda ${unpaid.roundNumber} sigue sin pagarse.`,
        en: `No new charge is created: the one for round ${unpaid.roundNumber} is still unpaid.`,
      },
      { roundNumber },
    );
  }

  // 7. The amount is the one the client signed, and nothing else.
  const amountCents = feeToCents(context.signedMonthlyFee);
  if (amountCents === null) {
    return no(
      "no_amount",
      {
        es: "No se cobra: el acuerdo firmado no tiene una cuota válida. Lo revisa una persona.",
        en: "Nothing is charged: the signed agreement has no valid fee. A person has to look.",
      },
      { roundNumber, needsPerson: true },
    );
  }

  // 8 and 9. Not yet.
  const afterDelay = addDays(round.mailedAt, CHARGE_DELAY_DAYS);
  const previous = lastChargedWork(account.charges);
  const afterSpacing = previous ? addDays(previous.workDate, MIN_DAYS_BETWEEN_CHARGES) : null;
  const availableAt = afterSpacing && afterSpacing.getTime() > afterDelay.getTime() ? afterSpacing : afterDelay;
  if (now.getTime() < afterDelay.getTime() && availableAt.getTime() === afterDelay.getTime()) {
    return no(
      "too_soon_after_mailing",
      {
        es: `Todavía no: la ronda ${roundNumber} se cobra a partir del ${billingDay(availableAt, "es")}, un día después de enviarla.`,
        en: `Not yet: round ${roundNumber} is charged from ${billingDay(availableAt, "en")}, a day after it was mailed.`,
      },
      { roundNumber, availableAt: availableAt.toISOString() },
    );
  }
  if (now.getTime() < availableAt.getTime()) {
    return no(
      "too_soon_after_last_charge",
      {
        es: `Todavía no: la ronda ${roundNumber} se cobra a partir del ${billingDay(availableAt, "es")}, ${MIN_DAYS_BETWEEN_CHARGES} días después del trabajo del cobro anterior.`,
        en: `Not yet: round ${roundNumber} is charged from ${billingDay(availableAt, "en")}, ${MIN_DAYS_BETWEEN_CHARGES} days after the work of the previous charge.`,
      },
      { roundNumber, availableAt: availableAt.toISOString() },
    );
  }

  // 10. The charge is due. Is there a way to collect it?
  if (!account.paymentMethod || !account.paymentMethod.authorizedAt || !account.paymentMethod.authorizationVersion) {
    return no(
      "no_payment_method",
      {
        es: `Falta su método de pago: la ronda ${roundNumber} ya se puede cobrar y no hay con qué.`,
        en: `No payment method on file: round ${roundNumber} can be charged and there is nothing to charge.`,
      },
      { roundNumber, needsPerson: true },
    );
  }

  return { eligible: true, roundNumber, amountCents, workDate: new Date(round.mailedAt).toISOString() };
}
