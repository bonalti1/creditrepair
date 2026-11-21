import type { AgreementRecord } from "../agreement/gate";
import { CHARGE_DELAY_DAYS, feeToCents } from "../billing/rules";
import type {
  BillableRound,
  BillingAccount,
  BillingCharge,
  BillingContext,
  PaymentMethodSummary,
} from "../billing/types";
import { PAYMENT_AUTHORIZATION_VERSION } from "../billing/authorization";
import type { StaffClient, StaffLetter, StaffRound } from "./types";

// A client's record, as billing reads it. The rules are in src/lib/billing;
// this file only translates: which of the console's rounds count as mailed,
// and what each letter's recipient is called on a receipt.

const DAY_MS = 24 * 60 * 60 * 1000;

const BUREAU_SHORT: Record<string, string> = { equifax: "Equifax", experian: "Experian", transunion: "TransUnion" };

/** "Equifax" for a bureau; the recipient's own name for anyone else. */
export function recipientShortName(letter: Pick<StaffLetter, "recipient">): string {
  const { type, key, name } = letter.recipient;
  return type === "bureau" && BUREAU_SHORT[key] ? BUREAU_SHORT[key] : name;
}

/** The round as billing reads it: mailed means marked as sent AND dated. */
export function billableRound(round: StaffRound): BillableRound {
  return {
    number: round.number,
    mailed: (round.status === "mailed" || round.status === "responded") && Boolean(round.mailedAt),
    mailedAt: round.mailedAt,
    letters: round.letters.map((letter) => ({
      recipient: recipientShortName(letter),
      returned: letter.mailStatus === "returned" || letter.mailStatus === "undeliverable",
    })),
  };
}

export function billableRounds(client: Pick<StaffClient, "rounds">): BillableRound[] {
  return client.rounds.map(billableRound);
}

/** Everything a billing decision about this client is made from. */
export function billingContextFor(client: StaffClient, agreement: AgreementRecord): BillingContext {
  return {
    agreement,
    signedMonthlyFee: client.agreementMonthlyFee ?? null,
    rounds: billableRounds(client),
    account: client.billing,
  };
}

// ── For the demo data and the tests ─────────────────────────────────────

/** A payment method put on file at `addedAt`, with the current authorization accepted. */
export function sampleMethod(addedAt: string, last4 = "4242", brand = "visa"): PaymentMethodSummary {
  return { brand, last4, addedAt, authorizationVersion: PAYMENT_AUTHORIZATION_VERSION, authorizedAt: addedAt };
}

/** A charge for one mailed round, paid at the first attempt, the day after mailing. */
export function paidCharge(clientId: string, round: StaffRound, fee: string): BillingCharge {
  const at = new Date(new Date(round.mailedAt!).getTime() + CHARGE_DELAY_DAYS * DAY_MS).toISOString();
  return {
    id: `${clientId}-ch${round.number}`,
    roundNumber: round.number,
    amountCents: feeToCents(fee) ?? 0,
    status: "succeeded",
    workDate: round.mailedAt!,
    createdAt: at,
    attempts: 1,
    lastAttemptAt: at,
    nextAttemptAt: null,
    chargedAt: at,
    failureCode: null,
    refund: null,
  };
}

/**
 * The account of a client whose billing is in order as of `now`: a payment
 * method on file, and every round mailed more than a day ago charged and paid
 * the day after it was mailed. A round mailed within the last day has no
 * charge yet: it is charged tomorrow.
 */
export function paidUpBilling(
  client: Pick<StaffClient, "id" | "rounds" | "agreementSignedAt">,
  fee: string,
  now: Date,
): BillingAccount {
  const charges = client.rounds
    .filter((round) => (round.status === "mailed" || round.status === "responded") && round.mailedAt)
    .filter((round) => new Date(round.mailedAt!).getTime() + CHARGE_DELAY_DAYS * DAY_MS <= now.getTime())
    .sort((a, b) => a.number - b.number)
    .map((round) => paidCharge(client.id, round, fee));
  return {
    paymentMethod: client.agreementSignedAt ? sampleMethod(client.agreementSignedAt) : null,
    charges,
    pause: null,
  };
}
