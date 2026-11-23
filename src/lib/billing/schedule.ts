import type { AgreementRecord } from "../agreement/gate";
import type { PlanSnapshot } from "./plans";
import { billingDay, chargeEligibility, type ChargeEligibility } from "./rules";
import type { Bilingual, BillableRound, BillingCharge, BillingContext, ChargeUnit, L, PaymentMethodSummary, ProvenResult } from "./types";

// What will be charged, and for which work: derived by RUNNING the rule
// (rules.ts: chargeEligibility), never by a separate calendar. Two uses:
//
//   upcomingCharges   the charges the work already on record will produce, for
//                     the staff card and "Mis pagos". Rounds not mailed yet
//                     produce nothing here, because they produce nothing in
//                     the rule.
//   paymentTimeline   the plan editor's "Payment timeline preview": an
//                     invented client whose rounds go out every 40 days,
//                     billed day by day by the same rule.

const DAY_MS = 24 * 60 * 60 * 1000;

export interface UpcomingCharge {
  /** When the rule would make it (ISO). */
  at: string;
  amountCents: number;
  unit: ChargeUnit;
  firstWorkCents: number;
  /** The work it pays for, in one line. */
  work: Bilingual;
}

const PROJECTION_METHOD: PaymentMethodSummary = { brand: "projection", last4: "0000", addedAt: "", authorizationVersion: "projection", authorizedAt: "projection" };

/** One line about the work a charge pays for. */
export function unitWork(e: Extract<ChargeEligibility, { eligible: true }> | BillingCharge, locale: L): string {
  const unit = e.unit ?? "round";
  const es = locale === "es";
  const n = e.roundNumber;
  const fw = (e.firstWorkCents ?? 0) > 0;
  switch (unit) {
    case "first_work":
      return es ? `Cuota de primer trabajo: ronda ${n} enviada` : `First work fee: round ${n} mailed`;
    case "period":
      return es
        ? `Mes con trabajo: ${billingDay(e.periodStart!, "es")} – ${billingDay(e.periodEnd!, "es")} (ronda ${n} enviada)`
        : `Month with work: ${billingDay(e.periodStart!, "en")} – ${billingDay(e.periodEnd!, "en")} (round ${n} mailed)`;
    case "installment":
      return es ? `Pago ${e.installmentNumber} de la tarifa fija: ronda ${n} enviada${fw ? " + primer trabajo" : ""}` : `Flat fee installment ${e.installmentNumber}: round ${n} mailed${fw ? " + first work" : ""}`;
    case "flat":
      return es ? `Tarifa fija: ronda ${n} enviada` : `Flat fee: round ${n} mailed`;
    case "results": {
      const k = e.resultItemIds?.length ?? 0;
      return es ? `${k} ${k === 1 ? "punto disputado que ya no aparece" : "puntos disputados que ya no aparecen"} en un reporte posterior` : `${k} disputed ${k === 1 ? "item" : "items"} no longer on a later report`;
    }
    default:
      return es ? `Ronda ${n} enviada${fw ? " + primer trabajo" : ""}` : `Round ${n} mailed${fw ? " + first work" : ""}`;
  }
}

/** A charge as the rule would create it, settled: for projections only. */
function projected(e: Extract<ChargeEligibility, { eligible: true }>, at: Date, index: number): BillingCharge {
  const iso = at.toISOString();
  return {
    id: `projection-${index}`,
    roundNumber: e.roundNumber,
    amountCents: e.amountCents,
    status: "succeeded",
    workDate: e.workDate,
    createdAt: iso,
    attempts: 1,
    lastAttemptAt: iso,
    nextAttemptAt: null,
    chargedAt: iso,
    failureCode: null,
    refund: null,
    unit: e.unit ?? "round",
    firstWorkCents: e.firstWorkCents ?? 0,
    creditCents: e.creditCents ?? 0,
    periodStart: e.periodStart ?? null,
    periodEnd: e.periodEnd ?? null,
    installmentNumber: e.installmentNumber ?? null,
    resultItemIds: e.resultItemIds ?? [],
  };
}

/** Codes that only mean "later": the projection waits for the date. */
const WAIT = new Set(["too_soon_after_mailing", "too_soon_after_last_charge", "before_due_date", "waiting_for_work"]);

/**
 * The next charges the work on record will produce, in order, assuming each
 * one is paid. Nothing for work that is not on record. An unpaid charge, a
 * pause or a stop request ends the projection (the rule would not charge).
 */
export function upcomingCharges(context: BillingContext, now: Date, limit = 4): UpcomingCharge[] {
  const out: UpcomingCharge[] = [];
  let charges = [...context.account.charges];
  let t = now;
  // A missing card does not change WHAT is owed or when: the projection assumes one.
  const account = { ...context.account, paymentMethod: context.account.paymentMethod ?? PROJECTION_METHOD };
  for (let guard = 0; guard < 40 && out.length < limit; guard++) {
    const e = chargeEligibility({ ...context, account: { ...account, charges } }, t);
    if (e.eligible) {
      out.push({ at: t.toISOString(), amountCents: e.amountCents, unit: e.unit ?? "round", firstWorkCents: e.firstWorkCents ?? 0, work: { es: unitWork(e, "es"), en: unitWork(e, "en") } });
      charges = [...charges, projected(e, t, guard)];
      continue;
    }
    if (WAIT.has(e.code) && e.availableAt && new Date(e.availableAt).getTime() > t.getTime()) {
      t = new Date(e.availableAt);
      continue;
    }
    break;
  }
  return out;
}

// ── The plan editor's preview ───────────────────────────────────────────

