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
          remarks: ["placed for collection"],
          furnisher: { name: "Midland Credit Management", addressLines: ["350 Camino De La Reina", "San Diego, CA 92108"] },
        },
      ],
      inquiries: [{ inquirer: "Auto Finance Corp", date: "2026-03-14", type: "hard" }],
      publicRecords: [],
      personalInfo: [
        { field: "address", value: "123 Old Street Apt 2, Houston, TX 77001" },
        { field: "name", value: "R. BONALTI JR" },
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
          remarks: [],
          furnisher: { name: "Midland Credit Management", addressLines: ["350 Camino De La Reina", "San Diego, CA 92108"] },
        },
      ],
      inquiries: [],
      publicRecords: [],
      personalInfo: [{ field: "employer", value: "ACME LLC (antiguo empleo)" }],
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

/** Score history across pulls, for the dashboard trend (demo until partner data flows). */
export const DEMO_SCORE_HISTORY: Array<{
  date: string;
  scores: Partial<Record<"equifax" | "experian" | "transunion", number>>;
}> = [
  { date: "2026-05-01", scores: { equifax: 538, experian: 549, transunion: 531 } },
  { date: "2026-06-01", scores: { equifax: 547, experian: 561, transunion: 540 } },
  { date: "2026-07-01", scores: { equifax: 561, experian: 574, transunion: 558 } },
];
