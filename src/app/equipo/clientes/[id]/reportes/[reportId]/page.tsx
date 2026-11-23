"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { historySummary, reportHistoryOf } from "@/lib/reports/history";
import { readerLabel } from "@/lib/reports/readers";
import { reappearedItems } from "@/lib/reports/reimport";
import { downloadJson, loadStoredReport, reportFileName, type StoredReport } from "@/lib/reports/staffSource";
import { longDay } from "@/lib/staff/format";
import { deniedReason } from "@/lib/staff/permissions";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import { fullName } from "@/lib/staff/types";
import { useStaff } from "@/lib/staff/useStaff";
import Icon from "@/components/Icon";
import ReportAudit from "@/components/reports/ReportAudit";
import { NoAccess, PRIMARY_BUTTON_COMPACT, SECONDARY_BUTTON_COMPACT } from "@/components/staff/ui";

// One report from the client's Reports tab: the audit of that report, ready to
// print (the browser's "Save as PDF"), and the report as it was stored, to
// download. "?imprimir=1" opens the print dialog as soon as it is drawn.
// Case view only (administrators; specialists for their assigned clients).

export default function StaffReportPage() {
  const { id, reportId } = useParams<{ id: string; reportId: string }>();
  const entryId = decodeURIComponent(reportId);
  const { data, ready, clients, can, locale } = useStaff();
  const t = useTx();
  const client = clients.find((c) => c.id === id) ?? null;
  const [stored, setStored] = useState<StoredReport | null | "loading">("loading");
  const printed = useRef(false);

  useEffect(() => {
    if (!ready || !client || !can("case.view")) return;
    let cancelled = false;
    void loadStoredReport(data.demo, client.id, entryId).then((s) => {
      if (!cancelled) setStored(s);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, client?.id, entryId, data.demo]);

  useEffect(() => {
    if (printed.current || stored === "loading" || !stored?.report) return;
    if (new URLSearchParams(window.location.search).get("imprimir") === "1") {
      printed.current = true;
      setTimeout(() => window.print(), 300);
    }
  }, [stored]);

  if (!ready) return null;
  if (!can("case.view")) return <NoAccess title={t("Reportes", "Reports")} reason={deniedReason("case.view", locale)} />;
  if (!client) {
    return (
      <main className="animate-rise">
        <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">{t("No encontramos a este cliente", "We couldn't find this client")}</h1>
        <Link href="/equipo/clientes" className="mt-4 inline-block text-[15px] font-medium text-blue-700">
          {t("Volver a clientes", "Back to clients")}
        </Link>
      </main>
    );
  }

  const entry = reportHistoryOf(client).find((e) => e.id === entryId) ?? null;
  const report = stored !== "loading" && stored ? stored.report : null;
  const back = `/equipo/clientes/${client.id}?pestana=reportes`;

  return (
    <main className="animate-rise mx-auto max-w-3xl" data-testid="staff-report-page">
      <Link href={back} className="inline-flex min-h-11 items-center gap-1 text-[14px] font-medium text-blue-700 print:hidden">
        <Icon name="chevron" size={16} className="rotate-180" />
        {t(`Reportes de ${client.firstName}`, `${client.firstName}'s reports`)}
      </Link>
      <header className="mt-2">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{t("Auditoría de crédito", "Credit audit")}</p>
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-slate-900">{fullName(client)}</h1>
        {entry && (
          <p className="mt-1 text-[15px] text-slate-600">
            {t(`Reporte del ${longDay(entry.reportDate, "es")}`, `Report from ${longDay(entry.reportDate, "en")}`)}
            {entry.readerKey ? ` · ${readerLabel(entry.readerKey)}` : entry.source ? ` · ${entry.source}` : ""}
          </p>
        )}
      </header>

      <div className="mt-4 flex flex-wrap gap-2 print:hidden">
        <button type="button" onClick={() => window.print()} disabled={!report} className={PRIMARY_BUTTON_COMPACT} data-testid="report-print-now">
          {t("Imprimir o guardar PDF", "Print or save as PDF")}
        </button>
        <button
          type="button"
          onClick={() => stored && stored !== "loading" && downloadJson(reportFileName(fullName(client), entry?.reportDate ?? new Date().toISOString()), stored.raw)}
          disabled={!stored || stored === "loading"}
          className={SECONDARY_BUTTON_COMPACT}
        >
          {t("Descargar JSON", "Download JSON")}
        </button>
      </div>

      {entry && (
        <ul className="mt-4 space-y-0.5 rounded-2xl bg-slate-50 px-4 py-3 text-[14px] leading-snug text-slate-700">
          {historySummary(entry, locale, "staff").map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      <div className="mt-5">
        {stored === "loading" ? (
          <p className="text-[15px] text-slate-500">{t("Leyendo el reporte…", "Reading the report…")}</p>
        ) : !report ? (
          <p className="card px-5 py-6 text-[15px] leading-snug text-slate-500">{t("No se pudo leer este reporte.", "This report couldn't be read.")}</p>
        ) : (
          <ReportAudit report={report} locale={locale} reappeared={new Set(reappearedItems(client.rounds, report).map((r) => r.item.fingerprint))} />
        )}
      </div>
      <p className="mt-6 text-xs leading-relaxed text-slate-500">
        {t(
          "Una lectura del reporte para ubicar cada punto. No dice qué es inexacto: eso lo decide solo el cliente.",
          "A reading of the report to find each item. It doesn't say what's inaccurate: only the client decides that.",
        )}
      </p>
    </main>
  );
}
