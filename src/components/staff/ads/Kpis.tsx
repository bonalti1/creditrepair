"use client";

import type { AdsReport } from "@/lib/ads/report";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import { moneyShort, SourceTag, useNum } from "./bits";

// The navy band on top (ALTO's KPI band): Meta's numbers on the left, Credalti's
// verified ones on the right, each labelled, for the chosen dates.

function Figure({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId?: string }) {
  return (
    <div className="min-w-0 bg-blue-900 px-4 py-3.5 md:px-5" data-testid={testId}>
      <p className="text-[11.5px] font-semibold uppercase leading-tight tracking-[0.08em] text-blue-200">{label}</p>
      <p className="mt-1 font-display text-[24px] font-semibold leading-tight text-white tabular-nums [overflow-wrap:anywhere]">{value}</p>
      {hint && <p className="mt-0.5 text-[12px] leading-snug text-blue-200 tabular-nums">{hint}</p>}
    </div>
  );
}

export default function Kpis({ report }: { report: AdsReport }) {
  const t = useTx();
  const num = useNum();
  const m = report.totals;
  return (
    <section className="mt-5 overflow-hidden rounded-[14px] bg-blue-900 text-white shadow-[0_6px_20px_rgba(18,33,58,0.12)]" aria-label={t("Los números de estas fechas", "The numbers for these dates")} data-testid="ads-kpis">
      <div className="grid gap-px bg-white/10 lg:grid-cols-2">
        <div className="bg-blue-900">
          <div className="flex items-center gap-2 px-4 pt-3.5 md:px-5">
            <SourceTag source="meta" onNavy />
            <span className="text-[12px] text-blue-200">{t("lo que muestra el Administrador de anuncios", "what Ads Manager shows")}</span>
          </div>
          <div className="grid grid-cols-2 gap-px sm:grid-cols-4">
            <Figure label={t("Gasto", "Spend")} value={moneyShort(m.spendCents)} testId="kpi-spend" />
            <Figure label={t("Resultados", "Results")} value={num(m.results)} hint={m.results === null ? t("Meta no informó resultados", "Meta reported no results") : undefined} />
            <Figure label={t("Costo por resultado", "Cost per result")} value={moneyShort(m.costPerResultCents)} />
            <Figure label={t("Clics al enlace", "Link clicks")} value={num(m.clicks)} hint={m.ctr === null ? undefined : `CTR ${m.ctr}%`} />
          </div>
        </div>
        <div className="bg-blue-900">
          <div className="flex items-center gap-2 px-4 pt-3.5 md:px-5">
            <SourceTag source="credalti" onNavy />
            <span className="text-[12px] text-blue-200">{t("prospectos y clientes en nuestros registros", "leads and clients in our own records")}</span>
          </div>
          <div className="grid grid-cols-2 gap-px sm:grid-cols-4">
            <Figure
              label={t("Prospectos", "Leads")}
              value={num(m.leads)}
              hint={m.metaUnknownLeads > 0 ? t(`${m.metaUnknownLeads} sin anuncio conocido`, `${m.metaUnknownLeads} with no known ad`) : undefined}
              testId="kpi-leads"
            />
            <Figure label={t("Costo por prospecto", "Cost per lead")} value={moneyShort(m.costPerLeadCents)} />
            <Figure label={t("Clientes firmados", "Signed clients")} value={num(m.signed)} />
            <Figure label={t("Costo por cliente firmado", "Cost per signed client")} value={moneyShort(m.costPerSignedCents)} testId="kpi-cost-signed" />
          </div>
        </div>
      </div>
    </section>
  );
}
