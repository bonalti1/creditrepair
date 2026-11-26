import { AGREEMENT_TIME_ZONE } from "../agreement/businessDays";
import { deadlineOf, workMayStart } from "../agreement/gate";
import { feeToCents } from "./money";
import { installmentCents, periodTiming, type PlanSnapshot } from "./plans";
import type { Bilingual, BillableRound, BillingCharge, BillingContext, ChargeUnit, L, ProvenResult } from "./types";

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
  | "no_payment_method"
  /** The plan's most-you'll-pay total is reached, or its duration is over: nothing more is ever charged. */
  | "plan_complete"
  /** Work was done and the plan does not charge for it yet (a flat fee before its last round, a period still open). */
  | "waiting_for_work"
  /** The first charge waits for the plan's due date: N days after the first round was mailed. */
  | "before_due_date"
  /** Pay per delete is off until an administrator records the attorney's approval. A person looks. */
  | "pay_per_delete_off";

export type ChargeEligibility =
  | {
      eligible: true;
      roundNumber: number;
      /** The fee in the signed agreement, in cents. */
      amountCents: number;
      /** The round's mailing date: the day the work was done (ISO). */
      workDate: string;
      /** Set only under a plan (migration 0026): what the charge pays for. */
      unit?: ChargeUnit;
      /** The part of amountCents that is the first work fee. */
      firstWorkCents?: number;
      /** Referral credit applied to this charge. */
      creditCents?: number;
      periodStart?: string;
      periodEnd?: string;
      installmentNumber?: number;
      resultItemIds?: string[];
      /** DIY mailing: the request it pays for. */
      mailRequestId?: string;
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

export { feeToCents, formatCents } from "./money";

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
  // Under a plan the unit of work depends on the plan type. Without one (an
  // agreement signed before plans existed) it is the mailed round, as below.
  if (context.plan?.terms.type === "diy_subscription") return diyEligibility(context, context.plan, now);
  if (context.plan) return planEligibility(context, context.plan, now);
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

// ── Under a plan (migration 0026) ───────────────────────────────────────
//
// The same rule, for every plan type. What changes is the unit of work a
// charge pays for (pickUnit); everything else is common and in this order:
//   the agreement gate; work on record, mailed after the cancellation window;
//   the unit has no charge yet; the client did not ask to stop; the letters
//   reached someone; no pause and nothing unpaid; the plan's most-you'll-pay
//   total is not reached (the amount is trimmed to what is left); the
//   correction delay, the plan's due date and 30 days since the work date AND
//   the creation of the last charge; a payment method, unless a referral
//   credit covers it all. The database trigger checks the same (0026).

const unitOf = (charge: BillingCharge): ChargeUnit => charge.unit ?? "round";

/** What counts toward the cap: everything charged that was not returned. */
export function chargedTowardCap(charges: BillingCharge[]): number {
  return charges.filter((c) => c.status !== "refunded").reduce((n, c) => n + c.amountCents, 0);
}

/** What is left before the plan's most-you'll-pay total. */
export function remainingUnderCap(plan: Pick<PlanSnapshot, "effective">, charges: BillingCharge[]): number {
  return Math.max(0, plan.effective.maxTotalCents - chargedTowardCap(charges));
}

/** Subscription periods are 30 days long, counted from the first round's mailing. */
export const PERIOD_DAYS = 30;

export interface WorkPeriod {
  index: number;
  start: string;
  end: string;
  /** Rounds mailed inside the period. Empty: no work, no charge. */
  rounds: number[];
  /** True once the period is over. */
  ended: boolean;
  charged: boolean;
}

/** The rounds that count as work under a plan: mailed, in the past, and after the cancellation window. */
export function planRounds(context: BillingContext, now: Date): BillableRound[] {
  const deadline = context.agreement ? deadlineOf(context.agreement) : null;
  return performedRounds(context.rounds, now).filter((r) => !deadline || new Date(r.mailedAt!).getTime() > deadline.getTime());
}

/** The subscription's periods up to now, the current one included. */
export function subscriptionPeriods(context: BillingContext, now: Date): WorkPeriod[] {
  const rounds = planRounds(context, now);
  const first = rounds[0];
  if (!first?.mailedAt) return [];
  const anchor = new Date(first.mailedAt).getTime();
  const charged = new Set(context.account.charges.filter((c) => unitOf(c) === "period" && c.periodStart).map((c) => new Date(c.periodStart!).toISOString()));
  const periods: WorkPeriod[] = [];
  for (let i = 0; anchor + i * PERIOD_DAYS * DAY_MS <= now.getTime() && i < 120; i++) {
    const start = anchor + i * PERIOD_DAYS * DAY_MS;
    const end = start + PERIOD_DAYS * DAY_MS;
    const startIso = new Date(start).toISOString();
    periods.push({
      index: i,
      start: startIso,
      end: new Date(end).toISOString(),
      rounds: rounds.filter((r) => {
        const t = new Date(r.mailedAt!).getTime();
        return t >= start && t < end;
      }).map((r) => r.number),
      ended: end <= now.getTime(),
      charged: charged.has(startIso),
    });
  }
  return periods;
}

/** Pay per delete: the items that may be charged now. Disputed through us, after the window, shown gone by a later report. */
export function chargeableResults(context: BillingContext, plan: PlanSnapshot, now: Date): ProvenResult[] {
  const deadline = context.agreement ? deadlineOf(context.agreement) : null;
  const paid = new Set(context.account.charges.flatMap((c) => c.resultItemIds ?? []));
  return (context.results ?? []).filter((r) => {
    if (paid.has(r.itemId)) return false;
    if (r.outcome === "updated" && !plan.terms.countsUpdated) return false;
    if (r.outcome === "deleted" && !r.stillGone) return false;
    const disputed = new Date(r.disputedAt).getTime();
    const proved = new Date(r.provedAt).getTime();
    if (Number.isNaN(disputed) || Number.isNaN(proved)) return false;
    if (deadline && disputed <= deadline.getTime()) return false;
    return proved > disputed && proved <= now.getTime();
  });
}

interface Candidate {
  unit: ChargeUnit;
  /** The round the work is, for a round-based unit; null for results. */
  round: BillableRound | null;
  roundNumber: number;
  workDate: string;
  baseCents: number;
  firstWorkCents: number;
  periodStart?: string;
  periodEnd?: string;
  installmentNumber?: number;
  resultItemIds?: string[];
}

type Refusal = { code: IneligibleCode; reason: Bilingual; roundNumber?: number; availableAt?: string; needsPerson?: boolean };

function pickUnit(context: BillingContext, plan: PlanSnapshot, rounds: BillableRound[], now: Date): Candidate | Refusal {
  const charges = context.account.charges;
  const e = plan.effective;
  const t = plan.terms;
  const first = rounds[0] ?? null;
  const firstWorkDue = e.firstWorkFeeCents > 0 && !charges.some((c) => (c.firstWorkCents ?? 0) > 0 || unitOf(c) === "first_work");
  const nothingMailed: Refusal = {
    code: "nothing_mailed",
    reason: { es: "No hay nada que cobrar: todavía no se envía ninguna ronda.", en: "There is nothing to charge: no round has been mailed yet." },
  };
  const complete: Refusal = {
    code: "plan_complete",
    reason: {
      es: "No se cobra nada más: el plan llegó a su total máximo o a su duración.",
      en: "Nothing more is charged: the plan reached its maximum total or its length.",
    },
  };
  const unbilled = (es: string, en: string, extra: Partial<Refusal> = {}): Refusal => ({ code: "nothing_unbilled", reason: { es, en }, ...extra });
  if (!first) return nothingMailed;
  const firstWork = (): Candidate => ({ unit: "first_work", round: first, roundNumber: first.number, workDate: first.mailedAt!, baseCents: 0, firstWorkCents: e.firstWorkFeeCents });

  switch (t.type) {
    case "per_round": {
      const limit = t.duration.kind === "rounds" ? t.duration.count : Infinity;
      const charged = new Set(charges.filter((c) => unitOf(c) === "round").map((c) => c.roundNumber));
      const round = rounds.find((r) => r.number <= limit && !charged.has(r.number));
      if (!round) {
        return charged.size >= limit
          ? complete
          : unbilled("No hay nada que cobrar: cada ronda enviada ya tiene su cobro.", "There is nothing to charge: every mailed round already has its charge.");
      }
      return { unit: "round", round, roundNumber: round.number, workDate: round.mailedAt!, baseCents: e.recurringCents, firstWorkCents: firstWorkDue ? e.firstWorkFeeCents : 0 };
    }
    case "flat_fee": {
      const f = t.flat!;
      if (f.schedule === "installments") {
        const done = charges.filter((c) => unitOf(c) === "installment");
        if (done.length >= f.rounds) return complete;
        const charged = new Set(done.map((c) => c.roundNumber));
        const round = rounds.find((r) => r.number <= f.rounds && !charged.has(r.number));
        if (!round) return unbilled("No hay nada que cobrar: cada ronda enviada ya tiene su pago.", "There is nothing to charge: every mailed round already has its installment.");
        const k = done.length + 1;
        return {
          unit: "installment",
          round,
          roundNumber: round.number,
          workDate: round.mailedAt!,
          baseCents: installmentCents(e.flatTotalCents, f.rounds, k),
          firstWorkCents: firstWorkDue ? e.firstWorkFeeCents : 0,
          installmentNumber: k,
        };
      }
      if (firstWorkDue) return firstWork();
      if (charges.some((c) => unitOf(c) === "flat")) return complete;
      const last = rounds.find((r) => r.number === f.rounds);
      if (!last) {
        return {
          code: "waiting_for_work",
          reason: {
            es: `Todavía no: la tarifa fija se cobra después de enviar la ronda ${f.rounds}.`,
            en: `Not yet: the flat fee is charged after round ${f.rounds} is mailed.`,
          },
        };
      }
      return { unit: "flat", round: last, roundNumber: last.number, workDate: last.mailedAt!, baseCents: e.flatTotalCents, firstWorkCents: 0 };
    }
    case "subscription": {
      if (firstWorkDue) return firstWork();
      const limit = t.duration.kind === "months" ? t.duration.count : Infinity;
      // The owner's decision (2026-11-25): "on_mailing" charges the period right after its round is mailed.
      const onMailing = periodTiming(t) === "on_mailing";
      const periods = subscriptionPeriods(context, now);
      const chargedCount = charges.filter((c) => unitOf(c) === "period").length;
      const due = periods.find((p) => p.index < limit && (onMailing || p.ended) && !p.charged && p.rounds.length > 0);
      if (!due) {
        if (chargedCount >= limit || (periods.length > limit && periods.slice(0, limit).every((p) => p.ended))) return complete;
        const open = periods.find((p) => p.index < limit && !p.ended && p.rounds.length > 0 && !p.charged);
        if (open) {
          return {
            code: "waiting_for_work",
            reason: {
              es: `Todavía no: el mes con trabajo se cobra al cerrar el periodo, el ${billingDay(open.end, "es")}.`,
              en: `Not yet: the month with work is charged when the period ends, on ${billingDay(open.end, "en")}.`,
            },
            availableAt: open.end,
          };
        }
        return unbilled(
          "No hay nada que cobrar: los periodos sin cartas enviadas no se cobran.",
          "There is nothing to charge: a period with no letters mailed is not charged.",
        );
      }
      const round = rounds.find((r) => r.number === due.rounds[0]) ?? null;
      return {
        unit: "period",
        round,
        roundNumber: due.rounds[0]!,
        workDate: onMailing && round?.mailedAt ? round.mailedAt : due.end,
        baseCents: e.recurringCents,
        firstWorkCents: 0,
        periodStart: due.start,
        periodEnd: due.end,
      };
    }
    case "diy_subscription":
      // Never reached: a DIY plan is decided by diyEligibility. Nothing is charged as full-service work.
      return { code: "nothing_unbilled", reason: { es: "Un plan hazlo tú no se cobra como trabajo del equipo.", en: "A DIY plan is not charged as team work." } };
    case "pay_per_delete": {
      if (!context.switches?.payPerDelete) {
        return {
          code: "pay_per_delete_off",
          reason: {
            es: "No se cobra: el pago por eliminación está apagado hasta que se registre la aprobación del abogado.",
            en: "Nothing is charged: pay per delete is off until the attorney's approval is recorded.",
          },
          needsPerson: (context.results ?? []).length > 0,
        };
      }
      const results = chargeableResults(context, plan, now);
      if (results.length === 0) {
        return unbilled(
          "No hay nada que cobrar: ningún punto disputado aparece fuera de un reporte posterior sin cobrar.",
          "There is nothing to charge: no disputed item is shown gone by a later report and still unbilled.",
        );
      }
      const workDate = results.map((r) => new Date(r.provedAt).toISOString()).sort().at(-1)!;
      return {
        unit: "results",
        round: null,
        roundNumber: 0,
        workDate,
        baseCents: results.length * e.recurringCents,
        firstWorkCents: 0,
        resultItemIds: results.map((r) => r.itemId).sort(),
      };
    }
  }
}

function planEligibility(context: BillingContext, plan: PlanSnapshot, now: Date): ChargeEligibility {
  const { agreement, account } = context;
  const gate = workMayStart(agreement, now);
  if (!gate.allowed && (gate.code === "disclosure_not_acknowledged" || gate.code === "not_signed")) {
    return no("agreement_not_signed", { es: "No se cobra: no hay un acuerdo de servicio firmado.", en: "Nothing is charged: there is no signed service agreement." });
  }
  if (!gate.allowed && gate.code === "cancelled") {
    return no("agreement_cancelled", { es: "No se cobra: el cliente canceló su acuerdo.", en: "Nothing is charged: the client cancelled their agreement." });
  }
  if (!gate.allowed && gate.code === "in_cancellation_window") {
    return no(
      "in_cancellation_window",
      { es: "No se cobra: está en su periodo de cancelación.", en: "Nothing is charged: the client is inside the cancellation period." },
      gate.startsAt ? { availableAt: gate.startsAt } : {},
    );
  }

  const rounds = planRounds(context, now);
  const picked = pickUnit(context, plan, rounds, now);
  if ("code" in picked) return no(picked.code, picked.reason, { roundNumber: picked.roundNumber, availableAt: picked.availableAt, needsPerson: picked.needsPerson });
  const c = picked;
  const n = c.roundNumber;
  const which = c.unit === "results" ? { es: "los puntos que ya no aparecen", en: "the items no longer reported" } : { es: `la ronda ${n}`, en: `round ${n}` };
  const at = c.unit === "results" ? {} : { roundNumber: n };

  if (!gate.allowed && gate.code === "service_end_requested" && !BILL_PERFORMED_WORK_AFTER_END_REQUEST) {
    return no(
      "service_end_requested",
      {
        es: `No se cobra solo: el cliente pidió terminar el servicio y ${which.es} quedó sin cobrar. Lo decide una persona.`,
        en: `Not charged automatically: the client asked to end the service and ${which.en} is unbilled. A person decides.`,
      },
      { ...at, needsPerson: true },
    );
  }
  if (c.round && allLettersReturned(c.round)) {
    return no(
      "all_letters_returned",
      {
        es: `No se cobra sola: el correo devolvió todas las cartas de la ronda ${n}. La revisa una persona.`,
        en: `Not charged automatically: the post office returned every letter of round ${n}. A person reviews it.`,
      },
      { ...at, needsPerson: true },
    );
  }
  if (account.pause) {
    return no(
      "billing_paused",
      { es: `No se cobra: el equipo puso los cobros en pausa («${account.pause.reason}»).`, en: `Nothing is charged: the team paused billing ("${account.pause.reason}").` },
      at,
    );
  }
  const unpaid = account.charges.find(isUnpaid);
  if (unpaid) {
    return no(
      "earlier_charge_unpaid",
      { es: "No se crea un cobro nuevo: uno anterior sigue sin pagarse.", en: "No new charge is created: an earlier one is still unpaid." },
      at,
    );
  }

  // The amount: from the signed snapshot, trimmed to what is left under the cap.
  const remaining = remainingUnderCap(plan, account.charges);
  if (remaining <= 0) {
    return no("plan_complete", {
      es: "No se cobra nada más: ya se cobró el total máximo del plan.",
      en: "Nothing more is charged: the plan's maximum total has been charged.",
    });
  }
  const amountCents = Math.min(c.baseCents + c.firstWorkCents, remaining);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return no("no_amount", { es: "No se cobra: el plan firmado no da un monto válido. Lo revisa una persona.", en: "Nothing is charged: the signed plan gives no valid amount. A person has to look." }, { ...at, needsPerson: true });
  }
  const firstWorkCents = Math.min(c.firstWorkCents, amountCents);

  // When: the correction delay, the due date, and 30 days since the last charge's work AND its creation.
  const afterDelay = addDays(c.workDate, CHARGE_DELAY_DAYS);
  const first = rounds[0]!;
  const dueDays = plan.terms.dueRule.kind === "days_after_first_round" ? plan.terms.dueRule.days : 0;
  const afterDue = addDays(first.mailedAt!, Math.max(CHARGE_DELAY_DAYS, dueDays));
  const previous = lastChargedWork(account.charges);
  const lastCreated = account.charges.reduce<string | null>((latest, ch) => (ch.createdAt && (!latest || ch.createdAt > latest) ? ch.createdAt : latest), null);
  const spacing = [previous ? addDays(previous.workDate, MIN_DAYS_BETWEEN_CHARGES) : null, lastCreated ? addDays(lastCreated, MIN_DAYS_BETWEEN_CHARGES) : null].filter(
    (d): d is Date => d !== null && !Number.isNaN(d.getTime()),
  );
  const afterSpacing = spacing.sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const candidates: Array<[IneligibleCode, Date]> = [["too_soon_after_mailing", afterDelay], ["before_due_date", afterDue]];
  if (afterSpacing) candidates.push(["too_soon_after_last_charge", afterSpacing]);
  const [code, availableAt] = candidates.reduce((a, b) => (b[1].getTime() > a[1].getTime() ? b : a));
  if (now.getTime() < availableAt.getTime()) {
    const day = { es: billingDay(availableAt, "es"), en: billingDay(availableAt, "en") };
    const why =
      code === "too_soon_after_last_charge"
        ? { es: `${MIN_DAYS_BETWEEN_CHARGES} días después del cobro anterior`, en: `${MIN_DAYS_BETWEEN_CHARGES} days after the previous charge` }
        : code === "before_due_date"
          ? { es: "en la fecha de cobro del plan", en: "on the plan's due date" }
          : { es: "un día después del trabajo", en: "a day after the work" };
    return no(
      code,
      { es: `Todavía no: ${which.es} se cobra a partir del ${day.es}, ${why.es}.`, en: `Not yet: ${which.en} is charged from ${day.en}, ${why.en}.` },
      { ...at, availableAt: availableAt.toISOString() },
    );
  }

  // A referral credit is applied first; it never creates a charge, it only lowers one that is due.
  const creditCents = context.switches?.referralCredits ? Math.min(Math.max(0, context.creditBalanceCents ?? 0), amountCents) : 0;
  if (amountCents - creditCents > 0 && (!account.paymentMethod || !account.paymentMethod.authorizedAt || !account.paymentMethod.authorizationVersion)) {
    return no(
      "no_payment_method",
      {
        es: `Falta su método de pago: ${which.es} ya se puede cobrar y no hay con qué.`,
        en: `No payment method on file: ${which.en} can be charged and there is nothing to charge.`,
      },
      { ...at, needsPerson: true },
    );
  }

  return {
    eligible: true,
    roundNumber: n,
    amountCents,
    workDate: new Date(c.workDate).toISOString(),
    unit: c.unit,
    firstWorkCents,
    creditCents,
    ...(c.periodStart ? { periodStart: c.periodStart, periodEnd: c.periodEnd } : {}),
    ...(c.installmentNumber ? { installmentNumber: c.installmentNumber } : {}),
    ...(c.resultItemIds ? { resultItemIds: c.resultItemIds } : {}),
  };
}

