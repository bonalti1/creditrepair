import { CHECK_KIND_LABEL, dataChecks, sameAccountKey, type CheckKind, type CheckStrength } from "../domain/checks";
import { parseReport, type RawReport } from "../domain/parser";
import type { Bureau, ReportItem } from "../domain/types";
import { dropOffDate, type ItemType } from "../learn/calculators";
import type { PackageKey } from "./packages";

// The review overview (docs/LIVE-FUNNEL.md, step 4): what the team reads
// before recording the person's personal video. Built from the reading of
// the report(s) they uploaded, by the same pieces the case uses later: the
// parser, the data checks (docs/DATA-CHECKS.md) and the § 605 time limits
// (learn/calculators.ts). Stored as data, not words, so each member reads it
// in their own language (overviewText.ts).
//
// What it never does: show a score, promise anything, or say an item is
// wrong. The checks say what the data shows; the consumer decides what is
// inaccurate. Scores in the report are dropped here (never stored in the
// overview), and a test holds it.

export interface OverviewCounts {
  /** Accounts, counted once across bureaus (same creditor and masked number). */
  accounts: number;
  openAccounts: number;
  collections: number;
  /** Accounts showing a late payment (status, payment status or history). */
  latePayments: number;
  chargeOffs: number;
  inquiries: number;
  publicRecords: number;
  /** Personal details (names, addresses, employers) reported. */
  personalInfo: number;
}

export interface OverviewTimeLimit {
  name: string;
  bureaus: Bureau[];
  type: Exclude<ItemType, "hard_inquiry">;
  /** The date the limit counts from (first delinquency, or the filing date). */
  startedOn: string;
  /** The last day the law lets it be reported. */
  until: string;
  passed: boolean;
}

export interface OverviewCheck {
  id: string;
  kind: CheckKind;
  strength: CheckStrength;
  names: string[];
  bureaus: Bureau[];
  explanation: { en: string; es: string };
}

export type FitReason = "goal_home" | "many_items" | "public_record" | "collections" | "few_items" | "no_negatives";

export interface ReviewOverview {
  version: 1;
  builtAt: string;
  reportDate: string | null;
  bureaus: Bureau[];
  counts: OverviewCounts;
  byBureau: Partial<Record<Bureau, Pick<OverviewCounts, "accounts" | "collections" | "latePayments" | "inquiries" | "publicRecords">>>;
  /** Negative items with the § 605 period, soonest first. */
  timeLimits: OverviewTimeLimit[];
  /** What the data checks noticed (possibly inconsistent), never a verdict. */
  checks: OverviewCheck[];
  /** Items the AI reader was not sure about: a person compares them with the file. */
  doubtful: number;
  /** Which package may fit, and why (the person decides). */
  fit: { suggested: PackageKey | "either"; reasons: FitReason[] };
  /** The reader's own warnings (counts that differ from the report's summary, an old report…). */
  warnings: string[];
}

const NEG = /collection|charge.?off|late|delinquen|repossess|foreclos|derog|default|\b(30|60|90|120|150|180)\b/i;
const text = (v: unknown) => (typeof v === "string" ? v : "");
const isCollection = (i: ReportItem) => /collection/i.test(text(i.data.accountType)) || /collection/i.test(text(i.data.status));
const isChargeOff = (i: ReportItem) => /charge.?off|charged off/i.test(`${text(i.data.status)} ${text(i.data.paymentStatus)}`);
const isLate = (i: ReportItem) => {
  if (/late|delinquen|\b(30|60|90|120|150|180)\b/i.test(`${text(i.data.status)} ${text(i.data.paymentStatus)}`)) return true;
  const history = Array.isArray(i.data.paymentHistory) ? (i.data.paymentHistory as Array<{ status?: unknown }>) : [];
  return history.some((h) => /^(30|60|90|120|150|180|late)/i.test(text(h.status)));
};
const isOpen = (i: ReportItem) => /open|current|active/i.test(text(i.data.status)) && !/closed/i.test(text(i.data.status));

const dayOf = (v: unknown): string | null => {
  const s = text(v);
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3] ?? "01"}` : null;
};

function unique(items: readonly ReportItem[]): ReportItem[][] {
  const groups = new Map<string, ReportItem[]>();
  for (const item of items) {
    const key = sameAccountKey(item) ?? `${item.bureau}|${item.fingerprint}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()];
}

function countsOf(items: readonly ReportItem[]): OverviewCounts {
  const accounts = unique(items.filter((i) => i.category === "tradeline"));
  const inquiries = unique(items.filter((i) => i.category === "inquiry"));
  return {
    accounts: accounts.length,
    openAccounts: accounts.filter((g) => g.some(isOpen)).length,
    collections: accounts.filter((g) => g.some(isCollection)).length,
    latePayments: accounts.filter((g) => g.some(isLate)).length,
    chargeOffs: accounts.filter((g) => g.some(isChargeOff)).length,
    inquiries: inquiries.length,
    publicRecords: items.filter((i) => i.category === "public_record").length,
    personalInfo: items.filter((i) => i.category === "personal_info").length,
  };
}

