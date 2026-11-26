import type { AgreementRecord } from "../agreement/gate";
import type { PlanSnapshot, PlanType } from "./plans";

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
  /** "void" when the charge had not settled yet and the processor cancelled it instead. */
  kind?: "refund" | "void";
}

/**
 * What one charge pays for (migration 0026). A charge is always for work on
 * record: a mailed round, a 30-day period in which a round was mailed, a flat
 * fee's installment or its last round, items a later report no longer shows,
 * or the first work fee after the first round was mailed.
 */
export type ChargeUnit = "round" | "period" | "installment" | "flat" | "results" | "first_work" | "diy_period" | "mailing";

/** The units only a signed DIY plan charges (migration 0042). */
export const DIY_UNITS: readonly ChargeUnit[] = ["diy_period", "mailing"];

export type MethodKind = "card" | "ach";

export type ChargebackStatus = "open" | "won" | "lost" | "accepted";

/** A dispute the client opened with their bank or card issuer about one charge. */
export interface ChargebackSummary {
  id: string;
  status: ChargebackStatus;
  reasonCode: string | null;
  amountCents: number;
  receivedAt: string;
  /** "webhook" (the processor told us) or "manual" (recorded by staff). */
  source: "webhook" | "manual";
  /** When the evidence was sent to the processor, if it was. */
  respondedAt: string | null;
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
  /** What the charge pays for. Absent on a charge made before plans existed: a round. */
  unit?: ChargeUnit;
  /** The plan type of the signed agreement it was charged under. */
  planType?: PlanType | null;
  /** Subscription: the 30-day period it pays for. */
  periodStart?: string | null;
  periodEnd?: string | null;
  /** Flat fee in installments: which one (1-based). */
  installmentNumber?: number | null;
  /** The part of the amount that is the first work fee. */
  firstWorkCents?: number;
  /** A referral credit applied: the processor is asked for amountCents − creditCents. */
  creditCents?: number;
  /** Pay per delete: the items (report_items ids) it pays for. */
  resultItemIds?: string[];
  /** "INV-2026-000123": assigned by the database. */
  invoiceNumber?: string | null;
  /** Card or bank account (ACH) at the time of the last attempt. */
  methodKind?: MethodKind;
  chargeback?: ChargebackSummary | null;
  /** The last ACH return code on this charge (R01…), when the bank sent one back. */
  returnCode?: string | null;
  /** DIY "Mail them for me": the request it pays for (mail_requests.id). */
  mailRequestId?: string | null;
  /** DIY mailing: how many letters it paid for. */
  letterCount?: number | null;
  /** The agreement it was charged under, when known (a client who switched option has more than one). */
  agreementId?: string | null;
}

/**
 * DIY "Mail them for me" (mail_requests, migration 0042): the letters a client
 * asked Credalti to mail, the fee per letter from their signed plan and the
 * total they accepted. Charged once, after Credalti mailed them.
 */
export interface MailingWork {
  id: string;
  roundNumber: number;
  letterCount: number;
  feeCents: number;
  totalCents: number;
  status: "requested" | "mailed" | "cancelled";
  requestedAt: string;
  mailedAt: string | null;
  /** True when the post office returned every one of its letters. */
  allReturned?: boolean;
  /** The agreement it was asked under. */
  agreementId?: string | null;
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
  /** "card" unless a bank account (ACH) is on file. For ACH, brand is "checking" or "savings". */
  kind?: MethodKind;
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

/**
 * Pay per delete: an item the client disputed through us that a later report
 * no longer shows (or shows updated). Built from item_results (migration
 * 0026), which the report import writes.
 */
export interface ProvenResult {
  /** report_items.id */
  itemId: string;
  /** "Equifax · CAPITAL ONE" */
  label: string;
  outcome: "deleted" | "updated";
  /** The round whose letter disputed it, and when that round was mailed. */
  disputedRound: number;
  disputedAt: string;
  /** When the report that shows it was pulled. */
  provedAt: string;
  /** False when a still later report shows the item again: then it is not charged. */
  stillGone: boolean;
}

/** Program-wide switches an administrator turns on only with the attorney's approval on record. */
export interface BillingSwitches {
  payPerDelete: boolean;
  referralCredits: boolean;
}

export const SWITCHES_OFF: BillingSwitches = { payPerDelete: false, referralCredits: false };

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
  /**
   * The plan snapshot kept with the signature (service_agreements.terms.plan).
   * Absent or null: the agreement was signed before plans existed, and it is
   * billed per mailed round at signedMonthlyFee, as before.
   */
  plan?: PlanSnapshot | null;
  /** Pay per delete only. */
  results?: ProvenResult[];
  switches?: BillingSwitches;
  /** Referral credit the client has not used yet, in cents. */
  creditBalanceCents?: number;
  /** DIY only: the mailings the client asked for. */
  mailings?: MailingWork[];
  /** The id of the agreement in force: charges under another agreement (before a switch) are told apart by it. */
  agreementId?: string | null;
}

export type L = "es" | "en";
export type Bilingual = { es: string; en: string };
