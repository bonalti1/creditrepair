import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AgreementRecord } from "../agreement/gate";
import { documentHash } from "../agreement/documents";
import { agreementReadiness } from "../agreement/readiness";
import { resolveTerms, withPlan } from "../agreement/terms";
import { achAuthorization, achAuthorizationHash, achAuthorizationText, ACH_AUTHORIZATION_VERSION } from "../billing/achAuthorization";
import { ACH_RETURN_CODES, afterAchReturn, returnAction } from "../billing/achReturns";
import { paymentMethodBodySchema } from "../billing/api";
import { paymentAuthorization, paymentAuthorizationText } from "../billing/authorization";
import { demoCatalogue, planActivate, planRecordApproval, planSaveDraft } from "../billing/catalogue";
import { chargebackRate } from "../billing/chargebacks";
import { createMemoryChargeStore, runClientBilling } from "../billing/collect";
import { evidenceHtml, evidencePack } from "../billing/evidence";
import { createDemoGateway, getPaymentGateway } from "../billing/gateway";
import { authorizeNetGateway, parseAnetResponse } from "../billing/gateways/authorizeNet";
import { nmiEvent, nmiGateway, parseNmiResponse } from "../billing/gateways/nmi";
import { csvCell, feeEstimateCents, invoiceRows, invoiceStatus, quickBooksCsv, statementMonths, transactionsCsv } from "../billing/invoices";
import {
  DUE_RULE_OPTIONS,
  installmentCents,
  paymentTermsLines,
  PLAN_TYPES,
  planMaxTotalCents,
  planSummary,
  planTermsHash,
  snapshotPlan,
  validatePlanTerms,
  type PlanSnapshot,
  type PlanTerms,
  type PlanVersion,
} from "../billing/plans";
import { chargeEligibility } from "../billing/rules";
import { paymentTimeline, upcomingCharges } from "../billing/schedule";
import type { BillableRound, BillingCharge, BillingContext, PaymentMethodSummary, ProvenResult } from "../billing/types";
import { checkClaimGuardrails, checkMarketingCopy } from "../compliance/guardrails";
import { buildDemoClients } from "../staff/demoClients";
import { planCopyStrings } from "../ux/billingPlanCopy";

// Billing plans (billing/plans.ts, rules.ts, migration 0026): every plan type
// charges only after the work it pays for, once per unit of work, 30 days
// apart, at the signed snapshot's amounts, never above the cap. The same
// cases are refused by the database in db/billingPlans.test.ts.

