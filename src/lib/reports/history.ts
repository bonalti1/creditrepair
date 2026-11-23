import type { NormalizedReport } from "../domain/types";
import type { ReportHistoryEntry, ReportImport, StaffClient } from "../staff/types";
import { readChangeRecords, type PersonalInfoChangeRecord } from "./reimport";

/** "1 punto", "3 puntos". (Here, not from the console's helpers: the client app reads this file too.) */
const count = (n: number, singular: string, plural: string): string => `${n} ${n === 1 ? singular : plural}`;

// "Reports in one place": every report in a client's file, newest first, with
// what each one changed. The staff client page's Reports tab and the client's
// "My reports" both read it.
//
// With a database every report_pulls row is one entry (staff/fromRows.ts sets
// StaffClient.reportHistory). In the demo the list is built here from the
// import records (reports/merge.ts), with the invented report on file first.
//
// The words come in two versions. Staff may read "deleted"; a client never
// does (docs/BRAND.md): for them an item "no longer appears".

export type Audience = "staff" | "client";

/** The entry for a report that came into the file by itself (the demo's invented report, or a first pull). */
export function entryOnFile(report: NormalizedReport, id = "on-file"): ReportHistoryEntry {
  return {
    id,
    at: report.pulledAt,
    reportDate: report.pulledAt,
    source: report.source,
    readerKey: null,
    by: null,
    itemCount: report.items.length,
    first: true,
    removed: 0,
    added: 0,
    changed: 0,
    closedRound: null,
    skippedPersonalInfo: 0,
    reappeared: 0,
    personalInfo: [],
  };
}

/** The id an import record has in the demo's list: its own time, which is unique per client. */
export const importEntryId = (record: Pick<ReportImport, "at">): string => `import-${record.at}`;

export function entryFromImport(record: ReportImport, first: boolean, id = importEntryId(record)): ReportHistoryEntry {
  return {
    id,
    at: record.at,
    reportDate: record.reportDate,
    source: record.source ?? "",
    readerKey: record.readerKey || null,
    by: record.by || null,
    itemCount: record.itemCount,
    first,
    removed: record.removed,
    added: record.added,
    changed: record.changed,
    closedRound: record.closedRound,
    skippedPersonalInfo: record.skippedPersonalInfo ?? 0,
    reappeared: record.reappeared ?? 0,
    personalInfo: record.personalInfo ?? [],
  };
}

/**
 * The demo's list, oldest first: the report the client had before any import
 * (when there was one), then each import.
 */
export function demoReportHistory(before: NormalizedReport | null, imports: readonly ReportImport[]): ReportHistoryEntry[] {
  const entries: ReportHistoryEntry[] = before ? [entryOnFile(before)] : [];
  for (const record of imports) entries.push(entryFromImport(record, entries.length === 0));
  return entries;
}

/** Every report in the client's file, NEWEST first. */
export function reportHistoryOf(client: Pick<StaffClient, "report" | "reportImports" | "reportHistory">): ReportHistoryEntry[] {
  if (client.reportHistory) return [...client.reportHistory].reverse();
  const imports = client.reportImports ?? [];
  if (imports.length > 0) return demoReportHistory(null, imports).reverse();
  return client.report ? [entryOnFile(client.report)] : [];
}

/** One report_pulls row (its import_summary read back) as an entry. `first`: the client's oldest pull. */
export function entryFromPullRow(row: Record<string, unknown>, first: boolean): ReportHistoryEntry {
  const summary = (row.import_summary && typeof row.import_summary === "object" ? row.import_summary : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : "");
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    id: text(row.id),
    at: iso(row.created_at) || iso(row.pulled_at),
    reportDate: iso(row.pulled_at),
    source: text(row.source),
    readerKey: text(row.reader_key) || null,
    by: text(row.imported_by_name) || null,
    itemCount: num(summary.itemCount),
    first,
    removed: first ? 0 : num(summary.removed),
    added: first ? 0 : num(summary.added),
    changed: first ? 0 : num(summary.changed),
    closedRound: typeof summary.closedRound === "number" ? summary.closedRound : null,
    skippedPersonalInfo: num(summary.skippedPersonalInfo),
    reappeared: num(summary.reappeared),
    personalInfo: readChangeRecords(summary.personalInfo),
  };
}

