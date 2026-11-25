"use client";

import { category } from "@/lib/accounting/categories";
import type { useAccounting } from "@/lib/accounting/data";
import { drift } from "@/lib/accounting/close";
import { formatCents } from "@/lib/accounting/money";
import { monthLabel, type MonthKey } from "@/lib/accounting/periods";
import { cashFlow, profitAndLoss, type PnlLine } from "@/lib/accounting/reports";
import { receivables, totalsFor } from "@/lib/accounting/summary";
import { BRAND } from "@/lib/brand";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { Money } from "./bits";

type Acc = ReturnType<typeof useAccounting>;

function Lines({ title, lines, total, totalLabel }: { title: string; lines: PnlLine[]; total: number; totalLabel: string }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  return (
    <table className="w-full text-[14px]">
      <thead>
        <tr>
          <th colSpan={2} className="pb-1.5 text-left text-[12px] font-semibold uppercase tracking-wide text-slate-500">
            {title}
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.key} className="border-t hairline">
            <td className={`py-1.5 text-slate-700 ${l.sub ? "pl-4" : ""}`}>
              {l.label[locale]}
              {l.estimate && <span className="ml-1.5 text-[11px] font-semibold text-amber-700">{t("estimado", "estimate")}</span>}
            </td>
            <td className="py-1.5 text-right tabular-nums">
              <Money cents={l.cents} />
            </td>
          </tr>
        ))}
        <tr className="border-t-2 border-slate-300 font-semibold">
          <td className="py-1.5">{totalLabel}</td>
          <td className="py-1.5 text-right tabular-nums">
            <Money cents={total} />
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** The month on one page: P&L, cash flow, expenses by category, receivables. Printable. */
export default function MonthlyReport({ acc, month }: { acc: Acc; month: MonthKey }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const totals = totalsFor(acc.input, [month]);
  const pnl = profitAndLoss(totals);
  const flow = cashFlow(totals);
  const ar = receivables(acc.input, new Date());
  const closed = acc.book.closes.find((c) => c.month === month);
  const moved = closed ? drift(closed.totals, totals) : null;

  return (
    <article className="card px-5 py-5 print:shadow-none sm:px-7" data-testid="monthly-report">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b hairline pb-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{BRAND.name} · {t("Informe mensual", "Monthly report")}</p>
          <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">{monthLabel(month, locale)}</h2>
        </div>
        <p className="text-right text-[12.5px] text-slate-500">
          {closed ? t(`Cerrado el ${closed.closedAt.slice(0, 10)} por ${closed.closedBy}`, `Closed ${closed.closedAt.slice(0, 10)} by ${closed.closedBy}`) : t("Mes abierto: las cifras pueden cambiar", "Open month: figures can still change")}
          <br />
          {t("Base de caja · hora de Texas", "Cash basis · Texas time")}
        </p>
      </header>
      {!totals.hasData ? (
        <p className="py-6 text-center text-[15px] text-slate-500">{t("Sin datos todavía para este mes.", "No data yet for this month.")}</p>
      ) : (
        <>
          {moved?.changed && (
            <p className="mt-3 rounded-xl bg-amber-100 px-3 py-2 text-[13px] text-blue-900" data-testid="drift">
              {t(`Ajustes después del cierre: la ganancia cambió ${formatCents(moved.netProfitCents)} (cerrada: ${formatCents(closed!.totals.netProfitCents)}).`, `Adjustments after the close: profit changed by ${formatCents(moved.netProfitCents)} (closed at ${formatCents(closed!.totals.netProfitCents)}).`)}
            </p>
          )}
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <Lines title={t("Ingresos", "Income")} lines={pnl.income} total={pnl.incomeTotal} totalLabel={t("Total de ingresos", "Total income")} />
              <Lines title={t("Gastos", "Expenses")} lines={pnl.expenses} total={pnl.expenseTotal} totalLabel={t("Total de gastos", "Total expenses")} />
              <div className="flex items-center justify-between rounded-xl bg-slate-900 px-4 py-3 text-white print:bg-white print:text-black print:ring-1 print:ring-slate-400">
                <span className="text-[14px] font-semibold">{t("Ganancia neta", "Net profit")}</span>
                <span className="text-[20px] font-semibold tabular-nums" data-testid="report-profit">{formatCents(pnl.netProfitCents)}</span>
              </div>
            </div>
            <div className="space-y-4">
              <Lines title={t("Entradas de dinero", "Cash in")} lines={flow.inLines} total={flow.inCents} totalLabel={t("Total de entradas", "Total in")} />
              <Lines title={t("Salidas de dinero", "Cash out")} lines={flow.outLines} total={flow.outCents} totalLabel={t("Total de salidas", "Total out")} />
              <p className="flex justify-between border-t-2 border-slate-300 pt-1.5 text-[14px] font-semibold">
                <span>{t("Cambio neto en caja", "Net change in cash")}</span>
                <Money cents={flow.netCents} />
              </p>
              <div className="text-[13.5px] text-slate-700">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{t("Por cobrar hoy", "Receivable today")}</p>
                <p className="mt-1">
                  {formatCents(ar.totalCents)} · {t(`${ar.open.length} cobro(s) por trabajo ya hecho`, `${ar.open.length} charge(s) for work already done`)}
                </p>
              </div>
              {totals.expensesByCategory.length > 0 && (
                <div className="text-[13px] text-slate-600">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{t("Gastos por categoría", "Expenses by category")}</p>
                  <ul className="mt-1 space-y-0.5">
                    {totals.expensesByCategory.map((c) => (
                      <li key={c.category} className="flex justify-between gap-2">
                        <span>
                          {category(c.category)[locale]} · {c.count}
                        </span>
                        <span className="tabular-nums">{formatCents(c.cents)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
          <p className="mt-5 border-t hairline pt-3 text-[11.5px] leading-snug text-slate-500">
            {t(
              "Ingresos: solo dinero cobrado de verdad por cobros reales (los de prueba no cuentan), menos reembolsos confirmados y contracargos perdidos. Comisiones del procesador: del estado de cuenta cuando se registró; si no, estimado. Esto no es una auditoría ni asesoría fiscal.",
              "Income: only money actually collected for real charges (test charges never count), less confirmed refunds and lost chargebacks. Processing fees: from the statement when entered; otherwise estimated. This is not an audit or tax advice.",
            )}
          </p>
        </>
      )}
    </article>
  );
}
