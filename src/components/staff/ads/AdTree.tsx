"use client";

import { useState } from "react";
import type { AdRow, CampaignRow, Metrics } from "@/lib/ads/report";
import { VERDICTS, type Verdict } from "@/lib/ads/verdict";
import { ADS_TEXT } from "@/lib/ads/text";
import { useText, useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";
import { Chip, EmptyState, pillTab, SectionTitle } from "@/components/staff/ui";
import { AdThumb, DeliveryChip, money, SourceTag, useNum, VerdictChip } from "./bits";

// Every campaign → ad set → ad, the way Ads Manager shows them, with Meta's
// numbers beside Credalti's. A verdict on each ad; the ad sets and campaigns
// carry their totals. On a laptop a table (scrolling sideways inside its own
// box, never the page); on a phone, cards.

export type VerdictFilter = Verdict | "all";

function counts(rows: readonly AdRow[]): Record<VerdictFilter, number> {
  const out = { all: rows.length } as Record<VerdictFilter, number>;
  for (const v of VERDICTS) out[v] = rows.filter((r) => r.verdict.verdict === v).length;
  return out;
}

const TD = "px-3 py-2.5 text-right tabular-nums whitespace-nowrap";

function NumberCells({ m }: { m: Metrics }) {
  const num = useNum();
  return (
    <>
      <td className={TD}>{money(m.spendCents)}</td>
      <td className={TD}>{num(m.results)}</td>
      <td className={TD}>{money(m.costPerResultCents)}</td>
      <td className={TD}>{m.ctr === null ? "—" : `${m.ctr}%`}</td>
      <td className={`${TD} bg-amber-50/60`}>{num(m.leads)}</td>
      <td className={`${TD} bg-amber-50/60`}>{num(m.signed)}</td>
      <td className={`${TD} bg-amber-50/60`}>{money(m.costPerLeadCents)}</td>
    </>
  );
}

export default function AdTree({ campaigns, ads, filter, onFilter, onOpen }: { campaigns: CampaignRow[]; ads: AdRow[]; filter: VerdictFilter; onFilter: (f: VerdictFilter) => void; onOpen: (row: AdRow) => void }) {
  const t = useTx();
  const text = useText(ADS_TEXT);
  const num = useNum();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const n = counts(ads);
  const shows = (row: AdRow) => filter === "all" || row.verdict.verdict === filter;
  const visible = campaigns
    .map((c) => ({ ...c, adsets: c.adsets.map((s) => ({ ...s, ads: s.ads.filter(shows) })).filter((s) => filter === "all" || s.ads.length > 0) }))
    .filter((c) => filter === "all" || c.adsets.length > 0);

  return (
    <section className="mt-6" aria-labelledby="tree-title" data-testid="ads-tree">
      <SectionTitle>
        <span id="tree-title">{t("Todas las campañas, conjuntos y anuncios", "Every campaign, ad set and ad")}</span>
      </SectionTitle>
      <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" role="group" aria-label={t("Filtrar por veredicto", "Filter by verdict")}>
        <div className="flex min-w-max gap-1.5">
          {(["all", ...VERDICTS] as VerdictFilter[]).map((v) => (
            <button key={v} type="button" className={pillTab(filter === v)} aria-pressed={filter === v} onClick={() => onFilter(v)} data-testid={`filter-${v}`}>
              {v === "all" ? t("Todos", "All") : text.verdict[v]}
              <span className="tabular-nums opacity-75">{n[v]}</span>
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="card mt-3">
          <EmptyState pose={filter === "turn_off" ? "thumbsUp" : "thinking"} title={filter === "turn_off" ? t("Ningún anuncio por apagar", "No ad to turn off") : t("Nada con ese veredicto", "Nothing with that verdict")}>
            {t("Cambia el filtro o las fechas.", "Change the filter or the dates.")}
          </EmptyState>
        </div>
      ) : (
        <>
          {/* Laptop: the table. */}
          <div className="card mt-3 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[980px] border-collapse text-[13.5px]">
              <thead>
                <tr className="bg-slate-50 text-[11.5px] uppercase tracking-[0.06em] text-slate-600">
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    {t("Nombre", "Name")}
                  </th>
                  <th scope="col" colSpan={4} className="border-l border-slate-200 px-3 py-2 text-center font-semibold">
                    <SourceTag source="meta" />
                  </th>
                  <th scope="col" colSpan={3} className="border-l border-slate-200 bg-amber-50/60 px-3 py-2 text-center font-semibold">
                    <SourceTag source="credalti" />
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    {t("Veredicto", "Verdict")}
                  </th>
                </tr>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11.5px] uppercase tracking-[0.06em] text-slate-600">
                  <th scope="col" className="px-3 pb-2 text-left font-semibold">
                    {t("Campaña › conjunto › anuncio", "Campaign › ad set › ad")}
                  </th>
                  <th scope="col" className="px-3 pb-2 text-right font-semibold">{t("Gasto", "Spend")}</th>
                  <th scope="col" className="px-3 pb-2 text-right font-semibold">{t("Resultados", "Results")}</th>
                  <th scope="col" className="px-3 pb-2 text-right font-semibold">{t("Por resultado", "Per result")}</th>
                  <th scope="col" className="px-3 pb-2 text-right font-semibold">CTR</th>
                  <th scope="col" className="bg-amber-50/60 px-3 pb-2 text-right font-semibold">{t("Prospectos", "Leads")}</th>
                  <th scope="col" className="bg-amber-50/60 px-3 pb-2 text-right font-semibold">{t("Firmados", "Signed")}</th>
                  <th scope="col" className="bg-amber-50/60 px-3 pb-2 text-right font-semibold">{t("Por prospecto", "Per lead")}</th>
                  <th scope="col" className="px-3 pb-2" />
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => {
                  const open = !closed.has(c.campaign.id);
                  return [
                    <tr key={c.campaign.id} className="border-b border-slate-100 bg-white font-semibold text-blue-900">
                      <th scope="row" className="px-3 py-2.5 text-left text-[13.5px] normal-case tracking-normal">
                        <button type="button" onClick={() => toggle(c.campaign.id)} aria-expanded={open} className="pressable inline-flex min-h-9 items-center gap-1.5 text-left">
                          <Icon name="chevron" size={15} className={open ? "rotate-90" : ""} />
                          <span className="[overflow-wrap:anywhere]">{c.campaign.name}</span>
                        </button>
                        <span className="ml-2 inline-flex gap-1.5 align-middle">
                          <DeliveryChip status={c.campaign.status} />
                          {!c.specialCategory && <Chip tone="bg-red-50 text-red-700">{t("Sin categoría especial", "No special category")}</Chip>}
                        </span>
                      </th>
                      <NumberCells m={c.metrics} />
                      <td />
                    </tr>,
                    ...(open
                      ? c.adsets.flatMap((s) => [
                          <tr key={s.adset.id} className="border-b border-slate-100 text-slate-700">
                            <th scope="row" className="py-2 pl-9 pr-3 text-left text-[13.5px] font-medium normal-case tracking-normal">
                              <span className="[overflow-wrap:anywhere]">{s.adset.name}</span> <span className="ml-1.5 align-middle"><DeliveryChip status={s.adset.status} /></span>
                              <span className="block text-[12px] font-normal text-slate-500">{text.resultKind[s.adset.resultKind]}</span>
                            </th>
                            <NumberCells m={s.metrics} />
                            <td />
                          </tr>,
                          ...s.ads.map((row) => (
                            <tr key={row.ad.id} className={`border-b border-slate-100 ${row.needsYou ? "bg-red-50/50" : "hover:bg-slate-50"}`} data-testid="ads-row">
                              <th scope="row" className="py-2 pl-14 pr-3 text-left text-[13.5px] font-normal normal-case tracking-normal">
                                <button type="button" onClick={() => onOpen(row)} className="pressable flex items-center gap-2.5 text-left text-blue-900 hover:underline" data-testid="ads-row-open">
                                  <AdThumb ad={row.ad} size={36} />
                                  <span className="min-w-0">
                                    <span className="block font-medium [overflow-wrap:anywhere]">{row.ad.name}</span>
                                    <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-slate-500">
                                      <DeliveryChip status={row.ad.status} />
                                      {row.needsYou && <span className="font-semibold text-red-700">{t("sigue gastando", "still spending")}</span>}
                                    </span>
                                  </span>
                                </button>
                              </th>
                              <NumberCells m={row.metrics} />
                              <td className="px-3 py-2.5">
                                <VerdictChip verdict={row.verdict.verdict} />
                              </td>
                            </tr>
                          )),
                        ])
                      : []),
                  ];
                })}
              </tbody>
            </table>
          </div>

          {/* Phone: cards. */}
          <ul className="mt-3 space-y-3 md:hidden">
            {visible.map((c) => (
              <li key={c.campaign.id} className="card px-4 py-3">
                <p className="text-[14.5px] font-semibold leading-snug text-blue-900 [overflow-wrap:anywhere]">{c.campaign.name}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-slate-500 tabular-nums">
                  <DeliveryChip status={c.campaign.status} />
                  {!c.specialCategory && <Chip tone="bg-red-50 text-red-700">{t("Sin categoría especial", "No special category")}</Chip>}
                  <span>
                    {money(c.metrics.spendCents)} · {t(`${c.metrics.leads} prospectos`, `${c.metrics.leads} leads`)}
                  </span>
                </p>
                {c.adsets.map((s) => (
                  <div key={s.adset.id} className="mt-3 border-t border-slate-100 pt-2.5">
                    <p className="text-[13px] font-medium text-slate-700 [overflow-wrap:anywhere]">{s.adset.name}</p>
                    <ul className="mt-1.5 space-y-1.5">
                      {s.ads.map((row) => (
                        <li key={row.ad.id}>
                          <button type="button" onClick={() => onOpen(row)} className={`pressable flex w-full items-center gap-3 rounded-[12px] px-2 py-2 text-left ${row.needsYou ? "bg-red-50" : "bg-slate-50"}`} data-testid="ads-card-open">
                            <AdThumb ad={row.ad} size={48} />
                            <span className="min-w-0 flex-1">
                              <span className="block text-[14px] font-medium leading-snug text-blue-900 [overflow-wrap:anywhere]">{row.ad.name}</span>
                              <span className="mt-0.5 block text-[12.5px] text-slate-600 tabular-nums">
                                {money(row.metrics.spendCents)} · {money(row.metrics.costPerResultCents)} {t("por resultado", "per result")} · {num(row.metrics.leads)} {t("prosp.", "leads")}
                              </span>
                              <span className="mt-1 flex items-center gap-1.5">
                                <VerdictChip verdict={row.verdict.verdict} />
                                {row.needsYou && <span className="text-[12px] font-semibold text-red-700">{t("sigue gastando", "still spending")}</span>}
                              </span>
                            </span>
                            <Icon name="chevron" size={16} className="shrink-0 text-slate-400" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
