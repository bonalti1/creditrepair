"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { chargebackRate } from "@/lib/billing/chargebacks";
import {
  filterInvoices,
  INVOICE_STATUS_LABEL,
  INVOICE_STATUSES,
  invoiceRows,
  quickBooksCsv,
  transactionsCsv,
  type InvoiceFilter,
  type InvoiceStatus,
} from "@/lib/billing/invoices";
import { formatCents } from "@/lib/billing/money";
import { PLAN_TYPE_LABEL, PLAN_TYPES } from "@/lib/billing/plans";
import { deniedReason } from "@/lib/staff/permissions";
import { shortDay } from "@/lib/staff/format";
import { useStaff } from "@/lib/staff/useStaff";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";
import { Chip, NoAccess, QUIET_BUTTON, ROW_BUTTON, SECONDARY_BUTTON, SectionTitle } from "@/components/staff/ui";

// Invoices: every charge is one, numbered by the database, with its status
// (paid, processing, failed, refunded, voided, disputed). Filters, the CSV
// of every transaction and a QuickBooks-friendly CSV (date, invoice, client,
// amount, fee estimate, net, method, status), the chargeback rate the
// processors watch, and the chargebacks themselves, each with its evidence
// pack one click away. Administrators only. Nothing here creates a charge or
// changes an amount.

const TONE: Record<InvoiceStatus, string> = {
  paid: "bg-green-50 text-green-700",
  processing: "bg-blue-50 text-blue-700",
  failed: "bg-amber-100 text-blue-900",
  refunded: "bg-slate-100 text-slate-600",
  voided: "bg-slate-100 text-slate-600",
  disputed: "bg-red-50 text-red-700",
};

