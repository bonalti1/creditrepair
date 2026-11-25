"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PLAN_TYPE_LABEL } from "@/lib/billing/plans";
import type { useAccounting } from "@/lib/accounting/data";
import { shownName } from "@/lib/accounting/facts";
import { buildLedger, filterLedger, LEDGER_KIND_LABEL, testChargesExcluded, type LedgerKind } from "@/lib/accounting/ledger";
import { formatCents } from "@/lib/accounting/money";
import type { MonthKey } from "@/lib/accounting/periods";
import { ledgerCsv } from "@/lib/accounting/reports";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { shortDay } from "@/lib/staff/format";
import Icon from "@/components/Icon";
import { Chip, SECONDARY_BUTTON, SectionTitle } from "@/components/staff/ui";
import { CONTROL, download, Money, Note, TableCard, TD, TH } from "./bits";
import OtherIncomeCard from "./OtherIncome";

type Acc = ReturnType<typeof useAccounting>;

const TONE: Partial<Record<LedgerKind, string>> = {
  payment: "bg-green-50 text-green-700",
  refund: "bg-slate-100 text-slate-600",
  void: "bg-slate-100 text-slate-600",
  chargeback_lost: "bg-red-50 text-red-700",
  chargeback_open: "bg-red-50 text-red-700",
  failed_attempt: "bg-amber-100 text-blue-900",
  ach_return: "bg-amber-100 text-blue-900",
  monitoring_commission: "bg-blue-50 text-blue-700",
  other_income: "bg-blue-50 text-blue-700",
};

