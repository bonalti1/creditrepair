import { activeExpenses, isClosed } from "../accounting/expenses";
import { addMonths, dayOf, monthOf, type MonthKey } from "../accounting/periods";
import { totalsFor, type BooksInput } from "../accounting/summary";
import type { AccountingBook } from "../accounting/types";

// The accounting department as the Overview and the Today list see it
// (docs/CONTROL.md «Money and the books»). Nothing here counts money itself:
// every figure is the accounting module's one money rule (accounting/ledger.ts
// through summary.ts totalsFor), on the same books the Accounting screens read
// (accounting/data.ts). For the `accounting` capability only (the owner).

/** This month in the books: what the Money card adds for the owner. */
export interface BooksSnapshot {
  month: MonthKey;
  netRevenueCents: number;
  /** Recorded expenses (voided ones left out), as the Accounting dashboard's «Expenses» line. */
  expensesCents: number;
  /** Processing fees (the processor's statement, else the estimate) and partner commissions paid: also taken off the profit. */
  otherCostsCents: number;
  feesEstimated: boolean;
  netProfitCents: number;
  /** Anything at all in the books this month. */
  hasData: boolean;
}

export function booksSnapshot(input: BooksInput, now: Date): BooksSnapshot {
  const month = monthOf(now);
  const t = totalsFor(input, [month]);
  return {
    month,
    netRevenueCents: t.netRevenueCents,
    expensesCents: t.expensesCents,
    otherCostsCents: t.feesCents + t.partnerCommissionsCents,
    feesEstimated: t.feesEstimated,
    netProfitCents: t.netProfitCents,
    hasData: t.hasData,
  };
}

/** A receipt is asked for from this amount up (the books' close checklist asks for every one; the Today list only for these). */
export const RECEIPT_THRESHOLD_CENTS = 7_500;
/** How far back the Today list looks for a missing receipt. */
export const RECEIPT_LOOKBACK_DAYS = 90;
/** The books of a month should be closed by this day of the next month. */
export const CLOSE_BY_DAY = 5;
/** How many past months the Today list checks for a close. */
const CLOSE_LOOKBACK_MONTHS = 3;

export interface BooksDue {
  /** Months that are over, past the 5th of the month after, with something in them, and not closed. Oldest first. */
  unclosed: MonthKey[];
  /** Expenses of RECEIPT_THRESHOLD_CENTS or more in the last RECEIPT_LOOKBACK_DAYS days with no receipt. */
  receipts: { count: number; cents: number; month: MonthKey | null; largest: { vendor: string; cents: number; spentOn: string } | null };
}

export function booksDue(book: Pick<AccountingBook, "closes" | "expenses">, input: BooksInput, now: Date): BooksDue {
  const current = monthOf(now);
  const today = dayOf(now);
  const dayOfMonth = Number(today.slice(8, 10));
  const unclosed: MonthKey[] = [];
  for (let back = CLOSE_LOOKBACK_MONTHS; back >= 1; back--) {
    const month = addMonths(current, -back);
    // Last month is due only after the 5th; the ones before it are already late.
    if (back === 1 && dayOfMonth <= CLOSE_BY_DAY) continue;
    if (isClosed(month, book.closes)) continue;
    if (!totalsFor(input, [month]).hasData) continue;
    unclosed.push(month);
  }
  const since = dayOf(new Date(now.getTime() - RECEIPT_LOOKBACK_DAYS * 86_400_000));
  const missing = activeExpenses(book.expenses)
    .filter((e) => !e.receipt && e.source !== "adjustment" && e.amountCents >= RECEIPT_THRESHOLD_CENTS && e.spentOn >= since && e.spentOn <= today)
    .sort((a, b) => b.amountCents - a.amountCents || b.spentOn.localeCompare(a.spentOn));
  // The month to open: the one with the most of them (the Expenses tab lists a month at a time).
  const perMonth = new Map<MonthKey, number>();
  for (const e of missing) perMonth.set(monthOf(e.spentOn), (perMonth.get(monthOf(e.spentOn)) ?? 0) + 1);
  const month = [...perMonth.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] ?? null;
  const largest = missing[0];
  return {
    unclosed,
    receipts: {
      count: missing.length,
      cents: missing.reduce((n, e) => n + e.amountCents, 0),
      month,
      largest: largest ? { vendor: largest.vendor, cents: largest.amountCents, spentOn: largest.spentOn } : null,
    },
  };
}
