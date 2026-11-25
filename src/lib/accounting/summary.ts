import type { CommissionRecord } from "../partners/rules";
import type { CategoryKey } from "./categories";
import { activeExpenses, byCategory } from "./expenses";
import type { ChargeFact } from "./facts";
import { buildLedger, type LedgerEntry } from "./ledger";
import { daysBetween, dayOf, monthOf, yearToDate, type MonthKey } from "./periods";
import type { CollectionAction, Expense, MonthTotalsSnapshot, OtherIncome } from "./types";

// The numbers on the dashboard and in the reports, all from one place, all
// from the ledger's money rule (ledger.ts). A figure with nothing behind it
// is null, and the screen says "No data yet" instead of a made-up $0.

export interface BooksInput {
  facts: readonly ChargeFact[];
  expenses: readonly Expense[];
  otherIncome: readonly OtherIncome[];
  /** Partner commissions recorded by an administrator (partner_commissions); [] while the switch is off. */
  commissions: readonly CommissionRecord[];
  collectionActions: readonly CollectionAction[];
}

export interface MonthTotals extends MonthTotalsSnapshot {
  months: MonthKey[];
  /** Revenue less refunds and lost chargebacks. */
  netRevenueCents: number;
  monitoringCents: number;
  expensesByCategory: Array<{ category: CategoryKey; cents: number; count: number }>;
  /** True when some of the processing fee is the estimate (no processor statement entered for a month). */
  feesEstimated: boolean;
  /** The estimated part of feesCents (the rest is from the processor's statement, entered as expenses). */
  feesEstimateCents: number;
  cashInCents: number;
  cashOutCents: number;
  failedCount: number;
  failedCents: number;
  openChargebacksCents: number;
  payments: number;
  /** Anything at all happened in these months. */
  hasData: boolean;
}

const sum = (xs: Iterable<number>) => {
  let t = 0;
  for (const x of xs) t += x;
  return t;
};

/** The totals of one or more months (a month, or the months of the year so far). */
export function totalsFor(input: BooksInput, months: readonly MonthKey[], ledger: readonly LedgerEntry[] = buildLedger(input.facts, input.otherIncome)): MonthTotals {
  const inMonths = new Set(months);
  const entries = ledger.filter((e) => inMonths.has(e.month));
  const of = (...kinds: LedgerEntry["kind"][]) => entries.filter((e) => kinds.includes(e.kind));
  const revenueCents = sum(of("payment").map((e) => e.amountCents));
  const refundsCents = -sum(of("refund", "void").map((e) => e.amountCents));
  const chargebacksCents = -sum(of("chargeback_lost").map((e) => e.amountCents));
  const monitoringCents = sum(of("monitoring_commission").map((e) => e.amountCents));
  const otherIncomeCents = monitoringCents + sum(of("other_income").map((e) => e.amountCents));
  const expenses = activeExpenses(input.expenses).filter((e) => inMonths.has(monthOf(e.spentOn)));
  const expensesByCategory = byCategory(expenses);
  // Processing fees are their own line: measured (the processor's statement,
  // entered as a "processing_fees" expense) beats estimated, month by month.
  const measuredCents = sum(expenses.filter((e) => e.category === "processing_fees").map((e) => e.amountCents));
  const expensesCents = sum(expenses.map((e) => e.amountCents)) - measuredCents;
  let feesEstimateCents = 0;
  for (const month of months) {
    const measured = expenses.some((e) => e.category === "processing_fees" && monthOf(e.spentOn) === month);
    if (!measured) feesEstimateCents += sum(entries.filter((e) => e.month === month && e.kind === "payment").map((e) => e.feeEstimateCents));
  }
  const feesCents = measuredCents + feesEstimateCents;
  const feesEstimated = feesEstimateCents > 0;
  const partnerCommissionsCents = sum(input.commissions.filter((c) => c.kind === "paid" && inMonths.has(monthOf(c.recordedAt))).map((c) => c.amountCents));
  const netRevenueCents = revenueCents - refundsCents - chargebacksCents;
  const netProfitCents = netRevenueCents + otherIncomeCents - expensesCents - feesCents - partnerCommissionsCents;
  const failed = of("failed_attempt", "ach_return");
  return {
    months: [...months],
    revenueCents,
    refundsCents,
    chargebacksCents,
    netRevenueCents,
    monitoringCents,
    otherIncomeCents,
    expensesCents,
    expensesByCategory,
    feesCents,
    feesEstimated,
    feesEstimateCents,
    partnerCommissionsCents,
    netProfitCents,
    cashInCents: revenueCents + otherIncomeCents,
    cashOutCents: refundsCents + chargebacksCents + expensesCents + feesCents + partnerCommissionsCents,
    failedCount: failed.length,
    failedCents: sum(failed.map((e) => e.involvedCents)),
    openChargebacksCents: sum(of("chargeback_open").map((e) => e.involvedCents)),
    payments: of("payment").length,
    hasData: entries.length > 0 || expenses.length > 0 || partnerCommissionsCents > 0,
  };
}

