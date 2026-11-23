import { personalInfoItemKey, personalInfoKind, type PersonalInfoKind } from "../domain/personalInfo";
import type { Bureau, NormalizedReport, ReportItem } from "../domain/types";
import type { StaffRound } from "../staff/types";

// What a new report says about the work already done, for the re-import
// preview and the record each import keeps (reports/merge.ts):
//
//   openRoundMarks       items in a round that is still open: mailed and
//                        waiting for the bureaus ("Already disputed"), or
//                        prepared and not yet mailed. A label only: nothing
//                        here adds or removes an item from a round, and only
//                        the client answers.
//   reappearedItems      items a past round's results recorded as gone that a
//                        newer report lists again. FCRA § 611(a)(5)(B): a
//                        bureau that puts back an item it deleted must first
//                        have the furnisher certify it is complete and
//                        accurate, and must tell the consumer in writing
//                        within 5 business days. The item goes back to the
//                        client's review; the client decides, as always.
//   personalInfoChanges  every name, address, birth date or employer a mailed
//                        round disputed, bureau by bureau: "No longer
//                        appears" or "Still reporting" on the new report,
//                        compared by normalized value (domain/personalInfo.ts).
//
// Pure: rounds and reports in, facts out.

export interface OpenRoundMark {
  round: number;
  /** "mailed": with the bureaus, waiting for answers. "ready"/"draft": prepared, not mailed. */
  status: "mailed" | "ready" | "draft";
}

/** Fingerprint → the open round that covers it (the newest one when two do). */
export function openRoundMarks(rounds: readonly StaffRound[]): Map<string, OpenRoundMark> {
  const marks = new Map<string, OpenRoundMark>();
  for (const round of [...rounds].sort((a, b) => a.number - b.number)) {
    if (round.status === "responded") continue;
    // A mailed round with no date cannot be waiting on anyone.
    if (round.status === "mailed" && !round.mailedAt) continue;
    for (const letter of round.letters) {
      for (const item of letter.items) marks.set(item.fingerprint, { round: round.number, status: round.status });
    }
  }
  return marks;
}

export interface ReappearedItem {
  item: ReportItem;
  /** The round whose results recorded it as gone. */
  round: number;
  /** The date of the report that no longer listed it. */
  goneOn: string;
}

/**
 * Items of `report` that a round recorded as gone on an earlier report. Only a
 * report dated after the one that showed the item gone counts.
 */
export function reappearedItems(rounds: readonly StaffRound[], report: NormalizedReport | null): ReappearedItem[] {
  if (!report) return [];
  const gone = new Map<string, { round: number; goneOn: string }>();
  for (const round of rounds) {
    for (const result of round.results ?? []) {
      if (result.outcome !== "removed") continue;
      const known = gone.get(result.fingerprint);
      // The latest time it was shown gone is the one a reappearance is measured from.
      if (!known || result.reportDate > known.goneOn) gone.set(result.fingerprint, { round: round.number, goneOn: result.reportDate });
    }
  }
  const pulled = new Date(report.pulledAt).getTime();
  return report.items.flatMap((item) => {
    const g = gone.get(item.fingerprint);
    return g && new Date(g.goneOn).getTime() < pulled ? [{ item, round: g.round, goneOn: g.goneOn }] : [];
  });
}

/** True when this item is one a round recorded as gone and the report lists it again. */
export function isReappeared(rounds: readonly StaffRound[], report: NormalizedReport | null, fingerprint: string): boolean {
  return reappearedItems(rounds, report).some((r) => r.item.fingerprint === fingerprint);
}

export type PersonalInfoStatus = "no_longer_appears" | "still_reporting";

export interface PersonalInfoChange {
  bureau: Bureau;
  kind: PersonalInfoKind;
  /** The entry as the round disputed it. */
  item: ReportItem;
  /** The newest mailed round that disputed it. */
  round: number;
  status: PersonalInfoStatus;
}

export const BUREAU_ORDER: readonly Bureau[] = ["equifax", "experian", "transunion"];

/**
 * Each personal-information entry a mailed round disputed, and whether the new
 * report still lists it at that bureau. Bureau by bureau, in the usual order;
 * empty when no round disputed one. A bureau the new report does not cover is
 * left out: the report says nothing about it.
 */
export function personalInfoChanges(rounds: readonly StaffRound[], report: NormalizedReport, coveredBureaus?: readonly Bureau[]): PersonalInfoChange[] {
  const covered = new Set(coveredBureaus ?? report.items.map((i) => i.bureau));
  const disputed = new Map<string, { item: ReportItem; round: number }>();
  for (const round of [...rounds].sort((a, b) => a.number - b.number)) {
    if (!round.mailedAt || (round.status !== "mailed" && round.status !== "responded")) continue;
    for (const letter of round.letters) {
      for (const item of letter.items) {
        const key = personalInfoItemKey(item);
        if (!key) continue;
        disputed.set(`${item.bureau}|${key}`, { item, round: round.number });
      }
    }
  }
  const onReport = new Set(report.items.flatMap((i) => {
    const key = personalInfoItemKey(i);
    return key ? [`${i.bureau}|${key}`] : [];
  }));
  return [...disputed.entries()]
    .filter(([, d]) => covered.has(d.item.bureau))
    .map(([key, d]) => ({
      bureau: d.item.bureau,
      kind: personalInfoKind(String((d.item.data as { field?: unknown }).field ?? "")),
      item: d.item,
      round: d.round,
      status: onReport.has(key) ? ("still_reporting" as const) : ("no_longer_appears" as const),
    }))
    .sort((a, b) => BUREAU_ORDER.indexOf(a.bureau) - BUREAU_ORDER.indexOf(b.bureau));
}

/** The changes grouped by bureau, in the usual order, for the summary screens. */
export function changesByBureau(changes: readonly PersonalInfoChange[]): Array<{ bureau: Bureau; entries: PersonalInfoChange[] }> {
  return BUREAU_ORDER.flatMap((bureau) => {
    const entries = changes.filter((c) => c.bureau === bureau);
    return entries.length > 0 ? [{ bureau, entries }] : [];
  });
}

/** What an import record keeps of these changes: small, and enough to read it back later. */
export interface PersonalInfoChangeRecord {
  bureau: Bureau;
  kind: PersonalInfoKind;
  /** The entry's display name ("Address: 123 Old Street"). */
  name: string;
  status: PersonalInfoStatus;
}

export function changeRecords(changes: readonly PersonalInfoChange[]): PersonalInfoChangeRecord[] {
  return changes.map((c) => ({ bureau: c.bureau, kind: c.kind, name: c.item.name, status: c.status }));
}

/** A record read back from storage (import_summary), or null when it is not one. */
export function readChangeRecords(raw: unknown): PersonalInfoChangeRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const row = r as Partial<PersonalInfoChangeRecord> | null;
    if (!row || !BUREAU_ORDER.includes(row.bureau as Bureau) || typeof row.name !== "string") return [];
    if (row.status !== "no_longer_appears" && row.status !== "still_reporting") return [];
    const kind: PersonalInfoKind = row.kind === "name" || row.kind === "address" || row.kind === "dob" || row.kind === "employer" ? row.kind : "other";
    return [{ bureau: row.bureau as Bureau, kind, name: row.name.slice(0, 200), status: row.status }];
  });
}
