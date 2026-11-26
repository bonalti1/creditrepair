import { workMayStart } from "../agreement/gate";
import { chargeStanding, MAX_AUTOMATIC_ATTEMPTS } from "./dunning";
import { billingDay, chargeEligibility, feeToCents, formatCents, isUnpaid, performedRounds } from "./rules";
import { upcomingCharges } from "./schedule";
import type { Bilingual, BillingContext, L } from "./types";

// "What happens next with the money", in one honest sentence. The staff
// console prints `staff` (Spanish, about the client); the client's "Mis pagos"
// screen prints `client` (to the client, both languages).
//
// The sentence is derived from the same rule that charges, so it cannot say a
// charge is coming when the rule would refuse it.

export type OutlookKind =
  /** The system will charge a round, on `at` (or today). */
  | "charge_scheduled"
  /** A payment was declined and the system will try again on `at`. */
  | "retry_scheduled"
  /** The processor has not answered yet. */
  | "processing"
  /** The retries are used up: the case is paused until the client fixes the payment. */
  | "paused_for_payment"
  /** A charge is due and no payment method is on file. */
  | "payment_method_missing"
  /** Nothing to charge, and nothing wrong. */
  | "nothing_to_charge"
  /** The law or the agreement says nothing may be charged (window, cancelled, unsigned). */
  | "not_chargeable"
  /** The system will not act by itself: a person has to decide. */
  | "needs_person"
  /** Staff paused billing for this client. */
  | "billing_paused";

export interface BillingOutlook {
  kind: OutlookKind;
  /** For the staff console. Spanish. */
  staff: string;
  /** The same for the staff console in English. */
  staffEn: string;
  /** For the client. */
  client: Bilingual;
  /** When the system acts next, when it has a date (ISO). */
  at: string | null;
  roundNumber: number | null;
}

