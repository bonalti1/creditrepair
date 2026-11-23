"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { useLocale } from "@/lib/i18n";
import { historySummary } from "@/lib/reports/history";
import { useClientReportHistory } from "@/lib/ux/reportHistory";

// "My reports" (Más): every report in the client's file, newest first: its
// date, where it came from, how many items and what changed since the one
// before, with "Open" and "Print" (the audit; the browser saves it as a PDF).
// Plain facts in the client's words: an item "no longer appears", never
// "deleted", and no score anywhere (docs/BRAND.md).

const COPY = {
  en: {
    back: "More",
    title: "My reports",
    lead: "Every credit report in your file, newest first, and what changed in each one.",
    from: (date: string) => `Report from ${date}`,
    byTeam: "Brought in by our team",
    byMonitoring: "Sent by your monitoring service",
    newest: "Newest",
    open: "Open",
    print: "Print",
    none: "No reports yet. Your first one arrives once your credit monitoring is connected.",
    demo: "Example: these are sample reports.",
    note: "These summaries say what each report shows. Only you decide what is inaccurate.",
  },
  es: {
    back: "Más",
    title: "Mis reportes",
    lead: "Cada reporte de crédito de tu expediente, del más nuevo al más viejo, y lo que cambió en cada uno.",
    from: (date: string) => `Reporte del ${date}`,
    byTeam: "Lo trajo nuestro equipo",
    byMonitoring: "Lo envió tu servicio de monitoreo",
    newest: "El más nuevo",
    open: "Abrir",
    print: "Imprimir",
    none: "Todavía no hay reportes. El primero llega cuando conectas tu monitoreo de crédito.",
    demo: "Ejemplo: son reportes de muestra.",
    note: "Estos resúmenes dicen lo que muestra cada reporte. Solo tú decides qué es inexacto.",
  },
} as const;

export default function MisReportesPage() {
  const { locale } = useLocale();
  const l = locale === "en" ? "en" : "es";
  const c = COPY[l];
  const { ready, entries, live } = useClientReportHistory();
  // Dates are written in the browser, after mount, so the server's day never disagrees with the visitor's.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const day = (iso: string) => new Date(iso).toLocaleDateString(l === "es" ? "es-MX" : "en-US", { day: "numeric", month: "long", year: "numeric" });

  if (!ready || !mounted) return null;
  return (
    <main className="animate-rise space-y-5" data-testid="mis-reportes">
      <Link href="/mas" className="inline-flex h-11 items-center gap-1 px-1 text-[15px] font-medium text-blue-700">
        <Icon name="chevron" size={16} className="rotate-180" />
        {c.back}
      </Link>
      <header className="px-1">
        <h1 className="font-display text-[30px] font-bold leading-tight text-blue-700">{c.title}</h1>
        <p className="mt-2 text-[16px] leading-relaxed text-slate-600">{c.lead}</p>
      </header>
      {!live && <p className="rounded-2xl bg-amber-100 px-4 py-3 text-[14px] leading-snug text-blue-900">{c.demo}</p>}
      {entries.length === 0 ? (
        <p className="card px-5 py-5 text-[16px] leading-relaxed text-slate-600">{c.none}</p>
      ) : (
        <ol className="space-y-3">
          {entries.map((entry, index) => (
            <li key={entry.id} className="card px-5 py-4" data-testid="client-report-entry">
              <p className="text-[17px] font-semibold leading-snug text-slate-900">{c.from(day(entry.reportDate))}</p>
              <p className="mt-0.5 text-[14px] text-slate-500">
                {entry.byTeam ? c.byTeam : c.byMonitoring}
                {index === 0 ? ` · ${c.newest}` : ""}
              </p>
              <ul className="mt-2 space-y-1">
                {historySummary({ ...entry, by: null, readerKey: null }, l, "client").map((line) => (
                  <li key={line} className="text-[15px] leading-snug text-slate-700">
                    {line}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <Link href={`/mas/reportes/${encodeURIComponent(entry.id)}`} className="pressable flex h-11 flex-1 items-center justify-center rounded-full bg-slate-100 text-[15px] font-semibold text-slate-900">
                  {c.open}
                </Link>
                <Link href={`/mas/reportes/${encodeURIComponent(entry.id)}?imprimir=1`} className="pressable flex h-11 flex-1 items-center justify-center rounded-full bg-slate-100 text-[15px] font-semibold text-slate-900">
                  {c.print}
                </Link>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="px-1 text-[13px] leading-relaxed text-slate-500">{c.note}</p>
    </main>
  );
}