// ── Do it yourself, guided (migration 0042) ─────────────────────────────
//
// The other service option. The client performs their disputes with the
// software, and the owner reports the attorney approved a monthly
// subscription charged from the start for it (docs/SERVICE-OPTIONS.md,
// 2026-11-25). What may be charged, in this order:
//
//   the agreement gate (signed, not cancelled, PAST the 3-business-day
//   cancellation window: that stays); no pause, nothing unpaid; then a
//   mailing the client asked for and Credalti already mailed (once, at the
//   total the client accepted); else the subscription period now running,
//   once per 30-day period counted from the end of the window (or from 30
//   days after the last charge under an earlier agreement, after a switch),
//   within the plan's length and its most-you'll-pay total; a payment method.
// The trigger checks the same (0042: diy_period, mailing).

const sameAgreement = (context: BillingContext, charge: BillingCharge): boolean =>
  !context.agreementId || !charge.agreementId || charge.agreementId === context.agreementId;

/** When the DIY subscription periods start counting: the end of the window, or the next cycle after an earlier agreement's last charge. */
export function diyAnchor(context: BillingContext): Date | null {
  const deadline = context.agreement ? deadlineOf(context.agreement) : null;
  if (!deadline) return null;
  const earlier = context.account.charges
    .filter((c) => !sameAgreement(context, c) && c.createdAt)
    .map((c) => addDays(c.createdAt, MIN_DAYS_BETWEEN_CHARGES).getTime());
  return new Date(Math.max(deadline.getTime(), ...earlier));
}

