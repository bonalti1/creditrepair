import type { Bilingual, BillingCharge, BillingRefund } from "./types";

// Refunds. Staff can return a charge in full, with a written reason. A refund
// is a record: it is added, never edited away, and the charge it returns stays
// on file marked as refunded.
//
// A charge made in error is always refundable: there is no time limit and no
// state of the agreement that blocks returning money. The only things that
// stop a refund are that there is no money to return (the charge was never
// paid) or that it was already returned.

/** A reason shorter than this is not a reason. */
export const REFUND_REASON_MIN_CHARS = 10;
export const REFUND_REASON_MAX_CHARS = 1000;

export type RefundBlock = "not_paid" | "already_refunded" | "reason_required";

export type RefundEligibility = { allowed: true; amountCents: number } | { allowed: false; code: RefundBlock; reason: Bilingual };

const REASONS: Record<RefundBlock, Bilingual> = {
  not_paid: {
    es: "Este cobro no se pagó, así que no hay nada que devolver.",
    en: "This charge was never paid, so there is nothing to return.",
  },
  already_refunded: {
    es: "Este cobro ya se devolvió.",
    en: "This charge was already refunded.",
  },
  reason_required: {
    es: `Escribe el motivo del reembolso (al menos ${REFUND_REASON_MIN_CHARS} letras). Queda en el registro.`,
    en: `Write the reason for the refund (at least ${REFUND_REASON_MIN_CHARS} characters). It is kept on record.`,
  },
};

export function cleanRefundReason(reason: string): string {
  return reason.replace(/\s+/g, " ").trim().slice(0, REFUND_REASON_MAX_CHARS);
}

/** Whether this charge can be refunded with this reason. A refund is always the full amount. */
export function refundEligibility(charge: BillingCharge, reason: string): RefundEligibility {
  const block = (code: RefundBlock): RefundEligibility => ({ allowed: false, code, reason: REASONS[code] });
  if (charge.status === "refunded" || charge.refund) return block("already_refunded");
  if (charge.status !== "succeeded") return block("not_paid");
  if (cleanRefundReason(reason).length < REFUND_REASON_MIN_CHARS) return block("reason_required");
  return { allowed: true, amountCents: charge.amountCents };
}

/** The charge as it stands once its refund is recorded. Pure: returns a new object. */
export function withRefund(charge: BillingCharge, refund: BillingRefund): BillingCharge {
  return { ...charge, status: "refunded", refund, nextAttemptAt: null };
}