const NOW = new Date("2026-12-05T18:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const later = (days: number) => new Date(NOW.getTime() + days * DAY);

const SIGNED: AgreementRecord = { disclosureAcknowledgedAt: ago(201), signedAt: ago(200), cancellationDeadline: ago(195), cancelledAt: null, serviceEndRequestedAt: null };
const METHOD: PaymentMethodSummary = { brand: "visa", last4: "4242", addedAt: ago(190), authorizationVersion: "v", authorizedAt: ago(190) };

const BASE: PlanTerms = {
  type: "per_round",
  firstWorkFeeCents: 0,
  recurringCents: 8900,
  flat: null,
  dueRule: { kind: "after_first_round" },
  duration: { kind: "indefinite" },
  maxTotalCents: 60000,
  householdDiscountPercent: 0,
  countsUpdated: false,
};

function version(terms: Partial<PlanTerms>, extra: Partial<PlanVersion> = {}): PlanVersion {
  const t = { ...BASE, ...terms };
  const name = { en: "Test", es: "Prueba" };
  return {
    id: "p1",
    key: "test",
    version: 1,
    status: "active",
    name,
    terms: t,
    termsHash: planTermsHash(t, name),
    textVersion: "x",
    isDefault: true,
    attorney: { name: "Lic. Prueba", approvedOn: "2026-11-01" },
    createdBy: "Carmen",
    createdAt: ago(300),
    activatedAt: ago(290),
    retiredAt: null,
    ...extra,
  };
}

const plan = (terms: Partial<PlanTerms>, household = false): PlanSnapshot => snapshotPlan(version(terms), { household });
const round = (n: number, daysAgo: number, returned = false): BillableRound => ({ number: n, mailed: true, mailedAt: ago(daysAgo), letters: [{ recipient: "Equifax", returned }] });

function ctx(p: PlanSnapshot, rounds: BillableRound[], charges: BillingCharge[] = [], extra: Partial<BillingContext> = {}): BillingContext {
  return { agreement: SIGNED, signedMonthlyFee: null, rounds, plan: p, account: { paymentMethod: METHOD, charges, pause: null }, ...extra };
}

/** Run the rule day by day from `fromDaysAgo` to `toDaysAhead`, paying every charge: what billing would do. */
function run(c: BillingContext, fromDaysAgo: number, toDaysAhead = 0): BillingCharge[] {
  let charges = [...c.account.charges];
  for (let d = -fromDaysAgo; d <= toDaysAhead; d++) {
    const now = new Date(NOW.getTime() + d * DAY);
    const e = chargeEligibility({ ...c, account: { ...c.account, charges } }, now);
    if (!e.eligible) continue;
    const at = now.toISOString();
    charges = [
      ...charges,
      {
        id: `c${charges.length + 1}`,
        roundNumber: e.roundNumber,
        amountCents: e.amountCents,
        status: "succeeded",
        workDate: e.workDate,
        createdAt: at,
        attempts: 1,
        lastAttemptAt: at,
        nextAttemptAt: null,
        chargedAt: at,
        failureCode: null,
        refund: null,
        unit: e.unit,
        firstWorkCents: e.firstWorkCents,
        periodStart: e.periodStart ?? null,
        periodEnd: e.periodEnd ?? null,
        installmentNumber: e.installmentNumber ?? null,
        resultItemIds: e.resultItemIds ?? [],
      },
    ];
  }
  return charges;
}

/** What every plan type holds, whatever the work: no charge before it, 30 days apart, never above the cap. */
function invariants(c: BillingContext, charges: BillingCharge[]) {
  const max = c.plan!.effective.maxTotalCents;
  expect(charges.reduce((n, ch) => n + ch.amountCents, 0)).toBeLessThanOrEqual(max);
  const created = charges.map((ch) => new Date(ch.createdAt).getTime());
  for (let i = 1; i < created.length; i++) expect(created[i]! - created[i - 1]!).toBeGreaterThanOrEqual(30 * DAY);
  for (const ch of charges) {
    expect(new Date(ch.createdAt).getTime()).toBeGreaterThanOrEqual(new Date(ch.workDate).getTime() + DAY);
    if (ch.unit !== "results") {
      const r = c.rounds.find((x) => x.number === ch.roundNumber)!;
      expect(new Date(ch.createdAt).getTime()).toBeGreaterThan(new Date(r.mailedAt!).getTime());
      expect(new Date(r.mailedAt!).getTime()).toBeGreaterThan(new Date(SIGNED.cancellationDeadline!).getTime());
    }
  }
}

// ── The catalogue ───────────────────────────────────────────────────────

describe("plans: what can be offered", () => {
  it("has CRC's four types, by CRC's names", () => {
    expect(PLAN_TYPES).toEqual(["subscription", "per_round", "flat_fee", "pay_per_delete"]);
    expect(validatePlanTerms(BASE)).toEqual([]);
  });

  it("refuses a setup, enrollment or signup fee, and says why", () => {
    for (const field of ["setupFeeCents", "enrollmentFee", "signupFeeCents", "activationFeeCents", "retainerCents", "upfrontCents"]) {
      const problems = validatePlanTerms({ ...BASE, [field]: 4900 });
      expect(problems[0], field).toMatchObject({ code: "setup_fee_refused", field });
      expect(problems[0]!.message.en).toMatch(/before any work is performed/);
    }
  });

  it("offers CRC's due dates that wait for the work, and refuses the two that can charge first", () => {
    expect(DUE_RULE_OPTIONS.filter((o) => o.allowed).map((o) => o.key)).toEqual(["after_first_round", "days_after_first_round"]);
    for (const kind of ["days_after_plan_saved", "when_letters_saved"]) {
      expect(validatePlanTerms({ ...BASE, dueRule: { kind, days: 3 } })[0]).toMatchObject({ code: "forbidden_due_rule" });
    }
  });

  it("needs a cap when the plan has no end, and works out the most a client can pay", () => {
    expect(validatePlanTerms({ ...BASE, maxTotalCents: null })[0]).toMatchObject({ code: "cap_required" });
    expect(planMaxTotalCents({ ...BASE, maxTotalCents: null, duration: { kind: "rounds", count: 6 }, firstWorkFeeCents: 4900 })).toBe(4900 + 6 * 8900);
    expect(planMaxTotalCents({ ...BASE, type: "subscription", duration: { kind: "months", count: 8 }, maxTotalCents: 50000, recurringCents: 7900 })).toBe(50000);
    expect(planMaxTotalCents({ ...BASE, type: "flat_fee", recurringCents: 0, flat: { totalCents: 49900, rounds: 3, schedule: "installments" }, duration: { kind: "rounds", count: 3 }, maxTotalCents: null })).toBe(49900);
  });

  it("keeps pay per delete without a first work fee, and 'updated' for pay per delete only", () => {
    expect(validatePlanTerms({ ...BASE, type: "pay_per_delete", firstWorkFeeCents: 100 })[0]).toMatchObject({ code: "first_work_not_allowed" });
    expect(validatePlanTerms({ ...BASE, countsUpdated: true })[0]).toMatchObject({ code: "updated_only_pay_per_delete" });
  });

  it("splits a flat fee into equal installments, the last carrying the remainder", () => {
    expect([1, 2, 3].map((k) => installmentCents(50000, 3, k))).toEqual([16666, 16666, 16668]);
  });

  it("applies the household discount to every amount, and only to linked clients", () => {
    const p = version({ householdDiscountPercent: 20, firstWorkFeeCents: 5000 });
    expect(snapshotPlan(p).effective).toMatchObject({ recurringCents: 8900, firstWorkFeeCents: 5000, maxTotalCents: 60000 });
    expect(snapshotPlan(p, { household: true })).toMatchObject({ householdDiscountPercent: 20, effective: { recurringCents: 7120, firstWorkFeeCents: 4000, maxTotalCents: 48000 } });
  });

  it("is versioned: draft → approved by the attorney → offered; an offered version never changes", () => {
    let all: PlanVersion[] = [];
    const draft = planSaveDraft(all, { name: { en: "Monthly", es: "Mensual" }, terms: { ...BASE, type: "subscription", duration: { kind: "months", count: 6 }, maxTotalCents: null } }, "Carmen", NOW, () => "d1");
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    all = [draft.value.version];
    expect(planActivate(all, "d1", NOW, { payPerDelete: false, referralCredits: false })).toMatchObject({ ok: false });
    const approved = planRecordApproval(all, "d1", { attorneyName: "Lic. Prueba", approvedOn: "2026-12-01", confirmed: true }, NOW);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    all = [approved.value];
    const on = planActivate(all, "d1", NOW, { payPerDelete: false, referralCredits: false });
    expect(on.ok).toBe(true);
    if (!on.ok) return;
    all = on.value;
    expect(planSaveDraft(all, { id: "d1", name: { en: "Monthly", es: "Mensual" }, terms: BASE }, "Carmen", NOW, () => "x")).toMatchObject({ ok: false });
    const next = planSaveDraft(all, { key: "monthly", name: { en: "Monthly", es: "Mensual" }, terms: BASE }, "Carmen", NOW, () => "d2");
    expect(next).toMatchObject({ ok: true, value: { version: { version: 2, status: "draft" } } });
  });

  it("keeps pay per delete from being offered until its switch is on", () => {
    const p = version({ type: "pay_per_delete", recurringCents: 5000 }, { status: "draft" });
    expect(planActivate([p], p.id, NOW, { payPerDelete: false, referralCredits: false })).toMatchObject({ ok: false });
    expect(planActivate([p], p.id, NOW, { payPerDelete: true, referralCredits: false })).toMatchObject({ ok: true });
  });

  it("ties the attorney's approval to the exact terms and wording", () => {
    const name = { en: "A", es: "A" };
    expect(planTermsHash(BASE, name)).toBe(planTermsHash({ ...BASE }, name));
    expect(planTermsHash(BASE, name)).not.toBe(planTermsHash({ ...BASE, maxTotalCents: 59999 }, name));
  });
});

// ── Each type: what may and may not be charged ──────────────────────────

describe("per round", () => {
  const p = plan({ firstWorkFeeCents: 4900, duration: { kind: "rounds", count: 3 }, maxTotalCents: null });

  it("charges each mailed round once, the first with the first work fee, and nothing beyond the plan's rounds", () => {
    const c = ctx(p, [round(1, 180), round(2, 140), round(3, 100), round(4, 60)]);
    const charges = run(c, 190);
    expect(charges.map((ch) => [ch.roundNumber, ch.amountCents, ch.firstWorkCents])).toEqual([
      [1, 13800, 4900],
      [2, 8900, 0],
      [3, 8900, 0],
    ]);
    invariants(c, charges);
    expect(chargeEligibility({ ...c, account: { ...c.account, charges } }, NOW)).toMatchObject({ eligible: false, code: "plan_complete" });
  });

  it("charges nothing before a round is mailed, nothing for a round mailed inside the window, and never twice for a round", () => {
    expect(chargeEligibility(ctx(p, []), NOW)).toMatchObject({ eligible: false, code: "nothing_mailed" });
    expect(chargeEligibility(ctx(p, [{ number: 1, mailed: false, mailedAt: null, letters: [] }]), NOW)).toMatchObject({ code: "nothing_mailed" });
    expect(chargeEligibility(ctx(p, [round(1, 197)]), NOW)).toMatchObject({ code: "nothing_mailed" });
    const once = run(ctx(p, [round(1, 50)]), 60);
    expect(once).toHaveLength(1);
    expect(chargeEligibility(ctx(p, [round(1, 50)], once), later(60))).toMatchObject({ eligible: false, code: "nothing_unbilled" });
  });

  it("waits a day after mailing and 30 days after the last charge's work and creation", () => {
    expect(chargeEligibility(ctx(p, [{ ...round(1, 0) }]), NOW)).toMatchObject({ code: "too_soon_after_mailing" });
    const first = run(ctx(p, [round(1, 50)]), 60, 0);
    // Round 2 mailed 5 days ago; the first charge was made 49 days ago, its work 50 days ago: due today.
    expect(chargeEligibility(ctx(p, [round(1, 50), round(2, 5)], first), NOW)).toMatchObject({ eligible: true, roundNumber: 2 });
    // A charge created late (a payment method added late) pushes the next one 30 days from its creation.
    const late = [{ ...first[0]!, createdAt: ago(10) }];
    expect(chargeEligibility(ctx(p, [round(1, 50), round(2, 5)], late), NOW)).toMatchObject({ code: "too_soon_after_last_charge", availableAt: later(20).toISOString() });
  });

  it("charges nothing after a cancellation or a request to end the service, and asks a person when every letter came back", () => {
    expect(chargeEligibility(ctx(p, [round(1, 50)], [], { agreement: { ...SIGNED, cancelledAt: ago(196) } }), NOW)).toMatchObject({ code: "agreement_cancelled" });
    expect(chargeEligibility(ctx(p, [round(1, 50)], [], { agreement: { ...SIGNED, serviceEndRequestedAt: ago(1) } }), NOW)).toMatchObject({ code: "service_end_requested", needsPerson: true });
    expect(chargeEligibility(ctx(p, [round(1, 50, true)]), NOW)).toMatchObject({ code: "all_letters_returned", needsPerson: true });
  });

  it("never goes above the most-you'll-pay total: the last charge is trimmed, then nothing", () => {
    const capped = plan({ maxTotalCents: 20000 });
    const c = ctx(capped, [round(1, 180), round(2, 140), round(3, 100), round(4, 60)]);
    const charges = run(c, 190);
    expect(charges.map((ch) => ch.amountCents)).toEqual([8900, 8900, 2200]);
    invariants(c, charges);
  });

  it("waits for the plan's due date: N days after the first round", () => {
    const p10 = plan({ dueRule: { kind: "days_after_first_round", days: 10 } });
    expect(chargeEligibility(ctx(p10, [round(1, 5)]), NOW)).toMatchObject({ code: "before_due_date", availableAt: later(5).toISOString() });
    expect(chargeEligibility(ctx(p10, [round(1, 5)]), later(5))).toMatchObject({ eligible: true });
  });
});

describe("subscription (monthly): only periods in which a round was mailed, charged when the period ends", () => {
  const p = plan({ type: "subscription", firstWorkFeeCents: 9900, recurringCents: 7900, duration: { kind: "months", count: 6 }, maxTotalCents: null });

  it("first work fee after round 1; each 30-day period with work once it ends; nothing for a period without work", () => {
    // Rounds 180, 140 and 60 days ago: periods [180,150), [150,120) and [60,30) have work; [120,90), [90,60) and [30,0) none.
    const c = ctx(p, [round(1, 180), round(2, 140), round(3, 60)]);
    const charges = run(c, 190);
    expect(charges.map((ch) => [ch.unit, ch.amountCents])).toEqual([
      ["first_work", 9900],
      ["period", 7900],
      ["period", 7900],
      ["period", 7900],
    ]);
    invariants(c, charges);
    const periods = charges.filter((ch) => ch.unit === "period").map((ch) => Math.round((NOW.getTime() - new Date(ch.periodStart!).getTime()) / DAY));
    expect(periods).toEqual([180, 150, 60]);
    // The statement says so.
    const months = statementMonths({ ...c, account: { ...c.account, charges } }, NOW, "en");
    expect(months.flatMap((m) => m.lines).filter((l) => l.kind === "no_work")).toHaveLength(3);
    expect(months.flatMap((m) => m.lines).find((l) => l.kind === "no_work")!.text).toMatch(/^No work this month, no charge/);
  });

  it("never charges a period that is still open", () => {
    const c = ctx(p, [round(1, 10)], [{ ...run(ctx(p, [round(1, 10)]), 10)[0]! }]);
    expect(chargeEligibility(c, NOW)).toMatchObject({ eligible: false, code: "waiting_for_work" });
  });
});

describe("flat fee: installments after each round, or one charge after the last round", () => {
  it("installments: N, each after its round, the remainder in the last", () => {
    const p = plan({ type: "flat_fee", recurringCents: 0, flat: { totalCents: 50000, rounds: 3, schedule: "installments" }, duration: { kind: "rounds", count: 3 }, maxTotalCents: null });
    const c = ctx(p, [round(1, 180), round(2, 140), round(3, 100), round(4, 60)]);
    const charges = run(c, 190);
    expect(charges.map((ch) => [ch.installmentNumber, ch.amountCents])).toEqual([
      [1, 16666],
      [2, 16666],
      [3, 16668],
    ]);
    invariants(c, charges);
  });

  it("after the last round: the first work fee after round 1, the total only after round N is mailed", () => {
    const p = plan({ type: "flat_fee", firstWorkFeeCents: 5000, recurringCents: 0, flat: { totalCents: 45000, rounds: 3, schedule: "after_last_round" }, duration: { kind: "rounds", count: 3 }, maxTotalCents: null });
    const two = ctx(p, [round(1, 180), round(2, 140)]);
    const charges = run(two, 190);
    expect(charges.map((ch) => [ch.unit, ch.amountCents])).toEqual([["first_work", 5000]]);
    expect(chargeEligibility({ ...two, account: { ...two.account, charges } }, NOW)).toMatchObject({ code: "waiting_for_work" });
    const three = ctx(p, [round(1, 180), round(2, 140), round(3, 100)]);
    expect(run(three, 190).map((ch) => [ch.unit, ch.amountCents])).toEqual([["first_work", 5000], ["flat", 45000]]);
  });
});

describe("pay per delete: an item disputed through us that a later report no longer shows", () => {
  const p = plan({ type: "pay_per_delete", recurringCents: 5000, maxTotalCents: 12000 });
  const result = (id: string, extra: Partial<ProvenResult> = {}): ProvenResult => ({
    itemId: id,
    label: "Equifax · ACME",
    outcome: "deleted",
    disputedRound: 1,
    disputedAt: ago(100),
    provedAt: ago(60),
    stillGone: true,
    ...extra,
  });
  const on = { payPerDelete: true, referralCredits: false };

  it("is off until the attorney's approval is recorded", () => {
    expect(chargeEligibility(ctx(p, [round(1, 100)], [], { results: [result("a")] }), NOW)).toMatchObject({ code: "pay_per_delete_off", needsPerson: true });
  });

  it("charges proven items together, once, within the cap; never 'updated' unless the plan says so; never an item back on a report", () => {
    const results = [
      result("a"),
      result("b"),
      result("c", { outcome: "updated" }),
      result("d", { stillGone: false }),
      result("e", { provedAt: ago(110) }),
      result("f", { disputedAt: ago(197) }),
      result("g"),
    ];
    const c = ctx(p, [round(1, 100)], [], { results, switches: on });
    const first = chargeEligibility(c, NOW);
    // a, b, g proven: 3 × $50 = $150, trimmed to the $120 cap.
    expect(first).toMatchObject({ eligible: true, unit: "results", roundNumber: 0, amountCents: 12000, resultItemIds: ["a", "b", "g"] });
    const charges = run(c, 70);
    invariants(c, charges);
    expect(chargeEligibility({ ...c, account: { ...c.account, charges } }, later(40))).toMatchObject({ eligible: false });
  });

  it("charges nothing when nothing changed", () => {
    expect(chargeEligibility(ctx(p, [round(1, 100)], [], { results: [], switches: on }), NOW)).toMatchObject({ eligible: false, code: "nothing_unbilled" });
  });
});

describe("referral credits never create a charge", () => {
  it("lower a charge that is due, and settle it without the processor when they cover it", async () => {
    const p = plan({});
    const c = ctx(p, [round(1, 50)], [], { switches: { payPerDelete: false, referralCredits: true }, creditBalanceCents: 10000, account: { paymentMethod: null, charges: [], pause: null } });
    expect(chargeEligibility(c, NOW)).toMatchObject({ eligible: true, amountCents: 8900, creditCents: 8900 });
    const gateway = createDemoGateway();
    const report = await runClientBilling({ gateway, store: createMemoryChargeStore() }, c, null, NOW);
    // No payment handle and no processor call: still nothing before the work, and no work, no credit.
    expect(report.attempts).toEqual([]);
    expect(chargeEligibility(ctx(p, [], [], { switches: { payPerDelete: false, referralCredits: true }, creditBalanceCents: 10000 }), NOW)).toMatchObject({ code: "nothing_mailed" });
    const paid = await runClientBilling({ gateway, store: createMemoryChargeStore() }, c, { customerRef: "x", paymentMethodRef: "demo_pm_visa_4242" }, NOW);
    expect(paid.attempts.map((a) => a.outcome)).toEqual(["paid"]);
    expect(gateway.chargeCalls()).toBe(0);
  });
});

// ── Previews and projections ────────────────────────────────────────────

describe("the payment timeline preview and upcoming charges come from the rule", () => {
  it("shows every charge after its work, for every plan type in the demo catalogue", () => {
    for (const v of demoCatalogue(NOW)) {
      const events = paymentTimeline(snapshotPlan(v));
      const charges = events.filter((e) => e.kind === "charge");
      expect(charges.length, v.key).toBeGreaterThan(0);
      const firstRound = events.find((e) => e.kind === "round")!.day;
      for (const e of charges) expect(e.day, v.key).toBeGreaterThan(firstRound);
      expect(charges.at(-1)!.totalCents!, v.key).toBeLessThanOrEqual(snapshotPlan(v).effective.maxTotalCents);
    }
  });

  it("projects nothing for work not on record", () => {
    const p = plan({});
    expect(upcomingCharges(ctx(p, []), NOW)).toEqual([]);
    expect(upcomingCharges(ctx(p, [round(1, 0)]), NOW)).toMatchObject([{ amountCents: 8900, at: later(1).toISOString() }]);
  });
});

// ── Words ───────────────────────────────────────────────────────────────

describe("everything a client reads about plans passes the claim rules, in both languages", () => {
  it("the contract's payment terms, every plan type, both languages", () => {
    for (const v of demoCatalogue(NOW)) {
      for (const locale of ["en", "es"] as const) {
        const s = snapshotPlan(v);
        for (const line of [...paymentTermsLines(s.terms, s.effective, locale), planSummary(s, locale)]) {
          expect(checkClaimGuardrails(line, "full_service"), line).toEqual([]);
          expect(checkMarketingCopy(line, "full_service"), line).toEqual([]);
        }
      }
    }
  });

  it("pay per delete says exactly that nothing changes means nothing to pay, and promises nothing", () => {
    const s = plan({ type: "pay_per_delete", recurringCents: 5000 });
    const en = paymentTermsLines(s.terms, s.effective, "en").join(" ");
    expect(en).toContain("If an item you disputed through us no longer appears on a later report, you pay $50.00 for it. If nothing changes, you pay nothing.");
    expect(en).not.toMatch(/expect|likely|will be (deleted|removed)|guarantee/i);
  });

  it("the Mis pagos plan copy and both authorizations", () => {
    for (const locale of ["en", "es"] as const) {
      const terms = { companyLegalName: "Credalti LLC", companyEmail: "help@credalti.test", monthlyFee: null, plan: plan({ firstWorkFeeCents: 4900 }) };
      const texts = [...planCopyStrings(locale), paymentAuthorizationText(paymentAuthorization(locale, terms)), achAuthorizationText(achAuthorization(locale, terms))];
      for (const text of texts) {
        expect(checkClaimGuardrails(text, "full_service"), text).toEqual([]);
        expect(checkMarketingCopy(text, "full_service"), text).toEqual([]);
      }
    }
  });
});

describe("the agreement under a plan", () => {
  it("prints the plan's terms, hashes them, and is ready only when the plan version is approved", () => {
    const base = resolveTerms({ companyLegalName: "Credalti LLC", companyAddress: "1 Main St", companyEmail: "a@b.test", texasRegistrationNumber: "1", bondSuretyName: "S", bondSuretyAddress: "A", texasAgentName: "N", texasAgentAddress: "A" });
    const approved = withPlan(base, plan({}));
    const pending = withPlan(base, { ...plan({}), attorneyApproved: false });
    // Without a plan the monthly fee and length are required; under a plan the plan carries the price.
    expect(readinessFromTerms(base).termsComplete).toBe(false);
    expect(documentHash("v", "en", approved)).not.toBe(documentHash("v", "en", base));
    expect(documentHash("v", "en", approved)).not.toBe(documentHash("v", "en", withPlan(base, plan({ recurringCents: 9900 }))));
    const r1 = readinessFromTerms(approved);
    const r2 = readinessFromTerms(pending);
    expect(r1.planApproved).toBe(true);
    expect(r1.termsComplete).toBe(true);
    expect(r2.planApproved).toBe(false);
    expect(r2.ready).toBe(false);
  });
});

function readinessFromTerms(terms: ReturnType<typeof resolveTerms>) {
  return agreementReadiness({ terms, approvedVersion: null, demo: false, unverifiedStatutes: [] });
}

// ── ACH ─────────────────────────────────────────────────────────────────

describe("ACH: its own authorization, tokens only, returns into the dunning schedule", () => {
  it("has the Nacha elements: amount, timing, the total, how to revoke, a copy; versioned and hashed", () => {
    const terms = { companyLegalName: "Credalti LLC", companyEmail: "help@credalti.test", monthlyFee: null, plan: plan({}) };
    const a = achAuthorization("en", terms);
    expect(a.reviewStatus).toBe("attorney_pending");
    expect(a.version).toBe(ACH_AUTHORIZATION_VERSION);
    expect(a.points.map((p) => p.heading)).toEqual(["How much", "When and how often", "The total", "If a debit does not go through", "How I cancel it", "My copy", "My bank details"]);
    expect(achAuthorizationHash(ACH_AUTHORIZATION_VERSION, "en", terms)).toMatch(/^[0-9a-f]{64}$/);
    expect(achAuthorizationHash(ACH_AUTHORIZATION_VERSION, "en", terms)).not.toBe(achAuthorizationHash(ACH_AUTHORIZATION_VERSION, "es", terms));
  });

  it("takes a processor token, never an account or card number", () => {
    const auth = { version: "v", locale: "en", hash: "a".repeat(64), accepted: true };
    expect(paymentMethodBodySchema.safeParse({ token: "AbC+/123=xyz-.:_", kind: "ach", authorization: auth }).success).toBe(true);
    expect(paymentMethodBodySchema.safeParse({ token: "4111 1111 1111 1111", kind: "card", authorization: auth }).success).toBe(false);
    expect(paymentMethodBodySchema.safeParse({ token: "tok_123456789", kind: "ach", accountNumber: "123", authorization: auth }).success).toBe(false);
  });

  it("maps return codes: R01/R09 retry on the dunning schedule, a closed account waits for a new method, an unauthorized debit stops", () => {
    expect(returnAction("R01")).toBe("retry");
    expect(returnAction("R09")).toBe("retry");
    expect(returnAction("R02")).toBe("new_method");
    expect(returnAction("R10")).toBe("revoked");
    expect(returnAction("R99")).toBe("person");
    for (const code of Object.keys(ACH_RETURN_CODES)) expect(code).toMatch(/^R\d{2}$/);
    const paid: BillingCharge = { id: "c", roundNumber: 1, amountCents: 8900, status: "succeeded", workDate: ago(10), createdAt: ago(9), attempts: 1, lastAttemptAt: ago(9), nextAttemptAt: null, chargedAt: ago(9), failureCode: null, refund: null };
    expect(afterAchReturn(paid, "R01", NOW)).toMatchObject({ status: "failed", attempts: 1, chargedAt: null, returnCode: "R01", nextAttemptAt: later(3).toISOString() });
    expect(afterAchReturn(paid, "R10", NOW)).toMatchObject({ status: "failed", nextAttemptAt: null, failureCode: "ach_R10" });
  });
});

// ── Gateways ────────────────────────────────────────────────────────────

function recorder(answers: Array<string | ((body: string) => string)>) {
  const calls: Array<{ url: string; body: string }> = [];
  let i = 0;
  const fetch = (async (url: string, init: RequestInit) => {
    const body = String(init.body ?? "");
    calls.push({ url, body });
    const a = answers[Math.min(i++, answers.length - 1)]!;
    return new Response(typeof a === "function" ? a(body) : a, { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("gateways: selected by BILLING_GATEWAY, keys from the environment only", () => {
  it("names nmi and authorize_net, and refuses to start without their keys", () => {
    expect(getPaymentGateway({ BILLING_GATEWAY: "nmi" })).toMatchObject({ configured: false, message: expect.stringMatching(/NMI_SECURITY_KEY/) });
    expect(getPaymentGateway({ BILLING_GATEWAY: "authorize_net" })).toMatchObject({ configured: false, message: expect.stringMatching(/AUTHORIZE_NET_API_LOGIN_ID/) });
    expect(getPaymentGateway({ BILLING_GATEWAY: "nmi", NMI_SECURITY_KEY: "k", NEXT_PUBLIC_NMI_TOKENIZATION_KEY: "t" })).toMatchObject({ configured: true, gateway: { name: "nmi", live: true } });
    expect(getPaymentGateway({ BILLING_GATEWAY: "stripe" })).toMatchObject({ configured: false });
  });

  it("no key or secret is committed: .env.example names them without values", () => {
    const example = readFileSync(".env.example", "utf8");
    for (const name of ["NMI_SECURITY_KEY", "NEXT_PUBLIC_NMI_TOKENIZATION_KEY", "NMI_WEBHOOK_SIGNING_KEY", "AUTHORIZE_NET_API_LOGIN_ID", "AUTHORIZE_NET_TRANSACTION_KEY", "AUTHORIZE_NET_SIGNATURE_KEY", "NEXT_PUBLIC_ACH_AUTHORIZATION_APPROVED_VERSION"]) {
      expect(example, name).toMatch(new RegExp(`^${name}=$`, "m"));
    }
  });
});

describe("NMI", () => {
  const env = { NMI_SECURITY_KEY: "secret", NEXT_PUBLIC_NMI_TOKENIZATION_KEY: "public", NMI_WEBHOOK_SIGNING_KEY: "whsec" };

  it("charges a vault id with our charge id as the order id, after asking whether that order was already approved", async () => {
    const { fetch, calls } = recorder(["<nm_response></nm_response>", "response=1&responsetext=SUCCESS&transactionid=9001&response_code=100"]);
    const built = nmiGateway(env, { fetch });
    if (!built.ok) throw new Error(built.message);
    const r = await built.gateway.charge({ amountCents: 8900, currency: "usd", customerRef: "nmi:cus:x", paymentMethodRef: "nmi:vault:123", idempotencyKey: "ch-1:1", description: "Round 1", methodKind: "ach" });
    expect(r).toEqual({ ok: true, reference: "9001" });
    expect(calls[0]!.url).toMatch(/query\.php$/);
    expect(new URLSearchParams(calls[0]!.body).get("order_id")).toBe("ch-1:1");
    const sale = new URLSearchParams(calls[1]!.body);
    expect(Object.fromEntries(sale)).toMatchObject({ security_key: "secret", type: "sale", customer_vault_id: "123", amount: "89.00", orderid: "ch-1:1", sec_code: "WEB" });
    expect(sale.has("ccnumber")).toBe(false);
  });

  it("answers a repeated attempt with the approved transaction, never a second sale", async () => {
    const { fetch, calls } = recorder(["<nm_response><transaction><transaction_id>9001</transaction_id><order_id>ch-1:1</order_id><condition>pendingsettlement</condition><action><action_type>sale</action_type></action></transaction></nm_response>"]);
    const built = nmiGateway(env, { fetch });
    if (!built.ok) throw new Error(built.message);
    expect(await built.gateway.charge({ amountCents: 8900, currency: "usd", customerRef: "", paymentMethodRef: "nmi:vault:1", idempotencyKey: "ch-1:1", description: "" })).toEqual({ ok: true, reference: "9001" });
    expect(calls).toHaveLength(1);
  });

  it("reads a decline as a decline and anything else as no answer", async () => {
    const declined = nmiGateway(env, { fetch: recorder(["<x/>", "response=2&responsetext=DECLINE&response_code=200"]).fetch });
    if (!declined.ok) throw new Error("");
    expect(await declined.gateway.charge({ amountCents: 1, currency: "usd", customerRef: "", paymentMethodRef: "nmi:vault:1", idempotencyKey: "k", description: "" })).toEqual({ ok: false, kind: "declined", code: "nmi_200" });
    expect(parseNmiResponse("response=3&responsetext=Bad")).toEqual({ response: "3", responsetext: "Bad" });
  });

  it("verifies the webhook signature (HMAC-SHA256 over nonce.body) and reads an ACH return", async () => {
    const built = nmiGateway(env);
    if (!built.ok) throw new Error("");
    const body = JSON.stringify({ event_id: "e1", event_type: "transaction.check.status.return", event_body: { transaction_id: "9001", action: { response_code: "R01" } } });
    const sig = createHmac("sha256", "whsec").update(`n1.${body}`).digest("hex");
    const ok = await built.gateway.parseWebhook!({ rawBody: body, headers: new Headers({ "webhook-signature": `t=n1,s=${sig}` }) });
    expect(ok).toMatchObject({ ok: true, events: [{ kind: "ach_return", reference: "9001", code: "R01" }] });
    expect(await built.gateway.parseWebhook!({ rawBody: body, headers: new Headers({ "webhook-signature": `t=n2,s=${sig}` }) })).toEqual({ ok: false, reason: "bad_signature" });
    expect(nmiEvent({ event_id: "e2", event_type: "transaction.sale.success", event_body: { transaction_id: "1" } })).toMatchObject({ kind: "ignored" });
  });
});

describe("Authorize.Net", () => {
  const env = { AUTHORIZE_NET_API_LOGIN_ID: "login", AUTHORIZE_NET_TRANSACTION_KEY: "txkey", NEXT_PUBLIC_AUTHORIZE_NET_CLIENT_KEY: "client", AUTHORIZE_NET_SIGNATURE_KEY: "ABCDEF0123" };

  it("charges the stored profile with a 20-character invoice number from our charge id, in the sandbox unless told otherwise", async () => {
    const { fetch, calls } = recorder([
      `﻿${JSON.stringify({ transactions: [], messages: { resultCode: "Ok" } })}`,
      `﻿${JSON.stringify({ transactionResponse: { responseCode: "1", transId: "60001" }, messages: { resultCode: "Ok" } })}`,
    ]);
    const built = authorizeNetGateway(env, { fetch });
    if (!built.ok) throw new Error(built.message);
    const r = await built.gateway.charge({ amountCents: 8900, currency: "usd", customerRef: "anet:111", paymentMethodRef: "anet:222", idempotencyKey: "ch-1:1", description: "Round 1" });
    expect(r).toEqual({ ok: true, reference: "60001" });
    expect(calls[1]!.url).toBe("https://apitest.authorize.net/xml/v1/request.api");
    const body = JSON.parse(calls[1]!.body).createTransactionRequest;
    expect(body.merchantAuthentication).toEqual({ name: "login", transactionKey: "txkey" });
    expect(body.transactionRequest).toMatchObject({ transactionType: "authCaptureTransaction", amount: "89.00", profile: { customerProfileId: "111", paymentProfile: { paymentProfileId: "222" } } });
    expect(body.transactionRequest.order.invoiceNumber).toHaveLength(20);
    expect(parseAnetResponse("﻿{\"a\":1}")).toEqual({ a: 1 });
  });

  it("verifies X-ANET-Signature (HMAC-SHA512 of the raw body)", async () => {
    const built = authorizeNetGateway(env);
    if (!built.ok) throw new Error("");
    const body = JSON.stringify({ notificationId: "n1", eventType: "net.authorize.payment.authcapture.created", payload: { id: "60001" } });
    const sig = createHmac("sha512", "ABCDEF0123").update(body).digest("hex").toUpperCase();
    expect(await built.gateway.parseWebhook!({ rawBody: body, headers: new Headers({ "x-anet-signature": `sha512=${sig}` }) })).toMatchObject({ ok: true });
    expect(await built.gateway.parseWebhook!({ rawBody: `${body} `, headers: new Headers({ "x-anet-signature": `sha512=${sig}` }) })).toEqual({ ok: false, reason: "bad_signature" });
  });
});

// ── Invoices, exports, chargebacks, evidence ────────────────────────────

describe("invoices and exports", () => {
  const clients = buildDemoClients(NOW);
  const rows = invoiceRows(clients.map((c) => ({ clientId: c.id, clientName: `${c.firstName} ${c.lastName}`, charges: c.billing.charges, planType: c.agreementPlan?.terms.type ?? null, methodKind: c.billing.paymentMethod?.kind ?? null })));

  it("every charge is an invoice with a status", () => {
    expect(rows.length).toBe(clients.reduce((n, c) => n + c.billing.charges.length, 0));
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(["paid", "failed", "refunded", "disputed"]));
    expect(rows.some((r) => r.method === "ach")).toBe(true);
    const refunded = clients.flatMap((c) => c.billing.charges).find((c) => c.status === "refunded")!;
    expect(invoiceStatus({ ...refunded, refund: { ...refunded.refund!, kind: "void" } })).toBe("voided");
  });

  it("writes a transactions CSV and a QuickBooks CSV, with fee estimates and net", () => {
    const qb = quickBooksCsv(rows).split("\r\n");
    expect(qb[0]).toBe("Date,Invoice,Client,Amount,Fee Estimate,Net,Method,Status");
    expect(qb[1]).toMatch(/^\d{2}\/\d{2}\/\d{4},INV-\d{4}-\d{6},/);
    expect(transactionsCsv(rows).split("\r\n")[0]).toMatch(/^Date,Invoice,Client,Client ID,Plan,Work,Amount,Credit,Collected,Refunded,Fee \(estimate\),Net,Method,Status/);
  });

  it("estimates fees from the configured rates: card 3.9% + 30¢, ACH 1% + 30¢ capped at $5 by default", () => {
    const base: BillingCharge = { id: "x", roundNumber: 1, amountCents: 10000, status: "succeeded", workDate: ago(2), createdAt: ago(1), attempts: 1, lastAttemptAt: ago(1), nextAttemptAt: null, chargedAt: ago(1), failureCode: null, refund: null };
    expect(feeEstimateCents(base)).toBe(420);
    expect(feeEstimateCents({ ...base, methodKind: "ach" })).toBe(130);
    expect(feeEstimateCents({ ...base, methodKind: "ach", amountCents: 100000 })).toBe(500);
    expect(feeEstimateCents({ ...base, chargedAt: null, status: "failed" })).toBe(0);
  });

  it("never lets a cell run as a spreadsheet formula", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("-5.00")).toBe("-5.00");
    expect(csvCell("a,b")).toBe('"a,b"');
  });

  it("the chargeback rate counts chargebacks received over charges taken in the window", () => {
    const rate = chargebackRate(clients.flatMap((c) => c.billing.charges), NOW, 30);
    expect(rate.chargebacks).toBe(1);
    expect(rate.rate).toBeCloseTo(1 / rate.charged);
  });

  it("the evidence pack carries the agreement, the plan, the authorization, the work and what the client was told", () => {
    const hector = clients.find((c) => c.id === "c27")!;
    const pack = evidencePack(hector, hector.billing.charges[0]!.id, { legalName: "Credalti LLC", email: null }, { now: NOW })!;
    expect(pack.sections.map((s) => s.heading)).toEqual([
      "1. The charge",
      "2. The signed agreement",
      "3. The plan the client signed",
      "4. The payment authorization",
      "5. The work this charge paid for",
      "6. What the client was told",
      "7. Refund and dispute",
    ]);
    expect(pack.sections[1]!.rows.find(([k]) => k === "Document SHA-256")![1]).toMatch(/^[0-9a-f]{64}$/);
    expect(pack.sections[4]!.items!.length).toBeGreaterThan(0);
    expect(pack.hash).toMatch(/^[0-9a-f]{64}$/);
    const html = evidenceHtml(pack);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).not.toMatch(/<script/i);
    const rosa = clients.find((c) => c.id === "c24")!;
    const period = rosa.billing.charges.find((c) => c.unit === "period")!;
    expect(evidencePack(rosa, period.id, { legalName: "Credalti LLC", email: null }, { now: NOW })!.sections[2]!.items!.join(" ")).toMatch(/Monthly subscription/);
  });

  it("the demo's plan clients were charged exactly as the rule would", () => {
    for (const id of ["c24", "c25", "c26"]) {
      const c = clients.find((x) => x.id === id)!;
      expect(c.agreementPlan, id).toBeTruthy();
      const created = c.billing.charges.map((ch) => new Date(ch.createdAt).getTime());
      for (let i = 1; i < created.length; i++) expect(created[i]! - created[i - 1]!).toBeGreaterThanOrEqual(30 * DAY);
    }
    expect(clients.find((c) => c.id === "c26")!.billing.paymentMethod).toMatchObject({ kind: "ach", brand: "checking" });
  });
});
