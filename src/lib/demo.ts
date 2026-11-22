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

/**
 * The sample report the client app shows in the demo: the one above, with a
 * few details changed and a few accounts added so that the review shows an
 * example of most data checks (domain/checks.ts, docs/DATA-CHECKS.md). Kept
 * apart from DEMO_RAW_REPORT, which tests, fixtures and the team's invented
 * clients are built on.
 */
export function demoClientRawReport(): RawReport {
  const raw = structuredClone(DEMO_RAW_REPORT);
  const eq = raw.bureaus.equifax!;
  const ex = raw.bureaus.experian!;
  const tu = raw.bureaus.transunion!;

  // Capital One on Equifax: three months of history, all on time.
  Object.assign(eq.tradelines[0]!, {
    lastReportedAt: "2026-06-20",
    paymentHistory: [
      { month: "2025-02", status: "OK" },
      { month: "2025-03", status: "OK" },
      { month: "2025-04", status: "OK" },
    ],
  });
  // Reported paid with a balance (balance_on_paid), a last payment before the
  // account was opened (impossible_dates) and a "last reported" date after the
  // report's own date (future_date).
  eq.tradelines.push({
    creditor: "Discover Card",
    accountNumberMasked: "****6604",
    accountType: "credit_card",
    status: "closed",
    paymentStatus: "paid",
    balance: 310,
    creditLimit: 2000,
    openedAt: "2019-06-15",
    lastPaymentAt: "2019-02-01",
    lastReportedAt: "2026-08-15",
    remarks: [],
    furnisher: { name: "Discover Financial Services", addressLines: ["P.O. Box 30943", "Salt Lake City, UT 84130"] },
  });

  // Midland on Experian: another balance and a later first delinquency than
  // on Equifax (balance_mismatch, possible_reaging).
  Object.assign(ex.tradelines[0]!, { balance: 900, firstDelinquencyAt: "2023-11-15" });
  // The same Capital One card, with another limit and a late month Equifax
  // shows as on time (limit_mismatch, payment_history_mismatch).
  ex.tradelines.push({
    creditor: "Capital One",
    accountNumberMasked: "****1234",
    accountType: "credit_card",
    status: "open",
    paymentStatus: "current",
    balance: 480,
    creditLimit: 1000,
    openedAt: "2021-09-10",
    lastPaymentAt: "2026-06-05",
    lastReportedAt: "2026-06-20",
    paymentHistory: [
      { month: "2025-02", status: "OK" },
      { month: "2025-03", status: "30" },
      { month: "2025-04", status: "OK" },
    ],
    remarks: [],
    furnisher: { name: "Capital One", addressLines: ["P.O. Box 30285", "Salt Lake City, UT 84130"] },
  });
  // A second version of the name (personal_info_variants; "JR" is name_suffix).
  ex.personalInfo.push({ field: "name", value: "ROSA MARTINEZ" });

  // An original creditor and its collector, both with a balance
  // (duplicate_debt); the charge-off has no date of first delinquency
  // (missing_first_delinquency) and the collection is past its reporting
  // period by the date it shows (obsolete).
  tu.tradelines.push(
    {
      creditor: "Synchrony Bank",
      accountNumberMasked: "****3390",
      accountType: "credit_card",
      status: "charge_off",
      paymentStatus: "charge-off",
      balance: 640,
      openedAt: "2015-05-01",
      lastPaymentAt: "2016-11-20",
      remarks: [],
      furnisher: { name: "Synchrony Bank", addressLines: ["P.O. Box 965060", "Orlando, FL 32896"] },
    },
    {
      creditor: "Portfolio Recovery Associates",
      accountNumberMasked: "****7712",
      accountType: "collection",
      status: "collection",
      paymentStatus: "",
      balance: 640,
      originalCreditor: "Synchrony Bank",
      openedAt: "2018-01-10",
      firstDelinquencyAt: "2017-03-02",
      remarks: ["placed for collection"],
      furnisher: { name: "Portfolio Recovery Associates", addressLines: ["120 Corporate Blvd", "Norfolk, VA 23502"] },
    },
  );
  return raw;
}

/** The client app's sample report (see demoClientRawReport). */
export const DEMO_CLIENT_REPORT: NormalizedReport = parseReport(demoClientRawReport());

export const DEMO_FLAGS: ItemFlag[] = [];

/**
 * Score history across pulls, in the shape the client's own history arrives in
 * (/api/report). The demo has a single pull, equal to today's scores. The
 * client app shows only the current scores, never a change between pulls
 * (docs/BRAND.md, "Scores in the client app").
 */
export const DEMO_SCORE_HISTORY: Array<{
  date: string;
  scores: Partial<Record<"equifax" | "experian" | "transunion", number>>;
}> = [{ date: "2026-07-01", scores: { equifax: 561, experian: 574, transunion: 558 } }];

/**
 * The demo report reads as imported today, whenever the demo is opened. Call
 * it in the browser after mount: a date worked out on the server can differ
 * from the visitor's day.
 */
export function demoImportedAt(): Date {
  return new Date();
}
