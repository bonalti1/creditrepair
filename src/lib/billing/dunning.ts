import { workMayStart } from "../agreement/gate";
import { BRAND } from "../brand";
import { billingDay, formatCents, isPerformed, isUnpaid } from "./rules";
import type { Bilingual, BillingAccount, BillingCharge, BillingContext, L } from "./types";

// What happens when a payment does not go through.
//
// A short, humane schedule. The first decline is followed by two more tries,
// 3 and 7 days after it, and the client is told plainly each time. There are
// no late fees, no penalties and no threats. After the last decline the case
// pauses: no new round is prepared or sent until the payment is settled. The
// moment it is paid, the case moves again on its own.
//
// It is always the SAME charge that is retried. A failed payment never
// creates a second charge for the round.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days after the FIRST declined attempt on which the system tries again. */
export const DUNNING_RETRY_DAYS = [3, 7] as const;

/** The first attempt plus the retries. */
export const MAX_AUTOMATIC_ATTEMPTS = 1 + DUNNING_RETRY_DAYS.length;

/** What the processor said about one attempt. */
export type AttemptResult =
  | { ok: true; reference: string }
  /** The card or the bank said no. Counts as an attempt. */
  | { ok: false; code: string };

/**
 * When to try again after a decline that was attempt number `attemptsMade`
 * (1 = the first try), or null when the automatic retries are used up.
 */
export function nextRetryAt(attemptsMade: number, declinedAt: Date): Date | null {
  if (attemptsMade < 1 || attemptsMade >= MAX_AUTOMATIC_ATTEMPTS) return null;
  // The schedule counts from the first decline: 3 days, then 7 (so 4 more).
  const day = DUNNING_RETRY_DAYS[attemptsMade - 1]!;
  const previous = attemptsMade === 1 ? 0 : DUNNING_RETRY_DAYS[attemptsMade - 2]!;
  return new Date(declinedAt.getTime() + (day - previous) * DAY_MS);
}

/** The charge as it stands after the processor answered one attempt. Pure: returns a new object. */
export function afterAttempt(charge: BillingCharge, result: AttemptResult, now: Date): BillingCharge {
  const attempts = charge.attempts + 1;
  const at = now.toISOString();
  if (result.ok) {
    return { ...charge, status: "succeeded", attempts, lastAttemptAt: at, chargedAt: at, nextAttemptAt: null, failureCode: null };
  }
  return {
    ...charge,
    status: "failed",
    attempts,
    lastAttemptAt: at,
    nextAttemptAt: nextRetryAt(attempts, now)?.toISOString() ?? null,
    failureCode: result.code.slice(0, 80),
  };
}

/**
 * The client put a new payment method on file: every declined charge gets one
 * more try, right away. The count of attempts is kept; if this try is also
 * declined and the automatic retries were already used up, the charge waits
 * for the client again.
 */
export function rearmAfterNewPaymentMethod(charge: BillingCharge, now: Date): BillingCharge {
  return charge.status === "failed" ? { ...charge, nextAttemptAt: now.toISOString() } : charge;
}

// ── Where a charge and an account stand ─────────────────────────────────

export type ChargeStanding =
  /** Waiting on the processor's first answer. */
  | "processing"
  | "paid"
  | "refunded"
  /** Declined, and the system will try again on its own. */
  | "retrying"
  /** Declined, and the automatic retries are used up. The client has to fix the payment. */
  | "exhausted";

export function chargeStanding(charge: BillingCharge): ChargeStanding {
  if (charge.status === "succeeded") return "paid";
  if (charge.status === "refunded") return "refunded";
  if (charge.status === "pending") return "processing";
  return charge.nextAttemptAt ? "retrying" : "exhausted";
}

export type AccountStanding =
  /** Nothing has been charged yet. */
  | "none"
  /** Every charge is settled. */
  | "current"
  /** A payment was declined and the system is still retrying it: the system's job. */
  | "retrying"
  /** The retries are used up. The case is paused until the client fixes the payment. */
  | "past_due";

export function accountStanding(account: BillingAccount): AccountStanding {
  if (account.charges.length === 0) return "none";
  const standings = account.charges.map(chargeStanding);
  if (standings.includes("exhausted")) return "past_due";
  if (standings.includes("retrying")) return "retrying";
  return "current";
}

/**
 * True when the case is paused for an unpaid charge: no new round is prepared
 * or sent. Lifts by itself the moment the charge is paid.
 */
export function casePausedForPayment(account: BillingAccount): boolean {
  return accountStanding(account) === "past_due";
}

/** The declined charge the account is waiting on, if any (the oldest one). */
export function unpaidCharge(account: BillingAccount): BillingCharge | null {
  return account.charges.find((charge) => charge.status === "failed") ?? null;
}

// ── May the system try a charge again? ──────────────────────────────────

export type RetryBlock =
  | "not_unpaid"
  | "not_due"
  /** The round the charge pays for is no longer recorded as mailed (it was marked sent by mistake). */
  | "work_not_on_record"
  | "no_payment_method"
  | "billing_paused"
  | "agreement_cancelled"
  | "service_end_requested";

export type RetryEligibility = { allowed: true } | { allowed: false; code: RetryBlock; needsPerson: boolean };

/**
 * Whether the system may send an existing unpaid charge to the processor
 * again now. The charge already passed chargeEligibility when it was created,
 * so the work is on record; this only checks that nothing has happened since
 * that stops collection.
 */
