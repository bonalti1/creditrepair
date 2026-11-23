"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Icon from "@/components/Icon";
import ReportAudit from "@/components/reports/ReportAudit";
import type { NormalizedReport } from "@/lib/domain/types";
import { useLocale } from "@/lib/i18n";
import { loadClientReportForAudit } from "@/lib/ux/reportHistory";

// One of the client's reports as an audit they can print or save as a PDF
// ("?imprimir=1" opens the print dialog). What each item is and what the
// report says about it; nothing about what is accurate, which only the client
// decides, and no scores.

const COPY = {
  en: { back: "My reports", title: "Credit audit", from: (d: string) => `Report from ${d}`, print: "Print or save as PDF", missing: "This report couldn't be opened.", reading: "Opening your report…", note: "This audit shows where each item is and what the report says. Only you decide what is inaccurate." },
  es: { back: "Mis reportes", title: "Auditoría de crédito", from: (d: string) => `Reporte del ${d}`, print: "Imprimir o guardar PDF", missing: "No se pudo abrir este reporte.", reading: "Abriendo tu reporte…", note: "Esta auditoría muestra dónde está cada punto y lo que dice el reporte. Solo tú decides qué es inexacto." },
} as const;

export default function ClientReportAuditPage() {
  const { id } = useParams<{ id: string }>();
  const { locale } = useLocale();
  const l = locale === "en" ? "en" : "es";
  const c = COPY[l];
  const [report, setReport] = useState<NormalizedReport | null | "loading">("loading");
  const printed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void loadClientReportForAudit(decodeURIComponent(id)).then((r) => !cancelled && setReport(r));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (printed.current || report === "loading" || !report) return;
    if (new URLSearchParams(window.location.search).get("imprimir") === "1") {
      printed.current = true;
      setTimeout(() => window.print(), 300);
    }
  }, [report]);

  return (
    <main className="animate-rise space-y-5" data-testid="client-report-audit">
      <Link href="/mas/reportes" className="inline-flex h-11 items-center gap-1 px-1 text-[15px] font-medium text-blue-700 print:hidden">
        <Icon name="chevron" size={16} className="rotate-180" />
        {c.back}
      </Link>
      <header className="px-1">
        <h1 className="font-display text-[30px] font-bold leading-tight text-blue-700">{c.title}</h1>
        {report !== "loading" && report && (
          <p className="mt-1 text-[16px] text-slate-600">{c.from(new Date(report.pulledAt).toLocaleDateString(l === "es" ? "es-MX" : "en-US", { day: "numeric", month: "long", year: "numeric" }))}</p>
        )}
      </header>
      {report === "loading" ? (
        <p className="px-1 text-[15px] text-slate-500">{c.reading}</p>
      ) : !report ? (
        <p className="card px-5 py-5 text-[16px] text-slate-600">{c.missing}</p>
      ) : (
        <>
          <button type="button" onClick={() => window.print()} className="pressable flex h-12 w-full items-center justify-center rounded-full bg-amber-400 text-[16px] font-semibold text-blue-900 hover:bg-amber-500 print:hidden">
            {c.print}
          </button>
          <ReportAudit report={report} locale={l} />
        </>
      )}
      <p className="px-1 text-[13px] leading-relaxed text-slate-500">{c.note}</p>
    </main>
  );
}