/** The DIY subscription period running at `now`: index, start and end. Null before the anchor. */
export function diyPeriodAt(context: BillingContext, now: Date): { index: number; start: string; end: string } | null {
  const anchor = diyAnchor(context);
  if (!anchor || now.getTime() < anchor.getTime()) return null;
  const index = Math.floor((now.getTime() - anchor.getTime()) / (PERIOD_DAYS * DAY_MS));
  const start = anchor.getTime() + index * PERIOD_DAYS * DAY_MS;
  return { index, start: new Date(start).toISOString(), end: new Date(start + PERIOD_DAYS * DAY_MS).toISOString() };
}

function diyEligibility(context: BillingContext, plan: PlanSnapshot, now: Date): ChargeEligibility {
  const { agreement, account } = context;
  const gate = workMayStart(agreement, now);
  if (!gate.allowed && (gate.code === "disclosure_not_acknowledged" || gate.code === "not_signed")) {
    return no("agreement_not_signed", { es: "No se cobra: no hay un acuerdo de servicio firmado.", en: "Nothing is charged: there is no signed service agreement." });
  }
  if (!gate.allowed && gate.code === "cancelled") {
    return no("agreement_cancelled", { es: "No se cobra: el cliente canceló su acuerdo.", en: "Nothing is charged: the client cancelled their agreement." });
  }
  if (!gate.allowed && gate.code === "in_cancellation_window") {
    return no(
      "in_cancellation_window",
      { es: "No se cobra: está en su periodo de cancelación.", en: "Nothing is charged: the client is inside the cancellation period." },
      gate.startsAt ? { availableAt: gate.startsAt } : {},
    );
  }
  if (!gate.allowed && gate.code === "service_end_requested") {
    return no("service_end_requested", {
      es: "No se cobra: el cliente pidió terminar el servicio. La suscripción no se cobra más.",
      en: "Nothing is charged: the client asked to end the service. The subscription is not charged again.",
    });
  }
  if (account.pause) {
    return no("billing_paused", { es: `No se cobra: el equipo puso los cobros en pausa («${account.pause.reason}»).`, en: `Nothing is charged: the team paused billing ("${account.pause.reason}").` });
  }
  if (account.charges.some(isUnpaid)) {
    return no("earlier_charge_unpaid", { es: "No se crea un cobro nuevo: uno anterior sigue sin pagarse.", en: "No new charge is created: an earlier one is still unpaid." });
  }
  const needMethod = (what: Bilingual) =>
    !account.paymentMethod || !account.paymentMethod.authorizedAt || !account.paymentMethod.authorizationVersion
      ? no("no_payment_method", { es: `Falta su método de pago: ${what.es} ya se puede cobrar y no hay con qué.`, en: `No payment method on file: ${what.en} can be charged and there is nothing to charge.` }, { needsPerson: true })
      : null;

  // A mailing the client asked for, which we already mailed.
  const charged = new Set(account.charges.map((c) => c.mailRequestId).filter(Boolean));
  const mailing = (context.mailings ?? []).find(
    (m) => m.status === "mailed" && m.mailedAt && new Date(m.mailedAt).getTime() <= now.getTime() && !charged.has(m.id) && sameAgreementId(context, m.agreementId),
  );
  if (mailing) {
    const what = { es: `el envío de ${mailing.letterCount} ${mailing.letterCount === 1 ? "carta" : "cartas"}`, en: `the mailing of ${mailing.letterCount} ${mailing.letterCount === 1 ? "letter" : "letters"}` };
    if (mailing.allReturned) {
      return no(
        "all_letters_returned",
        { es: `No se cobra solo: el correo devolvió todas las cartas de ${what.es}. La revisa una persona.`, en: `Not charged automatically: the post office returned every letter of ${what.en}. A person reviews it.` },
        { roundNumber: mailing.roundNumber, needsPerson: true },
      );
    }
    const missing = needMethod(what);
    if (missing) return missing;
    return {
      eligible: true,
      roundNumber: mailing.roundNumber,
      amountCents: mailing.totalCents,
      workDate: new Date(mailing.mailedAt!).toISOString(),
      unit: "mailing",
      firstWorkCents: 0,
      creditCents: 0,
      mailRequestId: mailing.id,
    };
  }

  // The subscription: the period running now.
  const period = diyPeriodAt(context, now);
  if (!period) {
    const anchor = diyAnchor(context);
    return no(
      "before_due_date",
      anchor
        ? { es: `Todavía no: la suscripción empieza el ${billingDay(anchor, "es")}, en el siguiente ciclo.`, en: `Not yet: the subscription starts on ${billingDay(anchor, "en")}, at the next cycle.` }
        : { es: "Todavía no: la suscripción empieza al terminar el periodo de cancelación.", en: "Not yet: the subscription starts when the cancellation period ends." },
      anchor ? { availableAt: anchor.toISOString() } : {},
    );
  }
  const t = plan.terms;
  if (t.duration.kind === "months" && period.index >= t.duration.count) {
    return no("plan_complete", { es: "No se cobra nada más: la suscripción llegó a su duración.", en: "Nothing more is charged: the subscription reached its length." });
  }
  const periodCharges = account.charges.filter((c) => unitOf(c) === "diy_period" && sameAgreement(context, c));
  if (periodCharges.some((c) => c.periodStart && new Date(c.periodStart).toISOString() === period.start)) {
    return no(
      "waiting_for_work",
      { es: `Ya se cobró este periodo. El siguiente empieza el ${billingDay(period.end, "es")}.`, en: `This period is already charged. The next one starts on ${billingDay(period.end, "en")}.` },
      { availableAt: period.end },
    );
  }
  const remaining = Math.max(0, plan.effective.maxTotalCents - chargedTowardCap(periodCharges));
  if (remaining <= 0) {
    return no("plan_complete", { es: "No se cobra nada más: ya se cobró el total máximo de la suscripción.", en: "Nothing more is charged: the subscription's maximum total has been charged." });
  }
  const amountCents = Math.min(plan.effective.recurringCents, remaining);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return no("no_amount", { es: "No se cobra: el plan firmado no da un monto válido. Lo revisa una persona.", en: "Nothing is charged: the signed plan gives no valid amount. A person has to look." }, { needsPerson: true });
  }
  const missing = needMethod({ es: "la suscripción de este mes", en: "this month's subscription" });
  if (missing) return missing;
  return {
    eligible: true,
    roundNumber: 0,
    amountCents,
    workDate: period.start,
    unit: "diy_period",
    firstWorkCents: 0,
    creditCents: 0,
    periodStart: period.start,
    periodEnd: period.end,
  };
}

function sameAgreementId(context: BillingContext, agreementId: string | null | undefined): boolean {
  return !context.agreementId || !agreementId || agreementId === context.agreementId;
}
