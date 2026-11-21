import type { AgreementRecord } from "../agreement/gate";

// Billing, as data. One rule shapes every type here: a charge exists only FOR
// a round of letters that was mailed. There is no "invoice", no "subscription
// period" and no amount field anyone can type into: a charge names the round
// it pays for, and its amount is copied from the client's signed agreement.
//
// No card data anywhere. The processor's hosted fields turn a card into a
// token in the browser; this app stores the token (server only), the brand and
// the last four digits, and nothing else.

export type ChargeStatus =
  /** The row exists and the processor has not answered yet. */
  | "pending"
  | "succeeded"
  /** The last attempt was declined. `nextAttemptAt` says whether the system tries again. */
  | "failed"
  /** Paid, then returned in full. */
  | "refunded";

/** A refund of one charge, in full. Recorded, never deleted. */
export interface BillingRefund {
  id: string;
  amountCents: number;
  /** Why, in the teammate's words. Required. */
  reason: string;
  /** The teammate who asked for it. */
  by: string;
  at: string;
  /** When the processor confirmed it; null while it is still being sent. */
  completedAt: string | null;
}

/** One charge: the payment for one mailed round. At most one per round, ever. */
export interface BillingCharge {
  id: string;
  /** The round this charge pays for. */
  roundNumber: number;
  /** From the signed agreement's terms. Never edited. */
  amountCents: number;
  status: ChargeStatus;
  /** The date the work was done: the round's mailing date (ISO). */
  workDate: string;
  createdAt: string;
  /** Times the processor was asked and answered (declines and the success). */
  attempts: number;
  lastAttemptAt: string | null;
  /** When the system tries again. Null once paid, refunded, or out of retries. */
  nextAttemptAt: string | null;
  /** When the money was actually taken. */
  chargedAt: string | null;
  /** The processor's code for the last decline, for staff. Never shown raw to a client. */
  failureCode: string | null;
  refund: BillingRefund | null;
}

/** What the app knows about the payment method on file. No token, no card number. */
export interface PaymentMethodSummary {
  /** "visa", "mastercard", … as the processor names it. */
  brand: string;
  last4: string;
  addedAt: string;
  /** The recurring-payment authorization the client accepted with it (authorization.ts). */
  authorizationVersion: string;
  authorizedAt: string;
}

/** Billing paused for one client by a member of staff, with the reason. */
export interface BillingPause {
  at: string;
  by: string;
  reason: string;
}

/** Everything billing knows about one client. */
export interface BillingAccount {
  paymentMethod: PaymentMethodSummary | null;
  /** Oldest first. */
  charges: BillingCharge[];
  pause: BillingPause | null;
}

export const NO_BILLING: BillingAccount = { paymentMethod: null, charges: [], pause: null };

/** One letter of a round, as far as billing needs it. */
export interface BillableLetter {
  /** Short name for a receipt: "Equifax", or the furnisher's name. */
  recipient: string;
  /** True when the post office returned it or could not deliver it. */
  returned: boolean;
}

/**
 * A round of letters as billing reads it. `mailed` is the record that the
 * work was done: the round is marked as sent AND carries its mailing date.
 */
export interface BillableRound {
  number: number;
  mailed: boolean;
  mailedAt: string | null;
  letters: BillableLetter[];
}

/** The four things every billing decision is made from. */
export interface BillingContext {
  agreement: AgreementRecord | null;
  /**
   * The monthly fee printed in the agreement the client SIGNED ("89.00"), from
   * the terms snapshot stored with the signature. Never today's configuration.
   */
  signedMonthlyFee: string | null;
  rounds: BillableRound[];
  account: BillingAccount;
}

export type L = "es" | "en";
export type Bilingual = { es: string; en: string };
