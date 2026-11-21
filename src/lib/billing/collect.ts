import { afterAttempt, chargeStanding, retryEligibility, type RetryBlock } from "./dunning";
import { attemptKey, type PaymentGateway } from "./gateway";
import { chargeEligibility, isUnpaid, type ChargeEligibility } from "./rules";
import type { BillingCharge, BillingContext } from "./types";

// Collecting: the one path by which money is ever asked for.
//
// The order is the safeguard:
//   1. the pure rule says a round may be charged (chargeEligibility);
//   2. the charge ROW is created first, so the database is the final judge
//      (its trigger refuses a charge for work that is not on record, a second
//      charge for a round, or a wrong amount: migration 0011);
//   3. only then is the processor asked, with an idempotency key made from the
//      charge's id and the attempt number;
//   4. the answer is saved on that same row.
//
// A decline is retried later on the SAME row. Nothing here can create a
// second charge for a round, and nothing here is reachable by a member of
// staff: there is no "charge this client" action anywhere.
//
// The storage and the processor are passed in, so the same code runs against
// the database in the cron route and against memory in the tests.

/** The processor's handles for one client. Server only: never sent to a browser. */
export interface PaymentHandle {
  customerRef: string;
  paymentMethodRef: string;
}

export type CreateChargeResult = { created: true; charge: BillingCharge } | { created: false; reason: string };

export interface ChargeStore {
  /** Insert the charge row for a round. The database may refuse; that is its job. */
  createCharge(input: { roundNumber: number; amountCents: number; workDate: string }): Promise<CreateChargeResult>;
  /** Save what one attempt changed. `gatewayReference` is set when the attempt was paid. */
  saveAttempt(charge: BillingCharge, gatewayReference: string | null): Promise<void>;
}

export type AttemptOutcome =
  | "paid"
  /** Declined; the system will try again on the date now on the charge. */
  | "declined"
  /** Declined, and the automatic retries are used up: the case pauses. */
  | "exhausted"
  /** The processor gave no definite answer. Nothing changed; the same request is sent again later. */
  | "error";

export interface AttemptReport {
  outcome: AttemptOutcome;
  charge: BillingCharge;
  /** For "error": what went wrong, for the error report. */
  message?: string;
}

/** Ask the processor for one attempt of one charge, and save the answer. */
export async function attemptCharge(
  deps: { gateway: PaymentGateway; store: ChargeStore },
  charge: BillingCharge,
  handle: PaymentHandle,
  now: Date,
): Promise<AttemptReport> {
  let result;
  try {
    result = await deps.gateway.charge({
      amountCents: charge.amountCents,
      currency: "usd",
      customerRef: handle.customerRef,
      paymentMethodRef: handle.paymentMethodRef,
      // The same attempt asked twice is one request to the processor.
      idempotencyKey: attemptKey(charge.id, charge.attempts + 1),
      description: `Round ${charge.roundNumber} of letters, mailed ${charge.workDate.slice(0, 10)}`,
    });
  } catch (error) {
    return { outcome: "error", charge, message: error instanceof Error ? error.message : String(error) };
  }
  if (!result.ok && result.kind === "error") return { outcome: "error", charge, message: result.message };

  const updated = afterAttempt(charge, result.ok ? { ok: true, reference: result.reference } : { ok: false, code: result.code }, now);
  await deps.store.saveAttempt(updated, result.ok ? result.reference : null);
  if (result.ok) return { outcome: "paid", charge: updated };
  return { outcome: chargeStanding(updated) === "exhausted" ? "exhausted" : "declined", charge: updated };
}

export interface ClientBillingReport {
  /** Unpaid charges that were not sent to the processor, and why. */
  skipped: Array<{ charge: BillingCharge; code: RetryBlock | "no_payment_handle"; needsPerson: boolean }>;
  /** Every attempt made in this run. */
  attempts: AttemptReport[];
  /** The rule's answer about a NEW charge, after the retries above. */
  eligibility: ChargeEligibility;
  /** Set when the rule allowed a new charge and the database refused it. That is a bug to look at. */
  refused: string | null;
  /** The charges as they stand after the run. */
  charges: BillingCharge[];
}

