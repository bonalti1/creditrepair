"use client";

import { useCallback, useEffect, useState } from "react";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { defaultRange, shortPage, validRange } from "@/lib/seo/search";
import { useSeo, type SearchView } from "@/lib/seo/store";
import type { SearchTotals } from "@/lib/seo/types";
import Icon from "@/components/Icon";
import { pillTab, SectionTitle } from "@/components/staff/ui";
import { FIELD, LABEL, PassChip, SampleNote, SeoGate, SeoHeader, when } from "@/components/staff/seo/ui";

// Search Console, read-only: clicks, impressions, click-through rate and
// average position per page and per query, for the dates chosen. With
// Search Console connected (the owner sets the variables in docs/SEO.md) the
// cron syncs Google's numbers every day; without it, a «Connect» card and no
// numbers at all. Only the demo shows numbers without a connection, labelled
// sample.

type Preset = "7" | "28" | "90" | "custom";

function fmt(n: number, locale: "en" | "es") {
  return n.toLocaleString(locale === "es" ? "es-US" : "en-US");
}

function Table({ rows, keyLabel, locale, page }: { rows: SearchTotals[]; keyLabel: string; locale: "en" | "es"; page?: boolean }) {
  const t = useTx();
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 12);
  return (
    <div>
      {/* Wide screens: a table. Phones: one card per row, nothing sideways. */}
      <table className="hidden w-full text-left text-[14px] md:table">
        <thead>
          <tr>
            <th scope="col" className="px-3 py-2">{keyLabel}</th>
            <th scope="col" className="px-3 py-2 text-right">{t("Clics", "Clicks")}</th>
            <th scope="col" className="px-3 py-2 text-right">{t("Impresiones", "Impressions")}</th>
            <th scope="col" className="px-3 py-2 text-right">CTR</th>
            <th scope="col" className="px-3 py-2 text-right">{t("Posición media", "Avg. position")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {shown.map((r) => (
            <tr key={r.key}>
              <td className="max-w-[420px] px-3 py-2 font-medium text-blue-900 [overflow-wrap:anywhere]">{page ? shortPage(r.key) : r.key}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt(r.clicks, locale)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt(r.impressions, locale)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.ctr === null ? "—" : `${(r.ctr * 100).toFixed(1)}%`}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.position === null ? "—" : r.position.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-slate-100 md:hidden">
        {shown.map((r) => (
          <li key={r.key} className="px-1 py-2.5">
            <p className="font-medium text-blue-900 [overflow-wrap:anywhere]">{page ? shortPage(r.key) : r.key}</p>
            <p className="mt-0.5 text-[13px] text-slate-600 tabular-nums">
              {t(`${fmt(r.clicks, locale)} clics · ${fmt(r.impressions, locale)} impresiones · posición ${r.position?.toFixed(1) ?? "—"}`, `${fmt(r.clicks, locale)} clicks · ${fmt(r.impressions, locale)} impressions · position ${r.position?.toFixed(1) ?? "—"}`)}
            </p>
          </li>
        ))}
      </ul>
      {rows.length > 12 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 inline-flex min-h-11 items-center text-[14px] font-semibold text-blue-700">
          {all ? t("Ver menos", "Show fewer") : t(`Ver las ${rows.length}`, `Show all ${rows.length}`)}
        </button>
      )}
    </div>
  );
}

function Search() {
  const t = useTx();
  const { locale } = useStaffLocale();
  const seo = useSeo();
  const [preset, setPreset] = useState<Preset>("28");
  const [range, setRange] = useState(() => defaultRange(new Date(), 28));
  const [view, setView] = useState<SearchView | null | "loading">("loading");
  const [tab, setTab] = useState<"query" | "page">("query");
  const { search } = seo;

  const load = useCallback(async (r: { from: string; to: string }) => {
    setView("loading");
    setView(await search(r));
  }, [search]);

  useEffect(() => {
    if (seo.ready) void load(range);
  }, [seo.ready, range, load]);

  const choose = (p: Preset) => {
    setPreset(p);
    if (p !== "custom") setRange(defaultRange(new Date(), Number(p)));
  };

  const connected = seo.connection.connected;
  const showNumbers = view !== "loading" && view !== null && (view.sample || view.connection.connected);

  return (
    <main className="animate-rise">
      <SeoHeader
        title="Search Console"
        lead={t("Cómo te encuentra Google: clics, impresiones y posición media por página y por búsqueda. Solo lectura: nada cambia en Google desde aquí.", "How Google finds the site: clicks, impressions and average position per page and per query. Read-only: nothing changes in Google from here.")}
      />
      <SampleNote live={seo.live}>{t("Estos números son de muestra, inventados para la demostración. Con Search Console conectado se ven los reales.", "These numbers are sample data, invented for the demo. With Search Console connected, the real ones show.")}</SampleNote>

      {seo.live && !connected && (
        <section className="card mt-5 px-4 py-5 sm:px-6" aria-labelledby="connect" data-testid="connect-card">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 id="connect" className="font-display text-[18px] font-semibold text-blue-900">{t("Conectar Search Console", "Connect Search Console")}</h2>
            <PassChip pass={false} label={t("Sin conectar", "Not connected")} />
          </div>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-slate-600">{t("Sin conexión no hay números: aquí no se inventa nada. El dueño lo conecta una vez, con una de estas dos formas, y el sistema trae los números cada día.", "Without a connection there are no numbers: nothing is made up here. The owner connects it once, one of these two ways, and the system brings the numbers every day.")}</p>
          <ol className="mt-3 max-w-2xl list-decimal space-y-2 pl-5 text-[14px] text-slate-700">
            <li>{t("Verifica el dominio en Search Console (search.google.com/search-console).", "Verify the domain in Search Console (search.google.com/search-console).")}</li>
            <li>
              {t("Cuenta de servicio (recomendado): crea una en Google Cloud, agrégala como usuario de la propiedad con permiso de lectura, y pon en el servidor", "Service account (recommended): create one in Google Cloud, add it as a user of the property with read access, and set on the server")}{" "}
              <code className="rounded bg-slate-100 px-1 text-[13px]">GOOGLE_SEARCH_CONSOLE_SITE</code>, <code className="rounded bg-slate-100 px-1 text-[13px]">GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL</code>, <code className="rounded bg-slate-100 px-1 text-[13px]">GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY</code>.
            </li>
            <li>
              {t("O con OAuth (tu propia cuenta de Google):", "Or with OAuth (your own Google account):")} <code className="rounded bg-slate-100 px-1 text-[13px]">GOOGLE_SEARCH_CONSOLE_CLIENT_ID</code>, <code className="rounded bg-slate-100 px-1 text-[13px]">GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET</code>, <code className="rounded bg-slate-100 px-1 text-[13px]">GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN</code>.
            </li>
            <li>{t("Programa el flujo 8 de n8n (POST /api/cron/seo, una vez al día). Los pasos completos están en docs/SEO.md.", "Schedule n8n Workflow 8 (POST /api/cron/seo, once a day). The full steps are in docs/SEO.md.")}</li>
          </ol>
        </section>
      )}

      {(connected || !seo.live) && (
        <>
          <div className="mt-5 flex flex-wrap items-end gap-3">
            <div className="flex flex-wrap gap-1.5" role="toolbar" aria-label={t("Fechas", "Dates")}>
              {(["7", "28", "90", "custom"] as Preset[]).map((p) => (
                <button key={p} type="button" aria-pressed={preset === p} onClick={() => choose(p)} className={pillTab(preset === p)}>
                  {p === "custom" ? t("Elegir fechas", "Pick dates") : t(`Últimos ${p} días`, `Last ${p} days`)}
                </button>
              ))}
            </div>
            {preset === "custom" && (
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className={LABEL} htmlFor="from">{t("Desde", "From")}</label>
                  <input id="from" type="date" className={`${FIELD} mt-1 h-11`} value={range.from} onChange={(e) => { const r = validRange(e.target.value, range.to); if (r) setRange(r); }} />
                </div>
                <div>
                  <label className={LABEL} htmlFor="to">{t("Hasta", "To")}</label>
                  <input id="to" type="date" className={`${FIELD} mt-1 h-11`} value={range.to} onChange={(e) => { const r = validRange(range.from, e.target.value); if (r) setRange(r); }} />
                </div>
              </div>
            )}
          </div>
          {seo.live && (
            <p className="mt-2 text-[13px] text-slate-500">
              {seo.syncError ? <span className="font-semibold text-red-700">{t(`La última sincronización falló: ${seo.syncError}`, `The last sync failed: ${seo.syncError}`)}</span> : seo.syncedAt ? t(`Sincronizado ${when(seo.syncedAt, locale)}`, `Synced ${when(seo.syncedAt, locale)}`) : t("Esperando la primera sincronización del flujo 8.", "Waiting for Workflow 8's first sync.")}
              {" · "}
              {t("Google entrega los números con unos dos días de atraso.", "Google's numbers arrive about two days late.")}
            </p>
          )}

          {view === "loading" ? (
            <div className="mt-5 h-40" aria-busy="true" />
          ) : !showNumbers || !view ? (
            <p className="card mt-5 px-4 py-5 text-[14px] text-slate-600">{t("No se pudieron leer los números ahora.", "The numbers could not be read right now.")}</p>
          ) : (
            <>
              <ul className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t("Totales", "Totals")} data-testid="search-totals">
                {[
                  [t("Clics", "Clicks"), fmt(view.total.clicks, locale)],
                  [t("Impresiones", "Impressions"), fmt(view.total.impressions, locale)],
                  ["CTR", view.total.ctr === null ? "—" : `${(view.total.ctr * 100).toFixed(1)}%`],
                  [t("Posición media", "Avg. position"), view.total.position === null ? "—" : view.total.position.toFixed(1)],
                ].map(([label, value]) => (
                  <li key={label} className="card px-4 py-3.5">
                    <p className="console-label">{label}</p>
                    <p className="mt-1 font-display text-[24px] font-semibold tabular-nums text-blue-900">{value}</p>
                    {view.sample && <p className="text-[12px] font-semibold uppercase tracking-wide text-amber-700">{t("Muestra", "Sample")}</p>}
                  </li>
                ))}
              </ul>
              <section className="card mt-4 px-3 py-4 sm:px-4" aria-labelledby="by">
                <SectionTitle
                  aside={
                    <div className="flex gap-1.5" role="tablist" aria-label={t("Agrupar por", "Group by")}>
                      <button type="button" role="tab" aria-selected={tab === "query"} onClick={() => setTab("query")} className={pillTab(tab === "query")}>
                        <Icon name="search" size={15} />
                        {t("Búsquedas", "Queries")}
                      </button>
                      <button type="button" role="tab" aria-selected={tab === "page"} onClick={() => setTab("page")} className={pillTab(tab === "page")}>
                        <Icon name="doc" size={15} />
                        {t("Páginas", "Pages")}
                      </button>
                    </div>
                  }
                >
                  <span id="by">{tab === "query" ? t("Por búsqueda", "By query") : t("Por página", "By page")}</span>
                </SectionTitle>
                {(tab === "query" ? view.byQuery : view.byPage).length === 0 ? (
                  <p className="px-1 text-[14px] text-slate-600">{t("Sin datos en esas fechas.", "No data for those dates.")}</p>
                ) : (
                  <Table rows={tab === "query" ? view.byQuery : view.byPage} keyLabel={tab === "query" ? t("Búsqueda", "Query") : t("Página", "Page")} locale={locale} page={tab === "page"} />
                )}
              </section>
              <p className="mt-3 text-[12.5px] text-slate-500">{t("Posición media: el lugar promedio en los resultados, ponderado por impresiones (1 es el primero). CTR: clics ÷ impresiones.", "Average position: the average place in the results, weighted by impressions (1 is the top). CTR: clicks ÷ impressions.")}</p>
            </>
          )}
        </>
      )}
    </main>
  );
}

export default function SearchPage() {
  return (
    <SeoGate>
      <Search />
    </SeoGate>
  );
}
