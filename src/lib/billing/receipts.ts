import { billingDate, billingDay, formatCents } from "./rules";
import type { Bilingual, BillableRound, BillingCharge, L } from "./types";

// A receipt says three things and nothing else: the date, the amount, and
// exactly which work the money paid for. The work line is built from the
// round itself, so a receipt can never describe work that is not on record:
//
//   "Ronda 2: 3 cartas enviadas el 4 de noviembre a Equifax, Experian y TransUnion"

function list(parts: string[], locale: L): string {
  if (parts.length <= 1) return parts.join("");
  const and = locale === "es" ? "y" : "and";
  return `${parts.slice(0, -1).join(", ")} ${and} ${parts[parts.length - 1]}`;
}

/** Recipients of a round, each once, in the order the letters were written. */
export function roundRecipients(round: BillableRound): string[] {
  return [...new Set(round.letters.map((letter) => letter.recipient.trim()).filter(Boolean))];
}

/**
 * The work a round is, in one line. `workDate` is the charge's own record of
 * the mailing date, used when the round's date is not at hand.
 */
export function workLine(round: BillableRound, workDate: string | null = round.mailedAt): Bilingual {
  const n = round.letters.length;
  const to = roundRecipients(round);
  const line = (locale: L): string => {
    const letters =
      locale === "es"
        ? `${n} ${n === 1 ? "carta enviada" : "cartas enviadas"}`
        : `${n} ${n === 1 ? "letter mailed" : "letters mailed"}`;
    const on = workDate ? (locale === "es" ? ` el ${billingDay(workDate, "es")}` : ` on ${billingDay(workDate, "en")}`) : "";
    const whom = to.length > 0 ? (locale === "es" ? ` a ${list(to, "es")}` : ` to ${list(to, "en")}`) : "";
    return `${locale === "es" ? "Ronda" : "Round"} ${round.number}: ${letters}${on}${whom}`;
  };
  return { es: line("es"), en: line("en") };
}

/** The work line when the round's letters are not at hand: the round and its date only. */
export function workLineWithoutLetters(roundNumber: number, workDate: string): Bilingual {
  return {
    es: `Ronda ${roundNumber}: cartas enviadas el ${billingDay(workDate, "es")}`,
    en: `Round ${roundNumber}: letters mailed on ${billingDay(workDate, "en")}`,
  };
}

/** Credalti DIY's subscription, by the period it pays for. */
export function diySubscriptionLine(periodStart: string): Bilingual {
  return {
    es: `Credalti DIY: tu suscripción mensual, el periodo que empieza el ${billingDay(periodStart, "es")}`,
    en: `Credalti DIY: your monthly subscription, the period starting ${billingDay(periodStart, "en")}`,
  };
}

/** Credalti DIY's "Mail them for me": the letters we mailed for them. */
export function diyMailingLine(mailedAt: string): Bilingual {
  return {
    es: `Credalti DIY: las cartas que enviamos por ti el ${billingDay(mailedAt, "es")}`,
    en: `Credalti DIY: the letters we mailed for you on ${billingDay(mailedAt, "en")}`,
  };
}

export interface Receipt {
  /** Short and stable, from the charge's id: what a client quotes to the team. */
  number: string;
  chargeId: string;
  roundNumber: number;
  /** When the money was taken (ISO). */
  paidAt: string;
  amountCents: number;
  /** "$89.00" */
  amount: string;
  /** "21 de noviembre de 2026" / "November 21, 2026" */
  date: Bilingual;
  /** Exactly which work it paid for (Credalti DIY: the subscription period, or the letters we mailed). */
  work: Bilingual;
  /**
   * What the charge paid for, in the receipt's sentence: "work already done:
   * Round 2: …" under Credalti Complete; under Credalti DIY the subscription
   * period or the letters we mailed for them (a DIY subscription is not
   * charged for work our team did, so it never says "work already done").
   */
  paidFor: Bilingual;
  /** Set when the charge was later returned in full. */
  refundedAt: string | null;
}

/** "R-" plus the first eight letters and digits of the charge id, in capitals. */
export function receiptNumber(chargeId: string): string {
  return `R-${chargeId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase()}`;
}

/**
 * The receipt for a charge that was paid (including one refunded afterwards).
 * Null for a charge that never took money: there is nothing to receipt.
 */
export function receiptFor(charge: BillingCharge, round: BillableRound | null | undefined): Receipt | null {
  if ((charge.status !== "succeeded" && charge.status !== "refunded") || !charge.chargedAt) return null;
  const work =
    charge.unit === "diy_period"
      ? diySubscriptionLine(charge.workDate)
      : charge.unit === "mailing"
        ? diyMailingLine(charge.workDate)
        : round
          ? workLine(round, charge.workDate)
          : workLineWithoutLetters(charge.roundNumber, charge.workDate);
  return {
    number: receiptNumber(charge.id),
    chargeId: charge.id,
    roundNumber: charge.roundNumber,
    paidAt: charge.chargedAt,
    amountCents: charge.amountCents,
    amount: formatCents(charge.amountCents),
    date: { es: billingDate(charge.chargedAt, "es"), en: billingDate(charge.chargedAt, "en") },
    work,
    paidFor:
      charge.unit === "diy_period" || charge.unit === "mailing"
        ? work
        : { es: `trabajo ya hecho: ${work.es}`, en: `work already done: ${work.en}` },
    refundedAt: charge.refund?.completedAt ?? (charge.status === "refunded" ? (charge.refund?.at ?? null) : null),
  };
}

/** Every receipt of an account, newest first. */
export function receiptsFor(charges: BillingCharge[], rounds: BillableRound[]): Receipt[] {
  const byNumber = new Map(rounds.map((round) => [round.number, round]));
  return charges
    .flatMap((charge) => receiptFor(charge, byNumber.get(charge.roundNumber)) ?? [])
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
}

/** The receipt as a short message, for WhatsApp or the in-app thread. */
export function receiptMessage(receipt: Receipt): Bilingual {
  return {
    es: `Recibo ${receipt.number}. Cobramos ${receipt.amount} el ${receipt.date.es} por ${receipt.paidFor.es}. Lo ves cuando quieras en la app, en «Mis pagos».`,
    en: `Receipt ${receipt.number}. We charged ${receipt.amount} on ${receipt.date.en} for ${receipt.paidFor.en}. You can see it anytime in the app, under "My payments".`,
  };
}
