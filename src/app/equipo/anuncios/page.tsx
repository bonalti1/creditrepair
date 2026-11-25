"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAccounting } from "@/lib/accounting/data";
import { monthOf, monthsEnding } from "@/lib/accounting/periods";
import { adSpendChecks } from "@/lib/ads/books";
import { fetchAdBriefs, useAds, type AdsSelection } from "@/lib/ads/data";
import { buildReport, type AdRow } from "@/lib/ads/report";
import { ADS_TEXT } from "@/lib/ads/text";
import type { AdBrief } from "@/lib/ads/types";
import { VERDICTS } from "@/lib/ads/verdict";
import { dayInZone, isDayKey, isPreset } from "@/lib/ads/window";
import { shortDateTime } from "@/lib/staff/format";
import { useStaffLocale, useText, useTx } from "@/lib/staff/i18n/StaffLocale";
import { can, deniedReason } from "@/lib/staff/permissions";
import { useViewer } from "@/lib/staff/useStaff";
import Icon from "@/components/Icon";
import SafeBoundary from "@/components/staff/control/SafeBoundary";
import { Chip, EmptyState, NoAccess, pillTab, ROW_BUTTON } from "@/components/staff/ui";
import AdDrawer from "@/components/staff/ads/AdDrawer";
import AdTree, { type VerdictFilter } from "@/components/staff/ads/AdTree";
import { money } from "@/components/staff/ads/bits";
import CopyStudio, { type CopyExample } from "@/components/staff/ads/CopyStudio";
import Kpis from "@/components/staff/ads/Kpis";
import { NextPanel, RulesCard } from "@/components/staff/ads/NextPanel";
import Platforms from "@/components/staff/ads/Platforms";
import { MoneyRuleNote, SpendTable } from "@/components/staff/ads/SpendBooks";
import Winners from "@/components/staff/ads/Winners";
import WindowPicker from "@/components/staff/ads/WindowPicker";

// The Ads Manager (docs/ADS.md): Meta ads, READ ONLY, joined to Credalti's own
// leads and signed clients. Four views:
//
//   Results    the numbers for 7, 14, 30 or 90 days (or custom dates), Meta's
//              beside Credalti's; the winners; every campaign → ad set → ad
//              with a verdict from rules written on the screen; what to make
//              next; one ad's drawer (creative, numbers, leads, what to do).
//   Ad copy    Alti's drafts (AI), checked, sent to Content or Video Studio.
//   Books      Meta's spend per month beside the books (a suggestion).
//   Platforms  Meta, Google Ads and TikTok Ads: what is connected.
//
// The numbers are administrators' (ads.view: spend is money, sales never sees
// it). The content team (ads.draft) opens the page on Ad copy. In the demo
// every number is SAMPLE data, and says so.

const VIEWS = ["results", "copy", "books", "platforms"] as const;
type View = (typeof VIEWS)[number];
const VIEW_PARAM: Record<View, string> = { results: "resultados", copy: "textos", books: "libros", platforms: "plataformas" };

function selectionOf(params: URLSearchParams): AdsSelection {
  const dias = params.get("dias");
  if (dias === "custom" && isDayKey(params.get("desde")) && isDayKey(params.get("hasta"))) return { preset: "custom", since: params.get("desde")!, until: params.get("hasta")! };
  return { preset: isPreset(dias) ? (Number(dias) as 7 | 14 | 30 | 90) : 7 };
}

function BooksTab({ monthly, sample }: { monthly: Array<{ month: string; spendCents: number }>; sample: boolean }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const acc = useAccounting();
  const months = monthsEnding(monthOf(new Date()), 6);
  const checks = adSpendChecks(new Map(monthly.map((m) => [m.month, m.spendCents])), acc.book.expenses, months);
  if (!acc.allowed) return <p className="card px-5 py-4 text-[14px] text-slate-600">{deniedReason("accounting", locale)}</p>;
  return (
    <section className="card max-w-3xl px-5 py-4" aria-labelledby="books-title" data-testid="ads-books">
      <h2 id="books-title" className="font-display text-[15px] font-semibold uppercase tracking-[0.06em] text-blue-900">
        {t("El gasto en anuncios y los libros", "Ad spend and the books")}
      </h2>
      <p className="mt-1 text-[13.5px] leading-snug text-slate-600">
        {t("Mes por mes, lo que Meta dice que se gastó junto a lo que los libros tienen en «Publicidad: Meta».", "Month by month, Meta's spend beside what the books hold under “Advertising: Meta”.")}
        {sample && ` ${t("El gasto de Meta es de muestra; los libros son los de la demo.", "Meta's spend is sample; the books are the demo's.")}`}
      </p>
      {!acc.ready ? <div className="h-24" aria-busy="true" /> : <SpendTable checks={checks} accounting />}
      <MoneyRuleNote />
    </section>
  );
}

