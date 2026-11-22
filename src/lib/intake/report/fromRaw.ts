import type { RawReport } from "../../domain/parser";
import type { Bureau } from "../../domain/types";
import type { ReportExtraction } from "./model";

// A report in the app's own format, written out the way the model answers.
// Used for the demo's simulated reading and by the tests as the "good" model
// answer for the fictional fixture report (src/lib/intake/__fixtures__).

const BUREAU_TITLE: Record<Bureau, string> = { equifax: "Equifax", experian: "Experian", transunion: "TransUnion" };

export function extractionFromRaw(raw: RawReport, options: { provider?: string | null; page?: (bureau: Bureau) => number } = {}): ReportExtraction {
  const page = options.page ?? (() => 1);
  const out: ReportExtraction = {
    documentIsCreditReport: true,
    provider: options.provider ?? null,
    reportDate: raw.pulledAt.slice(0, 10),
    reportDateCitation: { page: 1, quote: `Report Date: ${raw.pulledAt.slice(0, 10)}` },
    bureausPresent: [],
    summaryCounts: [],
    scores: [],
    tradelines: [],
    inquiries: [],
    publicRecords: [],
    personalInfo: [],
    unreadable: [],
  };
  for (const bureau of ["equifax", "experian", "transunion"] as const) {
    const section = raw.bureaus[bureau];
    if (!section) continue;
    out.bureausPresent.push(bureau);
    const p = page(bureau);
    out.summaryCounts.push({
      bureau,
      accounts: section.tradelines.length,
      inquiries: section.inquiries.length,
      publicRecords: section.publicRecords.length,
      citation: { page: 1, quote: `${BUREAU_TITLE[bureau]} Total Accounts: ${section.tradelines.length}` },
    });
    if (section.score !== undefined) out.scores.push({ bureau, score: section.score, scoreModel: "VantageScore 3.0", citation: { page: 1, quote: `${BUREAU_TITLE[bureau]} ${section.score}` } });
    for (const t of section.tradelines) {
      out.tradelines.push({
        bureau,
        creditor: t.creditor,
        accountNumberMasked: t.accountNumberMasked,
        accountType: t.accountType,
        status: t.status,
        paymentStatus: t.paymentStatus,
        balance: t.balance ?? null,
        creditLimit: t.creditLimit ?? null,
        openedAt: t.openedAt ?? null,
        lastPaymentAt: t.lastPaymentAt ?? null,
        firstDelinquencyAt: t.firstDelinquencyAt ?? null,
        lastReportedAt: t.lastReportedAt ?? null,
        remarks: t.remarks,
        citation: { page: p, quote: `${t.creditor} ${t.accountNumberMasked}`.trim() },
        confidence: "high",
        doubt: null,
      });
    }
    for (const q of section.inquiries) {
      out.inquiries.push({ bureau, inquirer: q.inquirer, date: q.date, type: q.type === "soft" ? "soft" : "hard", citation: { page: p, quote: `${q.inquirer} ${q.date}` }, confidence: "high", doubt: null });
    }
    for (const r of section.publicRecords) {
      out.publicRecords.push({ bureau, recordType: r.recordType, court: r.court, filedAt: r.filedAt ?? null, status: r.status, citation: { page: p, quote: r.recordType }, confidence: "high", doubt: null });
    }
    for (const pi of section.personalInfo) {
      if (pi.field !== "name" && pi.field !== "address" && pi.field !== "employer") continue;
      out.personalInfo.push({ bureau, field: pi.field, value: pi.value, citation: { page: 1, quote: pi.value }, confidence: "high", doubt: null });
    }
  }
  return out;
}
