import { parseReport, type RawReport } from "../domain/parser";
import type { NormalizedReport } from "../domain/types";
import { demoImportedReport, demoOnFileReport } from "../staff/data";
import { toRawReport } from "./merge";

// Where the staff Reports tab gets one report back, exactly as it was stored:
// with a database, GET /api/staff/reports (the member's own connection, so
// the read policies decide); in the demo, the browser's record of the import,
// or the invented report on file.

export interface StoredReport {
  /** As stored: what "Download" hands over. */
  raw: unknown;
  /** Read again, for the printable audit. Null when the stored JSON no longer reads. */
  report: NormalizedReport | null;
}

function read(raw: unknown): NormalizedReport | null {
  try {
    return parseReport(raw);
  } catch {
    return null;
  }
}

export async function loadStoredReport(demo: boolean, clientId: string, entryId: string): Promise<StoredReport | null> {
  if (demo) {
    let raw: RawReport | null = null;
    if (entryId === "on-file") {
      const report = demoOnFileReport(clientId);
      raw = report ? toRawReport(report) : null;
    } else if (entryId.startsWith("import-")) {
      raw = demoImportedReport(clientId, entryId.slice("import-".length));
    }
    return raw ? { raw, report: read(raw) } : null;
  }
  const res = await fetch(`/api/staff/reports?clientId=${encodeURIComponent(clientId)}&pull=${encodeURIComponent(entryId)}`, { cache: "no-store" }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { report?: { raw?: unknown } } | null;
  if (!body?.report) return null;
  return { raw: body.report.raw, report: read(body.report.raw) };
}

/** "reporte-rosa-delgado-2026-11-20.json": a file name with no spaces or accents. */
export function reportFileName(name: string, reportDate: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `report-${slug || "client"}-${reportDate.slice(0, 10)}.json`;
}

/** Hand the stored JSON to the browser as a file. */
export function downloadJson(fileName: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