/**
 * Everything billing does for one client in one run: retry what is due, then
 * create and collect the next charge if the rule allows one.
 */
export async function runClientBilling(
  deps: { gateway: PaymentGateway; store: ChargeStore },
  context: BillingContext,
  handle: PaymentHandle | null,
  now: Date,
): Promise<ClientBillingReport> {
  const report: ClientBillingReport = {
    skipped: [],
    attempts: [],
    eligibility: { eligible: false, code: "nothing_mailed", reason: { es: "", en: "" }, needsPerson: false },
    refused: null,
    charges: [...context.account.charges],
  };
  const replace = (charge: BillingCharge) => {
    report.charges = report.charges.map((c) => (c.id === charge.id ? charge : c));
  };
  const current = (): BillingContext => ({ ...context, account: { ...context.account, charges: report.charges } });

  // 1. Charges already on file that are still unpaid: a retry, or an attempt that never got its answer.
  for (const charge of context.account.charges.filter(isUnpaid)) {
    const retry = retryEligibility(charge, current(), now);
    if (!retry.allowed) {
      if (retry.code !== "not_due") report.skipped.push({ charge, code: retry.code, needsPerson: retry.needsPerson });
      continue;
    }
    if (!handle) {
      report.skipped.push({ charge, code: "no_payment_handle", needsPerson: true });
      continue;
    }
    const attempt = await attemptCharge(deps, charge, handle, now);
    report.attempts.push(attempt);
    replace(attempt.charge);
  }

  // 2. The next round that was mailed and never charged, if the rule allows it.
  report.eligibility = chargeEligibility(current(), now);
  if (!report.eligibility.eligible || !handle) return report;

  const { roundNumber, amountCents, workDate } = report.eligibility;
  const created = await deps.store.createCharge({ roundNumber, amountCents, workDate });
  if (!created.created) {
    report.refused = created.reason;
    return report;
  }
  report.charges = [...report.charges, created.charge];
  const attempt = await attemptCharge(deps, created.charge, handle, now);
  report.attempts.push(attempt);
  replace(attempt.charge);
  return report;
}

/** A charge store kept in memory, with the database's own refusals. For the tests and the demo. */
export function createMemoryChargeStore(
  initial: BillingCharge[] = [],
  ids: (roundNumber: number) => string = (roundNumber) => `ch_${roundNumber}_${Math.random().toString(36).slice(2, 10)}`,
): ChargeStore & { charges(): BillingCharge[]; references(): Record<string, string> } {
  let rows = [...initial];
  const references: Record<string, string> = {};
  return {
    async createCharge({ roundNumber, amountCents, workDate }) {
      // unique (round_id) and amount > 0, as in migration 0011.
      if (rows.some((row) => row.roundNumber === roundNumber)) return { created: false, reason: "a charge for this round already exists" };
      if (!Number.isInteger(amountCents) || amountCents <= 0) return { created: false, reason: "the amount must be positive" };
      const charge: BillingCharge = {
        id: ids(roundNumber),
        roundNumber,
        amountCents,
        status: "pending",
        workDate,
        createdAt: new Date().toISOString(),
        attempts: 0,
        lastAttemptAt: null,
        nextAttemptAt: null,
        chargedAt: null,
        failureCode: null,
        refund: null,
      };
      rows = [...rows, charge];
      return { created: true, charge };
    },
    async saveAttempt(charge, gatewayReference) {
      rows = rows.map((row) => (row.id === charge.id ? charge : row));
      if (gatewayReference) references[charge.id] = gatewayReference;
    },
    charges: () => [...rows],
    references: () => ({ ...references }),
  };
}
