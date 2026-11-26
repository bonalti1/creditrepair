import type { Expense } from "../accounting/types";

// Ad spend and the books (docs/ADS.md, "Spend and the books").
//
// THE MONEY RULE (src/lib/accounting/ledger.ts) is cash basis: everything on
// the day money moved, from what actually moved (billing, the bank file, a
// receipt a person enters). Meta's "spend" is not that: it is what the ads
// used, by the day they ran, in the ad account's time zone; Meta charges the
// card later (at a billing threshold or once a month), and that charge comes
// into the books from the bank import or the receipt, under "Advertising:
// Meta". Adding Meta's spend to the books by itself would count the same
// money twice and on the wrong day.
//
// So the Ads Manager never writes to the books. It offers a RECONCILIATION
// SUGGESTION instead: for each month, Meta's spend beside what the books hold
// under Advertising: Meta, and what to do when they differ. A person records
// the expense (from Meta's receipt, on the day the card was charged); the
// books stay the books.

export const META_CATEGORY = "advertising_meta" as const;

export type SpendCheckStatus = "match" | "books_low" | "books_high" | "no_spend";

export interface SpendCheck {
  /** "2026-11". */
  month: string;
  /** Meta's spend that month (its days, in the ad account's time zone). */
  metaCents: number;
  /** The books: expenses (and adjustments) under Advertising: Meta that month, voided ones left out. */
  booksCents: number;
  /** Meta minus the books: positive when the books have less. */
  differenceCents: number;
  status: SpendCheckStatus;
}

/** Close enough: $5 or 2% of Meta's spend, whichever is more (card charges and month edges rarely line up to the cent). */
export function tolerance(metaCents: number): number {
  return Math.max(500, Math.round(metaCents * 0.02));
}

export function booksMetaSpend(expenses: readonly Pick<Expense, "category" | "spentOn" | "amountCents" | "voidedAt">[], month: string): number {
  return expenses.filter((e) => e.category === META_CATEGORY && !e.voidedAt && e.spentOn.slice(0, 7) === month).reduce((sum, e) => sum + e.amountCents, 0);
}

/** Meta's spend beside the books, month by month (newest first). */
export function adSpendChecks(monthly: ReadonlyMap<string, number>, expenses: readonly Pick<Expense, "category" | "spentOn" | "amountCents" | "voidedAt">[], months: readonly string[]): SpendCheck[] {
  return [...months]
    .sort((a, b) => b.localeCompare(a))
    .map((month) => {
      const metaCents = monthly.get(month) ?? 0;
      const booksCents = booksMetaSpend(expenses, month);
      const differenceCents = metaCents - booksCents;
      const status: SpendCheckStatus =
        metaCents === 0 && booksCents === 0 ? "no_spend" : Math.abs(differenceCents) <= tolerance(metaCents) ? "match" : differenceCents > 0 ? "books_low" : "books_high";
      return { month, metaCents, booksCents, differenceCents, status };
    });
}