function Ads() {
  const t = useTx();
  const { locale } = useStaffLocale();
  const text = useText(ADS_TEXT);
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const { viewer, ready } = useViewer();
  const role = viewer?.role ?? null;
  const seesNumbers = can(role, "ads.view");
  const drafts = can(role, "ads.draft");
  const selection = useMemo(() => selectionOf(new URLSearchParams(params.toString())), [params]);
  const ads = useAds(viewer, selection);
  const [open, setOpen] = useState<AdRow | null>(null);
  const [example, setExample] = useState<CopyExample | null>(null);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [briefs, setBriefs] = useState<AdBrief[]>([]);

  const rawView = Object.entries(VIEW_PARAM).find(([, v]) => v === params.get("vista"))?.[0] as View | undefined;
  const views = VIEWS.filter((v) => (v === "copy" ? drafts : seesNumbers));
  const view: View = rawView && views.includes(rawView) ? rawView : (views[0] ?? "copy");
  const rawFilter = params.get("filtro");
  const filter: VerdictFilter = (VERDICTS as readonly string[]).includes(rawFilter ?? "") ? (rawFilter as VerdictFilter) : "all";

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${path}?${next.toString()}`, { scroll: false });
  };

  const payload = ads.payload;
  const report = useMemo(() => (payload ? buildReport(payload.snapshot, payload.leads, payload.window) : null), [payload]);
  const examples: CopyExample[] = useMemo(
    () => (report?.winners ?? []).map((r) => ({ adId: r.ad.id, name: r.ad.name, headline: r.ad.creative.title ?? r.ad.name, body: r.ad.creative.body ?? "" })),
    [report],
  );

  const closeDrawer = useCallback(() => setOpen(null), []);

  // The content team, who may not read the numbers, still sees the briefs they sent.
  useEffect(() => {
    if (!ready || seesNumbers) return;
    void fetchAdBriefs(viewer).then(setBriefs);
  }, [ready, seesNumbers, viewer]);

  if (!ready) return null;
  if (!drafts && !seesNumbers) return <NoAccess title={t("Anuncios", "Ads")} reason={deniedReason("ads.draft", locale)} />;

  const timeZone = payload?.snapshot.account?.timeZone ?? "America/Chicago";
  const today = dayInZone(new Date(), timeZone);
  const account = payload?.snapshot.account ?? null;

  const draftFrom = (row: AdRow) => {
    setOpen(null);
    setExample({ adId: row.ad.id, name: row.ad.name, headline: row.ad.creative.title ?? row.ad.name, body: row.ad.creative.body ?? "" });
    go({ vista: VIEW_PARAM.copy });
  };

  const syncNow = async () => {
    setSyncing(true);
    const out = await ads.sync();
    setSyncing(false);
    setSyncNote(out.ok ? t(`Listo: ${out.value.rows} filas leídas de Meta.`, `Done: ${out.value.rows} rows read from Meta.`) : out.message[locale]);
  };

  return (
    <main className="animate-rise min-w-0" data-testid="ads-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title">{t("Anuncios", "Ads")}</h1>
          <p className="mt-1 max-w-3xl text-[15px] leading-relaxed text-slate-500">
            {t(
              "Los anuncios de Meta, solo lectura, junto a los prospectos y clientes que de verdad trajeron. Nada aquí cambia Meta.",
              "Meta ads, read only, beside the leads and clients they really brought. Nothing here changes Meta.",
            )}
          </p>
        </div>
        {seesNumbers && payload && (
          <div className="flex flex-wrap items-center gap-2" data-testid="ads-sync">
            {payload.sample ? (
              <Chip tone="bg-amber-100 text-blue-900">{t("Datos de muestra", "Sample data")}</Chip>
            ) : payload.snapshot.syncedAt ? (
              <span className="text-[13px] text-slate-500">{t(`Leído de Meta: ${shortDateTime(payload.snapshot.syncedAt, locale)}`, `Read from Meta: ${shortDateTime(payload.snapshot.syncedAt, locale)}`)}</span>
            ) : null}
            {!payload.sample && payload.meta.configured && (
              <button type="button" onClick={syncNow} disabled={syncing} className={`${ROW_BUTTON} gap-1.5`} data-testid="sync-now">
                <Icon name="download" size={16} />
                {syncing ? t("Leyendo…", "Reading…") : t("Leer ahora", "Sync now")}
              </button>
            )}
          </div>
        )}
      </div>
      {syncNote && (
        <p className="mt-2 rounded-[10px] bg-blue-50 px-3 py-2 text-[13.5px] text-blue-900" role="status">
          {syncNote}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5" role="tablist" aria-label={t("Vista", "View")}>
        {views.map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className={pillTab(view === v)} onClick={() => go({ vista: VIEW_PARAM[v] })} data-testid={`view-${v}`}>
            {v === "results" ? t("Resultados", "Results") : v === "copy" ? t("Textos con Alti", "Ad copy") : v === "books" ? t("Gasto y libros", "Spend & books") : t("Plataformas", "Platforms")}
          </button>
        ))}
      </div>

      {!seesNumbers && (
        <p className="mt-4 flex items-start gap-2 text-[13px] leading-snug text-slate-500" data-testid="numbers-denied">
          <span aria-hidden="true" className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
          {deniedReason("ads.view", locale)}
        </p>
      )}

      <div className="mt-5">
        {view === "copy" && (
          <SafeBoundary>
            <CopyStudio ads={ads} examples={examples} initialExample={example} briefs={seesNumbers ? (payload?.briefs ?? []) : briefs} />
          </SafeBoundary>
        )}

        {view === "platforms" && <Platforms payload={payload} />}

        {view === "books" && payload && <BooksTab monthly={payload.monthly} sample={payload.sample} />}

        {view === "results" &&
          (ads.error ? (
            <p className="card px-5 py-4 text-[14px] text-red-700" role="alert">
              {ads.error[locale]}
            </p>
          ) : !payload || !report ? (
            <div className="h-40" aria-busy="true" />
          ) : !account ? (
            <div className="card">
              <EmptyState pose="phone" title={payload.meta.configured ? t("Meta todavía no se ha leído", "Meta has not been read yet") : t("Meta todavía no está conectada", "Meta is not connected yet")}>
                {payload.meta.configured
                  ? t("La lectura automática corre cada pocas horas; también puedes tocar «Leer ahora».", "The automatic read runs every few hours; you can also tap “Sync now”.")
                  : t("Cuando el servidor tenga el token de Meta, aquí aparecen el gasto y los resultados de cada anuncio.", "Once the server has the Meta token, each ad's spend and results show here.")}{" "}
                <button type="button" onClick={() => go({ vista: VIEW_PARAM.platforms })} className="font-semibold text-blue-700 underline-offset-2 hover:underline">
                  {t("Ver qué falta", "See what is missing")}
                </button>
                {payload.snapshot.lastRun && !payload.snapshot.lastRun.ok && <span className="mt-2 block text-red-700">{t(`La última lectura falló: ${payload.snapshot.lastRun.error ?? ""}`, `The last read failed: ${payload.snapshot.lastRun.error ?? ""}`)}</span>}
              </EmptyState>
            </div>
          ) : (
            <SafeBoundary>
              <WindowPicker
                today={today}
                value={selection}
                onChange={(next) => go(next.preset === "custom" ? { dias: "custom", desde: next.since ?? null, hasta: next.until ?? null } : { dias: String(next.preset), desde: null, hasta: null })}
              />
              <p className="mt-2 text-[12.5px] text-slate-500 tabular-nums">
                {t(`Del ${payload.window.since} al ${payload.window.until} · días de la cuenta (${timeZone})`, `${payload.window.since} to ${payload.window.until} · the ad account's days (${timeZone})`)}
                {account.status !== "active" && <span className="ml-2 font-semibold text-red-700">{text.accountStatus[account.status]}</span>}
              </p>

              {report.needsYou.length > 0 && (
                <section className="mt-4 rounded-[14px] border border-red-200 bg-red-50 px-4 py-3" aria-labelledby="needs-title" data-testid="ads-needs-you">
                  <h2 id="needs-title" className="flex items-center gap-2 text-[14.5px] font-semibold text-red-800">
                    <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-red-600 px-1.5 text-[12px] text-white tabular-nums">{report.needsYou.length}</span>
                    {t(
                      report.needsYou.length === 1 ? "Un anuncio marcado «Apagar» sigue gastando" : `${report.needsYou.length} anuncios marcados «Apagar» siguen gastando`,
                      report.needsYou.length === 1 ? "One ad marked “Turn off” is still spending" : `${report.needsYou.length} ads marked “Turn off” are still spending`,
                    )}
                  </h2>
                  <ul className="mt-2 space-y-1.5">
                    {report.needsYou.map((row) => (
                      <li key={row.ad.id}>
                        <button type="button" onClick={() => setOpen(row)} className="pressable flex min-h-11 w-full items-center justify-between gap-3 rounded-[10px] bg-white px-3 py-2 text-left text-[14px] hover:ring-2 hover:ring-red-300">
                          <span className="min-w-0 font-medium text-slate-900 [overflow-wrap:anywhere]">{row.ad.name}</span>
                          <span className="shrink-0 text-[13px] text-slate-600 tabular-nums">
                            {money(row.metrics.costPerResultCents)} {t("por resultado", "per result")}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[12.5px] leading-snug text-red-800">{t("Apágalos en el Administrador de anuncios de Meta. Aquí nada cambia Meta.", "Turn them off in Meta Ads Manager. Nothing here changes Meta.")}</p>
                </section>
              )}

              {report.missingCategory.length > 0 && (
                <section className="mt-4 rounded-[14px] border border-red-200 bg-white px-4 py-3" data-testid="ads-category-warning">
                  <p className="text-[14px] font-semibold text-red-800">
                    {t("Campañas encendidas sin la Categoría Especial de crédito:", "Campaigns on without the credit Special Ad Category:")} {report.missingCategory.map((c) => c.name).join(", ")}
                  </p>
                  <p className="mt-1 text-[13px] leading-snug text-slate-700">
                    {t(
                      "Un anuncio de servicios de crédito debe declarar en Meta la Categoría Especial (productos y servicios financieros). Agrégala en la campaña, en el Administrador de anuncios.",
                      "A credit services ad must declare Meta's Special Ad Category (financial products and services). Add it on the campaign, in Ads Manager.",
                    )}
                  </p>
                </section>
              )}

              <Kpis report={report} />
              {payload.sample && <p className="mt-2 px-1 text-[12.5px] text-slate-500">{t("Demo: todos estos números son de muestra (una cuenta de anuncios inventada y prospectos inventados).", "Demo: every number here is sample data (a made-up ad account and made-up leads).")}</p>}

              <Winners rows={report.winners} onOpen={setOpen} />

              <AdTree campaigns={report.campaigns} ads={report.ads} filter={filter} onFilter={(f) => go({ filtro: f === "all" ? null : f })} onOpen={setOpen} />

              <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
                <NextPanel next={report.next} onDraft={drafts ? () => go({ vista: VIEW_PARAM.copy }) : null} />
                <RulesCard />
              </div>

              <p className="mt-4 px-1 text-xs leading-relaxed text-slate-500">
                {t(
                  "Gasto, impresiones, clics y resultados: lo que Meta informa, en los días de la cuenta de anuncios. Prospectos y clientes firmados: los de nuestros registros, acreditados al anuncio por su primer contacto (la etiqueta del enlace, el anuncio de clic a WhatsApp o el formulario) y contados el día en que llegaron. Un cliente firmado firmó el acuerdo de servicio. Sin nada detrás, el número dice «—», nunca cero.",
                  "Spend, impressions, clicks and results: what Meta reports, on the ad account's days. Leads and signed clients: our own records, credited to the ad by their first touch (the link's tag, the click-to-WhatsApp ad or the form) and counted on the day they arrived. A signed client signed the service agreement. With nothing behind it, a number reads “—”, never zero.",
                )}{" "}
                <Link href="/equipo/leads" className="font-medium text-blue-700 hover:underline">
                  {t("Ver los prospectos", "See the leads")}
                </Link>
              </p>
            </SafeBoundary>
          ))}
      </div>

      {open && payload && (
        <AdDrawer
          row={open}
          snapshot={payload.snapshot}
          leads={report?.leadsByAd.get(open.ad.id) ?? []}
          sample={payload.sample}
          accountId={account?.id ?? null}
          onClose={closeDrawer}
          onDraft={drafts ? draftFrom : null}
          loadVideo={ads.video}
        />
      )}
    </main>
  );
}

export default function AdsPage() {
  return (
    <Suspense fallback={null}>
      <Ads />
    </Suspense>
  );
}
