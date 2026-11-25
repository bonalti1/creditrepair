"use client";

import type { AdRow } from "@/lib/ads/report";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import { EmptyState, SectionTitle } from "@/components/staff/ui";
import { AdThumb, money, useNum, useResultLabel, VerdictChip } from "./bits";

// The winners first (ALTO's): Winner and Looking good, best first, each with
// its picture, Meta's cost per result and Credalti's cost per lead and signed
// clients. Tap one for everything about it.

export default function Winners({ rows, onOpen }: { rows: AdRow[]; onOpen: (row: AdRow) => void }) {
  const t = useTx();
  const num = useNum();
  const resultLabel = useResultLabel();
  return (
    <section className="mt-6" aria-labelledby="winners-title" data-testid="ads-winners">
      <SectionTitle>
        <span id="winners-title">{t("Ganadores", "Winners")}</span>
      </SectionTitle>
      {rows.length === 0 ? (
        <div className="card">
          <EmptyState pose="thinking" title={t("Todavía no hay ganadores en estas fechas", "No winners in these dates yet")}>
            {t("Un anuncio necesita terminar su prueba (días y resultados) antes de ser ganador. Prueba con más días.", "An ad has to finish its test (days and results) before it can be a winner. Try more days.")}
          </EmptyState>
        </div>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((row, i) => (
            <li key={row.ad.id}>
              <button
                type="button"
                onClick={() => onOpen(row)}
                className="card pressable flex w-full items-start gap-3 px-4 py-3.5 text-left hover:ring-2 hover:ring-amber-400"
                data-testid="ads-winner"
                aria-label={t(`Abrir ${row.ad.name}`, `Open ${row.ad.name}`)}
              >
                <AdThumb ad={row.ad} size={72} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[12px] text-slate-500">#{i + 1}</span>
                    <VerdictChip verdict={row.verdict.verdict} />
                  </span>
                  <span className="mt-1 block text-[14.5px] font-semibold leading-snug text-blue-900 [overflow-wrap:anywhere]">{row.ad.name}</span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-slate-500">{[row.campaign?.name, row.adset?.name].filter(Boolean).join(" › ")}</span>
                  <span className="mt-2 grid grid-cols-2 gap-2 text-[12.5px] leading-snug text-slate-600">
                    <span>
                      <span className="block font-display text-[17px] font-semibold text-blue-900 tabular-nums">{money(row.metrics.costPerResultCents)}</span>
                      {t("por resultado", "per result")} · {num(row.metrics.results)} {resultLabel(row.resultKind).toLowerCase()}
                      <span className="block text-[11px] uppercase tracking-wide text-slate-500">Meta</span>
                    </span>
                    <span>
                      <span className="block font-display text-[17px] font-semibold text-blue-900 tabular-nums">{money(row.metrics.costPerLeadCents)}</span>
                      {t("por prospecto", "per lead")} · {t(`${row.metrics.leads} prospectos, ${row.metrics.signed} firmados`, `${row.metrics.leads} leads, ${row.metrics.signed} signed`)}
                      <span className="block text-[11px] uppercase tracking-wide text-slate-500">Credalti</span>
                    </span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
