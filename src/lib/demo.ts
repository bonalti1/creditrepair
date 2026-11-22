import { parseReport, type RawReport } from "./domain/parser";
import type { ItemFlag, NormalizedReport } from "./domain/types";

// Demo dataset so the UI is fully navigable before the monitoring partner
// integration (Phase 1 dependency #1) is wired. Replaced by Supabase-backed
// data once auth + import are live.

export const DEMO_RAW_REPORT: RawReport = {
  source: "demo",
  pulledAt: "2026-07-01T00:00:00.000Z",
  bureaus: {
    equifax: {
      score: 561,
      tradelines: [
        {
          creditor: "Capital One",
          accountNumberMasked: "****1234",
          accountType: "credit_card",
          status: "open",
          paymentStatus: "current",
          balance: 480,
          creditLimit: 1500,
          openedAt: "2021-09-10",
          lastPaymentAt: "2026-06-05",
          remarks: [],
          furnisher: { name: "Capital One", addressLines: ["P.O. Box 30285", "Salt Lake City, UT 84130"] },
        },
        {
          creditor: "Midland Credit Management",
          accountNumberMasked: "****8821",
          accountType: "collection",
          status: "collection",
          paymentStatus: "charge-off",
          balance: 1250,
          // A collection has no credit limit. Same dates on both bureaus.
          openedAt: "2024-02-20",
          firstDelinquencyAt: "2023-07-15",
          remarks: ["placed for collection"],
          furnisher: { name: "Midland Credit Management", addressLines: ["350 Camino De La Reina", "San Diego, CA 92108"] },
        },
      ],
      inquiries: [{ inquirer: "Auto Finance Corp", date: "2026-03-14", type: "hard" }],
      publicRecords: [],
      personalInfo: [
        { field: "address", value: "123 Old Street Apt 2, Houston, TX 77001" },
        { field: "name", value: "R. MARTINEZ JR" },
      ],
    },
    experian: {
      score: 574,
      tradelines: [
        {
          creditor: "Midland Credit Management",
          accountNumberMasked: "****8821",
          accountType: "collection",
          status: "collection",
          paymentStatus: "charge-off",
          balance: 1250,
          // A collection has no credit limit. Same dates on both bureaus.
          openedAt: "2024-02-20",
          firstDelinquencyAt: "2023-07-15",
          remarks: [],
          furnisher: { name: "Midland Credit Management", addressLines: ["350 Camino De La Reina", "San Diego, CA 92108"] },
        },
      ],
      inquiries: [],
      publicRecords: [],
      personalInfo: [{ field: "employer", value: "ACME LLC" }],
    },
    transunion: {
      score: 558,
      tradelines: [],
      inquiries: [{ inquirer: "Retail Card Services", date: "2026-01-08", type: "hard" }],
      publicRecords: [],
      personalInfo: [],
    },
  },
};

export const DEMO_REPORT: NormalizedReport = parseReport(DEMO_RAW_REPORT);

export const DEMO_FLAGS: ItemFlag[] = [];

/**
 * Score history across pulls, for the dashboard trend. The demo has a single
 * pull: today's scores are the starting point, so no gain or loss is shown.
 * A trend appears only once there are at least two real pulls.
 */
export const DEMO_SCORE_HISTORY: Array<{
  date: string;
  scores: Partial<Record<"equifax" | "experian" | "transunion", number>>;
}> = [{ date: "2026-07-01", scores: { equifax: 561, experian: 574, transunion: 558 } }];

/**
 * The first pull's scores to compare today's against, or null when there are
 * not yet two pulls (a single pull is a baseline, not a change).
 */
export function firstScoresForTrend(
  history: ReadonlyArray<{ scores: Partial<Record<"equifax" | "experian" | "transunion", number>> }>,
): Partial<Record<"equifax" | "experian" | "transunion", number>> | null {
  return history.length >= 2 ? history[0]!.scores : null;
}

/**
 * The demo report reads as imported today, whenever the demo is opened. Call
 * it in the browser after mount: a date worked out on the server can differ
 * from the visitor's day.
 */
export function demoImportedAt(): Date {
  return new Date();
}
