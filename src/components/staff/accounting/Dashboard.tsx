"use client";

import Link from "next/link";
import { category } from "@/lib/accounting/categories";
import { testChargesExcluded } from "@/lib/accounting/ledger";
import { formatCents } from "@/lib/accounting/money";
import { monthLabel, monthOf, type MonthKey } from "@/lib/accounting/periods";
import { realCharges } from "@/lib/accounting/facts";
import { planOption } from "@/lib/billing/plans";
import { OPTION_NAME, SERVICE_OPTIONS, type ServiceOption } from "@/lib/service/options";
import OptionBadge from "@/components/staff/OptionBadge";
import { dashboard, type MonthTotals } from "@/lib/accounting/summary";
import type { useAccounting } from "@/lib/accounting/data";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { SectionTitle } from "@/components/staff/ui";
import Definition from "@/components/staff/Definition";
import { Money, Note, Tile, TileGrid } from "./bits";

type Acc = ReturnType<typeof useAccounting>;

interface Row {
  key: string;
  label: string;
  definition: string;
  value: (t: MonthTotals) => number;
  strong?: boolean;
  out?: boolean;
}

export default function Dashboard({ acc, month }: { acc: Acc; month: MonthKey }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const d = dashboard(acc.input, month, acc.staff.now, acc.commissionsOn);
  const tests = testChargesExcluded(acc.facts);
  // Revenue by service option (docs/SERVICE-OPTIONS.md): what was collected this month, Credalti Complete and Credalti DIY.
  const byOption = Object.fromEntries(SERVICE_OPTIONS.map((o) => [o, { cents: 0, clients: new Set<string>() }])) as Record<ServiceOption, { cents: number; clients: Set<string> }>;
  for (const f of realCharges(acc.facts)) {
    if (!f.charge.chargedAt || monthOf(f.charge.chargedAt) !== month) continue;
    const option = f.planType ? planOption({ type: f.planType }) : "full_service";
    byOption[option].cents += f.collectedCents;
    if (f.collectedCents > 0) byOption[option].clients.add(f.clientId);
  }
  const rows: Row[] = [
    { key: "revenue", label: t("Ingresos cobrados", "Revenue collected"), definition: t("Lo que el procesador cobró de verdad por cobros reales, el día que lo cobró. Los cobros de prueba nunca cuentan.", "What the processor actually took for real charges, on the day it took it. Test charges never count."), value: (x) => x.revenueCents },
    { key: "refunds", label: t("Reembolsos", "Refunds"), definition: t("Reembolsos y anulaciones confirmados por el procesador, el día de la confirmación.", "Refunds and voids the processor confirmed, on the day it confirmed them."), value: (x) => -x.refundsCents, out: true },
    { key: "chargebacks", label: t("Contracargos perdidos", "Chargebacks lost"), definition: t("Contracargos perdidos o aceptados, el día que llegaron. Los abiertos se muestran aparte, en riesgo.", "Chargebacks lost or accepted, on the day they arrived. Open ones are shown apart, at risk."), value: (x) => -x.chargebacksCents, out: true },
    { key: "net_revenue", label: t("Ingreso neto", "Net revenue"), definition: t("Ingresos cobrados menos reembolsos y contracargos perdidos.", "Revenue collected less refunds and lost chargebacks."), value: (x) => x.netRevenueCents, strong: true },
    { key: "monitoring", label: t("Comisiones de monitoreo", "Monitoring commissions"), definition: t("Lo que pagó IdentityIQ (u otro proveedor) por referidos, registrado a mano o importado.", "What IdentityIQ (or another provider) paid for referrals, entered or imported."), value: (x) => x.monitoringCents },
    { key: "expenses", label: t("Gastos", "Expenses"), definition: t("Todos los gastos registrados del periodo, sin los anulados.", "Every expense recorded for the period, without voided ones."), value: (x) => -x.expensesCents, out: true },
    { key: "fees", label: t("Comisiones del procesador", "Processing fees"), definition: t("Del estado de cuenta del procesador cuando está registrado; si no, un estimado con las tarifas configuradas.", "From the processor's statement when it is entered; otherwise an estimate from the configured rates."), value: (x) => -x.feesCents, out: true },
    ...(acc.commissionsOn
      ? [{ key: "partners", label: t("Comisiones pagadas a socios", "Partner commissions paid"), definition: t("Pagos a socios registrados en Socios.", "Payments to partners recorded under Partners."), value: (x: MonthTotals) => -x.partnerCommissionsCents, out: true }]
      : []),
    { key: "profit", label: t("Ganancia neta", "Net profit"), definition: t("Ingreso neto más otros ingresos, menos gastos, comisiones del procesador y comisiones pagadas a socios. Base de caja.", "Net revenue plus other income, less expenses, processing fees and partner commissions paid. Cash basis."), value: (x) => x.netProfitCents, strong: true },
    { key: "cash_in", label: t("Entradas de dinero", "Cash in"), definition: t("Pagos cobrados más otros ingresos.", "Payments collected plus other income."), value: (x) => x.cashInCents },
    { key: "cash_out", label: t("Salidas de dinero", "Cash out"), definition: t("Reembolsos, contracargos, gastos, comisiones del procesador y pagos a socios.", "Refunds, chargebacks, expenses, processing fees and payments to partners."), value: (x) => -x.cashOutCents, out: true },
  ];
  const cols: Array<[string, MonthTotals]> = [
    [t("Este mes", "This month"), d.thisMonth],
    [t("Mes pasado", "Last month"), d.lastMonth],
    [t("En el año", "Year to date"), d.yearToDate],
  ];
  const cats = d.thisMonth.expensesByCategory.slice().sort((a, b) => b.cents - a.cents);
  const max = Math.max(1, ...cats.map((c) => c.cents));

  return (
    <div className="space-y-6" data-testid="accounting-dashboard">
      {d.empty && (
        <Note tone="info" testId="books-empty">
          {t("Todavía no hay nada en los libros: ni pagos cobrados ni gastos. Los números aparecen en cuanto haya registros reales.", "Nothing in the books yet: no payments collected and no expenses. The numbers appear as soon as there are real records.")}
        </Note>
      )}

      <TileGrid>
        <Tile label={t("Ganancia neta, este mes", "Net profit, this month")} definition={rows.find((r) => r.key === "profit")!.definition} testId="tile-profit">
          <Money cents={d.thisMonth.netProfitCents} empty={!d.thisMonth.hasData} />
        </Tile>
        <Tile
          label={t("Por cobrar", "Accounts receivable")}
          definition={t("Cobros ya ganados que todavía no se cobran (en proceso o rechazados), sin los dados de baja: en Complete, trabajo ya hecho; en DIY, la suscripción del periodo o las cartas enviadas. Nada por trabajo que no se ha hecho.", "Charges already earned that are not collected yet (processing or declined), without written-off ones: under Complete, work already done; under DIY, the period's subscription or letters mailed. Nothing for work not yet done.")}
          note={t(`${d.receivableCount} cobro(s)`, `${d.receivableCount} charge(s)`)}
          testId="tile-ar"
        >
          <Money cents={d.receivableCents} />
        </Tile>
        <Tile label={t("Pagos rechazados, este mes", "Failed payments, this month")} definition={t("Cobros rechazados o ACH devueltos cuyo último intento fue este mes.", "Charges declined, or ACH returned, whose last attempt was this month.")} note={formatCents(d.thisMonth.failedCents)} testId="tile-failed">
          {d.thisMonth.failedCount}
        </Tile>
        <Tile
          label={t("Comisiones por pagar a socios", "Partner commissions payable")}
          definition={t("Lo registrado como debido menos lo pagado, en Socios. Apagado hasta que el abogado lo apruebe.", "What was recorded as owed less what was paid, under Partners. Off until the attorney approves it.")}
          testId="tile-payable"
        >
          {d.partnerPayableCents === null ? <span className="text-[15px] font-medium text-slate-500">{t("Apagado (pendiente del abogado)", "Off (attorney-pending)")}</span> : <Money cents={d.partnerPayableCents} />}
        </Tile>
      </TileGrid>

      {d.thisMonth.openChargebacksCents > 0 && (
        <Note tone="warn">
          {t(`Contracargos abiertos en riesgo este mes: ${formatCents(d.thisMonth.openChargebacksCents)}. No se restan hasta que se pierdan.`, `Open chargebacks at risk this month: ${formatCents(d.thisMonth.openChargebacksCents)}. Not subtracted unless lost.`)}{" "}
          <Link href="/equipo/cobros" className="font-semibold underline">
            {t("Ver contracargos", "See chargebacks")}
          </Link>
        </Note>
      )}

      <section aria-labelledby="pnl-compare">
        <SectionTitle>
          <span id="pnl-compare">
            {monthLabel(month, locale)} · {t("comparado", "compared")}
          </span>
        </SectionTitle>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[34rem] text-[14px]" data-testid="dashboard-table">
            <thead>
              <tr className="border-b hairline text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2.5" />
                {cols.map(([label]) => (
                  <th key={label} className="px-3 py-2.5 text-right last:pr-5">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={`border-b hairline last:border-b-0 ${r.strong ? "bg-slate-50/70 font-semibold" : ""}`}>
                  <td className="px-5 py-2.5 text-slate-700">
                    <span className="inline-flex items-start gap-1.5">
                      {r.label}
                      <Definition label={r.label} text={r.definition} />
                    </span>
                    {r.key === "fees" && d.thisMonth.feesEstimated && <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-blue-900">{t("estimado", "estimate")}</span>}
                  </td>
                  {cols.map(([label, totals]) => (
                    <td key={label} className="px-3 py-2.5 text-right tabular-nums text-slate-900 last:pr-5">
                      {totals.hasData ? <Money cents={r.value(totals) === 0 ? 0 : r.value(totals)} /> : <Money cents={null} />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {tests.count > 0 && (
          <p className="mt-2 px-1 text-[12.5px] text-slate-500" data-testid="tests-excluded">
            {t(`${tests.count} cobro(s) de prueba (${formatCents(tests.amountCents)}) no cuentan como ingresos.`, `${tests.count} test charge(s) (${formatCents(tests.amountCents)}) are not counted as revenue.`)}
          </p>
        )}
      </section>

      <section aria-labelledby="by-option">
        <SectionTitle>
          <span id="by-option">{t("Ingresos por opción, este mes", "Revenue by option, this month")}</span>
        </SectionTitle>
        <div className="card grid grid-cols-1 overflow-hidden sm:grid-cols-2" data-testid="revenue-by-option">
          {SERVICE_OPTIONS.map((o) => (
            <div key={o} className="border-b hairline px-5 py-3.5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
              <p className="flex items-center gap-2 text-[13px] text-slate-600">
                <OptionBadge option={o} /> {OPTION_NAME[o][locale]}
              </p>
              <p className="mt-1 font-display text-[22px] font-semibold tabular-nums text-slate-900">{formatCents(byOption[o].cents)}</p>
              <p className="text-[12.5px] text-slate-500">
                {t(`${byOption[o].clients.size} cliente(s) pagaron`, `${byOption[o].clients.size} client(s) paid`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="by-category">
        <SectionTitle>
          <span id="by-category">{t("Gastos por categoría, este mes", "Expenses by category, this month")}</span>
        </SectionTitle>
        <div className="card px-5 py-4">
          {cats.length === 0 ? (
            <p className="text-[14px] text-slate-500">{t("Sin datos todavía: no hay gastos este mes.", "No data yet: no expenses this month.")}</p>
          ) : (
            <ul className="space-y-2.5" data-testid="category-bars">
              {cats.map((c) => (
                <li key={c.category} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 text-[13.5px] sm:grid-cols-[minmax(0,16rem)_1fr_auto]" title={`${category(c.category)[locale]}: ${formatCents(c.cents)}`}>
                  <span className="truncate text-slate-700">{category(c.category)[locale]}</span>
                  <span className="h-2.5 rounded-full bg-slate-100">
                    <span className="block h-2.5 rounded-full bg-blue-900" style={{ width: `${Math.max(2, (c.cents / max) * 100)}%` }} />
                  </span>
                  <span className="tabular-nums text-slate-900">{formatCents(c.cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