export default function Ledger({ acc, month, reveal, setReveal }: { acc: Acc; month: MonthKey; reveal: boolean; setReveal: (v: boolean) => void }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const [kind, setKind] = useState<LedgerKind | "all" | "money">("all");
  const [scope, setScope] = useState<"month" | "all">("month");
  const [query, setQuery] = useState("");
  const ledger = useMemo(() => buildLedger(acc.facts, acc.book.otherIncome), [acc.facts, acc.book.otherIncome]);
  const shown = filterLedger(ledger, { month: scope === "month" ? month : "all", kind, query });
  const tests = testChargesExcluded(acc.facts);
  const total = shown.reduce((a, e) => a + e.amountCents, 0);
  const kinds = Object.keys(LEDGER_KIND_LABEL) as LedgerKind[];

  return (
    <div className="space-y-5" data-testid="income-ledger">
      <Note>
        {t(
          "Se arma solo con los registros de cobros: cada pago cobrado, reembolso, contracargo e intento rechazado. Nadie lo escribe a mano. Los cobros de prueba no entran.",
          "Built by itself from the billing records: every payment collected, refund, chargeback and declined attempt. Nobody types it in. Test charges are left out.",
        )}
        {tests.count > 0 && t(` (${tests.count} de prueba excluido(s).)`, ` (${tests.count} test charge(s) excluded.)`)}
      </Note>
      <div className="flex flex-wrap items-end gap-2">
        <input className={`${CONTROL} sm:w-56`} placeholder={t("Factura, cliente o código", "Invoice, client or code")} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t("Buscar", "Search")} />
        <select className={`${CONTROL} sm:w-56`} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label={t("Tipo", "Type")}>
          <option value="all">{t("Todos los movimientos", "Every line")}</option>
          <option value="money">{t("Solo lo que movió dinero", "Only what moved money")}</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {LEDGER_KIND_LABEL[k][locale]}
            </option>
          ))}
        </select>
        <select className={`${CONTROL} sm:w-44`} value={scope} onChange={(e) => setScope(e.target.value as "month" | "all")} aria-label={t("Periodo", "Period")}>
          <option value="month">{t("El mes elegido", "The chosen month")}</option>
          <option value="all">{t("Todo", "Everything")}</option>
        </select>
        <label className="flex min-h-11 items-center gap-2 text-[13.5px] text-slate-700">
          <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} className="h-5 w-5" data-testid="reveal-names" />
          {t("Mostrar nombres", "Show client names")}
        </label>
        <button type="button" className={`${SECONDARY_BUTTON} sm:ml-auto`} onClick={() => download(`credalti-income-ledger-${scope === "month" ? month : "all"}.csv`, ledgerCsv(shown, reveal))} data-testid="export-ledger">
          <Icon name="download" size={18} className="mr-1.5" />
          CSV
        </button>
      </div>
      <p className="px-1 text-[13px] text-slate-500">
        {t(`${shown.length} línea(s) · neto `, `${shown.length} line(s) · net `)}
        <Money cents={total} className="font-semibold text-slate-900" />
      </p>
      <TableCard testId="ledger-table" minWidth="min-w-[60rem]">
        <thead>
          <tr className="border-b hairline">
            <th className={TH}>{t("Fecha", "Date")}</th>
            <th className={TH}>{t("Movimiento", "Type")}</th>
            <th className={TH}>{t("Cliente", "Client")}</th>
            <th className={TH}>{t("Plan · ronda", "Plan · round")}</th>
            <th className={TH}>{t("Procesador", "Processor")}</th>
            <th className={`${TH} text-right`}>{t("Monto", "Amount")}</th>
            <th className={TH}>{t("Detalle", "Detail")}</th>
          </tr>
        </thead>
        <tbody>
          {shown.slice(0, 400).map((e) => (
            <tr key={e.id} className="border-b hairline last:border-b-0">
              <td className={`${TD} whitespace-nowrap tabular-nums`}>{e.chargeId ? shortDay(e.at, locale) : shortDay(`${e.day}T18:00:00Z`, locale)}</td>
              <td className={TD}>
                <Chip tone={TONE[e.kind] ?? "bg-slate-100 text-slate-600"}>{LEDGER_KIND_LABEL[e.kind][locale]}</Chip>
              </td>
              <td className={TD}>
                {e.clientId ? (
                  <>
                    <Link href={`/equipo/clientes/${e.clientId}`} className="font-medium text-slate-900 underline-offset-2 hover:underline">
                      {shownName(e.clientName ?? "", reveal)}
                    </Link>
                    <span className="block font-mono text-[12px] text-slate-500">{e.invoice}</span>
                  </>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </td>
              <td className={`${TD} text-slate-700`}>
                {e.chargeId ? `${e.planType ? PLAN_TYPE_LABEL[e.planType][locale] : t("Por ronda", "Per round")} · ${t("ronda", "round")} ${e.roundNumber}` : "—"}
              </td>
              <td className={`${TD} text-slate-700`}>{e.processor ? (e.processor === "authorize_net" ? "Authorize.Net" : e.processor.toUpperCase()) : "—"}{e.method ? ` · ${e.method === "ach" ? "ACH" : t("tarjeta", "card")}` : ""}</td>
              <td className={`${TD} text-right tabular-nums`}>
                {e.amountCents === 0 ? <span className="text-slate-500">({formatCents(e.involvedCents)})</span> : <Money cents={e.amountCents} signed />}
              </td>
              <td className={`${TD} max-w-56 text-[12.5px] text-slate-600`}>{e.detail ?? ""}</td>
            </tr>
          ))}
          {shown.length === 0 && (
            <tr>
              <td colSpan={7} className="px-5 py-6 text-center text-slate-500">
                {t("Sin datos todavía para este filtro.", "No data yet for this filter.")}
              </td>
            </tr>
          )}
        </tbody>
      </TableCard>
      <p className="px-1 text-[12.5px] text-slate-500">{t("Entre paréntesis: el monto de lo que no movió dinero (un rechazo, un contracargo abierto). No suma.", "In brackets: the amount of what moved no money (a decline, an open chargeback). It does not add up.")}</p>

      <section aria-labelledby="other-income">
        <SectionTitle>
          <span id="other-income">{t("Comisiones de monitoreo y otros ingresos", "Monitoring commissions and other income")}</span>
        </SectionTitle>
        <OtherIncomeCard acc={acc} />
      </section>
    </div>
  );
}