function calendarDay(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

/** "hoy" / "mañana" / "el 23 de noviembre". */
function when(at: Date, now: Date, locale: L): string {
  const today = calendarDay(now);
  if (at.getTime() <= now.getTime() || calendarDay(at) === today) return locale === "es" ? "hoy" : "today";
  const tomorrow = calendarDay(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  if (calendarDay(at) === tomorrow) return locale === "es" ? "mañana" : "tomorrow";
  return locale === "es" ? `el ${billingDay(at, "es")}` : `on ${billingDay(at, "en")}`;
}

export function billingOutlook(
  context: BillingContext,
  now: Date,
  /** `amounts: false` leaves the amount out of the client's sentences (the demo, when no plan fee is set). */
  options: { amounts?: boolean } = {},
): BillingOutlook {
  const { account, agreement } = context;
  const make = (kind: OutlookKind, [staff, staffEn]: [string, string], client: Bilingual, at: string | null = null, roundNumber: number | null = null) => ({
    kind,
    staff,
    staffEn,
    client,
    at,
    roundNumber,
  });
  // Under a plan the amount is the next charge the rule would make (a first work fee, an installment…).
  const next = context.plan ? (upcomingCharges(context, now, 1)[0] ?? null) : null;
  const fee = context.plan ? (next?.amountCents ?? null) : feeToCents(context.signedMonthlyFee);
  const amount = fee === null || options.amounts === false ? "" : formatCents(fee);
  const ofAmount = { es: amount ? ` de ${amount}` : "", en: amount ? ` of ${amount}` : "" };

  const gate = workMayStart(agreement, now);
  const stopped = !gate.allowed && (gate.code === "cancelled" || gate.code === "service_end_requested");

  // An unpaid charge comes first: it is what the client and the team are looking at.
  const unpaid = account.charges.find(isUnpaid);
  if (unpaid) {
    const n = unpaid.roundNumber;
    // What the unpaid charge is for, in the client's words: a Credalti DIY subscription or mailing is not "a round".
    const forWhat =
      unpaid.unit === "diy_period"
        ? { es: "por tu suscripción de Credalti DIY", en: "for your Credalti DIY subscription" }
        : unpaid.unit === "mailing"
          ? { es: "por las cartas que enviamos por ti", en: "for the letters we mailed for you" }
          : { es: `por tu ronda ${n}`, en: `for your round ${n}` };
    if (stopped) {
      return make(
        "needs_person",
        [
          `El cobro de la ronda ${n} quedó sin pagar y el sistema ya no lo intenta: el cliente ${gate.code === "cancelled" ? "canceló su acuerdo" : "pidió terminar el servicio"}. Lo decide una persona.`,
          `The round ${n} charge is unpaid and the system has stopped trying: the client ${gate.code === "cancelled" ? "cancelled their agreement" : "asked to end the service"}. A person decides.`,
        ],
        {
          es: "No se hace ningún cobro automático. Una persona del equipo te escribe para resolverlo contigo.",
          en: "No automatic charge is made. A person on the team will write to you to settle it with you.",
        },
        null,
        n,
      );
    }
    if (account.pause) {
      return make(
        "billing_paused",
        [
          `Cobros en pausa por el equipo desde el ${billingDay(account.pause.at, "es")}: «${account.pause.reason}». El cobro de la ronda ${n} no se intenta mientras tanto.`,
          `Billing paused by the team since ${billingDay(account.pause.at, "en")}: “${account.pause.reason}”. The round ${n} charge isn't tried in the meantime.`,
        ],
        {
          es: "Tu equipo puso tus cobros en pausa. No se cobra nada por ahora.",
          en: "Your team paused your billing. Nothing is charged for now.",
        },
        null,
        n,
      );
    }
    const standing = chargeStanding(unpaid);
    if (standing === "retrying" && unpaid.nextAttemptAt) {
      const at = new Date(unpaid.nextAttemptAt);
      if (!account.paymentMethod) {
        return make(
          "payment_method_missing",
          [
            `Falta su método de pago: el cobro de la ronda ${n} no pasó y ya no hay un método en archivo para intentarlo de nuevo.`,
            `No payment method: the round ${n} charge didn't go through and there's no method on file to try it again.`,
          ],
          {
            es: `El cobro${ofAmount.es} ${forWhat.es} no pasó y ya no hay un método de pago en tu cuenta. Agrega uno para resolverlo.`,
            en: `The charge${ofAmount.en} ${forWhat.en} did not go through and there is no payment method on your account. Add one to settle it.`,
          },
          null,
          n,
        );
      }
      return make(
        "retry_scheduled",
        [
          `El cobro de la ronda ${n} no pasó. El sistema lo intenta de nuevo ${when(at, now, "es")} (intento ${unpaid.attempts + 1} de ${Math.max(MAX_AUTOMATIC_ATTEMPTS, unpaid.attempts + 1)}).`,
          `The round ${n} charge didn't go through. The system tries again ${when(at, now, "en")} (try ${unpaid.attempts + 1} of ${Math.max(MAX_AUTOMATIC_ATTEMPTS, unpaid.attempts + 1)}).`,
        ],
        {
          es: `El cobro${ofAmount.es} ${forWhat.es} no pasó. Lo intentamos de nuevo ${when(at, now, "es")}. No tienes que hacer nada, y no hay ningún cargo extra.`,
          en: `The charge${ofAmount.en} ${forWhat.en} did not go through. We will try again ${when(at, now, "en")}. There is nothing you need to do, and no extra charge.`,
        },
        unpaid.nextAttemptAt,
        n,
      );
    }
    if (standing === "exhausted") {
      return make(
        "paused_for_payment",
        [
          `El cobro de la ronda ${n} no pasó en ${unpaid.attempts} ${unpaid.attempts === 1 ? "intento" : "intentos"} y el sistema ya no lo intenta. El caso está en pausa; en cuanto el cliente actualice su método de pago, se cobra y sigue solo.`,
          `The round ${n} charge failed after ${unpaid.attempts} ${unpaid.attempts === 1 ? "try" : "tries"} and the system has stopped trying. The case is paused; once the client updates their payment method, it's charged and moves on by itself.`,
        ],
        {
          es: `El cobro${ofAmount.es} ${forWhat.es} no pasó y ya no lo intentamos por nuestra cuenta. Tu caso está en pausa. En cuanto actualices tu método de pago, se resuelve y tu caso sigue solo. No hay cargos extra.`,
          en: `The charge${ofAmount.en} ${forWhat.en} did not go through and we are no longer trying on our own. Your case is paused. As soon as you update your payment method, it is settled and your case continues by itself. There are no extra charges.`,
        },
        null,
        n,
      );
    }
    return make(
      "processing",
      [`El cobro de la ronda ${n} está en proceso con el procesador de pagos.`, `The round ${n} charge is processing with the payment processor.`],
      {
        es: `El cobro${ofAmount.es} ${forWhat.es} está en proceso.`,
        en: `The charge${ofAmount.en} ${forWhat.en} is being processed.`,
      },
      null,
      n,
    );
  }

  const eligibility = chargeEligibility(context, now);
  // Under a plan, the work a charge pays for is not always "a round": say exactly which work it is.
  if (context.plan && next && (eligibility.eligible || eligibility.code === "too_soon_after_mailing" || eligibility.code === "too_soon_after_last_charge" || eligibility.code === "before_due_date" || eligibility.code === "waiting_for_work")) {
    const at = new Date(next.at);
    const noMethod = !account.paymentMethod;
    return make(
      "charge_scheduled",
      [
        `El sistema cobra ${formatCents(next.amountCents)} ${when(at, now, "es")}: ${next.work.es}.${noMethod ? " Todavía no hay método de pago en archivo." : ""}`,
        `The system charges ${formatCents(next.amountCents)} ${when(at, now, "en")}: ${next.work.en}.${noMethod ? " There's no payment method on file yet." : ""}`,
      ],
      context.plan.terms.type === "diy_subscription"
        ? {
            // Credalti DIY: a simple monthly subscription, not a charge for work our team did.
            es: `El cobro${ofAmount.es} se hace ${when(at, now, "es")}: ${next.work.es}.`,
            en: `The charge${ofAmount.en} is made ${when(at, now, "en")}: ${next.work.en}.`,
          }
        : {
            es: `El cobro${ofAmount.es} se hace ${when(at, now, "es")}, por trabajo ya hecho: ${next.work.es}.`,
            en: `The charge${ofAmount.en} is made ${when(at, now, "en")}, for work already done: ${next.work.en}.`,
          },
      next.at,
      eligibility.eligible ? eligibility.roundNumber : (eligibility.roundNumber ?? null),
    );
  }
  if (eligibility.eligible) {
    const n = eligibility.roundNumber;
    return make(
      "charge_scheduled",
      [`El sistema cobra la ronda ${n} hoy.`, `The system charges for round ${n} today.`],
      {
        es: `Tu equipo envió tu ronda ${n} el ${billingDay(eligibility.workDate, "es")}. El cobro${ofAmount.es} por ese trabajo se hace hoy.`,
        en: `Your team mailed your round ${n} on ${billingDay(eligibility.workDate, "en")}. The charge${ofAmount.en} for that work is made today.`,
      },
      now.toISOString(),
      n,
    );
  }

  const n = eligibility.roundNumber ?? null;
  const mailedOn = (locale: L): string => {
    const round = context.rounds.find((r) => r.number === n);
    return round?.mailedAt ? billingDay(round.mailedAt, locale) : "";
  };

  switch (eligibility.code) {
    case "too_soon_after_mailing":
    case "too_soon_after_last_charge": {
      const at = new Date(eligibility.availableAt!);
      const noMethod = !account.paymentMethod;
      return make(
        "charge_scheduled",
        [
          `El sistema cobra la ronda ${n} ${when(at, now, "es")}.${noMethod ? " Todavía no hay método de pago en archivo." : ""}`,
          `The system charges for round ${n} ${when(at, now, "en")}.${noMethod ? " There's no payment method on file yet." : ""}`,
        ],
        {
          es: `Tu equipo envió tu ronda ${n} el ${mailedOn("es")}. El cobro${ofAmount.es} por ese trabajo se hace ${when(at, now, "es")}.`,
          en: `Your team mailed your round ${n} on ${mailedOn("en")}. The charge${ofAmount.en} for that work is made ${when(at, now, "en")}.`,
        },
        eligibility.availableAt!,
        n,
      );
    }
    case "no_payment_method":
      return make(
        "payment_method_missing",
        [`Falta su método de pago: la ronda ${n} ya se puede cobrar y no hay con qué.`, `No payment method: round ${n} can be charged now and there's nothing to charge it to.`],
        {
          es: `Tu equipo envió tu ronda ${n} el ${mailedOn("es")}. Falta tu método de pago para el cobro${ofAmount.es} por ese trabajo.`,
          en: `Your team mailed your round ${n} on ${mailedOn("en")}. Your payment method is missing for the charge${ofAmount.en} for that work.`,
        },
        null,
        n,
      );
    case "nothing_mailed":
      return make("nothing_to_charge", ["No hay nada que cobrar: todavía no se envía ninguna ronda.", "Nothing to charge: no round has gone out yet."], {
        es: "Todavía no hay nada que cobrar. Tu primer cobro llega después de que tu equipo envíe tu primera ronda de cartas.",
        en: "There is nothing to charge yet. Your first charge comes after your team mails your first round of letters.",
      });
    case "nothing_unbilled": {
      const last = performedRounds(context.rounds, now).at(-1)?.number ?? 0;
      if (stopped) {
        return make("nothing_to_charge", ["No hay nada que cobrar: el servicio se detuvo y no queda ninguna ronda sin cobrar.", "Nothing to charge: the service stopped and no round is left uncharged."], {
          es: "No hay nada pendiente y no se hace ningún cobro más.",
          en: "Nothing is pending and no further charge is made.",
        });
      }
      return make(
        "nothing_to_charge",
        [
          `No hay nada que cobrar: cada ronda enviada ya tiene su cobro. El siguiente es después de que se envíe la ronda ${last + 1}.`,
          `Nothing to charge: every mailed round already has its charge. The next one comes after round ${last + 1} goes out.`,
        ],
        {
          es: "No hay nada pendiente. Tu siguiente cobro llega después de que tu equipo envíe tu siguiente ronda de cartas.",
          en: "Nothing is pending. Your next charge comes after your team mails your next round of letters.",
        },
      );
    }
    case "in_cancellation_window":
      return make("not_chargeable", ["No se cobra: está en su periodo de cancelación.", "No charge: they're in their cancellation period."], {
        es: "Estás en tu periodo para cancelar sin costo. No se cobra nada, y tu equipo todavía no empieza.",
        en: "You are inside your time to cancel at no cost. Nothing is charged, and your team has not started yet.",
      });
    case "agreement_cancelled":
      return make("not_chargeable", ["No se cobra: canceló su acuerdo.", "No charge: they cancelled their agreement."], {
        es: "Cancelaste tu acuerdo. No se cobra nada.",
        en: "You cancelled your agreement. Nothing is charged.",
      });
    case "agreement_not_signed":
      return make("not_chargeable", ["No se cobra: no hay un acuerdo firmado.", "No charge: there's no signed agreement."], {
        es: "Todavía no firmas tu acuerdo. No se cobra nada.",
        en: "Your agreement is not signed yet. Nothing is charged.",
      });
    case "billing_paused":
      return make(
        "billing_paused",
        [
          `Cobros en pausa por el equipo desde el ${billingDay(account.pause!.at, "es")}: «${account.pause!.reason}». La ronda ${n} no se cobra mientras tanto.`,
          `Billing paused by the team since ${billingDay(account.pause!.at, "en")}: “${account.pause!.reason}”. Round ${n} isn't charged in the meantime.`,
        ],
        {
          es: "Tu equipo puso tus cobros en pausa. No se cobra nada por ahora.",
          en: "Your team paused your billing. Nothing is charged for now.",
        },
        null,
        n,
      );
    case "service_end_requested":
      return make(
        "needs_person",
        [
          `No se cobra solo: pidió terminar el servicio y la ronda ${n} quedó sin cobrar. Lo decide una persona (pregunta 3 para el abogado, en docs/BILLING.md).`,
          `Not charged automatically: they asked to end the service and round ${n} is uncharged. A person decides (question 3 for the attorney, in docs/BILLING.md).`,
        ],
        {
          es: "Pediste terminar el servicio. No se hace ningún cobro automático. Una persona del equipo te escribe para confirmarlo contigo.",
          en: "You asked to end the service. No automatic charge is made. A person on the team will write to you to confirm it.",
        },
        null,
        n,
      );
    case "all_letters_returned":
      return make(
        "needs_person",
        [
          `No se cobra sola: el correo devolvió todas las cartas de la ronda ${n}. La revisa una persona.`,
          `Not charged automatically: the post office returned every letter in round ${n}. A person reviews it.`,
        ],
        {
          es: `El correo devolvió las cartas de tu ronda ${n}. No se cobra mientras tu equipo lo revisa.`,
          en: `The post office returned the letters of your round ${n}. Nothing is charged while your team looks into it.`,
        },
        null,
        n,
      );
    case "no_amount":
      return make(
        "needs_person",
        ["No se cobra: el acuerdo firmado no tiene una cuota válida. Lo revisa una persona.", "No charge: the signed agreement has no valid fee. A person reviews it."],
        {
          es: "Tu equipo está revisando tu cuenta. No se cobra nada por ahora.",
          en: "Your team is reviewing your account. Nothing is charged for now.",
        },
        null,
        n,
      );
    case "plan_complete":
      return make("nothing_to_charge", ["No hay nada más que cobrar: el plan llegó a su total máximo o a su duración.", "Nothing more to charge: the plan reached its maximum total or its length."], {
        es: "Ya se cobró todo lo que tu plan permite. No se hace ningún cobro más.",
        en: "Everything your plan allows has been charged. No further charge is made.",
      });
    case "waiting_for_work":
      return make(
        "nothing_to_charge",
        [eligibility.reason.es, eligibility.reason.en],
        {
          es: "No hay nada pendiente. Tu siguiente cobro llega solo después del trabajo que paga.",
          en: "Nothing is pending. Your next charge comes only after the work it pays for.",
        },
        eligibility.availableAt ?? null,
        n,
      );
    case "before_due_date":
      return make("charge_scheduled", [eligibility.reason.es, eligibility.reason.en], {
        es: "Tu primer cobro llega en la fecha que dice tu plan, después de tu primera ronda.",
        en: "Your first charge comes on the date your plan says, after your first round.",
      }, eligibility.availableAt ?? null, n);
    case "pay_per_delete_off":
      return make("needs_person", [eligibility.reason.es, eligibility.reason.en], {
        es: "No se cobra nada por ahora.",
        en: "Nothing is charged for now.",
      });
    case "earlier_charge_unpaid":
      // Unreachable: an unpaid charge was handled above. Kept so the switch is complete.
      return make("processing", ["Hay un cobro anterior sin resolver.", "An earlier charge is unsettled."], {
        es: "Hay un cobro anterior en proceso.",
        en: "An earlier charge is being processed.",
      });
  }
}
