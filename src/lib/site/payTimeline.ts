import { CHARGE_DELAY_DAYS, MIN_DAYS_BETWEEN_CHARGES, PERIOD_DAYS } from "../billing/rules";
import { formatCents } from "../billing/money";
import type { EffectiveAmounts, PlanTerms } from "../billing/plans";
import { ESTIMATED_CYCLE_DAYS } from "../rounds/timing";
import { TIMELINE_DAYS, type PayEvent, type PayEventKind } from "./payTimelineShared";

export * from "./payTimelineShared";

/** Example: signing on a Monday, the third business day is a Thursday. */
export const EXAMPLE_CANCEL_ENDS_DAY = 3;
/** Example: the report is in and reviewed, and round 1 is mailed, about ten days after signing. */
export const EXAMPLE_FIRST_ROUND_DAY = 10;


// "When would I pay?" on /precios: the first six months of an example case,
// day by day, with when letters go out and when a charge can happen. Built on
// the server from the billing rules themselves (src/lib/billing/rules.ts), so
// the page says exactly what billing does:
//
//  - nothing before the first round is mailed (15 U.S.C. §1679b(b));
//  - a round is charged no sooner than CHARGE_DELAY_DAYS after it is mailed;
//  - never two charges less than MIN_DAYS_BETWEEN_CHARGES apart;
//  - a monthly plan charges a 30-day period only if letters went out in it;
//  - never above the plan's most-you'll-pay.
//
// Without an attorney-reviewed plan (the demo, or none offered yet) the
// timeline shows the rule only: where a charge CAN happen, with no amount.
// With one, the amounts come from that plan's own terms. Pay per delete is
// never shown on the public site (plans.ts).
//
// The dates are an example: signing on day 0, the 3 business days to cancel
// ending about day 3, the first round mailed about day 10, then a round about
// every ESTIMATED_CYCLE_DAYS days.

/** The days rounds go out in the example, up to the horizon. */
export function exampleRoundDays(horizon: number = TIMELINE_DAYS, cycle: number = ESTIMATED_CYCLE_DAYS): number[] {
  const days: number[] = [];
  for (let d = EXAMPLE_FIRST_ROUND_DAY; d <= horizon; d += cycle) days.push(d);
  return days;
}

/** The parts of a plan the timeline needs. Plain numbers, so the page can hand them to the browser. */
export interface TimelinePlan {
  type: PlanTerms["type"];
  firstWorkFeeCents: number;
  recurringCents: number;
  flatTotalCents: number;
  flatRounds: number;
  flatSchedule: "installments" | "after_last_round" | null;
  maxTotalCents: number;
  /** Per round: the rounds the plan covers; subscription: its months. Null: until the service ends. */
  limit: number | null;
}

export function timelinePlan(terms: PlanTerms, effective: EffectiveAmounts): TimelinePlan {
  return {
    type: terms.type,
    firstWorkFeeCents: effective.firstWorkFeeCents,
    recurringCents: effective.recurringCents,
    flatTotalCents: effective.flatTotalCents,
    flatRounds: terms.flat?.rounds ?? 0,
    flatSchedule: terms.flat?.schedule ?? null,
    maxTotalCents: effective.maxTotalCents,
    limit: terms.duration.kind === "indefinite" ? null : terms.duration.count,
  };
}

/** Equal installments, the last one taking the rounding (as billing does). */
function installment(total: number, n: number, k: number): number {
  const base = Math.floor(total / n);
  return k === n ? total - base * (n - 1) : base;
}

/**
 * Every event of the example's first six months, in day order. `plan` null:
 * the rule only (where a charge can happen, no amounts).
 */
export function payEvents(plan: TimelinePlan | null, horizon: number = TIMELINE_DAYS): PayEvent[] {
  const rounds = exampleRoundDays(horizon);
  const events: PayEvent[] = [
    { day: 0, kind: "signed", amount: null },
    { day: EXAMPLE_CANCEL_ENDS_DAY, kind: "cancelEnds", amount: null },
    ...rounds.map((day, i): PayEvent => ({ day, kind: "mailed", round: i + 1, amount: null })),
  ];

  const charges: PayEvent[] = [];
  let charged = 0;
  let lastChargeDay = -Infinity;
  const cap = plan?.maxTotalCents ?? Infinity;
  const charge = (day: number, round: number, cents: number | null) => {
    if (day > horizon) return;
    const at = Math.max(day, lastChargeDay + MIN_DAYS_BETWEEN_CHARGES);
    if (at > horizon) return;
    if (cents !== null) {
      const amount = Math.min(cents, cap - charged);
      if (amount <= 0) return;
      charged += amount;
      charges.push({ day: at, kind: "charge", round, amount: formatCents(amount) });
    } else {
      charges.push({ day: at, kind: "charge", round, amount: null });
    }
    lastChargeDay = at;
  };

  if (!plan) {
    // The rule: each mailed round can be charged after the delay, at most once every 30 days.
    rounds.forEach((day, i) => charge(day + CHARGE_DELAY_DAYS, i + 1, null));
  } else if (plan.type === "subscription") {
    // 30-day periods from the first mailing; a period with letters is charged when it ends.
    const anchor = rounds[0]!;
    const months = plan.limit ?? Infinity;
    for (let i = 0; i < months; i++) {
      const start = anchor + i * PERIOD_DAYS;
      const end = start + PERIOD_DAYS;
      if (end > horizon) break;
      const inside = rounds.filter((d) => d >= start && d < end);
      if (inside.length === 0) {
        events.push({ day: end, kind: "quiet", amount: null });
        continue;
      }
      const round = rounds.indexOf(inside[0]!) + 1;
      const fee = i === 0 ? plan.firstWorkFeeCents : 0;
      charge(end, round, plan.recurringCents + fee);
    }
  } else if (plan.type === "per_round") {
    const covered = plan.limit ?? Infinity;
    rounds.forEach((day, i) => {
      if (i + 1 > covered) return;
      charge(day + CHARGE_DELAY_DAYS, i + 1, plan.recurringCents + (i === 0 ? plan.firstWorkFeeCents : 0));
    });
  } else if (plan.type === "flat_fee") {
    const n = Math.max(1, plan.flatRounds);
    rounds.forEach((day, i) => {
      const k = i + 1;
      if (k > n) return;
      const fee = k === 1 ? plan.firstWorkFeeCents : 0;
      if (plan.flatSchedule === "after_last_round") {
        if (k === n) charge(day + CHARGE_DELAY_DAYS, k, plan.flatTotalCents + plan.firstWorkFeeCents);
        else if (fee > 0) charge(day + CHARGE_DELAY_DAYS, k, fee);
      } else {
        charge(day + CHARGE_DELAY_DAYS, k, installment(plan.flatTotalCents, n, k) + fee);
      }
    });
  }
  // Pay per delete is never shown here: its charges depend on later reports, which no example can know.

  return [...events, ...charges].sort((a, b) => a.day - b.day || order(a.kind) - order(b.kind));
}

const ORDER: Record<PayEventKind, number> = { signed: 0, cancelEnds: 1, mailed: 2, quiet: 3, charge: 4 };
const order = (kind: PayEventKind) => ORDER[kind];

