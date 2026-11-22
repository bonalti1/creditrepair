import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgreementRecord } from "../agreement/gate";
import { looksLikeCardNumber, paymentMethodBodySchema, pauseBodySchema, refundBodySchema } from "../billing/api";
import {
  authorizationFee,
  PAYMENT_AUTHORIZATION_VERSION,
  paymentAuthorization,
  paymentAuthorizationHash,
  paymentAuthorizationText,
} from "../billing/authorization";
import { attemptCharge, createMemoryChargeStore, runClientBilling, type ChargeStore, type PaymentHandle } from "../billing/collect";
import {
  accountStanding,
  afterAttempt,
  casePausedForPayment,
  chargeStanding,
  DUNNING_RETRY_DAYS,
  MAX_AUTOMATIC_ATTEMPTS,
  nextRetryAt,
  paymentFailedMessage,
  paymentMethodNeededMessage,
  rearmAfterNewPaymentMethod,
  retryEligibility,
} from "../billing/dunning";
import {
  attemptKey,
  createDemoGateway,
  DEMO_TOKEN_DECLINED,
  DEMO_TOKEN_OK,
  getPaymentGateway,
  isDemoToken,
  type PaymentGateway,
} from "../billing/gateway";
import { billingOutlook, type OutlookKind } from "../billing/outlook";
import { billingReadiness } from "../billing/readiness";
import { receiptFor, receiptMessage, receiptNumber, receiptsFor, workLine } from "../billing/receipts";
import { cleanRefundReason, REFUND_REASON_MIN_CHARS, refundEligibility, withRefund } from "../billing/refunds";
import {
  BILL_PERFORMED_WORK_AFTER_END_REQUEST,
  CHARGE_DELAY_DAYS,
  chargeEligibility,
  feeToCents,
  formatCents,
  isPerformed,
  MIN_DAYS_BETWEEN_CHARGES,
  type IneligibleCode,
} from "../billing/rules";
import { billableRoundFromRows, chargeFromRow, paymentMethodFromRow } from "../billing/server";
import type { BillableRound, BillingAccount, BillingCharge, BillingContext, PaymentMethodSummary } from "../billing/types";
import { checkClaimGuardrails, checkMarketingCopy } from "../compliance/guardrails";
import { DEMO_RAW_REPORT } from "../demo";
import { parseReport } from "../domain/parser";
import { billableRound, paidUpBilling, recipientShortName } from "../staff/billing";
import { applyDemoActions, demoBillingRun, EMPTY_ACTIONS } from "../staff/data";
import { buildDemoClients, DEMO_EXAMPLE_FEE } from "../staff/demoClients";
import { exceptionMessage } from "../staff/messages";
import {
  clientBillingOutlook,
  clientExceptions,
  clientStage,
  nextAutomaticStep,
  nextBillingStep,
  nextStep,
  sendableRound,
  STAGE_TEXT,
} from "../staff/stage";
import { clientTimeline } from "../staff/timeline";
import type { StaffClient, StaffRound } from "../staff/types";
import { BILLING_COPY, billingCopyStrings } from "../ux/billingCopy";
import { DEMO_SCENARIOS, demoScenarioState } from "../ux/billingDemo";
import { EMPTY_DEMO_BILLING } from "../ux/billingLocal";
import { nextAction, type JourneyState } from "../ux/journey";
import { setStaffLocaleFallback } from "../staff/i18n/locale";

// Written against the Spanish console: the sentences these tests pin are the Spanish ones.
setStaffLocaleFallback("es");

// Billing. One rule everything hangs on: the software must be unable to charge
// a client for work that has not been recorded as done. These tests cover the
// pure rules; the database's own refusals are checked against a real Postgres
// (see docs/BILLING.md, "What was verified").

