import type { NormalizedReport, ReportItem } from "./types";

// Diff engine (spec §4.1/§4.4): compare consecutive pulls, detect deletions and
// changes between rounds. Deletions drive the celebration + retention loop.

export interface ReportDiff {
  deleted: ReportItem[];
  added: ReportItem[];
  changed: ReportItem[];
  unchanged: ReportItem[];
}

export function diffReports(previous: NormalizedReport, current: NormalizedReport): ReportDiff {
  const prevByFp = new Map(previous.items.map((i) => [i.fingerprint, i]));
  const currByFp = new Map(current.items.map((i) => [i.fingerprint, i]));

  const deleted = previous.items.filter((i) => !currByFp.has(i.fingerprint));
  const added = current.items.filter((i) => !prevByFp.has(i.fingerprint));

  const changed: ReportItem[] = [];
  const unchanged: ReportItem[] = [];
  for (const item of current.items) {
    const prev = prevByFp.get(item.fingerprint);
    if (!prev) continue;
    if (JSON.stringify(prev.data) !== JSON.stringify(item.data)) changed.push(item);
    else unchanged.push(item);
  }

  return { deleted, added, changed, unchanged };
}

/** Summary line for the day-40 WhatsApp message: "X items deleted, Y remain". */
export function diffSummary(diff: ReportDiff): { deletedCount: number; remainingNegative: number } {
  return {
    deletedCount: diff.deleted.filter((i) => i.negative).length,
    remainingNegative: [...diff.changed, ...diff.unchanged, ...diff.added].filter((i) => i.negative)
      .length,
  };
}