export function retryEligibility(charge: BillingCharge, context: BillingContext, now: Date): RetryEligibility {
  const block = (code: RetryBlock, needsPerson = false): RetryEligibility => ({ allowed: false, code, needsPerson });
  if (!isUnpaid(charge)) return block("not_unpaid");
  // The work must still be on record: a round un-marked as sent is not collected for.
  const round = context.rounds.find((r) => r.number === charge.roundNumber);
  if (!round || !isPerformed(round, now)) return block("work_not_on_record", true);
  if (context.agreement?.cancelledAt) return block("agreement_cancelled", true);
  // The client asked to stop: whether work already done may still be collected is a person's call.
  const gate = workMayStart(context.agreement, now);
  if (!gate.allowed && gate.code === "service_end_requested") return block("service_end_requested", true);
  if (context.account.pause) return block("billing_paused");
  if (!context.account.paymentMethod) return block("no_payment_method", true);
  if (charge.status === "failed") {
    if (!charge.nextAttemptAt) return block("not_due");
    if (new Date(charge.nextAttemptAt).getTime() > now.getTime()) return block("not_due");
  }
  return { allowed: true };
}

// ── What the client is told ─────────────────────────────────────────────

export interface DunningMessageInput {
  firstName?: string | null;
  charge: Pick<BillingCharge, "roundNumber" | "amountCents" | "workDate" | "attempts" | "nextAttemptAt">;
}

function hello(firstName: string | null | undefined, locale: L): string {
  const name = firstName?.trim();
  if (locale === "es") return name ? `Hola ${name}, te escribe el equipo de ${BRAND.name}.` : `Hola, te escribe el equipo de ${BRAND.name}.`;
  return name ? `Hi ${name}, this is the ${BRAND.name} team.` : `Hi, this is the ${BRAND.name} team.`;
}

/**
 * The message for a declined payment, as a draft in both languages. Which one
 * it is follows from the charge: while a retry is scheduled it says when;
 * after the last one it says the case is paused and how to resume it.
 *
 * Plain on purpose: what was charged for, what happens next, how to fix it.
 * No fee, no threat, nothing about what the letters may achieve. Every one is
 * checked against the claim rules in the tests.
 */
export function paymentFailedMessage(input: DunningMessageInput): Bilingual {
  const body = paymentFailedBody(input.charge);
  return { es: `${hello(input.firstName, "es")} ${body.es}`, en: `${hello(input.firstName, "en")} ${body.en}` };
}

/** The same message without its greeting, for a place that already wrote one. */
export function paymentFailedBody(charge: DunningMessageInput["charge"]): Bilingual {
  const amount = formatCents(charge.amountCents);
  const work = {
    es: `tu ronda ${charge.roundNumber} de cartas, que tu equipo envió el ${billingDay(charge.workDate, "es")}`,
    en: `your round ${charge.roundNumber} of letters, which your team mailed on ${billingDay(charge.workDate, "en")}`,
  };
  if (charge.nextAttemptAt) {
    const retry = { es: billingDay(charge.nextAttemptAt, "es"), en: billingDay(charge.nextAttemptAt, "en") };
    const again = charge.attempts > 1;
    return {
      es: `${again ? "Otra vez no" : "No"} pudimos procesar el cobro de ${amount} por ${work.es}. A veces es un dato de la tarjeta o un límite del banco. Lo intentamos de nuevo el ${retry.es}. Si prefieres usar otro método de pago, puedes cambiarlo en la app, en «Mis pagos». No hay ningún cargo extra por esto.`,
      en: `${again ? "Again we" : "We"} could not process the ${amount} charge for ${work.en}. Sometimes it is a card detail or a bank limit. We will try again on ${retry.en}. If you would rather use another payment method, you can change it in the app, under "My payments". There is no extra charge for this.`,
    };
  }
  return {
    es: `No pudimos procesar el cobro de ${amount} por ${work.es}, y ya no lo intentaremos por nuestra cuenta. No hay cargos extra ni recargos. Tu caso queda en pausa: no se preparan ni se envían más cartas hasta que el pago quede resuelto. En cuanto actualices tu método de pago en la app, en «Mis pagos», tu caso sigue solo. Si prefieres hablarlo con una persona, respóndenos por aquí.`,
    en: `We could not process the ${amount} charge for ${work.en}, and we will not try again on our own. There are no extra charges and no late fees. Your case is paused: no more letters are prepared or mailed until the payment is settled. As soon as you update your payment method in the app, under "My payments", your case continues by itself. If you would rather talk it over with a person, reply here.`,
  };
}

/** The message when a charge is due and no payment method is on file. */
export function paymentMethodNeededMessage(input: { firstName?: string | null; roundNumber: number; workDate: string }): Bilingual {
  const body = paymentMethodNeededBody(input);
  return { es: `${hello(input.firstName, "es")} ${body.es}`, en: `${hello(input.firstName, "en")} ${body.en}` };
}

/** The same message without its greeting. */
export function paymentMethodNeededBody(input: { roundNumber: number; workDate: string }): Bilingual {
  return {
    es: `Tu equipo envió tu ronda ${input.roundNumber} de cartas el ${billingDay(input.workDate, "es")} y todavía no tenemos tu método de pago. Puedes agregarlo en la app, en «Mis pagos»; toma un minuto. El cobro es por ese trabajo, que ya se hizo. ¿Te ayudo con algo?`,
    en: `Your team mailed your round ${input.roundNumber} of letters on ${billingDay(input.workDate, "en")} and we do not have your payment method yet. You can add it in the app, under "My payments"; it takes a minute. The charge is for that work, which is already done. Can I help with anything?`,
  };
}