function limitType(item: ReportItem): OverviewTimeLimit["type"] | null {
  if (item.category === "public_record") return /bankrupt/i.test(text(item.data.recordType)) ? "bankruptcy" : null;
  if (item.category !== "tradeline") return null;
  if (isCollection(item)) return "collection";
  if (isChargeOff(item)) return "charge_off";
  if (NEG.test(`${text(item.data.status)} ${text(item.data.paymentStatus)}`)) return "late_payment";
  return null;
}

function timeLimits(items: readonly ReportItem[], asOf: Date): OverviewTimeLimit[] {
  const out: OverviewTimeLimit[] = [];
  for (const group of unique(items)) {
    const first = group[0]!;
    const type = limitType(first) ?? group.map(limitType).find(Boolean) ?? null;
    if (!type) continue;
    const field = first.category === "public_record" ? "filedAt" : "firstDelinquencyAt";
    const start = group.map((i) => dayOf(i.data[field])).filter((d): d is string => Boolean(d)).sort()[0];
    if (!start || Date.parse(start) > asOf.getTime()) continue;
    const result = dropOffDate(type, new Date(`${start}T00:00:00Z`), asOf);
    out.push({ name: first.name, bureaus: [...new Set(group.map((i) => i.bureau))], type, startedOn: start, until: result.until, passed: result.alreadyPassed });
  }
  return out.sort((a, b) => a.until.localeCompare(b.until));
}

/** Which package may fit. A suggestion for the team's words, never a decision: the person chooses. */
export function packageFit(counts: OverviewCounts, goal: string | null): ReviewOverview["fit"] {
  const reasons: FitReason[] = [];
  const negatives = counts.collections + counts.latePayments + counts.chargeOffs + counts.publicRecords;
  if (goal === "mortgage") reasons.push("goal_home");
  if (negatives >= 5) reasons.push("many_items");
  if (counts.publicRecords > 0) reasons.push("public_record");
  if (counts.collections >= 3) reasons.push("collections");
  const complete = reasons.length > 0;
  if (!complete && negatives === 0) return { suggested: "either", reasons: ["no_negatives"] };
  if (!complete && negatives <= 3) return { suggested: "diy", reasons: ["few_items"] };
  return { suggested: complete ? "complete" : "either", reasons };
}

export interface OverviewInput {
  raw: RawReport;
  /** The goal they gave on the form. */
  goal: string | null;
  /** Items the reader was not sure about, and its warnings. */
  doubtful?: number;
  warnings?: string[];
  now: Date;
}

export function buildOverview(input: OverviewInput): ReviewOverview {
  const report = parseReport(input.raw);
  const asOf = Number.isNaN(Date.parse(report.pulledAt)) ? input.now : new Date(report.pulledAt);
  const items = report.items;
  const bureaus = [...new Set(items.map((i) => i.bureau))].sort() as Bureau[];
  const byBureau: ReviewOverview["byBureau"] = {};
  for (const bureau of bureaus) {
    const c = countsOf(items.filter((i) => i.bureau === bureau));
    byBureau[bureau] = { accounts: c.accounts, collections: c.collections, latePayments: c.latePayments, inquiries: c.inquiries, publicRecords: c.publicRecords };
  }
  const counts = countsOf(items);
  const names = new Map(items.map((i) => [i.fingerprint, i.name]));
  const checks: OverviewCheck[] = dataChecks(items, asOf).map((c) => ({
    id: c.id,
    kind: c.kind,
    strength: c.strength,
    names: [...new Set(c.items.map((fp) => names.get(fp) ?? ""))].filter(Boolean),
    bureaus: c.bureaus,
    explanation: c.explanation,
  }));
  return {
    version: 1,
    builtAt: input.now.toISOString(),
    reportDate: dayOf(report.pulledAt),
    bureaus,
    counts,
    byBureau,
    timeLimits: timeLimits(items, asOf),
    checks,
    doubtful: input.doubtful ?? 0,
    fit: packageFit(counts, input.goal),
    warnings: (input.warnings ?? []).slice(0, 20),
  };
}

/** Several readings (one file per bureau from annualcreditreport.com) as one report: each bureau from the newest file that has it. */
export function mergeRaw(raws: readonly RawReport[]): RawReport | null {
  if (raws.length === 0) return null;
  const sorted = [...raws].sort((a, b) => a.pulledAt.localeCompare(b.pulledAt));
  const bureaus: RawReport["bureaus"] = {};
  for (const raw of sorted) for (const [bureau, section] of Object.entries(raw.bureaus)) if (section) bureaus[bureau as Bureau] = structuredClone(section);
  const newest = sorted[sorted.length - 1]!;
  // No score is kept: the overview and the case never need one from here.
  for (const section of Object.values(bureaus)) if (section) delete section.score;
  return { source: sorted.length > 1 ? "live-funnel" : newest.source, pulledAt: newest.pulledAt, bureaus };
}

export { CHECK_KIND_LABEL };
