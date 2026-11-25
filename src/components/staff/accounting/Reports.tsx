"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { checkClose, closeChecklist } from "@/lib/accounting/close";
import type { useAccounting } from "@/lib/accounting/data";
import { activeExpenses, isClosed } from "@/lib/accounting/expenses";
import { buildLedger } from "@/lib/accounting/ledger";
import { monthLabel, monthOf, yearToDate, type MonthKey } from "@/lib/accounting/periods";
import { reconcile } from "@/lib/accounting/reconcile";
import { accountantCsv, expensesCsv, ledgerCsv, pnlCsv, profitAndLoss } from "@/lib/accounting/reports";
import { totalsFor } from "@/lib/accounting/summary";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";
import { PRIMARY_BUTTON, ROW_BUTTON, SECONDARY_BUTTON, SectionTitle } from "@/components/staff/ui";
import { CONTROL, CONTROL_INLINE, download, Note, useBi } from "./bits";
import MonthlyReport from "./MonthlyReport";

type Acc = ReturnType<typeof useAccounting>;

export default function Reports({ acc, month, reveal }: { acc: Acc; month: MonthKey; reveal: boolean }) {
  const t = useTx();
  const bi = useBi();
  const { locale } = useStaffLocale();
  const [scope, setScope] = useState<"month" | "ytd">("month");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const months = scope === "month" ? [month] : yearToDate(month);
  const ledger = useMemo(() => buildLedger(acc.facts, acc.book.otherIncome), [acc.facts, acc.book.otherIncome]);
  const totals = totalsFor(acc.input, months, ledger);
  const recon = acc.book.settlement.length ? reconcile(acc.facts, acc.book.settlement, acc.book.decisions) : null;
  const checklist = closeChecklist(month, acc.book, recon, new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }));
  const closeCheck = checkClose(month, totalsFor(acc.input, [month], ledger), acc.book, new Date());
  const closed = isClosed(month, acc.book.closes);
  const name = scope === "month" ? month : `${month.slice(0, 4)}-ytd`;
  const inMonths = (m: string) => months.includes(m);
  const partnerPaid = acc.input.commissions.filter((c) => c.kind === "paid").map((c) => ({ at: c.recordedAt, cents: c.amountCents, partner: acc.partners?.partners.find((p) => p.id === c.partnerId)?.name ?? c.partnerId }));

  const close = async () => {
    if (!window.confirm(t(`¿Cerrar ${monthLabel(month, locale)}? Después solo se corrige con ajustes. No se puede reabrir.`, `Close ${monthLabel(month, locale)}? After that it is corrected only with adjustments. It can't be reopened.`))) return;
    const result = await acc.act({ action: "close_month", month, note });
    setMessage(result.ok ? { tone: "ok", text: bi(result.message) || t("Mes cerrado.", "Month closed.") } : { tone: "bad", text: bi(result.message) });
  };

  return (
    <div className="space-y-6" data-testid="reports">
      <div className="flex flex-wrap items-center gap-2">
        <select className={CONTROL_INLINE} value={scope} onChange={(e) => setScope(e.target.value as "month" | "ytd")} aria-label={t("Periodo", "Period")}>
          <option value="month">{monthLabel(month, locale)}</option>
          <option value="ytd">{t(`En el año, hasta ${monthLabel(month, locale)}`, `Year to date, through ${monthLabel(month, locale)}`)}</option>
        </select>
        <Link href={`/equipo/contabilidad/informe?mes=${month}`} className={ROW_BUTTON} data-testid="print-report">
          <Icon name="doc" size={16} className="mr-1.5" />
          {t("Informe para imprimir", "Printable report")}
        </Link>
      </div>

      <section aria-labelledby="exports">
        <SectionTitle>
          <span id="exports">{t("Archivos", "Files")}</span>
        </SectionTitle>
        <div className="card flex flex-wrap gap-2 px-5 py-4" data-testid="exports">
          <button type="button" className={SECONDARY_BUTTON} onClick={() => download(`credalti-pnl-${name}.csv`, pnlCsv(name, profitAndLoss(totals)))}>
            <Icon name="download" size={18} className="mr-1.5" />
            {t("Estado de resultados (CSV)", "P&L (CSV)")}
          </button>
          <button type="button" className={SECONDARY_BUTTON} onClick={() => download(`credalti-ledger-${name}.csv`, ledgerCsv(ledger.filter((e) => inMonths(e.month)), reveal))}>
            <Icon name="download" size={18} className="mr-1.5" />
            {t("Ingresos (CSV)", "Income ledger (CSV)")}
          </button>
          <button type="button" className={SECONDARY_BUTTON} onClick={() => download(`credalti-expenses-${name}.csv`, expensesCsv(activeExpenses(acc.book.expenses).filter((e) => inMonths(monthOf(e.spentOn)))))}>
            <Icon name="download" size={18} className="mr-1.5" />
            {t("Gastos (CSV)", "Expenses (CSV)")}
          </button>
          <button type="button" className={SECONDARY_BUTTON} onClick={() => download(`credalti-quickbooks-xero-${name}.csv`, accountantCsv(ledger, acc.book.expenses, months, partnerPaid))} data-testid="export-accountant">
            <Icon name="download" size={18} className="mr-1.5" />
            {t("Para QuickBooks / Xero", "For QuickBooks / Xero")}
          </button>
        </div>
        <p className="mt-2 px-1 text-[12.5px] text-slate-500">
          {t("El archivo para el contador: Fecha (MM/DD/AAAA), Cuenta, Descripción, Monto (entradas en positivo, salidas en negativo), Clase. Sin nombres de clientes.", "The accountant's file: Date (MM/DD/YYYY), Account, Description, Amount (money in positive, money out negative), Class. No client names.")}
        </p>
      </section>

      <MonthlyReport acc={acc} month={month} />

      <section aria-labelledby="close">
        <SectionTitle>
          <span id="close">{t(`Cierre de ${monthLabel(month, locale)}`, `Closing ${monthLabel(month, locale)}`)}</span>
        </SectionTitle>
        <div className="card px-5 py-4" data-testid="month-close">
          {closed ? (
            <p className="text-[14.5px] text-slate-700">{t("Este mes está cerrado. Las correcciones se registran como ajustes, aparte.", "This month is closed. Corrections are recorded as adjustments, kept apart.")}</p>
          ) : (
            <>
              <ul className="space-y-1.5">
                {checklist.map((c) => (
                  <li key={c.key} className="flex items-start gap-2 text-[14px] text-slate-700">
                    <span className={`mt-[3px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${c.done ? "bg-green-600 text-white" : "bg-amber-100 text-blue-900"}`} aria-hidden="true">
                      {c.done ? <Icon name="check" size={11} /> : "!"}
                    </span>
                    {bi(c.text)}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[12.5px] text-slate-500">{t("La lista es un consejo, no un candado: tú decides cuándo cerrar.", "The list is advice, not a lock: you decide when to close.")}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                <input className={CONTROL} placeholder={t("Nota del cierre (opcional)", "Closing note (optional)")} value={note} onChange={(e) => setNote(e.target.value)} />
                <button type="button" className={PRIMARY_BUTTON} disabled={!closeCheck.ok} onClick={close} data-testid="close-month">
                  {t("Cerrar el mes", "Close the month")}
                </button>
              </div>
              {!closeCheck.ok && <p className="mt-2 text-[13px] text-slate-500">{bi(closeCheck.message)}</p>}
            </>
          )}
          {message && (
            <div className="mt-3">
              <Note tone={message.tone}>{message.text}</Note>
            </div>
          )}
          {acc.book.closes.length > 0 && (
            <p className="mt-3 text-[13px] text-slate-500">
              {t("Meses cerrados: ", "Closed months: ")}
              {acc.book.closes.map((c) => monthLabel(c.month, locale)).join(", ")}
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="audit">
        <SectionTitle>
          <span id="audit">{t("Registro de cambios", "Audit trail")}</span>
        </SectionTitle>
        <ul className="card divide-y divide-slate-900/[0.06]" data-testid="audit">
          {acc.book.audit.slice(0, 25).map((a) => (
            <li key={a.id} className="flex flex-wrap justify-between gap-2 px-5 py-2 text-[13px]">
              <span className="text-slate-700">
                <span className="font-mono">{a.action}</span> · {a.entity}
                {a.entityId ? ` ${a.entityId.slice(0, 12)}` : ""}
              </span>
              <span className="text-slate-500">
                {a.actor} · {new Date(a.at).toLocaleString(locale === "es" ? "es-MX" : "en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" })}
              </span>
            </li>
          ))}
          {acc.book.audit.length === 0 && <li className="px-5 py-3 text-[13.5px] text-slate-500">{t("Sin cambios todavía.", "No changes yet.")}</li>}
        </ul>
        <p className="mt-2 px-1 text-[12.5px] text-slate-500">{t("Solo se agrega; nada se borra ni se cambia.", "Append-only: nothing is deleted or changed.")}</p>
      </section>
    </div>
  );
}