export function snapshotOf(t: MonthTotals): MonthTotalsSnapshot {
  return {
    revenueCents: t.revenueCents,
    refundsCents: t.refundsCents,
    chargebacksCents: t.chargebacksCents,
    otherIncomeCents: t.otherIncomeCents,
    expensesCents: t.expensesCents,
    feesCents: t.feesCents,
    partnerCommissionsCents: t.partnerCommissionsCents,
    netProfitCents: t.netProfitCents,
  };
}

// ── Accounts receivable ─────────────────────────────────────────────────

export interface Receivable {
  fact: ChargeFact;
  /** Days since the work the charge pays for. */
  ageDays: number;
  bucket: "0-30" | "31-60" | "61-90" | "90+";
  writtenOff: boolean;
}

/**
 * Earned and not collected. A charge exists only for work already done (the
 * database refuses any other, BILLING.md), so every charge that is not paid
 * is receivable: processing, or declined and waiting. Written-off charges (a
 * person's decision in collections) are listed apart and not counted.
 * Nothing is receivable for work not yet done: upcoming charges are not here.
 */
export function receivables(input: Pick<BooksInput, "facts" | "collectionActions">, now: Date): { open: Receivable[]; writtenOff: Receivable[]; totalCents: number; buckets: Record<Receivable["bucket"], number> } {
  const off = new Set(input.collectionActions.filter((a) => a.kind === "decided_write_off").map((a) => a.chargeId));
  const today = dayOf(now);
  const all = input.facts
    .filter((f) => !f.test && (f.charge.status === "pending" || f.charge.status === "failed"))
    .map((fact): Receivable => {
      const ageDays = Math.max(0, daysBetween(fact.charge.workDate, today));
      const bucket = ageDays <= 30 ? "0-30" : ageDays <= 60 ? "31-60" : ageDays <= 90 ? "61-90" : "90+";
      return { fact, ageDays, bucket, writtenOff: off.has(fact.id) };
    })
    .sort((a, b) => b.ageDays - a.ageDays);
  const open = all.filter((r) => !r.writtenOff);
  const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 } as Record<Receivable["bucket"], number>;
  for (const r of open) buckets[r.bucket] += r.fact.amountCents - (r.fact.charge.creditCents ?? 0);
  return { open, writtenOff: all.filter((r) => r.writtenOff), totalCents: sum(Object.values(buckets)), buckets };
}

// ── The dashboard ───────────────────────────────────────────────────────

export interface Dashboard {
  month: MonthKey;
  thisMonth: MonthTotals;
  lastMonth: MonthTotals;
  yearToDate: MonthTotals;
  receivableCents: number;
  receivableCount: number;
  /** Owed to partners and not yet paid (null while partner commissions are off). */
  partnerPayableCents: number | null;
  /** Nothing in the books at all yet. */
  empty: boolean;
}

export function dashboard(input: BooksInput, month: MonthKey, now: Date, commissionsOn: boolean): Dashboard {
  const ledger = buildLedger(input.facts, input.otherIncome);
  const [y, m] = month.split("-").map(Number);
  const last = m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`;
  const ar = receivables(input, now);
  const owed = sum(input.commissions.filter((c) => c.kind === "owed").map((c) => c.amountCents));
  const paid = sum(input.commissions.filter((c) => c.kind === "paid").map((c) => c.amountCents));
  return {
    month,
    thisMonth: totalsFor(input, [month], ledger),
    lastMonth: totalsFor(input, [last], ledger),
    yearToDate: totalsFor(input, yearToDate(month), ledger),
    receivableCents: ar.totalCents,
    receivableCount: ar.open.length,
    partnerPayableCents: commissionsOn ? owed - paid : null,
    empty: ledger.length === 0 && activeExpenses(input.expenses).length === 0,
  };
}

/** "+12%" / "−5%" against last month, or null when last month had nothing to compare with. */
export function change(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}
