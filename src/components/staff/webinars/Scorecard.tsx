"use client";

import { useState } from "react";
import { addDays, dayInZone } from "@/lib/ads/window";
import { useStaffLocale, useText, useTx } from "@/lib/staff/i18n/StaffLocale";
import type { WebinarsData } from "@/lib/webinars/data";
import { MIN_SIGNED_FOR_CAC, type CacFigure, type Scorecard } from "@/lib/webinars/scorecard";
import { WEBINARS_TEXT } from "@/lib/webinars/text";
import { TEXAS_TZ } from "@/lib/webinars/time";
import { COST_KINDS, PURCHASE_KINDS, SERVICE_OPTIONS, type Campaign, type CostKind, type PurchaseKind } from "@/lib/webinars/types";
import type { CampaignsView } from "@/lib/webinars/views";
import { GOLD_ROW_BUTTON, PRIMARY_BUTTON, QUIET_BUTTON, ROW_BUTTON, SECONDARY_BUTTON } from "@/components/staff/ui";
import { FIELD, Figure, Labeled, money } from "./bits";

// The campaign scorecard (docs/WEBINARS.md, «The scorecard and its formulas»):
// per campaign, the funnel, CAC two ways with the formula on screen, each
// signed client's value (money actually collected, IdentityIQ commissions,
// later purchases, DIY → Complete upgrades), split by package. A client is a
// first name and an initial; nothing of their credit is here.

const ratio = (v: number | null) => (v === null ? null : `${v.toFixed(1)}×`);

function CacCard({ title, figure, formula, testId }: { title: string; figure: CacFigure; formula: string; testId: string }) {
  const t = useTx();
  const text = useText(WEBINARS_TEXT);
  return (
    <div className="min-w-0 rounded-[12px] border border-slate-200 px-4 py-3" data-testid={testId}>
      <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-slate-500">{title}</p>
      {figure.state === "ok" ? (
        <p className="mt-0.5 font-display text-[28px] font-semibold tabular-nums text-blue-900">{money(figure.cents)}</p>
      ) : (
        <p className="mt-1.5 text-[15px] font-semibold text-slate-600" data-testid={`${testId}-state`}>
          {text.cacState[figure.state]}
        </p>
      )}
      <p className="mt-1 text-[12.5px] leading-snug text-slate-600">
        <span className="font-semibold">{t("Fórmula:", "Formula:")}</span> {formula}
      </p>
      <p className="mt-0.5 text-[12.5px] tabular-nums text-slate-500">
        {money(figure.costCents)} ÷ {figure.signed} {t("firmados", "signed")}
        {figure.state === "not_enough" && ` · ${t(`se necesitan al menos ${MIN_SIGNED_FOR_CAC}`, `at least ${MIN_SIGNED_FOR_CAC} needed`)}`}
      </p>
    </div>
  );
}