// Noon in Texas on Saturday 5 December 2026.
const NOW = new Date("2026-12-05T18:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const ago = (days: number, hours = 0) => new Date(NOW.getTime() - days * DAY - hours * HOUR).toISOString();
const later = (days: number, hours = 0) => new Date(NOW.getTime() + days * DAY + hours * HOUR);

/** Signed 60 days ago; the cancellation window ended 55 days ago. */
const SIGNED: AgreementRecord = {
  disclosureAcknowledgedAt: ago(60, 1),
  signedAt: ago(60),
  cancellationDeadline: ago(55),
  cancelledAt: null,
  serviceEndRequestedAt: null,
};

const METHOD: PaymentMethodSummary = {
  brand: "visa",
  last4: "4242",
  addedAt: ago(50),
  authorizationVersion: PAYMENT_AUTHORIZATION_VERSION,
  authorizedAt: ago(50),
};

const BUREAUS = ["Equifax", "Experian", "TransUnion"];

function round(number: number, mailedDaysAgo: number | null, letters: Array<[string, boolean]> = BUREAUS.map((b) => [b, false])): BillableRound {
  return {
    number,
    mailed: mailedDaysAgo !== null,
    mailedAt: mailedDaysAgo === null ? null : ago(mailedDaysAgo),
    letters: letters.map(([recipient, returned]) => ({ recipient, returned })),
  };
}

function charge(roundNumber: number, workDaysAgo: number, overrides: Partial<BillingCharge> = {}): BillingCharge {
  const at = ago(workDaysAgo - 1);
  return {
    id: `ch-${roundNumber}`,
    roundNumber,
    amountCents: 8900,
    status: "succeeded",
    workDate: ago(workDaysAgo),
    createdAt: at,
    attempts: 1,
    lastAttemptAt: at,
    nextAttemptAt: null,
    chargedAt: at,
    failureCode: null,
    refund: null,
    ...overrides,
  };
}

const declined = (roundNumber: number, workDaysAgo: number, attempts: number, lastDaysAgo: number): BillingCharge =>
  charge(roundNumber, workDaysAgo, {
    status: "failed",
    attempts,
    lastAttemptAt: ago(lastDaysAgo),
    chargedAt: null,
    nextAttemptAt: nextRetryAt(attempts, new Date(ago(lastDaysAgo)))?.toISOString() ?? null,
    failureCode: "card_declined",
  });

type ContextOverrides = Partial<Omit<BillingContext, "account">> & { account?: Partial<BillingAccount> };

function context(overrides: ContextOverrides = {}): BillingContext {
  const { account, ...rest } = overrides;
  return {
    agreement: SIGNED,
    signedMonthlyFee: "89.00",
    rounds: [round(1, 5)],
    ...rest,
    account: { paymentMethod: METHOD, charges: [], pause: null, ...account },
  };
}

const HANDLE: PaymentHandle = { customerRef: "demo_cus_test", paymentMethodRef: "demo_pm_visa_4242" };
const BAD_HANDLE: PaymentHandle = { customerRef: "demo_cus_test", paymentMethodRef: "demo_pm_visa_0002" };

/** Every sentence a client may read passes the claim rules, and stays calm. */
function expectCleanClientCopy(text: string) {
  expect(text.trim().length, text).toBeGreaterThan(8);
  expect(checkClaimGuardrails(text, "full_service"), text).toEqual([]);
  expect(checkMarketingCopy(text, "full_service"), text).toEqual([]);
  // Nothing about what the letters may achieve.
  expect(text, text).not.toMatch(/resultado|puntaje|\bscore\b|result|mejor|improve|sube|aument|elimina|remov|borr/i);
  // No threat and no penalty. ("No hay cargos extra ni recargos" is a denial, and allowed.)
  expect(text, text).not.toMatch(/cobranza|collection|abogad|attorney|demand|lawsuit|legal action|acci[oó]n legal|inter[eé]s(es)?\b|penaliz|penalt|suspend/i);
  expect(text.replace(/no hay (ning[uú]n )?carg\w+[^.]*\./gi, "").replace(/there (is|are) no [^.]*\./gi, ""), text).not.toMatch(
    /recargo|late fee|cargo por pago tard[ií]o/i,
  );
  expect(text, text).not.toMatch(/ataque|\battack\b/i);
}

// ── Money ───────────────────────────────────────────────────────────────

describe("billing: amounts", () => {
  it("reads a fee as cents, exactly", () => {
    expect(feeToCents("89.00")).toBe(8900);
    expect(feeToCents("89")).toBe(8900);
    expect(feeToCents("129.5")).toBe(12950);
    expect(feeToCents("0.07")).toBe(7);
    // The classic floating point trap: 19.99 * 100 is 1998.9999999999998.
    expect(feeToCents("19.99")).toBe(1999);
    expect(feeToCents("1005.10")).toBe(100510);
  });

  it("refuses anything that is not a positive amount", () => {
    for (const bad of [null, undefined, "", "0", "0.00", "-5", "89.999", "abc", "$89", "8,900", "1e3", " "]) {
      expect(feeToCents(bad as string | null), String(bad)).toBeNull();
    }
  });

  it("prints cents as dollars", () => {
    expect(formatCents(8900)).toBe("$89.00");
    expect(formatCents(12950)).toBe("$129.50");
    expect(formatCents(7)).toBe("$0.07");
    expect(formatCents(123456789)).toBe("$1,234,567.89");
  });
});

// ── Performed work ──────────────────────────────────────────────────────

describe("billing: what counts as performed work", () => {
  it("is a round marked as mailed, with a mailing date in the past", () => {
    expect(isPerformed(round(1, 5), NOW)).toBe(true);
    expect(isPerformed(round(1, 0, undefined), NOW)).toBe(true);
    // Not marked as mailed.
    expect(isPerformed(round(1, null), NOW)).toBe(false);
    // Marked, with no date.
    expect(isPerformed({ ...round(1, 5), mailedAt: null }, NOW)).toBe(false);
    // Dated, not marked.
    expect(isPerformed({ ...round(1, 5), mailed: false }, NOW)).toBe(false);
    // A date in the future, or one that cannot be read.
    expect(isPerformed({ ...round(1, 5), mailedAt: later(1).toISOString() }, NOW)).toBe(false);
    expect(isPerformed({ ...round(1, 5), mailedAt: "not a date" }, NOW)).toBe(false);
  });

  it("reads the console's rounds the same way: mailed or answered, and dated", () => {
    const letter = { id: "l1", recipient: { type: "bureau" as const, key: "equifax", name: "Equifax Information Services LLC", addressLines: [] }, templateKey: "t", category: "personal_info" as const, stage: "personal_info_cleanup" as const, items: [], mailStatus: "delivered" as const };
    const staffRound = (status: StaffRound["status"], mailedAt: string | null): StaffRound => ({ number: 1, status, mailedAt, respondedAt: null, letters: [letter] });
    expect(billableRound(staffRound("mailed", ago(3))).mailed).toBe(true);
    expect(billableRound(staffRound("responded", ago(40))).mailed).toBe(true);
    expect(billableRound(staffRound("ready", null)).mailed).toBe(false);
    expect(billableRound(staffRound("draft", null)).mailed).toBe(false);
    // Marked sent without a date is not a record of work.
    expect(billableRound(staffRound("mailed", null)).mailed).toBe(false);
    expect(recipientShortName(letter)).toBe("Equifax");
    expect(recipientShortName({ recipient: { type: "furnisher", key: "Midland", name: "Midland Credit Management", addressLines: [] } })).toBe("Midland Credit Management");
    const returned = billableRound({ ...staffRound("mailed", ago(3)), letters: [{ ...letter, mailStatus: "returned" }, { ...letter, id: "l2", mailStatus: "undeliverable" }] });
    expect(returned.letters.map((l) => l.returned)).toEqual([true, true]);
  });
});

// ── Eligibility ─────────────────────────────────────────────────────────

describe("billing: chargeEligibility", () => {
  it("allows a charge when everything holds: the round, the amount and the work date", () => {
    expect(chargeEligibility(context(), NOW)).toEqual({ eligible: true, roundNumber: 1, amountCents: 8900, workDate: ago(5) });
  });

  const cancelled: AgreementRecord = { ...SIGNED, cancelledAt: ago(58) };
  const inWindow: AgreementRecord = { ...SIGNED, disclosureAcknowledgedAt: ago(1, 1), signedAt: ago(1), cancellationDeadline: later(3).toISOString() };
  const ending: AgreementRecord = { ...SIGNED, serviceEndRequestedAt: ago(1) };

  // Each row breaks exactly one condition of an otherwise chargeable client.
  const table: Array<[IneligibleCode, BillingContext, { needsPerson: boolean; round?: number }]> = [
    ["agreement_not_signed", context({ agreement: null }), { needsPerson: false }],
    ["agreement_not_signed", context({ agreement: { ...SIGNED, signedAt: null, cancellationDeadline: null } }), { needsPerson: false }],
    ["agreement_not_signed", context({ agreement: { ...SIGNED, disclosureAcknowledgedAt: null } }), { needsPerson: false }],
    ["in_cancellation_window", context({ agreement: inWindow, rounds: [round(1, 0)] }), { needsPerson: false }],
    ["agreement_cancelled", context({ agreement: cancelled }), { needsPerson: false }],
    ["nothing_mailed", context({ rounds: [] }), { needsPerson: false }],
    ["nothing_mailed", context({ rounds: [round(1, null)] }), { needsPerson: false }],
    ["nothing_mailed", context({ rounds: [{ ...round(1, 5), mailedAt: later(2).toISOString() }] }), { needsPerson: false }],
    ["nothing_unbilled", context({ account: { charges: [charge(1, 5)] } }), { needsPerson: false }],
    ["service_end_requested", context({ agreement: ending }), { needsPerson: true, round: 1 }],
    ["all_letters_returned", context({ rounds: [round(1, 5, [["Equifax", true], ["Experian", true]])] }), { needsPerson: true, round: 1 }],
    ["billing_paused", context({ account: { pause: { at: ago(2), by: "carmen", reason: "Disputa el cobro con su banco" } } }), { needsPerson: false, round: 1 }],
    ["earlier_charge_unpaid", context({ rounds: [round(1, 45), round(2, 5)], account: { charges: [declined(1, 45, 3, 37)] } }), { needsPerson: false, round: 2 }],
    ["no_amount", context({ signedMonthlyFee: null }), { needsPerson: true, round: 1 }],
    ["no_amount", context({ signedMonthlyFee: "0.00" }), { needsPerson: true, round: 1 }],
    ["no_amount", context({ signedMonthlyFee: "-89" }), { needsPerson: true, round: 1 }],
    ["too_soon_after_mailing", context({ rounds: [round(1, 0, undefined)] }), { needsPerson: false, round: 1 }],
    ["too_soon_after_last_charge", context({ rounds: [round(1, 20), round(2, 5)], account: { charges: [charge(1, 20)] } }), { needsPerson: false, round: 2 }],
    ["no_payment_method", context({ account: { paymentMethod: null } }), { needsPerson: true, round: 1 }],
    ["no_payment_method", context({ account: { paymentMethod: { ...METHOD, authorizedAt: "" } } }), { needsPerson: true, round: 1 }],
    ["no_payment_method", context({ account: { paymentMethod: { ...METHOD, authorizationVersion: "" } } }), { needsPerson: true, round: 1 }],
  ];

  it.each(table)("refuses: %s", (code, ctx, expected) => {
    const result = chargeEligibility(ctx, NOW);
    expect(result.eligible).toBe(false);
    if (result.eligible) return;
    expect(result.code).toBe(code);
    expect(result.needsPerson).toBe(expected.needsPerson);
    expect(result.roundNumber).toBe(expected.round);
    // One plain sentence in each language, for the staff console.
    expect(result.reason.es.length).toBeGreaterThan(15);
    expect(result.reason.en.length).toBeGreaterThan(15);
  });

  it("covers every reason the rule can give", () => {
    const all: IneligibleCode[] = [
      "agreement_not_signed", "in_cancellation_window", "agreement_cancelled", "nothing_mailed", "nothing_unbilled",
      "service_end_requested", "all_letters_returned", "billing_paused", "earlier_charge_unpaid", "no_amount",
      "too_soon_after_mailing", "too_soon_after_last_charge", "no_payment_method",
    ];
    expect([...new Set(table.map(([code]) => code))].sort()).toEqual([...all].sort());
  });

  it("never charges a client who cancelled inside the window, whatever else is on record", () => {
    const everything = context({ agreement: cancelled, rounds: [round(1, 40), round(2, 5)] });
    for (const now of [NOW, later(30), later(400)]) {
      expect(chargeEligibility(everything, now)).toMatchObject({ eligible: false, code: "agreement_cancelled" });
    }
  });

  it("charges nothing inside the cancellation window, even for a round wrongly marked as mailed", () => {
    const result = chargeEligibility(context({ agreement: inWindow, rounds: [round(1, 0)] }), NOW);
    expect(result).toMatchObject({ eligible: false, code: "in_cancellation_window" });
    // …and the same client is chargeable once the window is over and the delay has passed.
    expect(chargeEligibility(context({ agreement: inWindow, rounds: [round(1, 0)] }), later(6)).eligible).toBe(true);
  });

  it("after a request to end the service: unbilled work goes to a person, and is not charged", () => {
    expect(BILL_PERFORMED_WORK_AFTER_END_REQUEST).toBe(false);
    const result = chargeEligibility(context({ agreement: ending }), NOW);
    expect(result).toMatchObject({ eligible: false, code: "service_end_requested", needsPerson: true, roundNumber: 1 });
    // With nothing unbilled there is nothing for a person to decide.
    expect(chargeEligibility(context({ agreement: ending, account: { charges: [charge(1, 5)] } }), NOW)).toMatchObject({
      code: "nothing_unbilled",
      needsPerson: false,
    });
  });

  it("bills a round when only some letters were returned, and not when all were", () => {
    expect(chargeEligibility(context({ rounds: [round(1, 5, [["Equifax", true], ["Experian", false]])] }), NOW).eligible).toBe(true);
    expect(chargeEligibility(context({ rounds: [round(1, 5, [["Equifax", true]])] }), NOW)).toMatchObject({ code: "all_letters_returned" });
    // A round with no letters at all is not "all returned"; it is still a mailed round on record.
    expect(chargeEligibility(context({ rounds: [round(1, 5, [])] }), NOW).eligible).toBe(true);
  });

  it("charges the oldest unbilled round first", () => {
    const two = context({ rounds: [round(2, 3), round(1, 40)] });
    expect(chargeEligibility(two, NOW)).toMatchObject({ eligible: true, roundNumber: 1, workDate: ago(40) });
  });

  describe("the amount is the one in the signed agreement", () => {
    it("is whatever the signed snapshot says, to the cent", () => {
      expect(chargeEligibility(context({ signedMonthlyFee: "129.50" }), NOW)).toMatchObject({ eligible: true, amountCents: 12950 });
      expect(chargeEligibility(context({ signedMonthlyFee: "49" }), NOW)).toMatchObject({ eligible: true, amountCents: 4900 });
    });

    it("ignores today's configuration: a different fee in the environment changes nothing", () => {
      const before = process.env.NEXT_PUBLIC_PLAN_MONTHLY_FEE;
      process.env.NEXT_PUBLIC_PLAN_MONTHLY_FEE = "199";
      try {
        expect(chargeEligibility(context({ signedMonthlyFee: "89.00" }), NOW)).toMatchObject({ eligible: true, amountCents: 8900 });
      } finally {
        if (before === undefined) delete process.env.NEXT_PUBLIC_PLAN_MONTHLY_FEE;
        else process.env.NEXT_PUBLIC_PLAN_MONTHLY_FEE = before;
      }
    });

    it("is read from the signature's terms on the server, and from nowhere else", () => {
      const server = readFileSync("src/lib/billing/server.ts", "utf8");
      expect(server).toMatch(/const terms = agreement\?\.signedAt \? agreement\.terms : null;/);
      expect(server).toMatch(/signedMonthlyFee: terms\?\.monthlyFee \?\? null/);
      // Neither the rules nor the server code can read the plan fee from the configuration.
      for (const file of ["rules.ts", "server.ts", "collect.ts", "dunning.ts", "outlook.ts"]) {
        expect(readFileSync(`src/lib/billing/${file}`, "utf8"), file).not.toMatch(/resolveTerms|NEXT_PUBLIC_PLAN_MONTHLY_FEE/);
      }
    });
  });

  describe("the delay after mailing", () => {
    it(`waits ${CHARGE_DELAY_DAYS} day so a round marked by mistake can be corrected`, () => {
      expect(CHARGE_DELAY_DAYS).toBe(1);
      const mailedAt = ago(0, 2);
      const ctx = context({ rounds: [{ ...round(1, 0), mailedAt }] });
      const early = chargeEligibility(ctx, NOW);
      expect(early).toMatchObject({ eligible: false, code: "too_soon_after_mailing", needsPerson: false });
      const due = new Date(new Date(mailedAt).getTime() + DAY);
      expect(!early.eligible && early.availableAt).toBe(due.toISOString());
      expect(chargeEligibility(ctx, new Date(due.getTime() - 1)).eligible).toBe(false);
      expect(chargeEligibility(ctx, due).eligible).toBe(true);
    });
  });

  describe("the 30-day rule", () => {
    const second = (firstWorkDaysAgo: number, now = NOW) =>
      chargeEligibility(context({ rounds: [round(1, firstWorkDaysAgo), round(2, 3)], account: { charges: [charge(1, firstWorkDaysAgo)] } }), now);

    it("needs 30 days since the work date of the last charged round", () => {
      expect(MIN_DAYS_BETWEEN_CHARGES).toBe(30);
      expect(second(29)).toMatchObject({ eligible: false, code: "too_soon_after_last_charge", roundNumber: 2 });
      expect(second(30)).toMatchObject({ eligible: true, roundNumber: 2 });
      expect(second(45)).toMatchObject({ eligible: true, roundNumber: 2 });
    });

    it("says the day it becomes chargeable, and is chargeable that day", () => {
      const result = second(20);
      expect(result.eligible).toBe(false);
      if (result.eligible) return;
      expect(result.availableAt).toBe(new Date(new Date(ago(20)).getTime() + 30 * DAY).toISOString());
      expect(second(20, new Date(new Date(result.availableAt!).getTime() - 1)).eligible).toBe(false);
      expect(second(20, new Date(result.availableAt!)).eligible).toBe(true);
    });

    it("holds whatever happened to the earlier charge: declined, refunded or paid late", () => {
      const refunded = charge(1, 20, { status: "refunded", refund: { id: "r", amountCents: 8900, reason: "Se cobró por error.", by: "ana", at: ago(10), completedAt: ago(10) } });
      const ctx = context({ rounds: [round(1, 20), round(2, 3)], account: { charges: [refunded] } });
      expect(chargeEligibility(ctx, NOW)).toMatchObject({ code: "too_soon_after_last_charge" });
    });

    it("so three rounds mailed in one month are charged a month apart, never together", () => {
      // Rounds mailed 12, 8 and 4 days ago; the first was charged the day after it went out.
      let charges = [charge(1, 12)];
      const rounds = [round(1, 12), round(2, 8), round(3, 4)];
      const at = (now: Date) => chargeEligibility(context({ rounds, account: { charges } }), now);
      expect(at(NOW)).toMatchObject({ eligible: false, code: "too_soon_after_last_charge", roundNumber: 2 });
      // 30 days after round 1's work: round 2.
      const first = later(18);
      expect(at(first)).toMatchObject({ eligible: true, roundNumber: 2 });
      charges = [...charges, charge(2, 8)];
      // Round 3 waits 30 days from round 2's work date, not from today.
      expect(at(first)).toMatchObject({ eligible: false, code: "too_soon_after_last_charge", roundNumber: 3 });
      expect(at(later(22))).toMatchObject({ eligible: true, roundNumber: 3 });
    });
  });

  describe("one charge per round, ever", () => {
    it("a round that has a charge is never offered again, whatever became of the charge", () => {
      for (const existing of [charge(1, 5), declined(1, 5, 1, 4), declined(1, 5, 3, 1), charge(1, 5, { status: "pending", attempts: 0, chargedAt: null }), charge(1, 5, { status: "refunded" })]) {
        const result = chargeEligibility(context({ account: { charges: [existing] } }), NOW);
        expect(result.eligible, existing.status).toBe(false);
        if (!result.eligible) expect(["nothing_unbilled", "earlier_charge_unpaid"]).toContain(result.code);
      }
    });

    it("a refunded round is not charged again a month later", () => {
      const refunded = charge(1, 60, { status: "refunded" });
      expect(chargeEligibility(context({ rounds: [round(1, 60)], account: { charges: [refunded] } }), NOW)).toMatchObject({ code: "nothing_unbilled" });
    });
  });
});

// ── Dunning ─────────────────────────────────────────────────────────────

describe("billing: failed payments", () => {
  it("retries 3 and 7 days after the first decline, then stops", () => {
    expect([...DUNNING_RETRY_DAYS]).toEqual([3, 7]);
    expect(MAX_AUTOMATIC_ATTEMPTS).toBe(3);
    const first = new Date("2026-11-10T15:00:00.000Z");
    const second = nextRetryAt(1, first)!;
    expect(second.toISOString()).toBe("2026-11-13T15:00:00.000Z");
    // The second retry is 7 days after the FIRST decline: 4 days after the second.
    expect(nextRetryAt(2, second)!.toISOString()).toBe("2026-11-17T15:00:00.000Z");
    expect(nextRetryAt(3, new Date("2026-11-17T15:00:00.000Z"))).toBeNull();
    expect(nextRetryAt(7, first)).toBeNull();
    expect(nextRetryAt(0, first)).toBeNull();
  });

  it("records each answer on the same charge", () => {
    const pending = charge(1, 5, { status: "pending", attempts: 0, lastAttemptAt: null, chargedAt: null });
    const once = afterAttempt(pending, { ok: false, code: "card_declined" }, NOW);
    expect(once).toMatchObject({ id: "ch-1", status: "failed", attempts: 1, failureCode: "card_declined", chargedAt: null, nextAttemptAt: later(3).toISOString() });
    expect(chargeStanding(once)).toBe("retrying");
    const twice = afterAttempt(once, { ok: false, code: "insufficient_funds" }, later(3));
    expect(twice).toMatchObject({ status: "failed", attempts: 2, nextAttemptAt: later(7).toISOString() });
    const thrice = afterAttempt(twice, { ok: false, code: "card_declined" }, later(7));
    expect(thrice).toMatchObject({ status: "failed", attempts: 3, nextAttemptAt: null });
    expect(chargeStanding(thrice)).toBe("exhausted");
    const paid = afterAttempt(thrice, { ok: true, reference: "ref" }, later(9));
    expect(paid).toMatchObject({ status: "succeeded", attempts: 4, chargedAt: later(9).toISOString(), nextAttemptAt: null, failureCode: null });
    expect(chargeStanding(paid)).toBe("paid");
    // Nothing about the charge itself moved.
    for (const c of [once, twice, thrice, paid]) expect(c).toMatchObject({ id: "ch-1", roundNumber: 1, amountCents: 8900, workDate: pending.workDate });
    // The original object is untouched.
    expect(pending.status).toBe("pending");
  });

  it("pauses the case only when the retries are used up, and resumes the moment the charge is paid", () => {
    const standing = (charges: BillingCharge[]) => accountStanding({ paymentMethod: METHOD, charges, pause: null });
    expect(standing([])).toBe("none");
    expect(standing([charge(1, 40), charge(2, 5)])).toBe("current");
    expect(standing([declined(1, 5, 1, 4)])).toBe("retrying");
    expect(standing([declined(1, 12, 2, 5)])).toBe("retrying");
    expect(standing([declined(1, 20, 3, 12)])).toBe("past_due");
    expect(casePausedForPayment({ paymentMethod: METHOD, charges: [declined(1, 5, 1, 4)], pause: null })).toBe(false);
    const exhausted = declined(1, 20, 3, 12);
    expect(casePausedForPayment({ paymentMethod: METHOD, charges: [exhausted], pause: null })).toBe(true);
    const paid = afterAttempt(exhausted, { ok: true, reference: "ref" }, NOW);
    expect(casePausedForPayment({ paymentMethod: METHOD, charges: [paid], pause: null })).toBe(false);
    // A refunded charge leaves nothing owing.
    expect(standing([charge(1, 20, { status: "refunded" })])).toBe("current");
  });

  it("a new payment method gives a declined charge one more try, at once", () => {
    const exhausted = declined(1, 20, 3, 12);
    const rearmed = rearmAfterNewPaymentMethod(exhausted, NOW);
    expect(rearmed).toMatchObject({ status: "failed", attempts: 3, nextAttemptAt: NOW.toISOString() });
    expect(chargeStanding(rearmed)).toBe("retrying");
    // If that try is declined too, it waits for the client again: no endless retries.
    expect(afterAttempt(rearmed, { ok: false, code: "card_declined" }, NOW)).toMatchObject({ attempts: 4, nextAttemptAt: null });
    // A paid charge is left alone.
    expect(rearmAfterNewPaymentMethod(charge(1, 5), NOW)).toEqual(charge(1, 5));
  });

  describe("may the system try again?", () => {
    const due = declined(1, 5, 1, 4); // next try was due a day ago
    const ctx = (overrides: ContextOverrides = {}) => context({ account: { charges: [due] }, ...overrides });

    it("yes, when the retry date has come and nothing changed", () => {
      expect(retryEligibility(due, ctx(), NOW)).toEqual({ allowed: true });
    });

    it("no, with the reason, otherwise", () => {
      const notYet = declined(1, 5, 1, 1);
      expect(retryEligibility(notYet, ctx(), NOW)).toEqual({ allowed: false, code: "not_due", needsPerson: false });
      expect(retryEligibility(declined(1, 20, 3, 12), ctx(), NOW)).toMatchObject({ allowed: false, code: "not_due" });
      expect(retryEligibility(charge(1, 5), ctx(), NOW)).toMatchObject({ allowed: false, code: "not_unpaid" });
      expect(retryEligibility(due, ctx({ account: { charges: [due], paymentMethod: null } }), NOW)).toMatchObject({ code: "no_payment_method", needsPerson: true });
      expect(retryEligibility(due, ctx({ account: { charges: [due], pause: { at: ago(1), by: "ana", reason: "x" } } }), NOW)).toMatchObject({ code: "billing_paused" });
      expect(retryEligibility(due, ctx({ agreement: { ...SIGNED, cancelledAt: ago(1) } }), NOW)).toMatchObject({ code: "agreement_cancelled", needsPerson: true });
      // The client asked to stop: collecting work already done is a person's call.
      expect(retryEligibility(due, ctx({ agreement: { ...SIGNED, serviceEndRequestedAt: ago(1) } }), NOW)).toMatchObject({ code: "service_end_requested", needsPerson: true });
      // The round was un-marked as sent (it had been marked by mistake): it is not collected for.
      expect(retryEligibility(due, ctx({ rounds: [round(1, null)] }), NOW)).toMatchObject({ code: "work_not_on_record", needsPerson: true });
      expect(retryEligibility(due, ctx({ rounds: [] }), NOW)).toMatchObject({ code: "work_not_on_record" });
    });

    it("a charge still waiting on the processor's first answer is asked again without a wait", () => {
      const pending = charge(1, 5, { status: "pending", attempts: 0, chargedAt: null, lastAttemptAt: null });
      expect(retryEligibility(pending, context({ account: { charges: [pending] } }), NOW)).toEqual({ allowed: true });
    });
  });
});

// ── The gateway ─────────────────────────────────────────────────────────

describe("billing: the payment gateway", () => {
  it("answers 'not configured' until a processor is set up, and never falls back to the demo", () => {
    const none = getPaymentGateway({});
    expect(none.configured).toBe(false);
    if (!none.configured) expect(none.message).toMatch(/No payment processor is configured.*Nothing was charged/);
    expect(getPaymentGateway({ BILLING_GATEWAY: "  " }).configured).toBe(false);
    const unknown = getPaymentGateway({ BILLING_GATEWAY: "stripe" });
    expect(unknown.configured).toBe(false);
    if (!unknown.configured) expect(unknown.message).toMatch(/no adapter with that name exists\. Nothing was charged/);
  });

  it("uses the demo processor only when asked for by name, and it is not live", () => {
    const demo = getPaymentGateway({ BILLING_GATEWAY: "demo" });
    expect(demo.configured).toBe(true);
    if (demo.configured) expect(demo.gateway).toMatchObject({ name: "demo", live: false });
    expect(getPaymentGateway({ BILLING_GATEWAY: "DEMO " }).configured).toBe(true);
  });

  it("takes a token, never a card: the demo token carries a brand and four digits", async () => {
    const gateway = createDemoGateway();
    expect(isDemoToken(DEMO_TOKEN_OK)).toBe(true);
    expect(await gateway.attachPaymentMethod({ customerRef: "c", token: DEMO_TOKEN_OK })).toEqual({ ok: true, paymentMethodRef: "demo_pm_visa_4242", brand: "visa", last4: "4242" });
    expect(await gateway.attachPaymentMethod({ customerRef: "c", token: "4242424242424242" })).toEqual({ ok: false, code: "invalid_token" });
    expect(await gateway.attachPaymentMethod({ customerRef: "c", token: "tok_live_abc" })).toEqual({ ok: false, code: "invalid_token" });
    const { customerRef } = await gateway.createCustomer({ userId: "user-1" });
    expect(customerRef).toMatch(/^demo_cus_[0-9a-f]{16}$/);
    // Deterministic, and not the account id itself.
    expect((await gateway.createCustomer({ userId: "user-1" })).customerRef).toBe(customerRef);
    expect(customerRef).not.toContain("user-1");
  });

  it("is deterministic: one card goes through, one is always declined", async () => {
    const gateway = createDemoGateway();
    const input = { amountCents: 8900, currency: "usd" as const, customerRef: "c", description: "Round 1" };
    const ok = await gateway.charge({ ...input, paymentMethodRef: "demo_pm_visa_4242", idempotencyKey: "ch-1:1" });
    expect(ok).toEqual({ ok: true, reference: expect.stringMatching(/^demo_ch_[0-9a-f]{20}$/) });
    expect(await gateway.charge({ ...input, paymentMethodRef: "demo_pm_visa_0002", idempotencyKey: "ch-2:1" })).toEqual({ ok: false, kind: "declined", code: "card_declined" });
    expect(await gateway.charge({ ...input, amountCents: 0, paymentMethodRef: "demo_pm_visa_4242", idempotencyKey: "ch-3:1" })).toMatchObject({ ok: false });
    expect(await gateway.charge({ ...input, paymentMethodRef: "4242424242424242", idempotencyKey: "ch-4:1" })).toMatchObject({ ok: false });
    expect(DEMO_TOKEN_DECLINED).toMatch(/0002$/);
  });

  it("treats the same idempotency key as the same request: asked twice, charged once", async () => {
    const gateway = createDemoGateway();
    const input = { amountCents: 8900, currency: "usd" as const, customerRef: "c", paymentMethodRef: "demo_pm_visa_4242", description: "Round 1", idempotencyKey: attemptKey("ch-1", 1) };
    const first = await gateway.charge(input);
    const again = await gateway.charge(input);
    expect(again).toEqual(first);
    expect(gateway.chargeCalls()).toBe(2);
    expect(gateway.chargesMade()).toBe(1);
    // A different attempt is a different request.
    expect(attemptKey("ch-1", 1)).toBe("ch-1:1");
    expect(attemptKey("ch-1", 2)).not.toBe(attemptKey("ch-1", 1));
  });

  it("refunds by reference, once per refund id", async () => {
    const gateway = createDemoGateway();
    const paid = await gateway.charge({ amountCents: 8900, currency: "usd", customerRef: "c", paymentMethodRef: "demo_pm_visa_4242", description: "Round 1", idempotencyKey: "ch-1:1" });
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    const refund = { chargeReference: paid.reference, amountCents: 8900, idempotencyKey: "refund-1" };
    expect(await gateway.refund(refund)).toEqual(await gateway.refund(refund));
    expect(gateway.refundsMade()).toBe(1);
    expect(await gateway.refund({ ...refund, chargeReference: "unknown", idempotencyKey: "refund-2" })).toMatchObject({ ok: false });
  });
});

// ── Collecting ──────────────────────────────────────────────────────────

describe("billing: collecting a charge", () => {
  it("creates the charge row first, then asks the processor, then records the answer", async () => {
    const order: string[] = [];
    const memory = createMemoryChargeStore([], (n) => `ch-${n}`);
    const store: ChargeStore = {
      async createCharge(input) {
        order.push("row");
        return memory.createCharge(input);
      },
      async saveAttempt(c, ref) {
        order.push("saved");
        return memory.saveAttempt(c, ref);
      },
    };
    const demo = createDemoGateway();
    const gateway: PaymentGateway = { ...demo, charge: async (input) => (order.push("processor"), demo.charge(input)) };
    const report = await runClientBilling({ gateway, store }, context(), HANDLE, NOW);
    expect(order).toEqual(["row", "processor", "saved"]);
    expect(report.attempts.map((a) => a.outcome)).toEqual(["paid"]);
    expect(report.charges).toHaveLength(1);
    expect(report.charges[0]).toMatchObject({ roundNumber: 1, amountCents: 8900, status: "succeeded", attempts: 1, workDate: ago(5) });
    expect(memory.references()["ch-1"]).toMatch(/^demo_ch_/);
  });

  it("asks the processor for nothing when the rule says no", async () => {
    for (const ctx of [context({ agreement: null }), context({ rounds: [] }), context({ rounds: [round(1, 0, undefined)] }), context({ agreement: { ...SIGNED, cancelledAt: ago(50) } })]) {
      const gateway = createDemoGateway();
      const store = createMemoryChargeStore();
      const report = await runClientBilling({ gateway, store }, ctx, HANDLE, NOW);
      expect(report.eligibility.eligible).toBe(false);
      expect(gateway.chargeCalls()).toBe(0);
      expect(store.charges()).toEqual([]);
    }
  });

  it("asks the processor for nothing when the database refuses the row", async () => {
    const gateway = createDemoGateway();
    const store: ChargeStore = {
      createCharge: async () => ({ created: false, reason: "charges: the round is not recorded as mailed" }),
      saveAttempt: async () => undefined,
    };
    const report = await runClientBilling({ gateway, store }, context(), HANDLE, NOW);
    expect(report.refused).toMatch(/not recorded as mailed/);
    expect(report.attempts).toEqual([]);
    expect(gateway.chargeCalls()).toBe(0);
  });

  it("running twice charges once: the round already has its charge", async () => {
    const gateway = createDemoGateway();
    const store = createMemoryChargeStore([], (n) => `ch-${n}`);
    const first = await runClientBilling({ gateway, store }, context(), HANDLE, NOW);
    const second = await runClientBilling({ gateway, store }, context({ account: { charges: first.charges } }), HANDLE, NOW);
    expect(second.attempts).toEqual([]);
    expect(second.eligibility).toMatchObject({ eligible: false, code: "nothing_unbilled" });
    expect(gateway.chargesMade()).toBe(1);
    expect(store.charges()).toHaveLength(1);
    // And the store itself refuses a second row for the round, as the database does.
    expect(await store.createCharge({ roundNumber: 1, amountCents: 8900, workDate: ago(5) })).toEqual({ created: false, reason: "a charge for this round already exists" });
    expect(await createMemoryChargeStore().createCharge({ roundNumber: 1, amountCents: 0, workDate: ago(5) })).toMatchObject({ created: false });
  });

  it("a request repeated after a crash can never double-charge", async () => {
    // The processor takes the money; the write that records it is lost.
    const gateway = createDemoGateway();
    const memory = createMemoryChargeStore([], (n) => `ch-${n}`);
    let lose = true;
    const store: ChargeStore = {
      createCharge: (input) => memory.createCharge(input),
      async saveAttempt(c, ref) {
        if (lose) {
          lose = false;
          throw new Error("connection lost");
        }
        return memory.saveAttempt(c, ref);
      },
    };
    await expect(runClientBilling({ gateway, store }, context(), HANDLE, NOW)).rejects.toThrow("connection lost");
    // On record: a pending charge with no attempts. At the processor: one charge.
    expect(memory.charges()).toMatchObject([{ status: "pending", attempts: 0 }]);
    expect(gateway.chargesMade()).toBe(1);

    // The next run finds the pending charge and asks again with the SAME key.
    const again = await runClientBilling({ gateway, store }, context({ account: { charges: memory.charges() } }), HANDLE, later(0, 1));
    expect(again.attempts.map((a) => a.outcome)).toEqual(["paid"]);
    expect(gateway.chargeCalls()).toBe(2);
    expect(gateway.chargesMade()).toBe(1);
    expect(memory.charges()).toMatchObject([{ status: "succeeded", attempts: 1 }]);
    expect(memory.charges()).toHaveLength(1);
  });

  it("an outage is not an attempt: nothing is recorded and the same request goes out later", async () => {
    const demo = createDemoGateway();
    const keys: string[] = [];
    let down = true;
    const gateway: PaymentGateway = {
      ...demo,
      async charge(input) {
        keys.push(input.idempotencyKey);
        if (down) return { ok: false, kind: "error", message: "timeout" };
        return demo.charge(input);
      },
    };
    const store = createMemoryChargeStore([], (n) => `ch-${n}`);
    const first = await runClientBilling({ gateway, store }, context(), HANDLE, NOW);
    expect(first.attempts).toMatchObject([{ outcome: "error", message: "timeout" }]);
    expect(store.charges()).toMatchObject([{ status: "pending", attempts: 0, nextAttemptAt: null }]);
    down = false;
    const second = await runClientBilling({ gateway, store }, context({ account: { charges: store.charges() } }), HANDLE, later(0, 1));
    expect(second.attempts.map((a) => a.outcome)).toEqual(["paid"]);
    expect(keys).toEqual(["ch-1:1", "ch-1:1"]);
    // A processor that throws is handled the same way.
    const throwing: PaymentGateway = { ...demo, charge: async () => Promise.reject(new Error("socket hang up")) };
    const report = await attemptCharge({ gateway: throwing, store: createMemoryChargeStore() }, charge(9, 5, { status: "pending", attempts: 0, chargedAt: null }), HANDLE, NOW);
    expect(report).toMatchObject({ outcome: "error", message: "socket hang up" });
  });

  it("a declined card: three tries on the same charge, then the case pauses; a working card resumes it", async () => {
    const gateway = createDemoGateway();
    const store = createMemoryChargeStore([], (n) => `ch-${n}`);
    const run = (now: Date, handle = BAD_HANDLE) =>
      runClientBilling({ gateway, store }, context({ account: { charges: store.charges() } }), handle, now);

    // Day 0: the charge is created and declined.
    expect((await run(NOW)).attempts.map((a) => a.outcome)).toEqual(["declined"]);
    expect(store.charges()).toMatchObject([{ status: "failed", attempts: 1, nextAttemptAt: later(3).toISOString() }]);
    // Before the retry date nothing is asked.
    expect((await run(later(2))).attempts).toEqual([]);
    expect(gateway.chargeCalls()).toBe(1);
    // Day 3 and day 7: retried, declined.
    expect((await run(later(3))).attempts.map((a) => a.outcome)).toEqual(["declined"]);
    expect(store.charges()).toMatchObject([{ attempts: 2, nextAttemptAt: later(7).toISOString() }]);
    expect((await run(later(7))).attempts.map((a) => a.outcome)).toEqual(["exhausted"]);
    expect(store.charges()).toMatchObject([{ status: "failed", attempts: 3, nextAttemptAt: null }]);
    expect(casePausedForPayment({ paymentMethod: METHOD, charges: store.charges(), pause: null })).toBe(true);
    // Paused: the system does not ask again by itself, however long it waits.
    expect((await run(later(60))).attempts).toEqual([]);
    expect(gateway.chargeCalls()).toBe(3);
    // It was one charge throughout.
    expect(store.charges()).toHaveLength(1);

    // The client puts a working method on file: one more try, and it goes through.
    const rearmed = store.charges().map((c) => rearmAfterNewPaymentMethod(c, later(9)));
    const fixed = await runClientBilling({ gateway, store }, context({ account: { charges: rearmed } }), HANDLE, later(9));
    expect(fixed.attempts.map((a) => a.outcome)).toEqual(["paid"]);
    expect(fixed.charges).toMatchObject([{ id: "ch-1", status: "succeeded", attempts: 4 }]);
    expect(casePausedForPayment({ paymentMethod: METHOD, charges: fixed.charges, pause: null })).toBe(false);
    expect(gateway.chargesMade()).toBe(1);
  });

  it("does not start a second charge while an earlier one is unpaid", async () => {
    const gateway = createDemoGateway();
    const store = createMemoryChargeStore([declined(1, 45, 3, 37)], (n) => `ch-${n}`);
    const ctx = context({ rounds: [round(1, 45), round(2, 5)], account: { charges: store.charges() } });
    const report = await runClientBilling({ gateway, store }, ctx, HANDLE, NOW);
    expect(report.attempts).toEqual([]);
    expect(report.eligibility).toMatchObject({ eligible: false, code: "earlier_charge_unpaid" });
    expect(store.charges()).toHaveLength(1);
  });

  it("stops retrying when the client asked to end the service, and says a person must decide", async () => {
    const gateway = createDemoGateway();
    const due = declined(1, 5, 1, 4);
    const store = createMemoryChargeStore([due]);
    const report = await runClientBilling({ gateway, store }, context({ agreement: { ...SIGNED, serviceEndRequestedAt: ago(1) }, account: { charges: [due] } }), HANDLE, NOW);
    expect(report.attempts).toEqual([]);
    expect(report.skipped).toMatchObject([{ code: "service_end_requested", needsPerson: true }]);
    expect(gateway.chargeCalls()).toBe(0);
  });

  it("does nothing without a payment handle, and flags it", async () => {
    const gateway = createDemoGateway();
    const due = declined(1, 5, 1, 4);
    const report = await runClientBilling({ gateway, store: createMemoryChargeStore([due]) }, context({ account: { charges: [due] } }), null, NOW);
    expect(report.skipped).toMatchObject([{ code: "no_payment_handle", needsPerson: true }]);
    expect(gateway.chargeCalls()).toBe(0);
    const fresh = await runClientBilling({ gateway, store: createMemoryChargeStore() }, context(), null, NOW);
    expect(fresh.attempts).toEqual([]);
    expect(gateway.chargeCalls()).toBe(0);
  });
});

// ── Refunds ─────────────────────────────────────────────────────────────

describe("billing: refunds", () => {
  const reason = "Dos cartas salieron con la dirección anterior.";

  it("a paid charge is refundable in full, with a written reason", () => {
    expect(refundEligibility(charge(1, 5), reason)).toEqual({ allowed: true, amountCents: 8900 });
    expect(REFUND_REASON_MIN_CHARS).toBeGreaterThanOrEqual(10);
  });

  it("needs a real reason", () => {
    for (const short of ["", "   ", "error", "a b c d e"]) {
      expect(refundEligibility(charge(1, 5), short), short).toMatchObject({ allowed: false, code: "reason_required" });
    }
    expect(cleanRefundReason("  se   cobró\n dos veces  ")).toBe("se cobró dos veces");
  });

  it("there is nothing to refund on a charge that was never paid, and no second refund", () => {
    expect(refundEligibility(declined(1, 5, 1, 4), reason)).toMatchObject({ allowed: false, code: "not_paid" });
    expect(refundEligibility(charge(1, 5, { status: "pending", chargedAt: null }), reason)).toMatchObject({ allowed: false, code: "not_paid" });
    expect(refundEligibility(charge(1, 5, { status: "refunded" }), reason)).toMatchObject({ allowed: false, code: "already_refunded" });
  });

  it("a charge made in error stays refundable however old it is", () => {
    expect(refundEligibility(charge(1, 900), reason)).toEqual({ allowed: true, amountCents: 8900 });
  });

  it("is recorded on the charge, never in place of it", () => {
    const paid = charge(1, 5);
    const refunded = withRefund(paid, { id: "re-1", amountCents: 8900, reason, by: "carmen", at: NOW.toISOString(), completedAt: NOW.toISOString() });
    expect(refunded).toMatchObject({ id: paid.id, status: "refunded", amountCents: 8900, chargedAt: paid.chargedAt });
    expect(refunded.refund).toMatchObject({ reason, by: "carmen", amountCents: 8900 });
    expect(paid.status).toBe("succeeded");
    expect(chargeStanding(refunded)).toBe("refunded");
    // The round is not charged again.
    expect(chargeEligibility(context({ account: { charges: [refunded] } }), later(60))).toMatchObject({ eligible: false, code: "nothing_unbilled" });
  });
});

// ── The authorization ───────────────────────────────────────────────────

describe("billing: the recurring-payment authorization", () => {
  const terms = { companyLegalName: "Credalti LLC", companyEmail: "hola@credalti.test", monthlyFee: "89.00" };

  it("is a draft for the attorney, versioned", () => {
    for (const locale of ["es", "en"] as const) {
      const doc = paymentAuthorization(locale, terms);
      expect(doc.reviewStatus).toBe("attorney_pending");
      expect(doc.version).toBe(PAYMENT_AUTHORIZATION_VERSION);
      expect(doc.version).toMatch(/draft/);
      expect(doc.points.length).toBeGreaterThanOrEqual(6);
    }
  });

  it("says what is charged, when, how to stop it and how to get a copy", () => {
    const es = paymentAuthorizationText(paymentAuthorization("es", terms));
    expect(es).toMatch(/\$89\.00 cada vez/);
    expect(es).toMatch(/Solo después de que mi equipo envió por correo una ronda de mis cartas/);
    expect(es).toMatch(/Nunca se cobra por adelantado, nunca más de un cobro por ronda y nunca más de una vez cada 30 días/);
    expect(es).toMatch(/Puedo retirar esta autorización en cualquier momento y sin costo/);
    expect(es).toMatch(/hola@credalti\.test/);
    expect(es).toMatch(/Puedo leer e imprimir esta autorización cuando quiera/);
    expect(es).toMatch(/a los 3 y a los 7 días/);
    expect(es).toMatch(/monitoreo de crédito es aparte/);
    expect(es).toMatch(/No hay cuota de inscripción, cargos por pago tardío, cargos por cancelar ni cargos por el envío/);
    const en = paymentAuthorizationText(paymentAuthorization("en", terms));
    expect(en).toMatch(/Only after my team has mailed a round of my letters/);
    expect(en).toMatch(/I can withdraw this authorization at any time and at no cost/);
    expect(en).toMatch(/after 3 and 7 days/);
  });

  it("prints no amount while the agreement carries no fee", () => {
    expect(authorizationFee({ ...terms, monthlyFee: null })).toBeNull();
    for (const locale of ["es", "en"] as const) {
      const text = paymentAuthorizationText(paymentAuthorization(locale, { ...terms, monthlyFee: null }));
      expect(text).not.toMatch(/\$\d/);
      expect(text).toMatch(locale === "es" ? /La cuota de servicio que dice mi acuerdo firmado, y nada más/ : /The service fee stated in my signed agreement, and nothing else/);
    }
  });

  it("is hashed like the agreement documents: SHA-256 of exactly the text shown", () => {
    const hash = paymentAuthorizationHash(PAYMENT_AUTHORIZATION_VERSION, "es", terms);
    const text = [`version: ${PAYMENT_AUTHORIZATION_VERSION}`, "locale: es", paymentAuthorizationText(paymentAuthorization("es", terms))].join("\n\n");
    expect(hash).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // The same text, the same hash; any difference, another.
    expect(paymentAuthorizationHash(PAYMENT_AUTHORIZATION_VERSION, "es", { ...terms })).toBe(hash);
    expect(paymentAuthorizationHash(PAYMENT_AUTHORIZATION_VERSION, "en", terms)).not.toBe(hash);
    expect(paymentAuthorizationHash(PAYMENT_AUTHORIZATION_VERSION, "es", { ...terms, monthlyFee: "99.00" })).not.toBe(hash);
    expect(paymentAuthorizationHash(PAYMENT_AUTHORIZATION_VERSION, "es", { ...terms, companyEmail: "otro@credalti.test" })).not.toBe(hash);
    expect(paymentAuthorizationHash("2027-01-01", "es", terms)).not.toBe(hash);
    expect(readFileSync("src/lib/billing/authorization.ts", "utf8")).toContain('import { sha256Hex } from "../agreement/sha256";');
  });

  it("passes the claim rules, in both languages, with and without a fee", () => {
    for (const locale of ["es", "en"] as const) {
      for (const t of [terms, { companyLegalName: null, companyEmail: null, monthlyFee: null }]) {
        const doc = paymentAuthorization(locale, t);
        for (const line of [doc.title, doc.intro, doc.consent, ...doc.points.flatMap((p) => [p.heading, p.text])]) {
          expect(checkClaimGuardrails(line, "full_service"), line).toEqual([]);
          expect(checkMarketingCopy(line, "full_service"), line).toEqual([]);
          expect(line).not.toMatch(/ataque|resultado|result|puntaje|score/i);
        }
      }
    }
  });
});

// ── Receipts ────────────────────────────────────────────────────────────

describe("billing: receipts", () => {
  // Round 2 mailed on 4 November 2026 (Texas), charged the next day.
  const mailed = "2026-11-04T16:00:00.000Z";
  const round2: BillableRound = { number: 2, mailed: true, mailedAt: mailed, letters: BUREAUS.map((recipient) => ({ recipient, returned: false })) };
  const paid = charge(2, 0, { id: "3f9a1c2e-77aa-4b1d-9c0e-aaaaaaaaaaaa", workDate: mailed, chargedAt: "2026-11-05T16:00:00.000Z" });

  it("says exactly which work the money paid for", () => {
    expect(workLine(round2)).toEqual({
      es: "Ronda 2: 3 cartas enviadas el 4 de noviembre a Equifax, Experian y TransUnion",
      en: "Round 2: 3 letters mailed on November 4 to Equifax, Experian and TransUnion",
    });
    expect(workLine({ ...round2, number: 1, letters: [{ recipient: "Equifax", returned: false }] }).es).toBe("Ronda 1: 1 carta enviada el 4 de noviembre a Equifax");
    // Two letters to one recipient: named once.
    expect(workLine({ ...round2, letters: [{ recipient: "Equifax", returned: false }, { recipient: "Equifax", returned: false }, { recipient: "Midland Credit Management", returned: false }] }).es).toBe(
      "Ronda 2: 3 cartas enviadas el 4 de noviembre a Equifax y Midland Credit Management",
    );
  });

  it("carries the date, the amount and the work, and a number to quote", () => {
    const receipt = receiptFor(paid, round2)!;
    expect(receipt).toMatchObject({
      number: "R-3F9A1C2E",
      roundNumber: 2,
      amountCents: 8900,
      amount: "$89.00",
      date: { es: "5 de noviembre de 2026", en: "November 5, 2026" },
      work: workLine(round2),
      refundedAt: null,
    });
    expect(receiptNumber("ab-12")).toBe("R-AB12");
  });

  it("exists only for money that was actually taken", () => {
    expect(receiptFor(declined(1, 5, 1, 4), round2)).toBeNull();
    expect(receiptFor(charge(1, 5, { status: "pending", chargedAt: null }), round2)).toBeNull();
    // A refunded charge keeps its receipt, marked as returned.
    const refunded = withRefund(paid, { id: "r", amountCents: 8900, reason: "Se cobró por error.", by: "ana", at: "2026-11-08T16:00:00.000Z", completedAt: "2026-11-08T16:00:00.000Z" });
    expect(receiptFor(refunded, round2)).toMatchObject({ refundedAt: "2026-11-08T16:00:00.000Z" });
    expect(receiptsFor([declined(1, 40, 3, 30), paid], [round2]).map((r) => r.roundNumber)).toEqual([2]);
    // Without the round's letters at hand it still names the round and its date.
    expect(receiptFor(paid, null)!.work.es).toBe("Ronda 2: cartas enviadas el 4 de noviembre");
  });

  it("is sent in words that pass the claim rules", () => {
    const message = receiptMessage(receiptFor(paid, round2)!);
    expect(message.es).toBe(
      "Recibo R-3F9A1C2E. Cobramos $89.00 el 5 de noviembre de 2026 por trabajo ya hecho: Ronda 2: 3 cartas enviadas el 4 de noviembre a Equifax, Experian y TransUnion. Lo ves cuando quieras en la app, en «Mis pagos».",
    );
    expectCleanClientCopy(message.es);
    expectCleanClientCopy(message.en);
  });
});

// ── What the client is told ─────────────────────────────────────────────

describe("billing: every message to a client passes the claim rules", () => {
  it("a declined payment: plain, with the next step, no fee and no threat", () => {
    const first = paymentFailedMessage({ firstName: "Noemí", charge: declined(1, 5, 1, 0) });
    expect(first.es).toMatch(/^Hola Noemí, te escribe el equipo de Credalti\. No pudimos procesar el cobro de \$89\.00 por tu ronda 1 de cartas, que tu equipo envió el 30 de noviembre\./);
    expect(first.es).toMatch(/Lo intentamos de nuevo el 8 de diciembre\./);
    expect(first.es).toMatch(/No hay ningún cargo extra por esto\.$/);
    const second = paymentFailedMessage({ firstName: "Noemí", charge: declined(1, 8, 2, 0) });
    expect(second.es).toMatch(/Otra vez no pudimos procesar/);
    expect(second.es).toMatch(/Lo intentamos de nuevo el 9 de diciembre\./);
    const last = paymentFailedMessage({ firstName: null, charge: declined(1, 12, 3, 0) });
    expect(last.es).toMatch(/^Hola, te escribe el equipo de Credalti\./);
    expect(last.es).toMatch(/ya no lo intentaremos por nuestra cuenta\. No hay cargos extra ni recargos\. Tu caso queda en pausa/);
    expect(last.es).toMatch(/En cuanto actualices tu método de pago en la app, en «Mis pagos», tu caso sigue solo\./);
    for (const message of [first, second, last]) {
      expectCleanClientCopy(message.es);
      expectCleanClientCopy(message.en);
    }
  });

  it("a charge that is due with no payment method on file", () => {
    const message = paymentMethodNeededMessage({ firstName: "Baltazar", roundNumber: 1, workDate: ago(2) });
    expect(message.es).toMatch(/Tu equipo envió tu ronda 1 de cartas el 3 de diciembre y todavía no tenemos tu método de pago/);
    expect(message.es).toMatch(/El cobro es por ese trabajo, que ya se hizo\./);
    expectCleanClientCopy(message.es);
    expectCleanClientCopy(message.en);
  });

  it("everything the 'Mis pagos' screen says", () => {
    for (const locale of ["es", "en"] as const) {
      const lines = billingCopyStrings(locale);
      expect(lines.length).toBeGreaterThan(60);
      for (const line of lines) {
        expect(checkClaimGuardrails(line, "full_service"), line).toEqual([]);
        expect(checkMarketingCopy(line, "full_service"), line).toEqual([]);
        expect(line, line).not.toMatch(/ataque|\battack\b|resultado|\bresults?\b|puntaje|\bscore\b|gratis|\bfree\b/i);
        // No price is written in the copy: the amount comes from the signed agreement.
        expect(line, line).not.toMatch(/\$\s?\d/);
      }
    }
    // The three things the screen must always say.
    expect(BILLING_COPY.es.lead).toMatch(/Cada cobro paga trabajo que ya se hizo/);
    expect(BILLING_COPY.es.monitoringBody).toMatch(/se la pagas directamente al servicio de monitoreo, no a Credalti/);
    expect(BILLING_COPY.es.whenLine).toBe("El cobro se hace después de que tu equipo envíe tu siguiente ronda, nunca antes.");
    expect(BILLING_COPY.en.lead).toMatch(/Each charge pays for work that is already done/);
    expect(BILLING_COPY.es.feeLine("$89.00")).toMatch(/^Tu cuota es de \$89\.00 por cada ronda de cartas enviada/);
  });

  it("every 'what happens next' sentence, for every situation", () => {
    const exhausted = declined(1, 20, 3, 12);
    const situations: Array<[OutlookKind, BillingContext]> = [
      ["charge_scheduled", context()],
      ["charge_scheduled", context({ rounds: [round(1, 0, undefined)] })],
      ["charge_scheduled", context({ rounds: [round(1, 20), round(2, 5)], account: { charges: [charge(1, 20)] } })],
      ["retry_scheduled", context({ account: { charges: [declined(1, 5, 1, 2)] } })],
      ["processing", context({ account: { charges: [charge(1, 5, { status: "pending", attempts: 0, chargedAt: null })] } })],
      ["paused_for_payment", context({ rounds: [round(1, 20)], account: { charges: [exhausted] } })],
      ["payment_method_missing", context({ account: { paymentMethod: null } })],
      ["payment_method_missing", context({ account: { paymentMethod: null, charges: [declined(1, 5, 1, 2)] } })],
      ["nothing_to_charge", context({ rounds: [] })],
      ["nothing_to_charge", context({ account: { charges: [charge(1, 5)] } })],
      ["nothing_to_charge", context({ agreement: { ...SIGNED, serviceEndRequestedAt: ago(1) }, account: { charges: [charge(1, 5)] } })],
      ["not_chargeable", context({ agreement: null })],
      ["not_chargeable", context({ agreement: { ...SIGNED, cancelledAt: ago(58) } })],
      ["not_chargeable", context({ agreement: { ...SIGNED, signedAt: ago(1), cancellationDeadline: later(3).toISOString() } })],
      ["needs_person", context({ agreement: { ...SIGNED, serviceEndRequestedAt: ago(1) } })],
      ["needs_person", context({ agreement: { ...SIGNED, serviceEndRequestedAt: ago(1) }, account: { charges: [declined(1, 5, 1, 2)] } })],
      ["needs_person", context({ rounds: [round(1, 5, [["Equifax", true]])] })],
      ["needs_person", context({ signedMonthlyFee: null })],
      ["billing_paused", context({ account: { pause: { at: ago(2), by: "carmen", reason: "Cambia de banco" } } })],
      ["billing_paused", context({ account: { charges: [declined(1, 5, 1, 2)], pause: { at: ago(2), by: "carmen", reason: "Cambia de banco" } } })],
    ];
    const kinds: OutlookKind[] = ["charge_scheduled", "retry_scheduled", "processing", "paused_for_payment", "payment_method_missing", "nothing_to_charge", "not_chargeable", "needs_person", "billing_paused"];
    expect([...new Set(situations.map(([kind]) => kind))].sort()).toEqual([...kinds].sort());
    for (const [kind, ctx] of situations) {
      for (const amounts of [true, false]) {
        const outlook = billingOutlook(ctx, NOW, { amounts });
        expect(outlook.kind, outlook.staff).toBe(kind);
        expectCleanClientCopy(outlook.client.es);
        expectCleanClientCopy(outlook.client.en);
        expect(outlook.staff.length).toBeGreaterThan(20);
        // The team's pause note is theirs: it never reaches the client's sentence.
        expect(`${outlook.client.es} ${outlook.client.en}`).not.toContain("Cambia de banco");
        if (!amounts) expect(`${outlook.client.es} ${outlook.client.en}`).not.toMatch(/\$\d/);
      }
    }
  });

  it("the journey's nudge to add a payment method", () => {
    const state: JourneyState = { reportImported: true, totalItems: 8, reviewedCount: 8, attestedCount: 3, roundApproved: false, agreement: SIGNED, paymentMethodOnFile: false };
    for (const locale of ["es", "en"] as const) {
      const step = nextAction(state, locale, { mode: "full_service", now: NOW });
      expect(step.key).toBe("payment-method");
      for (const line of [step.title, step.description, step.cta]) expectCleanClientCopy(line);
    }
  });
});

// ── What the staff console is told ──────────────────────────────────────

describe("billing: the one honest sentence about what happens next", () => {
  it("says when the system charges", () => {
    // Mailed at noon on 4 December (Texas): charged from noon on the 5th. Read on the 4th.
    const yesterdayNoon = new Date(NOW.getTime() - DAY);
    const ctx = context({ rounds: [round(1, 20), { ...round(2, 0), mailedAt: yesterdayNoon.toISOString() }], account: { charges: [charge(1, 20)] } });
    // 30 days after round 1's work (15 November): 15 December.
    expect(billingOutlook(ctx, yesterdayNoon).staff).toBe("El sistema cobra la ronda 2 el 15 de diciembre.");
    expect(billingOutlook(context({ rounds: [{ ...round(1, 0), mailedAt: ago(0, 3) }] }), NOW).staff).toBe("El sistema cobra la ronda 1 mañana.");
    expect(billingOutlook(context(), NOW).staff).toBe("El sistema cobra la ronda 1 hoy.");
  });

  it("says when there is nothing to charge, and why", () => {
    expect(billingOutlook(context({ rounds: [] }), NOW).staff).toBe("No hay nada que cobrar: todavía no se envía ninguna ronda.");
    expect(billingOutlook(context({ agreement: { ...SIGNED, signedAt: ago(1), cancellationDeadline: later(3).toISOString() } }), NOW).staff).toBe(
      "No se cobra: está en su periodo de cancelación.",
    );
    expect(billingOutlook(context({ agreement: { ...SIGNED, cancelledAt: ago(58) } }), NOW).staff).toBe("No se cobra: canceló su acuerdo.");
    expect(billingOutlook(context({ account: { charges: [charge(1, 5)] } }), NOW).staff).toBe(
      "No hay nada que cobrar: cada ronda enviada ya tiene su cobro. El siguiente es después de que se envíe la ronda 2.",
    );
  });

  it("says what is wrong when a payment did not go through", () => {
    expect(billingOutlook(context({ account: { charges: [declined(1, 5, 1, 2)] } }), NOW).staff).toBe(
      "El cobro de la ronda 1 no pasó. El sistema lo intenta de nuevo mañana (intento 2 de 3).",
    );
    expect(billingOutlook(context({ rounds: [round(1, 20)], account: { charges: [declined(1, 20, 3, 12)] } }), NOW).staff).toMatch(
      /^El cobro de la ronda 1 no pasó en 3 intentos y el sistema ya no lo intenta\. El caso está en pausa/,
    );
    expect(billingOutlook(context({ account: { paymentMethod: null } }), NOW).staff).toBe("Falta su método de pago: la ronda 1 ya se puede cobrar y no hay con qué.");
  });

  it("gives the date the system acts, when it has one", () => {
    expect(billingOutlook(context(), NOW).at).toBe(NOW.toISOString());
    expect(billingOutlook(context({ account: { charges: [declined(1, 5, 1, 2)] } }), NOW).at).toBe(later(1).toISOString());
    expect(billingOutlook(context({ rounds: [] }), NOW).at).toBeNull();
    expect(billingOutlook(context({ rounds: [round(1, 20)], account: { charges: [declined(1, 20, 3, 12)] } }), NOW).at).toBeNull();
  });
});

// ── The staff console ───────────────────────────────────────────────────

describe("billing: the staff console", () => {
  const FEE = "89.00";
  const report = parseReport({ ...DEMO_RAW_REPORT, pulledAt: ago(2) });
  const answers = Object.fromEntries(
    report.items.map((item, index) => [
      item.fingerprint,
      index < 3 ? ({ status: "inaccurate", reason: "No lo reconozco.", confirmedAt: ago(1) } as const) : ({ status: "correct", answeredAt: ago(1) } as const),
    ]),
  );
  const staffRound = (number: number, status: StaffRound["status"], mailedDaysAgo?: number): StaffRound => ({
    number,
    status,
    mailedAt: mailedDaysAgo === undefined ? null : ago(mailedDaysAgo),
    respondedAt: status === "responded" ? ago(1) : null,
    letters: [
      {
        id: `l-${number}`,
        recipient: { type: "bureau", key: "equifax", name: "Equifax Information Services LLC", addressLines: ["P.O. Box 740256"] },
        templateKey: "personal_info_cleanup",
        category: "personal_info",
        stage: "personal_info_cleanup",
        items: report.items.filter((i) => i.category === "personal_info").slice(0, 1),
        mailStatus: status === "draft" || status === "ready" ? "not_sent" : "delivered",
      },
    ],
  });
  function client(overrides: Partial<StaffClient> = {}): StaffClient {
    const base: StaffClient = {
      id: "t1",
      firstName: "Prueba",
      // A Spanish-speaking client: the drafts below are written in Spanish.
      locale: "es",
      lastName: "Ejemplo",
      phone: "+17135550100",
      state: "TX",
      addressLines: ["1 Calle Ejemplo", "Houston, TX 77001"],
      salesperson: "ana",
      createdAt: ago(62),
      signedUpAt: ago(61),
      agreementSignedAt: ago(60),
      documents: ["government_id", "proof_of_address"],
      report,
      answers,
      rounds: [],
      agreementMonthlyFee: FEE,
      billing: { paymentMethod: null, charges: [], pause: null },
      lastActivityAt: ago(1),
      notes: [],
      questions: [],
      handled: {},
      ...overrides,
    };
    return overrides.billing ? base : { ...base, billing: paidUpBilling(base, FEE, NOW) };
  }
  const kinds = (c: StaffClient) => clientExceptions(c, NOW).map((e) => e.kind);
  const failing = (attempts: number, lastDaysAgo: number, mailedDaysAgo = 20): BillingAccount => ({
    paymentMethod: METHOD,
    charges: [declined(1, mailedDaysAgo, attempts, lastDaysAgo)],
    pause: null,
  });

  it("a declined payment is the system's job while it retries: no exception, no pause, and it is the next automatic step", () => {
    const c = client({ rounds: [staffRound(1, "mailed", 5)], billing: failing(1, 2, 5) });
    expect(kinds(c)).toEqual([]);
    expect(clientStage(c, NOW)).toBe("waiting_on_bureaus");
    expect(nextBillingStep(c, NOW)).toEqual({ text: "Reintentar el cobro de la ronda 1 el 6 de diciembre", at: later(1).toISOString() });
    // It comes before the re-import, which is weeks away.
    expect(nextAutomaticStep(c, NOW)!.text).toBe("Reintentar el cobro de la ronda 1 el 6 de diciembre");
    expect(nextStep(c, NOW)).toMatchObject({ actor: "system" });
    expect(clientTimeline(c, NOW)[0]).toMatchObject({ kind: "upcoming", text: "Reintentar el cobro de la ronda 1 el 6 de diciembre" });
  });

  it("becomes a person's only when the retries are used up, and then the case is paused", () => {
    const c = client({ rounds: [staffRound(1, "mailed", 20)], billing: failing(3, 12) });
    expect(kinds(c)).toEqual(["payment_past_due"]);
    expect(clientStage(c, NOW)).toBe("paused");
    expect(nextAutomaticStep(c, NOW)).toBeNull();
    expect(nextStep(c, NOW)).toEqual({ actor: "client", text: "Actualizar su método de pago", at: null });
    expect(STAGE_TEXT.es.paused.description).toMatch(/Con un cobro sin resolver no se prepara ni se envía ninguna ronda; en cuanto el cliente paga, el caso sigue solo/);
  });

  it("paused means no new round goes out, even one that is prepared", () => {
    const paused = client({ rounds: [staffRound(1, "responded", 41), staffRound(2, "ready")], billing: failing(3, 33, 41) });
    expect(clientStage(paused, NOW)).toBe("paused");
    expect(sendableRound(paused, NOW)).toBeNull();
    // With the charge paid, the same client's round 2 is ready to send again.
    const paid = { ...paused, billing: { ...paused.billing, charges: paused.billing.charges.map((c) => afterAttempt(c, { ok: true, reference: "r" }, NOW)) } };
    expect(clientStage(paid, NOW)).toBe("next_round_ready");
    expect(sendableRound(paid, NOW)?.number).toBe(2);
    expect(kinds(paid)).toEqual([]);
  });

  it("the stage is read from the charges, not from a flag", () => {
    const stage = readFileSync("src/lib/staff/stage.ts", "utf8");
    expect(stage).not.toMatch(/client\.billing === /);
    expect(stage).toMatch(/if \(pausedForPayment\(client\)\) return "paused";/);
    const types = readFileSync("src/lib/staff/types.ts", "utf8");
    expect(types).not.toMatch(/BillingStatus|"past_due"/);
    expect(types).toMatch(/billing: BillingAccount;/);
  });

  it("no payment method is an exception only once a charge is due", () => {
    const none: BillingAccount = { paymentMethod: null, charges: [], pause: null };
    // A round ready to mail, or mailed an hour ago: nothing is due yet.
    expect(kinds(client({ rounds: [staffRound(1, "ready")], billing: none }))).toEqual([]);
    const today = client({ rounds: [{ ...staffRound(1, "mailed", 0), mailedAt: ago(0, 1) }], billing: none });
    expect(kinds(today)).toEqual([]);
    expect(nextBillingStep(today, NOW)).toBeNull();
    // A day later the charge is due and there is nothing to charge.
    const due = client({ rounds: [staffRound(1, "mailed", 2)], billing: none });
    const [e] = clientExceptions(due, NOW);
    expect(e).toMatchObject({ kind: "payment_method_missing", key: "payment_method_missing:1", severity: "high", action: "whatsapp", since: ago(2) });
    expect(e!.sentence).toBe("Falta su método de pago. La ronda 1 se envió el 3 de diciembre y el sistema no tiene con qué cobrarla.");
    expect(e!.actionLabel).toBe("Pedirle su método de pago");
    // Not a reason to hold the letters, and not a pause.
    expect(clientStage(due, NOW)).toBe("waiting_on_bureaus");
    const draft = exceptionMessage(due, e!);
    expect(draft).toMatch(/^Hola Prueba, te escribe el equipo de Credalti\. Tu equipo envió tu ronda 1 de cartas el 3 de diciembre/);
    expectCleanClientCopy(draft);
  });

  it("the drafted message for an unpaid charge uses the same plain words as the automatic notice", () => {
    const c = client({ rounds: [staffRound(1, "mailed", 20)], billing: failing(3, 12) });
    const draft = exceptionMessage(c, clientExceptions(c, NOW)[0]!);
    expect(draft).toBe(`Hola Prueba, te escribe el equipo de Credalti. ${paymentFailedMessage({ charge: c.billing.charges[0]! }).es.replace(/^Hola, te escribe el equipo de Credalti\. /, "")}`);
    expectCleanClientCopy(draft);
  });

  it("the system's next charge is an automatic step, with its date", () => {
    const mailedToday = client({ rounds: [{ ...staffRound(1, "mailed", 0), mailedAt: ago(0, 1) }] });
    expect(mailedToday.billing.charges).toEqual([]);
    expect(nextBillingStep(mailedToday, NOW)!.text).toBe("Cobrar la ronda 1 el 6 de diciembre");
    expect(clientBillingOutlook(mailedToday, NOW).staff).toBe("El sistema cobra la ronda 1 mañana.");
    // Charged and paid: billing has nothing scheduled; the work's own step is next.
    const paid = client({ rounds: [staffRound(1, "mailed", 5)] });
    expect(nextBillingStep(paid, NOW)).toBeNull();
    expect(nextAutomaticStep(paid, NOW)!.text).toMatch(/^Re-importar el reporte/);
  });

  it("nothing asks staff to charge anyone, and no operation could", () => {
    const data = readFileSync("src/lib/staff/data.ts", "utf8");
    const api = data.slice(data.indexOf("export interface StaffData"), data.indexOf("// ── Demo implementation"));
    const methods = [...api.matchAll(/^  (\w+)\(/gm)].map((m) => m[1]!);
    const money = methods.filter((name) => /charge|bill|pay|amount|refund|cobr|pag/i.test(name));
    expect(money).toEqual(["refundCharge", "pauseBilling", "resumeBilling"]);
    // No operation takes an amount: the signatures have no such parameter.
    const signatures = [...api.matchAll(/^  \w+\([^;]*;/gm)].map((m) => m[0]);
    expect(signatures).toHaveLength(methods.length);
    for (const signature of signatures) expect(signature, signature).not.toMatch(/amount|cents|monto|fee|cuota/i);
    // Every sentence and every button the console derives says who acts; none tells the team to charge.
    const clients = buildDemoClients(NOW);
    for (const c of clients) {
      const lines = [...clientExceptions(c, NOW).flatMap((e) => [e.sentence, e.actionLabel]), nextStep(c, NOW).text, clientBillingOutlook(c, NOW).staff];
      for (const line of lines) expect(line, line).not.toMatch(/^Cobrarle|Cobra(r)? al cliente|cobrar a mano|Cobrar ahora/i);
      const step = nextStep(c, NOW);
      if (/cobr/i.test(step.text)) expect(step.actor, step.text).toBe("system");
    }
    // The screens: no control that charges, no field for an amount.
    for (const file of ["src/app/equipo/page.tsx", "src/app/equipo/clientes/[id]/page.tsx", "src/components/staff/BillingCard.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/Cobrar ahora|Cobrarle|createCharge|chargeClient|type="number"|inputMode="decimal"/);
    }
    expect(readFileSync("src/components/staff/BillingCard.tsx", "utf8")).toContain("El equipo no puede crear un cobro ni");
  });

  describe("the demo clients", () => {
    const clients = buildDemoClients(NOW);
    const read = new Date(NOW.getTime() + 5 * 60 * 1000);
    const byId = (id: string) => clients.find((c) => c.id === id)!;
    const outlook = (id: string) => clientBillingOutlook(byId(id), read);

    it("cover every state of billing", () => {
      // Paid twice on time.
      expect(byId("c20").billing.charges.map((c) => [c.roundNumber, c.status, c.attempts])).toEqual([[1, "succeeded", 1], [2, "succeeded", 1]]);
      expect(outlook("c20").kind).toBe("nothing_to_charge");
      // First charge scheduled tomorrow.
      expect(byId("c21").billing.charges).toEqual([]);
      expect(outlook("c21")).toMatchObject({ kind: "charge_scheduled", staff: "El sistema cobra la ronda 1 mañana." });
      // One failed and retrying.
      expect(outlook("c22")).toMatchObject({ kind: "retry_scheduled" });
      expect(clientExceptions(byId("c22"), read)).toEqual([]);
      // Retries exhausted and paused.
      expect(outlook("c15").kind).toBe("paused_for_payment");
      expect(clientStage(byId("c15"), read)).toBe("paused");
      expect(clientExceptions(byId("c15"), read).map((e) => e.kind)).toEqual(["payment_past_due"]);
      // Refunded once.
      expect(byId("c10").billing.charges[0]).toMatchObject({ status: "refunded", refund: { by: "carmen", amountCents: 8900 } });
      // No payment method: not yet needed, and needed.
      expect(byId("c08").billing.paymentMethod).toBeNull();
      expect(clientExceptions(byId("c08"), read)).toEqual([]);
      expect(outlook("c23").kind).toBe("payment_method_missing");
      expect(clientExceptions(byId("c23"), read).map((e) => e.kind)).toEqual(["payment_method_missing"]);
      // Inside the window, cancelled, and asked to end.
      expect(outlook("c17").staff).toBe("No se cobra: está en su periodo de cancelación.");
      expect(outlook("c18").staff).toBe("No se cobra: canceló su acuerdo.");
      expect(outlook("c19").kind).toBe("nothing_to_charge");
    });

    it("are consistent with the rule: every charge is for a mailed round, the day after, at the signed fee, never two for a round", () => {
      for (const c of clients) {
        const seen = new Set<number>();
        for (const ch of c.billing.charges) {
          const r = c.rounds.find((x) => x.number === ch.roundNumber)!;
          expect(r, `${c.id} round ${ch.roundNumber}`).toBeDefined();
          expect(r.mailedAt, c.id).not.toBeNull();
          expect(ch.workDate).toBe(r.mailedAt);
          expect(new Date(ch.createdAt).getTime()).toBeGreaterThanOrEqual(new Date(r.mailedAt!).getTime() + DAY);
          expect(ch.amountCents).toBe(feeToCents(c.agreementMonthlyFee)!);
          expect(seen.has(ch.roundNumber)).toBe(false);
          seen.add(ch.roundNumber);
        }
        // Charged work is at least 30 days apart.
        const dates = c.billing.charges.map((ch) => new Date(ch.workDate).getTime()).sort();
        for (let i = 1; i < dates.length; i++) expect(dates[i]! - dates[i - 1]!).toBeGreaterThanOrEqual(30 * DAY);
        // Nobody who has not signed, or who cancelled, has a charge or a fee.
        if (!c.agreementSignedAt) expect(c.agreementMonthlyFee).toBeNull();
        if (!c.agreementSignedAt || c.agreementCancelledAt) expect(c.billing.charges).toEqual([]);
        // The rule agrees with the data: it would create no charge that already exists.
        const eligibility = chargeEligibility({ agreement: null, signedMonthlyFee: c.agreementMonthlyFee ?? null, rounds: c.rounds.map(billableRound), account: c.billing }, read);
        expect(eligibility.eligible, c.id).toBe(false);
      }
      expect(clients.filter((c) => c.agreementSignedAt).every((c) => c.agreementMonthlyFee === DEMO_EXAMPLE_FEE)).toBe(true);
    });

    it("tell the money in each client's history", () => {
      const lines = (id: string) => clientTimeline(byId(id), read).map((e) => e.text);
      expect(lines("c20")).toContain("Agregó su método de pago (Visa ···· 4242) y aceptó la autorización de pagos");
      expect(lines("c20").filter((l) => /^Se cobró la ronda \d \(\$89\.00\)/.test(l))).toHaveLength(2);
      expect(lines("c10").some((l) => /^Carmen devolvió el cobro de la ronda 1 \(\$89\.00\): «Dos de sus cartas/.test(l))).toBe(true);
      expect(lines("c15")).toContain("No pasó el cobro de la ronda 1 ($89.00) en 3 intentos. El caso quedó en pausa");
      expect(lines("c22")).toContain("No pasó el cobro de la ronda 1 ($89.00). Van 1 intento; el sistema lo vuelve a intentar");
      expect(lines("c22")[0]).toMatch(/^Reintentar el cobro de la ronda 1/);
      expect(lines("c21")[0]).toMatch(/^Cobrar la ronda 1/);
    });

    it("paying resumes the case automatically", async () => {
      const noemi = byId("c15");
      expect(clientStage(noemi, read)).toBe("paused");
      // The system's own run does nothing: the retries are used up.
      expect((await demoBillingRun(noemi, read)).charges).toEqual(noemi.billing.charges);
      // The client puts a working method on file: the same charge is tried again and paid.
      const account = await demoBillingRun(noemi, read, { newMethod: true });
      expect(account.charges).toMatchObject([{ id: noemi.billing.charges[0]!.id, status: "succeeded", attempts: 4 }]);
      const after = applyDemoActions(clients, { ...EMPTY_ACTIONS, billing: { c15: account } }).find((c) => c.id === "c15")!;
      expect(clientStage(after, read)).toBe("waiting_on_bureaus");
      expect(clientExceptions(after, read)).toEqual([]);
      expect(nextAutomaticStep(after, read)!.text).toMatch(/^Re-importar el reporte/);
    });

    it("the system's run charges what is due and nothing else", async () => {
      // Due and with a method on file: one day later Joaquín's round is charged.
      const tomorrow = new Date(read.getTime() + DAY);
      const joaquin = await demoBillingRun(byId("c21"), tomorrow);
      expect(joaquin.charges).toMatchObject([{ roundNumber: 1, status: "succeeded", amountCents: 8900 }]);
      // Not due yet: nothing.
      expect((await demoBillingRun(byId("c21"), read)).charges).toEqual([]);
      // Nobody else gets a charge they did not already have.
      for (const c of clients.filter((x) => !["c21", "c22"].includes(x.id))) {
        expect((await demoBillingRun(c, read)).charges, c.id).toEqual(c.billing.charges);
      }
      // No payment method: nothing is charged, whatever is due.
      expect((await demoBillingRun(byId("c23"), tomorrow)).charges).toEqual([]);
    });
  });
});

// ── The client's journey ────────────────────────────────────────────────

describe("billing: the journey's payment-method nudge", () => {
  const base: JourneyState = { reportImported: true, totalItems: 8, reviewedCount: 8, attestedCount: 3, roundApproved: false, agreement: SIGNED };
  const step = (state: JourneyState, mode: "full_service" | "self_serve" = "full_service") => nextAction(state, "es", { mode, now: NOW });

  it("appears after the review is finished and work may start, when there is no method on file", () => {
    expect(step({ ...base, paymentMethodOnFile: false })).toMatchObject({ key: "payment-method", step: 4, href: "/pagos", title: "Agrega tu método de pago" });
    expect(step({ ...base, roundApproved: true, mailedAt: ago(2), paymentMethodOnFile: false })).toMatchObject({ key: "payment-method", step: 5 });
    expect(step({ ...base, paymentMethodOnFile: false }).description).toMatch(/esto no detiene tus cartas/);
    expect(step({ ...base, paymentMethodOnFile: false }).description).toMatch(/Cada cobro paga trabajo ya hecho/);
  });

  it("is never a condition for the client's own review", () => {
    const before: JourneyState[] = [
      { ...base, agreement: null, paymentMethodOnFile: false },
      { ...base, agreement: { ...SIGNED, signedAt: null, cancellationDeadline: null }, paymentMethodOnFile: false },
      { ...base, reportImported: false, paymentMethodOnFile: false },
      { ...base, reviewedCount: 0, attestedCount: 0, paymentMethodOnFile: false },
      { ...base, reviewedCount: 5, attestedCount: 2, paymentMethodOnFile: false },
      { ...base, attestedCount: 0, paymentMethodOnFile: false },
    ];
    expect(before.map((s) => step(s).key)).toEqual(["agreement", "agreement", "import", "review", "review", "review-empty"]);
  });

  it("does not appear with a method on file, when nothing is known, inside the window, after a stop, or in self-serve", () => {
    expect(step({ ...base, paymentMethodOnFile: true }).key).toBe("team-preparing");
    expect(step(base).key).toBe("team-preparing");
    const inWindow = { ...SIGNED, signedAt: ago(1), disclosureAcknowledgedAt: ago(1, 1), cancellationDeadline: later(3).toISOString() };
    expect(step({ ...base, agreement: inWindow, paymentMethodOnFile: false }).key).toBe("team-starts-soon");
    expect(step({ ...base, agreement: { ...SIGNED, cancelledAt: ago(58) }, paymentMethodOnFile: false }).key).toBe("agreement-cancelled");
    expect(step({ ...base, agreement: { ...SIGNED, serviceEndRequestedAt: ago(1) }, paymentMethodOnFile: false }).key).toBe("end-requested");
    expect(step({ ...base, paymentMethodOnFile: false }, "self_serve").key).toBe("attack");
  });
});

// ── The demo on the client's screen ─────────────────────────────────────

describe("billing: the example situations of the 'Mis pagos' demo", () => {
  const authorization = { version: PAYMENT_AUTHORIZATION_VERSION, hash: "a".repeat(64) };

  it("each is consistent with the rule: the system would create no charge that is not there", () => {
    for (const scenario of DEMO_SCENARIOS) {
      const state = demoScenarioState(scenario, NOW, 8900, EMPTY_DEMO_BILLING, authorization);
      expect(state.scenario).toBe(scenario);
      const ctx: BillingContext = {
        agreement: state.agreement,
        signedMonthlyFee: state.agreement ? "89.00" : null,
        rounds: state.rounds,
        account: { paymentMethod: state.method, charges: state.charges, pause: null },
      };
      expect(chargeEligibility(ctx, NOW).eligible, scenario).toBe(false);
      for (const ch of state.charges) {
        const r = state.rounds.find((x) => x.number === ch.roundNumber)!;
        expect(ch.workDate).toBe(r.mailedAt);
        expect(new Date(ch.createdAt).getTime()).toBe(new Date(r.mailedAt!).getTime() + DAY);
      }
      // Distinct charges have distinct receipt numbers.
      const numbers = state.charges.map((ch) => receiptNumber(ch.id));
      expect(new Set(numbers).size).toBe(numbers.length);
    }
  });

  it("show the situations they are named for", () => {
    const kind = (scenario: (typeof DEMO_SCENARIOS)[number]) => {
      const state = demoScenarioState(scenario, NOW, 8900, EMPTY_DEMO_BILLING, authorization);
      return billingOutlook({ agreement: state.agreement, signedMonthlyFee: "89.00", rounds: state.rounds, account: { paymentMethod: state.method, charges: state.charges, pause: null } }, NOW).kind;
    };
    expect(kind("first_tomorrow")).toBe("charge_scheduled");
    expect(kind("paid_twice")).toBe("nothing_to_charge");
    expect(kind("retrying")).toBe("retry_scheduled");
    expect(kind("paused")).toBe("paused_for_payment");
    // "live" invents nothing: it is whatever this device holds.
    expect(demoScenarioState("live", NOW, 8900, EMPTY_DEMO_BILLING, authorization)).toMatchObject({ rounds: [], charges: [], agreement: null, method: null });
  });

  it("hold only demo tokens: a brand, four digits, never a card number", () => {
    for (const scenario of DEMO_SCENARIOS) {
      const { method } = demoScenarioState(scenario, NOW, 8900, EMPTY_DEMO_BILLING, authorization);
      if (!method) continue;
      expect(isDemoToken(method.token)).toBe(true);
      expect(looksLikeCardNumber(method.token)).toBe(false);
      expect(method.last4).toMatch(/^\d{4}$/);
    }
  });
});

// ── What the endpoints accept ───────────────────────────────────────────

describe("billing: what the endpoints accept", () => {
  const authorization = { version: PAYMENT_AUTHORIZATION_VERSION, locale: "es", hash: "a".repeat(64), accepted: true };

  it("a payment method is a token and an accepted authorization, nothing else", () => {
    expect(paymentMethodBodySchema.safeParse({ token: DEMO_TOKEN_OK, authorization }).success).toBe(true);
    expect(paymentMethodBodySchema.safeParse({ token: "tok_1NqXyZAbCdEf", authorization }).success).toBe(true);
    // Not accepted, or no authorization: refused.
    expect(paymentMethodBodySchema.safeParse({ token: DEMO_TOKEN_OK, authorization: { ...authorization, accepted: false } }).success).toBe(false);
    expect(paymentMethodBodySchema.safeParse({ token: DEMO_TOKEN_OK }).success).toBe(false);
    expect(paymentMethodBodySchema.safeParse({ token: DEMO_TOKEN_OK, authorization: { ...authorization, hash: "short" } }).success).toBe(false);
  });

  it("a card number is refused, wherever it is put", () => {
    for (const card of ["4242424242424242", "4242 4242 4242 4242", "4242-4242-4242-4242", "378282246310005", "6011111111111117"]) {
      expect(looksLikeCardNumber(card), card).toBe(true);
      expect(paymentMethodBodySchema.safeParse({ token: card, authorization }).success, card).toBe(false);
    }
    expect(looksLikeCardNumber(DEMO_TOKEN_OK)).toBe(false);
    expect(looksLikeCardNumber("4242")).toBe(false);
    // Extra fields are refused, not ignored.
    for (const extra of [{ cardNumber: "4242424242424242" }, { cvv: "123" }, { expiry: "12/29" }, { amountCents: 100 }]) {
      expect(paymentMethodBodySchema.safeParse({ token: DEMO_TOKEN_OK, authorization, ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
  });

  it("a refund names a charge and a reason; there is no amount to send", () => {
    const chargeId = "3f9a1c2e-77aa-4b1d-9c0e-aaaaaaaaaaaa";
    expect(refundBodySchema.safeParse({ chargeId, reason: "Se cobró por error esta ronda." }).success).toBe(true);
    expect(refundBodySchema.safeParse({ chargeId, reason: "corto" }).success).toBe(false);
    expect(refundBodySchema.safeParse({ chargeId }).success).toBe(false);
    expect(refundBodySchema.safeParse({ chargeId: "1", reason: "Se cobró por error esta ronda." }).success).toBe(false);
    expect(refundBodySchema.safeParse({ chargeId, reason: "Se cobró por error esta ronda.", amountCents: 100 }).success).toBe(false);
    expect(pauseBodySchema.safeParse({ userId: chargeId, action: "pause", reason: "Cambia de banco" }).success).toBe(true);
    expect(pauseBodySchema.safeParse({ userId: chargeId, action: "charge" }).success).toBe(false);
  });

  it("rows become records without anything a browser should not see", () => {
    const row = {
      id: "ch-1", user_id: "u", round_id: "r", round_number: 2, work_date: "2026-11-04T16:00:00+00:00", amount_cents: 8900, status: "failed",
      attempts: 2, last_attempt_at: "2026-11-08T16:00:00+00:00", next_attempt_at: "2026-11-12T16:00:00+00:00", charged_at: null,
      failure_code: "card_declined", gateway: "demo", gateway_reference: "demo_ch_secret", created_at: "2026-11-05T16:00:00+00:00",
    };
    const c = chargeFromRow(row);
    expect(c).toEqual({
      id: "ch-1", roundNumber: 2, amountCents: 8900, status: "failed", workDate: "2026-11-04T16:00:00.000Z", createdAt: "2026-11-05T16:00:00.000Z",
      attempts: 2, lastAttemptAt: "2026-11-08T16:00:00.000Z", nextAttemptAt: "2026-11-12T16:00:00.000Z", chargedAt: null, failureCode: "card_declined", refund: null,
    });
    expect(JSON.stringify(c)).not.toContain("demo_ch_secret");
    expect(chargeFromRow({ ...row, status: "weird" }).status).toBe("pending");
    const method = paymentMethodFromRow({ id: "pm", brand: "visa", last4: "4242", created_at: "2026-11-01T00:00:00Z", authorization_version: "v", authorized_at: "2026-11-01T00:00:00Z", authorization_hash: "h", authorized_ip: "1.2.3.4" });
    expect(Object.keys(method).sort()).toEqual(["addedAt", "authorizationVersion", "authorizedAt", "brand", "last4"]);
    // Letters: a draft is not a letter that went out; one the mail service failed counts as returned.
    const r = billableRoundFromRows({ round_number: 1, status: "mailed", mailed_at: "2026-11-04T16:00:00Z" }, [
      { target_type: "bureau", target_key: "equifax", target_name: "Equifax Information Services LLC", status: "queued" },
      { target_type: "furnisher", target_key: "Midland", target_name: "Midland Credit Management", status: "failed" },
      { target_type: "bureau", target_key: "experian", target_name: "Experian", status: "draft" },
    ]);
    expect(r).toEqual({ number: 1, mailed: true, mailedAt: "2026-11-04T16:00:00.000Z", letters: [{ recipient: "Equifax", returned: false }, { recipient: "Midland Credit Management", returned: true }] });
    expect(billableRoundFromRows({ round_number: 1, status: "mailed", mailed_at: null }, []).mailed).toBe(false);
    expect(billableRoundFromRows({ round_number: 1, status: "draft", mailed_at: "2026-11-04T16:00:00Z" }, []).mailed).toBe(false);
    expect(billableRoundFromRows({ round_number: 1, status: "complete", mailed_at: "2026-11-04T16:00:00Z" }, []).mailed).toBe(true);
  });
});

// ── Readiness ───────────────────────────────────────────────────────────

describe("billing: is it ready for real money?", () => {
  it("not until a real processor, a fee and an approved authorization are all in place", () => {
    const none = billingReadiness({}, null);
    expect(none).toMatchObject({ ready: false, gatewayConfigured: false, gatewayLive: false, gatewayName: null, authorizationApproved: false });
    expect(none.problems.join(" ")).toMatch(/No payment processor is configured/);
    const demo = billingReadiness({ BILLING_GATEWAY: "demo" }, PAYMENT_AUTHORIZATION_VERSION);
    expect(demo).toMatchObject({ ready: false, gatewayConfigured: true, gatewayLive: false, gatewayName: "demo", authorizationApproved: true });
    expect(demo.problems.join(" ")).toMatch(/demo processor: charges are simulated and no money moves/);
    expect(billingReadiness({ BILLING_GATEWAY: "demo" }, "some-other-version").authorizationApproved).toBe(false);
  });
});

// ── The routes ──────────────────────────────────────────────────────────

describe("billing: the routes", () => {
  const SECRET = "test-secret";
  const saved = { secret: process.env.N8N_WEBHOOK_SECRET, gateway: process.env.BILLING_GATEWAY };
  afterEach(() => {
    for (const [key, value] of [["N8N_WEBHOOK_SECRET", saved.secret], ["BILLING_GATEWAY", saved.gateway]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const post = (path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
    new Request(`https://x.test${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });

  it("the cron needs the shared secret", async () => {
    const { POST } = await import("@/app/api/cron/billing/route");
    process.env.N8N_WEBHOOK_SECRET = SECRET;
    expect((await POST(post("/api/cron/billing"))).status).toBe(401);
    expect((await POST(post("/api/cron/billing", {}, { "x-webhook-secret": "wrong" }))).status).toBe(401);
  });

  it("with no processor configured the cron does nothing, and says so", async () => {
    const { POST } = await import("@/app/api/cron/billing/route");
    process.env.N8N_WEBHOOK_SECRET = SECRET;
    delete process.env.BILLING_GATEWAY;
    const res = await POST(post("/api/cron/billing", {}, { "x-webhook-secret": SECRET }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "gateway_not_configured", charged: 0, error: expect.stringMatching(/No payment processor is configured.*Nothing was charged/) });
    // With the demo processor named and no database, it still charges nobody.
    process.env.BILLING_GATEWAY = "demo";
    const noDb = await POST(post("/api/cron/billing", {}, { "x-webhook-secret": SECRET }));
    expect(noDb.status).toBe(503);
    expect(await noDb.json()).toEqual({ error: "Supabase not configured" });
  });

  it("in the demo (no database) the other routes answer the way the app's other routes do", async () => {
    const billing = await import("@/app/api/billing/route");
    expect(await (await billing.GET()).json()).toEqual({ authenticated: false });
    const method = await import("@/app/api/billing/payment-method/route");
    expect((await method.POST(post("/api/billing/payment-method", { token: DEMO_TOKEN_OK }))).status).toBe(401);
    expect((await method.DELETE(new Request("https://x.test/api/billing/payment-method", { method: "DELETE" }))).status).toBe(401);
    const refund = await import("@/app/api/billing/refund/route");
    const refused = await refund.POST(post("/api/billing/refund", { chargeId: "x", reason: "y" }));
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: "Supabase not configured" });
    const pause = await import("@/app/api/billing/pause/route");
    expect((await pause.POST(post("/api/billing/pause", {}))).status).toBe(503);
  });

  it("are built the way the brief asks: secret, limits, validation, staff check, error reports", () => {
    const read = (path: string) => readFileSync(path, "utf8");
    const cron = read("src/app/api/cron/billing/route.ts");
    expect(cron).toMatch(/hasSharedSecret\(req, process\.env\.N8N_WEBHOOK_SECRET\)/);
    expect(cron.indexOf("getPaymentGateway()")).toBeLessThan(cron.indexOf("getAdminClient()"));
    expect(cron).toMatch(/reportError/);
    const method = read("src/app/api/billing/payment-method/route.ts");
    expect(method).toMatch(/rateLimit\(req, "billing-payment-method"/);
    expect(method).toMatch(/readJsonBody\(req, 2_000\)/);
    expect(method).toMatch(/paymentMethodBodySchema\.safeParse/);
    expect(method).toMatch(/card_number_refused/);
    for (const staffRoute of ["refund", "pause"]) {
      const source = read(`src/app/api/billing/${staffRoute}/route.ts`);
      expect(source, staffRoute).toMatch(/const access = await getStaffAccess\(\);/);
      expect(source, staffRoute).toMatch(/if \(access !== "allowed"\) return NextResponse\.json\(\{ error: "Staff only" \}, \{ status: 403 \}\);/);
      expect(source, staffRoute).toMatch(/rateLimit\(/);
      expect(source, staffRoute).toMatch(/readJsonBody\(/);
    }
    // The only code that inserts a charge row is the store the collection run writes through.
    const inserts = sourceFiles("src").filter((file) => /from\("charges"\)\s*\.insert/.test(read(file)));
    expect(inserts).toEqual(["src/lib/billing/server.ts"]);
    // And the only route that reaches it for new work is the cron (the payment-method route retries and resumes).
    const callers = sourceFiles("src/app").filter((file) => /runBillingForUser|runClientBilling/.test(read(file)));
    expect(callers.sort()).toEqual(["src/app/api/billing/payment-method/route.ts", "src/app/api/cron/billing/route.ts"]);
    expect(read("src/app/api/health/route.ts")).toMatch(/"Billing \(payment processor\)"/);
    expect(read("src/proxy.ts")).toContain('"/pagos/:path*"');
    // A case paused for payment does not get a new round mailed.
    // (Both ways a round leaves go through src/lib/rounds/send.ts.)
    expect(read("src/lib/rounds/send.ts")).toMatch(/"billing_past_due"/);
    expect(read("src/app/api/attacks/approve/route.ts")).toMatch(/sendRound\(/);
  });
});

// ── Card data never enters the app ──────────────────────────────────────

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return /\.(tsx?|sql)$/.test(name) ? [path] : [];
  });
}

describe("billing: no card number can be typed into, sent to, or stored by this app", () => {
  it("no screen has a card field", () => {
    for (const file of [...sourceFiles("src/app"), ...sourceFiles("src/components")]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/autoComplete="cc-|name="(card|cc|cvv|cvc)|placeholder="[^"]*(\d{4} \d{4}|MM\s?\/\s?(AA|YY))|cardNumber|cardnumber/);
    }
    const page = readFileSync("src/app/(app)/pagos/page.tsx", "utf8");
    // The form's only inputs: the consent checkbox and the two labelled test cards.
    expect([...page.matchAll(/type="(\w+)"/g)].map((m) => m[1]).filter((t) => t !== "button").sort()).toEqual(["checkbox", "radio"]);
    expect(page).toContain('data-testid="secure-fields"');
    expect(BILLING_COPY.es.secureFieldsBody).toMatch(/Tu número va directo al procesador: Credalti nunca lo ve ni lo guarda\. Solo guardamos la marca y los últimos 4 dígitos\./);
    expect(BILLING_COPY.es.secureFieldsDemo).toBe("Demo: no escribas una tarjeta real. Elige una tarjeta de prueba.");
  });

  it("no table has a column for one, and the token is out of everyone's reach", () => {
    const sql = readFileSync("supabase/migrations/0011_billing.sql", "utf8");
    const columns = [...sql.matchAll(/^  (\w+) (?:uuid|text|int|timestamptz|boolean|jsonb)\b/gm)].map((m) => m[1]!);
    expect(columns.length).toBeGreaterThan(30);
    for (const column of columns) expect(column).not.toMatch(/card|pan$|cvv|cvc|expir|exp_/i);
    expect(sql).toMatch(/alter table public\.payment_method_vault enable row level security;/);
    expect(sql).not.toMatch(/create policy "[^"]*" on public\.payment_method_vault/);
    // Only SELECT policies anywhere in the migration: nobody but the server writes.
    expect([...sql.matchAll(/create policy [^;]+;/g)].every((m) => /for select using/.test(m[0]))).toBe(true);
    expect(sql).toMatch(/constraint charges_one_per_round unique \(round_id\)/);
    expect(sql).toMatch(/amount_cents int not null check \(amount_cents > 0\)/);
    for (const trigger of ["charges_guard_insert", "charges_guard", "refunds_guard_insert", "refunds_guard", "payment_methods_guard"]) {
      expect(sql, trigger).toMatch(new RegExp(`create trigger ${trigger}\\s`));
    }
  });

  it("nothing in the billing code logs a token or a payment body", () => {
    for (const file of [...sourceFiles("src/lib/billing"), ...sourceFiles("src/app/api/billing"), ...sourceFiles("src/app/api/cron/billing")]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/console\.(log|info|warn|error)/);
      // What goes to the error report is an identifier, never the token.
      expect(source, file).not.toMatch(/extra: \{[^}]*(token|paymentMethodRef|customerRef)/);
    }
  });

  it("the new customer-facing files keep the house wording rules", () => {
    for (const file of ["src/app/(app)/pagos/page.tsx", "src/lib/ux/billingCopy.ts", "src/lib/ux/billingDemo.ts", "src/lib/billing/authorization.ts", "src/lib/billing/dunning.ts", "src/lib/billing/receipts.ts", "src/lib/billing/outlook.ts"]) {
      const text = readFileSync(file, "utf8");
      expect(/ataque/i.test(text), file).toBe(false);
      expect(/\b(your|my|next|the) attack\b/i.test(text), file).toBe(false);
    }
  });
});