export interface TimelineEvent {
  /** Days after the first round is mailed (negative: before it). */
  day: number;
  kind: "signed" | "work_starts" | "round" | "report" | "charge" | "no_work";
  label: Bilingual;
  amountCents?: number;
  /** Total charged so far, after this charge. */
  totalCents?: number;
}

export interface TimelineOptions {
  /** Rounds mailed in the example. */
  rounds?: number;
  /** Days between rounds. */
  everyDays?: number;
  /** Days the example runs for. */
  days?: number;
  /** Pay per delete: items a report shows gone after each round (an example, not a forecast). */
  itemsGonePerReport?: number;
}

/**
 * An invented client on this plan: signed, past the cancellation window,
 * rounds mailed every `everyDays` days, and billed day by day by the real
 * rule. What the preview shows is what billing would do.
 */
export function paymentTimeline(plan: PlanSnapshot, options: TimelineOptions = {}): TimelineEvent[] {
  const rounds = options.rounds ?? 6;
  const every = options.everyDays ?? 40;
  const days = options.days ?? Math.max(rounds * every + 90, 240);
  const t0 = Date.UTC(2026, 0, 5, 17, 0, 0);
  const at = (day: number) => new Date(t0 + day * DAY_MS);
  const agreement: AgreementRecord = {
    disclosureAcknowledgedAt: at(-6).toISOString(),
    signedAt: at(-5.9).toISOString(),
    cancellationDeadline: at(-2).toISOString(),
    cancelledAt: null,
    serviceEndRequestedAt: null,
  };
  const mailed = Array.from({ length: rounds }, (_, i) => i * every);
  const billable: BillableRound[] = mailed.map((d, i) => ({
    number: i + 1,
    mailed: true,
    mailedAt: at(d).toISOString(),
    letters: [{ recipient: "Equifax", returned: false }],
  }));
  const perReport = options.itemsGonePerReport ?? 1;
  const results: ProvenResult[] =
    plan.terms.type === "pay_per_delete"
      ? mailed.flatMap((d, i) =>
          Array.from({ length: perReport }, (_, j) => ({
            itemId: `example-${i}-${j}`,
            label: "",
            outcome: "deleted" as const,
            disputedRound: i + 1,
            disputedAt: at(d).toISOString(),
            provedAt: at(d + 35).toISOString(),
            stillGone: true,
          })),
        )
      : [];

  const events: TimelineEvent[] = [
    { day: -6, kind: "signed", label: { en: "Agreement signed: nothing is charged", es: "Acuerdo firmado: no se cobra nada" } },
    { day: -2, kind: "work_starts", label: { en: "Cancellation window ends; work may start", es: "Termina el periodo de cancelación; puede empezar el trabajo" } },
  ];
  mailed.forEach((d, i) => events.push({ day: d, kind: "round", label: { en: `Round ${i + 1} mailed`, es: `Ronda ${i + 1} enviada` } }));
  if (plan.terms.type === "pay_per_delete") {
    mailed.forEach((d, i) => events.push({ day: d + 35, kind: "report", label: { en: `Report after round ${i + 1} imported (example: ${perReport} disputed item no longer shown)`, es: `Reporte después de la ronda ${i + 1} (ejemplo: ${perReport} punto disputado ya no aparece)` } }));
  }

  let charges: BillingCharge[] = [];
  let total = 0;
  const method: PaymentMethodSummary = { brand: "visa", last4: "4242", addedAt: at(-5).toISOString(), authorizationVersion: "preview", authorizedAt: at(-5).toISOString() };
  for (let day = 0; day <= days; day++) {
    const now = at(day + 0.1);
    for (let guard = 0; guard < 3; guard++) {
      const e = chargeEligibility({ agreement, signedMonthlyFee: null, rounds: billable, plan, results, switches: { payPerDelete: true, referralCredits: false }, account: { paymentMethod: method, charges, pause: null } }, now);
      if (!e.eligible) break;
      total += e.amountCents;
      charges = [...charges, projected(e, now, charges.length)];
      events.push({ day, kind: "charge", label: { en: unitWork(e, "en"), es: unitWork(e, "es") }, amountCents: e.amountCents, totalCents: total });
    }
  }
  if (plan.terms.type === "subscription") {
    // The periods that had no round: shown, so staff see "no work, no charge".
    const first = mailed[0] ?? 0;
    for (let i = 0; first + (i + 1) * 30 <= days; i++) {
      const start = first + i * 30;
      if (!mailed.some((d) => d >= start && d < start + 30)) {
        events.push({ day: start + 30, kind: "no_work", label: { en: "No work this month, no charge", es: "Sin trabajo este mes, sin cobro" } });
      }
    }
  }
  const order: Record<TimelineEvent["kind"], number> = { signed: 0, work_starts: 1, round: 2, report: 3, no_work: 4, charge: 5 };
  return events.sort((a, b) => a.day - b.day || order[a.kind] - order[b.kind]);
}

/**
 * The charges the rule would have made, day by day, from `from` until
 * `until`, each paid at once: for the demo's invented history only, so that
 * what the console shows is exactly what billing would have done.
 */
export function simulatedCharges(context: BillingContext, from: Date, until: Date, idPrefix: string): BillingCharge[] {
  let charges: BillingCharge[] = [...context.account.charges];
  const account = { ...context.account, paymentMethod: context.account.paymentMethod ?? PROJECTION_METHOD };
  for (let t = from.getTime(); t <= until.getTime(); t += 24 * 60 * 60 * 1000) {
    const now = new Date(t);
    const e = chargeEligibility({ ...context, account: { ...account, charges } }, now);
    if (!e.eligible) continue;
    charges = [...charges, { ...projected(e, now, charges.length), id: `${idPrefix}-ch${charges.length + 1}` }];
  }
  return charges;
}