function CampaignForm({ view, campaign, data, onDone }: { view: CampaignsView; campaign: Campaign | null; data: WebinarsData; onDone: () => void }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const today = dayInZone(new Date(), TEXAS_TZ);
  const [form, setForm] = useState({
    name: campaign?.name ?? "",
    startDay: campaign?.startDay ?? today,
    endDay: campaign?.endDay ?? addDays(today, 30),
    budget: campaign?.budgetCents === null || campaign?.budgetCents === undefined ? "" : String(campaign.budgetCents / 100),
    metaCampaignIds: campaign?.metaCampaignIds ?? [],
    webinarIds: campaign?.webinarIds ?? [],
    keywords: (campaign?.keywords ?? ["CREDIT"]).join(", "),
    organicSources: (campaign?.organicSources ?? ["instagram", "tiktok", "youtube"]).join(", "),
    note: campaign?.note ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const toggle = (key: "metaCampaignIds" | "webinarIds", id: string) => setForm((f) => ({ ...f, [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] }));
  const list = (v: string, upper: boolean) => v.split(/[,\s]+/).map((s) => (upper ? s.toUpperCase() : s.toLowerCase()).replace(/[^A-Za-z0-9_.-]/g, "")).filter((s) => s.length >= 2).slice(0, 20);
  return (
    <form
      className="card space-y-3 px-5 py-5"
      data-testid="campaign-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const budget = form.budget.trim() === "" ? null : Math.round(Number(form.budget) * 100);
        const out = await data.saveCampaign({
          id: campaign?.id ?? null,
          name: form.name.trim(),
          startDay: form.startDay,
          endDay: form.endDay,
          budgetCents: budget !== null && Number.isFinite(budget) ? budget : null,
          metaCampaignIds: form.metaCampaignIds,
          webinarIds: form.webinarIds,
          keywords: list(form.keywords, true),
          organicSources: list(form.organicSources, false),
          note: form.note.trim() || null,
        });
        if (!out.ok) setError(out.message[locale]);
        else onDone();
      }}
    >
      <h3 className="font-display text-[16px] font-semibold text-blue-900">{campaign ? t("Cambiar la campaña", "Change the campaign") : t("Nueva campaña", "New campaign")}</h3>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-4">
        <Labeled label={t("Nombre", "Name")} className="md:col-span-2">
          <input className={FIELD} value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Webinar test #1" data-testid="campaign-name" />
        </Labeled>
        <Labeled label={t("Desde", "From")}>
          <input type="date" className={FIELD} value={form.startDay} onChange={(e) => setForm({ ...form, startDay: e.target.value })} />
        </Labeled>
        <Labeled label={t("Hasta", "To")}>
          <input type="date" className={FIELD} value={form.endDay} onChange={(e) => setForm({ ...form, endDay: e.target.value })} />
        </Labeled>
        <Labeled label={t("Presupuesto total (USD)", "Total budget (USD)")}>
          <input inputMode="decimal" className={FIELD} value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="1000" />
        </Labeled>
        <Labeled label={t("Palabras clave", "Keywords")}>
          <input className={FIELD} value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} />
        </Labeled>
        <Labeled label={t("Fuentes orgánicas (utm_source)", "Organic sources (utm_source)")} className="md:col-span-2">
          <input className={FIELD} value={form.organicSources} onChange={(e) => setForm({ ...form, organicSources: e.target.value })} />
        </Labeled>
      </div>
      <fieldset>
        <legend className="mb-1 text-[13px] font-semibold text-slate-700">{t("Campañas de Meta (del Administrador de anuncios)", "Meta campaigns (from the Ads Manager)")}</legend>
        {view.metaCampaigns.length === 0 ? (
          <p className="text-[13px] text-slate-500">{t("Meta todavía no se ha leído: conéctala en Anuncios.", "Meta has not been read yet: connect it in Ads.")}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {view.metaCampaigns.map((c) => (
              <label key={c.id} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-300 bg-white px-3 text-[13.5px] md:min-h-9">
                <input type="checkbox" checked={form.metaCampaignIds.includes(c.id)} onChange={() => toggle("metaCampaignIds", c.id)} className="h-4 w-4 accent-blue-700" />
                <span className="[overflow-wrap:anywhere]">{c.name}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-[13px] font-semibold text-slate-700">{t("Webinars", "Webinars")}</legend>
        <div className="flex flex-wrap gap-1.5">
          {view.webinars.map((w) => (
            <label key={w.id} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-300 bg-white px-3 text-[13.5px] md:min-h-9">
              <input type="checkbox" checked={form.webinarIds.includes(w.id)} onChange={() => toggle("webinarIds", w.id)} className="h-4 w-4 accent-blue-700" />
              <span className="[overflow-wrap:anywhere]">{w.title}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && <p className="rounded-[10px] bg-red-50 px-3 py-2 text-[13.5px] text-red-800" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY_BUTTON} disabled={form.name.trim().length < 2} data-testid="save-campaign">
          {t("Guardar", "Save")}
        </button>
        <button type="button" className={SECONDARY_BUTTON} onClick={onDone}>
          {t("Cancelar", "Cancel")}
        </button>
      </div>
    </form>
  );
}

function CostForm({ campaignId, data, onDone }: { campaignId: string; data: WebinarsData; onDone: () => void }) {
  const t = useTx();
  const text = useText(WEBINARS_TEXT);
  const { locale } = useStaffLocale();
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<CostKind>("tools");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(dayInZone(new Date(), TEXAS_TZ));
  const [error, setError] = useState<string | null>(null);
  const cents = Math.round(Number(amount) * 100);
  return (
    <form
      className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[2fr_1.3fr_1fr_1.2fr_auto] sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        const out = await data.addCost({ campaignId, label: label.trim(), kind, amountCents: cents, day });
        if (!out.ok) setError(out.message[locale]);
        else {
          setLabel("");
          setAmount("");
          onDone();
        }
      }}
    >
      <Labeled label={t("Qué", "What")}>
        <input className={FIELD} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder="Zoom Webinars" />
      </Labeled>
      <Labeled label={t("Tipo", "Kind")}>
        <select className={FIELD} value={kind} onChange={(e) => setKind(e.target.value as CostKind)}>
          {COST_KINDS.map((k) => (
            <option key={k} value={k}>
              {text.costKind[k]}
            </option>
          ))}
        </select>
      </Labeled>
      <Labeled label="USD">
        <input inputMode="decimal" className={FIELD} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
      </Labeled>
      <Labeled label={t("Día", "Day")}>
        <input type="date" className={FIELD} value={day} onChange={(e) => setDay(e.target.value)} />
      </Labeled>
      <button type="submit" className={GOLD_ROW_BUTTON} disabled={label.trim().length < 2 || !(cents > 0)} data-testid="add-cost">
        {t("Agregar costo", "Add cost")}
      </button>
      {error && <p className="text-[13px] text-red-700 sm:col-span-5" role="alert">{error}</p>}
    </form>
  );
}

function PurchaseForm({ card, data, onDone }: { card: Scorecard; data: WebinarsData; onDone: () => void }) {
  const t = useTx();
  const text = useText(WEBINARS_TEXT);
  const { locale } = useStaffLocale();
  const [clientId, setClientId] = useState(card.value.clients[0]?.clientId ?? "");
  const [kind, setKind] = useState<PurchaseKind>("household_addon");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (card.value.clients.length === 0) return null;
  return (
    <form
      className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[1.3fr_1.5fr_1fr_2fr_auto] sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        const cents = amount.trim() === "" ? null : Math.round(Number(amount) * 100);
        const out = await data.addPurchase({ clientId, kind, amountCents: cents !== null && Number.isFinite(cents) ? cents : null, day: dayInZone(new Date(), TEXAS_TZ), note: note.trim() || null });
        if (!out.ok) setError(out.message[locale]);
        else {
          setAmount("");
          setNote("");
          onDone();
        }
      }}
    >
      <Labeled label={t("Cliente", "Client")}>
        <select className={FIELD} value={clientId} onChange={(e) => setClientId(e.target.value)}>
          {card.value.clients.map((c) => (
            <option key={c.clientId} value={c.clientId}>
              {c.name}
            </option>
          ))}
        </select>
      </Labeled>
      <Labeled label={t("Qué compró", "What they bought")}>
        <select className={FIELD} value={kind} onChange={(e) => setKind(e.target.value as PurchaseKind)}>
          {PURCHASE_KINDS.map((k) => (
            <option key={k} value={k}>
              {text.purchaseKind[k]}
            </option>
          ))}
        </select>
      </Labeled>
      <Labeled label={t("USD (si trajo dinero)", "USD (if it brought money)")}>
        <input inputMode="decimal" className={FIELD} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
      </Labeled>
      <Labeled label={t("Nota", "Note")}>
        <input className={FIELD} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      </Labeled>
      <button type="submit" className={ROW_BUTTON} disabled={!clientId} data-testid="add-purchase">
        {t("Marcar", "Mark it")}
      </button>
      {error && <p className="text-[13px] text-red-700 sm:col-span-5" role="alert">{error}</p>}
    </form>
  );
}

function CampaignCard({ card, view, data, onChanged, manage }: { card: Scorecard; view: CampaignsView; data: WebinarsData; onChanged: () => void; manage: boolean }) {
  const t = useTx();
  const text = useText(WEBINARS_TEXT);
  const [editing, setEditing] = useState(false);
  const f = card.funnel;
  const costs = view.costs.filter((c) => c.campaignId === card.campaign.id);
  const ids = new Set(card.value.clients.map((c) => c.clientId));
  const purchases = view.purchases.filter((p) => ids.has(p.clientId));
  const nameOf = new Map(card.value.clients.map((c) => [c.clientId, c.name]));
  if (editing) return <CampaignForm view={view} campaign={card.campaign} data={data} onDone={() => { setEditing(false); onChanged(); }} />;
  return (
    <article className="card px-5 py-5" data-testid="campaign-card" aria-labelledby={`camp-${card.campaign.id}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`camp-${card.campaign.id}`} className="font-display text-[19px] font-semibold text-blue-900">
            {card.campaign.name}
          </h2>
          <p className="mt-0.5 text-[13.5px] tabular-nums text-slate-600">
            {card.window.since} → {card.window.until} · {t("Gasto", "Spend")} {money(card.spend.totalCents)}
            {card.spend.budgetCents !== null && ` ${t("de", "of")} ${money(card.spend.budgetCents)} ${t("presupuestados", "budgeted")} · ${t("quedan", "left")} ${money(card.spend.leftCents)}`}
          </p>
        </div>
        {manage && (
          <button type="button" className={ROW_BUTTON} onClick={() => setEditing(true)} data-testid="edit-campaign">
            {t("Cambiar", "Change")}
          </button>
        )}
      </header>

      <h3 className="console-label mt-4">{t("El embudo", "The funnel")}</h3>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" data-testid="campaign-funnel">
        <Figure label={t("Gasto en Meta", "Meta spend")} value={money(card.spend.metaCents)} sub={view.adsConnected || view.sample ? undefined : t("Meta no está conectada", "Meta is not connected")} />
        <Figure label={t("Otros costos", "Other costs")} value={money(card.spend.otherCents)} />
        <Figure label={text.counters.registered} value={f.registered} />
        <Figure label={text.counters.attended} value={f.attended} />
        <Figure label={t("Prospectos", "Leads")} value={f.leads} />
        <Figure label={text.counters.reportsUploaded} value={f.reportsUploaded} />
        <Figure label={text.counters.videosSent} value={f.videosSent} sub={f.videosSent === null ? text.noDataVideos : undefined} />
        <Figure label={text.counters.videosWatched} value={f.videosWatched} sub={f.videosWatched === null ? text.noDataVideos : undefined} />
        <Figure label={text.counters.signupsStarted} value={f.signupsStarted} />
        <Figure label={text.counters.signed} value={f.signed} tone="gold" testId="campaign-signed" />
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="bg-slate-50 text-left text-[11.5px] uppercase tracking-[0.06em] text-slate-500">
              <th className="px-3 py-2 font-semibold">{t("Por dónde llegaron", "How they came")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("Prospectos", "Leads")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("Firmaron", "Signed")}</th>
            </tr>
          </thead>
          <tbody>
            {(["ads", "webinar", "keyword", "organic"] as const).map((c) => (
              <tr key={c} className="border-t border-slate-100 tabular-nums">
                <td className="px-3 py-2">{text.channel[c]}</td>
                <td className="px-3 py-2 text-right">{card.byChannel[c].leads}</td>
                <td className="px-3 py-2 text-right">{card.byChannel[c].signed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="console-label mt-5">{t("Costo por cliente (CAC), de dos formas", "Cost per client (CAC), two ways")}</h3>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-2 md:grid-cols-2">
        <CacCard
          testId="cac-ads"
          title={t("Solo anuncios", "Ads only")}
          figure={card.cac.adsOnly}
          formula={t("gasto de Meta en las campañas de esta campaña, en sus fechas ÷ clientes firmados acreditados a esos anuncios", "Meta spend on this campaign's Meta campaigns, in its dates ÷ signed clients credited to those ads")}
        />
        <CacCard
          testId="cac-blended"
          title={t("Combinado", "Blended")}
          figure={card.cac.blended}
          formula={t("(gasto de Meta + todos los otros costos de la campaña) ÷ todos los clientes firmados que trajo la campaña", "(Meta spend + every other campaign cost) ÷ every signed client the campaign brought")}
        />
      </div>

      <h3 className="console-label mt-5">{t("Valor del cliente", "Client value")}</h3>
      <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Figure label={t("Valor promedio por cliente", "Average value per client")} value={card.value.averageCents === null ? null : money(card.value.averageCents)} testId="value-average" />
        <Figure label={t("Valor ÷ CAC", "Value ÷ CAC")} value={ratio(card.value.valueOverCac)} sub={card.value.valueOverCac === null ? text.cacState.not_enough : t("valor promedio ÷ CAC combinado", "average value ÷ blended CAC")} testId="value-over-cac" />
        <Figure label={t("Cambios DIY → Complete", "DIY → Complete upgrades")} value={card.value.upgrades} sub={`${money(card.value.collectedAfterUpgradeCents)} ${t("cobrado después", "collected after")}`} testId="upgrades" />
        <Figure label={t("Valor total", "Total value")} value={money(card.value.totalCents)} />
      </div>
      <p className="mt-2 text-[12.5px] leading-snug text-slate-500">
        {t(
          "Valor = dinero cobrado de verdad hasta hoy (la regla del dinero de Contabilidad: reembolsos y contracargos perdidos restan; los cargos de prueba nunca cuentan) + comisiones de IdentityIQ registradas + compras posteriores con monto. Un cambio DIY → Complete se ve en lo cobrado después del cambio.",
          "Value = money actually collected so far (Accounting's money rule: refunds and lost chargebacks subtract; test charges never count) + IdentityIQ commissions recorded + later purchases with an amount. A DIY → Complete upgrade shows in what was collected after it.",
        )}
      </p>

      {/* On a phone: one card per package (Complete first), the same figures as the table. */}
      <div className="mt-3 grid gap-2 sm:hidden" data-testid="by-package-cards">
        {SERVICE_OPTIONS.map((o) => {
          const p = card.byPackage[o];
          const cac = (c: CacFigure) => (c.state === "ok" ? money(c.cents) : text.cacState[c.state]);
          const rows: Array<[string, string]> = [
            [t("Firmaron", "Signed"), String(p.signed)],
            [t("Cobrado", "Collected"), money(p.collectedCents)],
            [t("Valor promedio", "Average value"), money(p.averageValueCents)],
            ["CAC*", cac(p.cac)],
            [t("CAC anuncios", "Ads CAC"), cac(p.adsCac)],
            [t("Valor ÷ CAC", "Value ÷ CAC"), ratio(p.valueOverCac) ?? "—"],
            ...(o === "complete" ? ([[t("Cambios desde DIY", "Upgrades from DIY"), String(p.upgrades)]] as Array<[string, string]>) : []),
          ];
          return (
            <div key={o} className="rounded-[12px] border border-slate-200 px-4 py-3" data-testid={`by-package-${o}`}>
              <p className="text-[15px] font-semibold text-blue-900">{text.package[o]}</p>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[13.5px] tabular-nums">
                {rows.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="text-right font-medium text-slate-900">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
      <div className="mt-3 hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[40rem] text-[13.5px]" data-testid="by-package">
          <thead>
            <tr className="bg-slate-50 text-left text-[11.5px] uppercase tracking-[0.06em] text-slate-500">
              <th className="px-3 py-2 font-semibold">{t("Paquete", "Package")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("Firmaron", "Signed")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("Cobrado", "Collected")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("Valor promedio", "Average value")}</th>
              <th className="px-3 py-2 text-right font-semibold">CAC*</th>
              <th className="px-3 py-2 text-right font-semibold">{t("CAC anuncios", "Ads CAC")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("Valor ÷ CAC", "Value ÷ CAC")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("Cambios", "Upgrades")}</th>
            </tr>
          </thead>
          <tbody>
            {SERVICE_OPTIONS.map((o) => {
              const p = card.byPackage[o];
              const cac = (c: CacFigure) => (c.state === "ok" ? money(c.cents) : text.cacState[c.state]);
              return (
                <tr key={o} className="border-t border-slate-100 tabular-nums">
                  <td className="px-3 py-2 font-medium">{text.package[o]}</td>
                  <td className="px-3 py-2 text-right">{p.signed}</td>
                  <td className="px-3 py-2 text-right">{money(p.collectedCents)}</td>
                  <td className="px-3 py-2 text-right">{money(p.averageValueCents)}</td>
                  <td className="px-3 py-2 text-right">{cac(p.cac)}</td>
                  <td className="px-3 py-2 text-right">{cac(p.adsCac)}</td>
                  <td className="px-3 py-2 text-right">{ratio(p.valueOverCac) ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{o === "complete" ? p.upgrades : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[12px] leading-snug text-slate-500">
        {t(
          "* CAC por paquete = todos los costos de la campaña ÷ los firmados de ese paquete (como si la campaña hubiera traído solo a esos). CAC anuncios por paquete = gasto de Meta ÷ firmados de ese paquete acreditados a anuncios. Valor ÷ CAC usa el CAC combinado de toda la campaña.",
          "* CAC per package = all campaign costs ÷ that package's signed clients (as if the campaign had brought only those). Ads CAC per package = Meta spend ÷ that package's ad-credited signed clients. Value ÷ CAC uses the whole campaign's blended CAC.",
        )}
      </p>

      {card.value.clients.length > 0 && (
        <details className="mt-3 rounded-[12px] border border-slate-200 px-4 py-2">
          <summary className="flex min-h-11 cursor-pointer items-center text-[14px] font-semibold text-blue-900">{t(`Cada cliente firmado (${card.value.clients.length})`, `Each signed client (${card.value.clients.length})`)}</summary>
          <div className="overflow-x-auto pb-2">
            <table className="w-full min-w-[40rem] text-[13px]" data-testid="client-values">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-[0.06em] text-slate-500">
                  <th className="px-2 py-1.5 font-semibold">{t("Cliente", "Client")}</th>
                  <th className="px-2 py-1.5 font-semibold">{t("Paquete", "Package")}</th>
                  <th className="px-2 py-1.5 font-semibold">{t("Llegó por", "Came through")}</th>
                  <th className="px-2 py-1.5 text-right font-semibold">{t("Cobrado", "Collected")}</th>
                  <th className="px-2 py-1.5 text-right font-semibold">IdentityIQ</th>
                  <th className="px-2 py-1.5 text-right font-semibold">{t("Compras", "Purchases")}</th>
                  <th className="px-2 py-1.5 text-right font-semibold">{t("Total", "Total")}</th>
                </tr>
              </thead>
              <tbody>
                {card.value.clients.map((c) => (
                  <tr key={c.clientId} className="border-t border-slate-100 tabular-nums">
                    <td className="px-2 py-1.5">{c.name}</td>
                    <td className="px-2 py-1.5">
                      {text.package[c.option]}
                      {c.upgrades > 0 && <span className="ml-1 text-[12px] text-emerald-700">{t("(cambió de DIY)", "(upgraded from DIY)")}</span>}
                    </td>
                    <td className="px-2 py-1.5">{text.channel[c.channel]}</td>
                    <td className="px-2 py-1.5 text-right">{money(c.collectedCents)}</td>
                    <td className="px-2 py-1.5 text-right">{money(c.commissionsCents)}</td>
                    <td className="px-2 py-1.5 text-right">
                      {money(c.purchasesCents)}
                      {(c.households > 0 || c.loanOfficer > 0) && (
                        <span className="block text-[11.5px] text-slate-500">
                          {[c.households > 0 ? t(`${c.households} del hogar`, `${c.households} household`) : null, c.loanOfficer > 0 ? t(`${c.loanOfficer} oficial de préstamos`, `${c.loanOfficer} loan officer`) : null].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold">{money(c.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <details className="mt-3 rounded-[12px] border border-slate-200 px-4 py-2">
        <summary className="flex min-h-11 cursor-pointer items-center text-[14px] font-semibold text-blue-900">{t(`Costos que no son de Meta (${costs.filter((c) => !c.voidedAt).length})`, `Costs that are not Meta's (${costs.filter((c) => !c.voidedAt).length})`)}</summary>
        <ul className="divide-y divide-slate-100 text-[13.5px]">
          {costs.map((c) => (
            <li key={c.id} className={`flex flex-wrap items-center justify-between gap-2 py-1.5 ${c.voidedAt ? "text-slate-400 line-through" : ""}`}>
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {c.day} · {c.label} · {text.costKind[c.kind]}
              </span>
              <span className="flex items-center gap-2 tabular-nums">
                {money(c.amountCents)}
                {manage && !c.voidedAt && (
                  <button type="button" className={QUIET_BUTTON} onClick={async () => { await data.voidCost(c.id); onChanged(); }}>
                    {t("Anular", "Void")}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {manage && <CostForm campaignId={card.campaign.id} data={data} onDone={onChanged} />}
      </details>

      <details className="mt-3 rounded-[12px] border border-slate-200 px-4 py-2">
        <summary className="flex min-h-11 cursor-pointer items-center text-[14px] font-semibold text-blue-900">{t(`Compras posteriores marcadas (${purchases.filter((p) => !p.voidedAt).length})`, `Later purchases marked (${purchases.filter((p) => !p.voidedAt).length})`)}</summary>
        <ul className="divide-y divide-slate-100 text-[13.5px]">
          {purchases.map((p) => (
            <li key={p.id} className={`flex flex-wrap items-center justify-between gap-2 py-1.5 ${p.voidedAt ? "text-slate-400 line-through" : ""}`}>
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {p.day} · {nameOf.get(p.clientId) ?? "—"} · {text.purchaseKind[p.kind]}
                {p.note ? ` · ${p.note}` : ""}
              </span>
              <span className="flex items-center gap-2 tabular-nums">
                {money(p.amountCents)}
                {manage && !p.voidedAt && (
                  <button type="button" className={QUIET_BUTTON} onClick={async () => { await data.voidPurchase(p.id); onChanged(); }}>
                    {t("Anular", "Void")}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {manage && <PurchaseForm card={card} data={data} onDone={onChanged} />}
      </details>
    </article>
  );
}

export default function Scorecards({ view, data, onChanged }: { view: CampaignsView; data: WebinarsData; onChanged: () => void }) {
  const t = useTx();
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4" data-testid="scorecards">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-[14px] leading-snug text-slate-600">
          {t(
            "Una campaña junta anuncios de Meta, webinars, palabras clave y fuentes orgánicas en unas fechas. Cuenta los prospectos que llegaron en esas fechas y hasta dónde ha llegado cada uno. Un cliente firmado firmó el acuerdo de servicio.",
            "A campaign groups Meta ads, webinars, keywords and organic sources over its dates. It counts the leads that arrived in those dates and how far each has come so far. A signed client signed the service agreement.",
          )}
        </p>
        {!adding && (
          <button type="button" className={ROW_BUTTON} onClick={() => setAdding(true)} data-testid="new-campaign">
            {t("Nueva campaña", "New campaign")}
          </button>
        )}
      </div>
      {adding && <CampaignForm view={view} campaign={null} data={data} onDone={() => { setAdding(false); onChanged(); }} />}
      {view.scorecards.length === 0 && !adding && <p className="card px-5 py-4 text-[14px] text-slate-600">{t("Todavía no hay campañas. Crea la primera: por ejemplo, «Webinar test #1» con $1,000.", "No campaigns yet. Create the first one: for example, “Webinar test #1” with $1,000.")}</p>}
      {view.scorecards.map((card) => (
        <CampaignCard key={card.campaign.id} card={card} view={view} data={data} onChanged={onChanged} manage />
      ))}
    </div>
  );
}