/** Rows of report_pulls (any order) → entries, oldest first. */
export function historyFromPullRows(rows: readonly Record<string, unknown>[]): ReportHistoryEntry[] {
  const sorted = [...rows].sort(
    (a, b) => String(a.pulled_at).localeCompare(String(b.pulled_at)) || String(a.created_at).localeCompare(String(b.created_at)),
  );
  return sorted.map((row, index) => entryFromPullRow(row, index === 0));
}

/** "No longer appears: 2 · Still reporting: 1", by status. */
export function personalInfoTally(records: readonly PersonalInfoChangeRecord[]): { gone: number; still: number } {
  return {
    gone: records.filter((r) => r.status === "no_longer_appears").length,
    still: records.filter((r) => r.status === "still_reporting").length,
  };
}

/**
 * What one report changed, as short lines, in the reader's language. The
 * client's version never says "deleted" and never mentions scores.
 */
export function historySummary(entry: ReportHistoryEntry, locale: "es" | "en", audience: Audience): string[] {
  const es = locale === "es";
  const lines: string[] = [];
  if (entry.first) {
    lines.push(es ? `Primer reporte: ${count(entry.itemCount, "punto", "puntos")}.` : `First report: ${count(entry.itemCount, "item", "items")}.`);
  } else {
    const parts = es
      ? [
          entry.removed > 0 ? `${count(entry.removed, "ya no aparece", "ya no aparecen")}` : null,
          entry.added > 0 ? `${count(entry.added, "nuevo", "nuevos")}` : null,
          entry.changed > 0 ? `${count(entry.changed, "cambió", "cambiaron")}` : null,
        ]
      : [
          entry.removed > 0 ? `${entry.removed} no longer ${entry.removed === 1 ? "appears" : "appear"}` : null,
          entry.added > 0 ? `${entry.added} new` : null,
          entry.changed > 0 ? `${entry.changed} changed` : null,
        ];
    const said = parts.filter((p): p is string => p !== null);
    lines.push(
      said.length > 0
        ? `${es ? count(entry.itemCount, "punto", "puntos") : count(entry.itemCount, "item", "items")}: ${said.join(" · ")}.`
        : es
          ? `${count(entry.itemCount, "punto", "puntos")}: sin cambios contra el reporte anterior.`
          : `${count(entry.itemCount, "item", "items")}: no changes from the report before.`,
    );
  }
  if (entry.closedRound !== null) {
    lines.push(es ? `Trajo las respuestas a la ronda ${entry.closedRound}.` : `It brought the answers to round ${entry.closedRound}.`);
  }
  if (entry.reappeared > 0) {
    lines.push(
      es
        ? `${count(entry.reappeared, "punto volvió", "puntos volvieron")} a aparecer después de no aparecer.`
        : `${count(entry.reappeared, "item shows", "items show")} up again after no longer appearing.`,
    );
  }
  const { gone, still } = personalInfoTally(entry.personalInfo);
  if (gone + still > 0) {
    if (audience === "staff") {
      lines.push(
        es
          ? `Datos personales disputados: ${gone} ya no ${gone === 1 ? "aparece" : "aparecen"} (borrados por el buró), ${still} ${still === 1 ? "sigue" : "siguen"} en el reporte.`
          : `Disputed personal info: ${gone} no longer ${gone === 1 ? "appears" : "appear"} (deleted by the bureau), ${still} still reporting.`,
      );
    } else {
      lines.push(
        es
          ? `Datos personales que disputaste: ${gone} ya no ${gone === 1 ? "aparece" : "aparecen"}, ${still} ${still === 1 ? "sigue" : "siguen"} en tu reporte.`
          : `Personal details you disputed: ${gone} no longer ${gone === 1 ? "appears" : "appear"}, ${still} still reporting.`,
      );
    }
  }
  if (audience === "staff" && entry.skippedPersonalInfo > 0) {
    lines.push(
      es
        ? `${count(entry.skippedPersonalInfo, "dato personal repetido no se agregó", "datos personales repetidos no se agregaron")}.`
        : `${count(entry.skippedPersonalInfo, "repeat personal-info entry", "repeat personal-info entries")} skipped.`,
    );
  }
  return lines;
}
