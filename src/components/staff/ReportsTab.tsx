"use client";

import { useState } from "react";
import Link from "next/link";
import { historySummary, reportHistoryOf } from "@/lib/reports/history";
import { readerLabel } from "@/lib/reports/readers";
import { downloadJson, loadStoredReport, reportFileName } from "@/lib/reports/staffSource";
import { longDay, shortDay } from "@/lib/staff/format";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import type { StaffLocale } from "@/lib/staff/i18n/locale";
import { fullName, type ReportHistoryEntry, type StaffClient } from "@/lib/staff/types";
import Icon from "@/components/Icon";
import { Chip, ROW_BUTTON } from "@/components/staff/ui";

// The client page's "Reports" tab: every report in the client's file, newest
// first, with its date, where it came from (the reader, or the monitoring pull
// by itself), how many items, what it changed, and three actions: open the
// audit, print it (the browser saves it as a PDF), and download the report as
// it was stored (JSON; staff only: the client's own page has no download).
//
// The tab exists only for members who see the case (case.view): sales sees
// none, a specialist only their assigned clients (the read policies decide
// again on the server).

function sourceLine(entry: ReportHistoryEntry, t: (es: string, en: string) => string): string {
  const reader = entry.readerKey ? readerLabel(entry.readerKey) : null;
  const provider = entry.source && entry.source !== entry.readerKey ? entry.source : null;
  if (!reader) return t(`Llegó solo, del monitoreo${provider ? ` (${provider})` : ""}`, `Came in by itself, from monitoring${provider ? ` (${provider})` : ""}`);
  return `${t("Lector", "Reader")}: ${reader}${provider ? ` · ${provider}` : ""}`;
}

export default function ReportsTab({ client, demo, locale }: { client: StaffClient; demo: boolean; locale: StaffLocale }) {
  const t = useTx();
  const entries = reportHistoryOf(client);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const download = async (entry: ReportHistoryEntry) => {
    setBusy(entry.id);
    setProblem(null);
    const stored = await loadStoredReport(demo, client.id, entry.id);
    setBusy(null);
    if (!stored) {
      setProblem(t("No se pudo leer ese reporte. Intenta de nuevo.", "That report couldn't be read. Try again."));
      return;
    }
    downloadJson(reportFileName(fullName(client), entry.reportDate), stored.raw);
  };

  if (entries.length === 0) {
    return (
      <div className="card px-5 py-6 text-[15px] leading-snug text-slate-500" data-testid="reports-tab">
        {t(
          "Todavía no hay reportes. Llegan solos cuando el cliente activa su monitoreo, o los trae el equipo con «Importar reporte».",
          "No reports yet. They come in by themselves once the client turns on monitoring, or the team brings them in with “Import report”.",
        )}
      </div>
    );
  }

  return (
    <div data-testid="reports-tab">
      <p className="mb-3 px-1 text-[14px] leading-snug text-slate-500">
        {t(
          "Cada reporte del expediente, del más nuevo al más viejo. «Imprimir» guarda la auditoría como PDF; «Descargar» entrega el reporte tal como se guardó (solo para el equipo).",
          "Every report in the file, newest first. “Print” saves the audit as a PDF; “Download” hands over the report exactly as it was stored (team only).",
        )}
      </p>
      {problem && (
        <p className="mb-3 rounded-2xl bg-red-50 px-4 py-3 text-[14px] text-red-700" role="alert">
          {problem}
        </p>
      )}
      <ol className="space-y-3">
        {entries.map((entry, index) => {
          const href = `/equipo/clientes/${client.id}/reportes/${encodeURIComponent(entry.id)}`;
          return (
            <li key={entry.id} className="card px-5 py-4" data-testid="report-entry">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="flex flex-wrap items-center gap-2 text-[16px] font-semibold text-slate-900">
                    {t(`Reporte del ${longDay(entry.reportDate, "es")}`, `Report from ${longDay(entry.reportDate, "en")}`)}
                    {index === 0 && <Chip tone="bg-blue-50 text-blue-700">{t("En archivo", "On file")}</Chip>}
                  </p>
                  <p className="mt-0.5 text-[13px] leading-snug text-slate-500">
                    {t(`Entró el ${shortDay(entry.at, "es")}`, `Came in ${shortDay(entry.at, "en")}`)} · {sourceLine(entry, t)}
                    {entry.by ? ` · ${t("importó", "imported by")} ${entry.by}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <Link href={href} className={ROW_BUTTON} data-testid="report-open">
                    <Icon name="doc" size={15} />
                    {t("Abrir", "Open")}
                  </Link>
                  <Link href={`${href}?imprimir=1`} className={ROW_BUTTON} data-testid="report-print">
                    {t("Imprimir", "Print")}
                  </Link>
                  <button type="button" onClick={() => void download(entry)} disabled={busy === entry.id} className={ROW_BUTTON} data-testid="report-download">
                    <Icon name="download" size={15} />
                    {t("Descargar", "Download")}
                  </button>
                </div>
              </div>
              <ul className="mt-2 space-y-0.5 border-t hairline pt-2">
                {historySummary(entry, locale, "staff").map((line) => (
                  <li key={line} className="text-[14px] leading-snug text-slate-700">
                    {line}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