const CONTROL = "h-11 md:h-10 min-w-0 rounded-xl bg-white px-3 text-[14px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.1)] outline-none focus:ring-2 focus:ring-blue-300";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Invoices() {
  const { ready, clients, now, can, locale, reload, data } = useStaff();
  const t = useTx();
  const [filter, setFilter] = useState<InvoiceFilter>({ status: "all", method: "all", planType: "all", from: "", to: "", query: "" });
  const rows = useMemo(
    () =>
      invoiceRows(
        clients.map((c) => ({
          clientId: c.id,
          clientName: `${c.firstName} ${c.lastName}`.trim(),
          charges: c.billing.charges,
          planType: c.agreementPlan?.terms.type ?? null,
          methodKind: c.billing.paymentMethod?.kind ?? null,
        })),
        locale,
      ),
    [clients, locale],
  );
  if (!ready) return null;
  if (!can("billing.plans")) return <NoAccess title={t("Facturas", "Invoices")} reason={deniedReason("billing.plans", locale)} />;

  const shown = filterInvoices(rows, filter);
  const rate = chargebackRate(clients.flatMap((c) => c.billing.charges), now, 30);
  const totals = shown.reduce((acc, r) => ({ collected: acc.collected + r.collectedCents, fee: acc.fee + r.feeEstimateCents, net: acc.net + r.netCents }), { collected: 0, fee: 0, net: 0 });
  const disputes = rows.filter((r) => r.chargebackStatus);
  const day = new Date().toISOString().slice(0, 10);
  const set = (patch: Partial<InvoiceFilter>) => setFilter({ ...filter, ...patch });

  return (
    <main className="animate-rise" data-testid="invoices">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">{t("Facturas", "Invoices")}</h1>
          <p className="mt-0.5 text-[14px] text-slate-500">
            {t("Cada cobro es una factura, por trabajo ya hecho. Las comisiones del procesador son un estimado.", "Every charge is an invoice, for work already done. Processor fees are an estimate.")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={SECONDARY_BUTTON} onClick={() => download(`credalti-transactions-${day}.csv`, transactionsCsv(shown))} data-testid="export-transactions">
            <Icon name="download" size={18} className="mr-1.5" />
            {t("CSV de transacciones", "Transactions CSV")}
          </button>
          <button type="button" className={SECONDARY_BUTTON} onClick={() => download(`credalti-quickbooks-${day}.csv`, quickBooksCsv(shown))} data-testid="export-quickbooks">
            <Icon name="download" size={18} className="mr-1.5" />
            {t("CSV para QuickBooks", "QuickBooks CSV")}
          </button>
        </div>
      </div>

      <div className="card mt-5 grid grid-cols-2 overflow-hidden sm:grid-cols-4 [&>*]:border-r [&>*]:border-slate-900/[0.06]">
        {[
          [t("Cobrado (filtro)", "Collected (filter)"), formatCents(totals.collected)],
          [t("Comisiones (estimado)", "Fees (estimate)"), formatCents(totals.fee)],
          [t("Neto", "Net"), formatCents(totals.net)],
          [t("Tasa de contracargos, 30 días", "Chargeback rate, 30 days"), rate.rate === null ? "—" : `${(rate.rate * 100).toFixed(2)}%`],
        ].map(([label, value]) => (
          <div key={label} className="px-4 py-3.5">
            <p className="text-[12.5px] text-slate-500">{label}</p>
            <p className="mt-0.5 font-display text-[22px] font-semibold tabular-nums text-slate-900">{value}</p>
          </div>
        ))}
      </div>
      {rate.rate !== null && rate.rate >= 0.0075 && (
        <p role="alert" className="mt-2 rounded-2xl bg-amber-100 px-4 py-2.5 text-[13px] leading-snug text-blue-900">
          {t(
            "Los procesadores suelen cerrar cuentas con más de ~1% de contracargos. Revisa cada uno y responde con su paquete de evidencia.",
            "Processors often close accounts above ~1% chargebacks. Review each one and answer with its evidence pack.",
          )}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-end gap-2" data-testid="invoice-filters">
        <input className={`${CONTROL} w-52`} placeholder={t("Cliente o factura", "Client or invoice")} value={filter.query} onChange={(e) => set({ query: e.target.value })} />
        <select className={CONTROL} value={filter.status} onChange={(e) => set({ status: e.target.value as InvoiceFilter["status"] })} aria-label={t("Estado", "Status")}>
          <option value="all">{t("Todos los estados", "All statuses")}</option>
          {INVOICE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {INVOICE_STATUS_LABEL[s][locale]}
            </option>
          ))}
        </select>
        <select className={CONTROL} value={filter.method} onChange={(e) => set({ method: e.target.value as InvoiceFilter["method"] })} aria-label={t("Método", "Method")}>
          <option value="all">{t("Tarjeta y ACH", "Card and ACH")}</option>
          <option value="card">{t("Tarjeta", "Card")}</option>
          <option value="ach">ACH</option>
        </select>
        <select className={CONTROL} value={filter.planType} onChange={(e) => set({ planType: e.target.value as InvoiceFilter["planType"] })} aria-label={t("Plan", "Plan")}>
          <option value="all">{t("Todos los planes", "All plans")}</option>
          {PLAN_TYPES.map((p) => (
            <option key={p} value={p}>
              {PLAN_TYPE_LABEL[p][locale]}
            </option>
          ))}
        </select>
        <label className="text-[12px] text-slate-500">
          {t("Desde", "From")}
          <input className={`${CONTROL} ml-1.5`} type="date" value={filter.from} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label className="text-[12px] text-slate-500">
          {t("Hasta", "To")}
          <input className={`${CONTROL} ml-1.5`} type="date" value={filter.to} onChange={(e) => set({ to: e.target.value })} />
        </label>
        <span className="ml-auto text-[13px] text-slate-500">{t(`${shown.length} de ${rows.length}`, `${shown.length} of ${rows.length}`)}</span>
      </div>

      <div className="card mt-3 overflow-x-auto">
        <table className="w-full min-w-[64rem] text-[13.5px]" data-testid="invoice-list">
          <thead>
            <tr className="border-b hairline text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-5 py-2.5">{t("Fecha", "Date")}</th>
              <th className="px-3 py-2.5">{t("Factura", "Invoice")}</th>
              <th className="px-3 py-2.5">{t("Cliente", "Client")}</th>
              <th className="px-3 py-2.5">{t("Trabajo que paga", "Work it pays for")}</th>
              <th className="px-3 py-2.5 text-right">{t("Monto", "Amount")}</th>
              <th className="px-3 py-2.5 text-right">{t("Comisión est.", "Fee est.")}</th>
              <th className="px-3 py-2.5 text-right">{t("Neto", "Net")}</th>
              <th className="px-3 py-2.5">{t("Método", "Method")}</th>
              <th className="px-3 py-2.5 pr-5">{t("Estado", "Status")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.chargeId} className="border-b hairline align-top last:border-b-0">
                <td className="whitespace-nowrap px-5 py-2.5 tabular-nums">{shortDay(r.date, locale)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[12.5px]">
                  <Link href={`/equipo/cobros/${encodeURIComponent(r.chargeId)}`} className="text-blue-700 underline-offset-2 hover:underline">
                    {r.invoice}
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  <Link href={`/equipo/clientes/${r.clientId}`} className="font-medium text-slate-900 underline-offset-2 hover:underline">
                    {r.clientName}
                  </Link>
                  <span className="block text-[12px] text-slate-500">{r.planType ? PLAN_TYPE_LABEL[r.planType][locale] : t("Por ronda", "Per round")}</span>
                </td>
                <td className="max-w-72 px-3 py-2.5 text-slate-700">{r.work}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatCents(r.amountCents)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{formatCents(r.feeEstimateCents)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatCents(r.netCents)}</td>
                <td className="px-3 py-2.5">{r.method === "ach" ? "ACH" : t("Tarjeta", "Card")}</td>
                <td className="px-3 py-2.5 pr-5">
                  <Chip tone={TONE[r.status]}>{INVOICE_STATUS_LABEL[r.status][locale]}</Chip>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={9} className="px-5 py-6 text-center text-slate-500">
                  {t("Ninguna factura con estos filtros.", "No invoices match these filters.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="mt-7" aria-labelledby="disputas">
        <SectionTitle>
          <span id="disputas">{t("Contracargos", "Chargebacks")}</span>
        </SectionTitle>
        <div className="card overflow-hidden" data-testid="chargebacks">
          {disputes.length === 0 ? (
            <p className="px-5 py-4 text-[14px] text-slate-600">{t("Ningún contracargo registrado.", "No chargebacks on record.")}</p>
          ) : (
            disputes.map((r) => {
              const cb = clients.find((c) => c.id === r.clientId)?.billing.charges.find((c) => c.id === r.chargeId)?.chargeback;
              return (
                <div key={r.chargeId} className="flex flex-wrap items-center justify-between gap-3 border-t hairline px-5 py-3.5 first:border-t-0">
                  <div className="min-w-0">
                    <p className="text-[14.5px] font-medium text-slate-900">
                      {r.invoice} · {r.clientName} · {formatCents(r.collectedCents)}
                    </p>
                    <p className="text-[12.5px] text-slate-500">
                      {t("Recibido", "Received")} {cb ? shortDay(cb.receivedAt, locale) : "—"}
                      {cb?.reasonCode ? ` · ${t("código", "code")} ${cb.reasonCode}` : ""} · {cb?.source === "webhook" ? t("del procesador", "from the processor") : t("registrado a mano", "recorded by hand")}
                      {cb?.respondedAt ? ` · ${t("evidencia enviada", "evidence sent")} ${shortDay(cb.respondedAt, locale)}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={r.chargebackStatus === "open" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"}>{r.chargebackStatus}</Chip>
                    <Link href={`/equipo/cobros/${encodeURIComponent(r.chargeId)}`} className={ROW_BUTTON} data-testid="evidence-link">
                      {t("Paquete de evidencia", "Evidence pack")}
                    </Link>
                    {r.chargebackStatus === "open" &&
                      (["responded", "won", "lost"] as const).map((s) => (
                        <button key={s} type="button" className={QUIET_BUTTON} onClick={async () => { await data.setChargebackStatus(r.clientId, r.chargeId, s); await reload(); }}>
                          {s === "responded" ? t("Evidencia enviada", "Evidence sent") : s === "won" ? t("Ganado", "Won") : t("Perdido", "Lost")}
                        </button>
                      ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </main>
  );
}

export default function CobrosPage() {
  return (
    <Suspense fallback={null}>
      <Invoices />
    </Suspense>
  );
}
