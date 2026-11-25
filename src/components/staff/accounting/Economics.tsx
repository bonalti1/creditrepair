"use client";

import { useState } from "react";
import type { useAccounting } from "@/lib/accounting/data";
import { expensesAdSpend, unitEconomics, type Figure } from "@/lib/accounting/economics";
import { formatCents } from "@/lib/accounting/money";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { CONTROL_INLINE, Note, Tile, TileGrid } from "./bits";

type Acc = ReturnType<typeof useAccounting>;

export default function Economics({ acc }: { acc: Acc }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const [days, setDays] = useState(90);
  // Leads include people who never signed up: everyone the console knows.
  const u = unitEconomics(acc.staff.clients, acc.facts, expensesAdSpend(acc.book.expenses), new Date(), days);
  const show = (f: Figure, format: (v: number) => string) =>
    f.value === null ? <span className="text-[14px] font-medium leading-snug text-slate-400">{f.missing?.[locale]}</span> : format(f.value);
  const money = (v: number) => formatCents(v);
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const months = (v: number) => t(`${v} meses`, `${v} months`);

  return (
    <div className="space-y-5" data-testid="unit-economics">
      <div className="flex flex-wrap items-center gap-3">
        <select className={CONTROL_INLINE} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={t("Periodo", "Period")}>
          <option value={30}>{t("Últimos 30 días", "Last 30 days")}</option>
          <option value={90}>{t("Últimos 90 días", "Last 90 days")}</option>
          <option value={365}>{t("Últimos 12 meses", "Last 12 months")}</option>
        </select>
        <span className="text-[13px] text-slate-500">
          {u.from} → {u.to}
        </span>
      </div>
      <TileGrid>
        <Tile label={t("Gasto en publicidad", "Ad spend")} definition={t("Gastos en las categorías de publicidad (Meta, Google, TikTok, otra) en el periodo. Más adelante, también los datos de las plataformas.", "Expenses in the advertising categories (Meta, Google, TikTok, other) in the period. Later, also the platforms' own data.")}>
          {u.adSpendCents ? formatCents(u.adSpendCents) : <span className="text-[14px] font-medium text-slate-400">{t("Sin datos todavía", "No data yet")}</span>}
        </Tile>
        <Tile label={t("Prospectos", "Leads")} definition={t("Personas con primer contacto en el periodo.", "People first contacted in the period.")}>{u.leads}</Tile>
        <Tile label={t("Clientes que firmaron", "Signed clients")} definition={t("Firmaron en el periodo y no cancelaron dentro de los 3 días.", "Signed in the period and did not cancel within the 3-day window.")}>{u.signed}</Tile>
        <Tile label={t("De prospecto a firmado", "Lead to signed")}>{show(u.leadToSigned, pct)}</Tile>
        <Tile label={t("Costo por prospecto", "Cost per lead")} definition={t("Gasto en publicidad ÷ prospectos.", "Ad spend ÷ leads.")} testId="cpl">{show(u.costPerLeadCents, money)}</Tile>
        <Tile label={t("Costo por cliente firmado", "Cost per signed client")} definition={t("Gasto en publicidad ÷ clientes que firmaron.", "Ad spend ÷ signed clients.")}>{show(u.costPerSignedCents, money)}</Tile>
        <Tile label={t("Ingreso promedio por cliente", "Average revenue per client")} definition={t("Lo cobrado neto (con reembolsos y contracargos) de cada cliente que alguna vez pagó, en promedio, desde siempre.", "Net collected (after refunds and chargebacks) per client who ever paid, on average, all time.")}>{show(u.revenuePerClientCents, money)}</Tile>
        <Tile label={t("Ingreso por cliente al mes", "Revenue per client per month")} definition={t("Lo cobrado neto ÷ meses activos de los clientes que pagaron.", "Net collected ÷ the paying clients' active months.")}>{show(u.revenuePerClientMonthCents, money)}</Tile>
        <Tile label={t("Meses activos (promedio)", "Months active (average)")} definition={t("Del primer pago al fin del servicio (o hoy).", "From the first payment to the end of service (or today).")}>{show(u.monthsActive, months)}</Tile>
        <Tile label={t("Bajas al mes", "Monthly churn")} definition={t("De los clientes activos al inicio del periodo, cuántos se fueron (cancelaron o pidieron terminar), por cada 30 días.", "Of the clients active at the start of the period, how many left (cancelled or asked to end), per 30 days.")}>{show(u.monthlyChurn, pct)}</Tile>
        <Tile label={t("Valor de vida del cliente", "Lifetime value")} definition={t("Ingreso por cliente al mes × duración esperada (1 ÷ bajas al mes).", "Revenue per client per month × expected lifetime (1 ÷ monthly churn).")}>{show(u.lifetimeValueCents, money)}</Tile>
        <Tile label={t("Meses para recuperar", "Payback")} definition={t("Costo por cliente firmado ÷ ingreso por cliente al mes.", "Cost per signed client ÷ revenue per client per month.")}>{show(u.paybackMonths, months)}</Tile>
      </TileGrid>
      <Note>
        {t(
          "Sin datos no hay número: si falta el gasto en publicidad o nadie se ha ido, la cifra lo dice en lugar de inventarla. Las comisiones de monitoreo no entran aquí (van en el estado de resultados).",
          "No data, no number: if ad spend is missing or nobody has left yet, the figure says so instead of making one up. Monitoring commissions are not counted here (they are in the P&L).",
        )}
      </Note>
    </div>
  );
}
