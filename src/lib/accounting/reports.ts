import { PLAN_TYPE_LABEL } from "../billing/plans";
import { toCsv } from "../billing/invoices";
import { category, categoryLabel, CATEGORIES, PAYMENT_METHOD_LABEL } from "./categories";
import { activeExpenses } from "./expenses";
import { shownName } from "./facts";
import { LEDGER_KIND_LABEL, type LedgerEntry } from "./ledger";
import { centsToDecimal } from "./money";
import { monthOf, type MonthKey } from "./periods";
import type { MonthTotals } from "./summary";
import type { Bilingual, Expense } from "./types";

// Reports and files: the monthly profit and loss, the cash-flow summary, the
// expense report, and the CSV files (everything, and one an accountant can
// bring into QuickBooks or Xero). Cells are never read as formulas (toCsv).
// Client names are masked in the files unless the person asked to show them.

export interface PnlLine {
  key: string;
  label: Bilingual;
  cents: number;
  /** Shown as an estimate. */
  estimate?: boolean;
  /** Indented under its section. */
  sub?: boolean;
}

export interface Pnl {
  income: PnlLine[];
  incomeTotal: number;
  expenses: PnlLine[];
  expenseTotal: number;
  netProfitCents: number;
}

export function profitAndLoss(t: MonthTotals): Pnl {
  const income: PnlLine[] = [
    { key: "revenue", label: { en: "Client payments collected", es: "Pagos de clientes cobrados" }, cents: t.revenueCents },
    { key: "refunds", label: { en: "Less refunds and voids", es: "Menos reembolsos y anulaciones" }, cents: -t.refundsCents, sub: true },
    { key: "chargebacks", label: { en: "Less chargebacks lost", es: "Menos contracargos perdidos" }, cents: -t.chargebacksCents, sub: true },
    { key: "net_revenue", label: { en: "Net revenue from clients", es: "Ingreso neto de clientes" }, cents: t.netRevenueCents },
    { key: "monitoring", label: { en: "Monitoring commissions", es: "Comisiones de monitoreo" }, cents: t.monitoringCents },
    { key: "other_income", label: { en: "Other income", es: "Otros ingresos" }, cents: t.otherIncomeCents - t.monitoringCents },
  ];
  const expenses: PnlLine[] = t.expensesByCategory.map((c) => ({ key: c.category, label: { en: category(c.category).en, es: category(c.category).es }, cents: c.cents }));
  // The measured fees are the "processing_fees" category line above; this is only the estimated part.
  if (t.feesEstimateCents > 0) expenses.push({ key: "fees_estimate", label: { en: "Processing fees (estimate)", es: "Comisiones del procesador (estimado)" }, cents: t.feesEstimateCents, estimate: true });
  if (t.partnerCommissionsCents > 0) expenses.push({ key: "partner_commissions", label: { en: "Partner commissions paid", es: "Comisiones pagadas a socios" }, cents: t.partnerCommissionsCents });
  const expenseTotal = expenses.reduce((a, l) => a + l.cents, 0);
  return { income, incomeTotal: t.netRevenueCents + t.otherIncomeCents, expenses, expenseTotal, netProfitCents: t.netProfitCents };
}

export interface CashFlow {
  inLines: PnlLine[];
  outLines: PnlLine[];
  inCents: number;
  outCents: number;
  netCents: number;
}

export function cashFlow(t: MonthTotals): CashFlow {
  const inLines: PnlLine[] = [
    { key: "payments", label: { en: "Client payments", es: "Pagos de clientes" }, cents: t.revenueCents },
    { key: "monitoring", label: { en: "Monitoring commissions", es: "Comisiones de monitoreo" }, cents: t.monitoringCents },
    { key: "other", label: { en: "Other income", es: "Otros ingresos" }, cents: t.otherIncomeCents - t.monitoringCents },
  ];
  const outLines: PnlLine[] = [
    { key: "refunds", label: { en: "Refunds and voids", es: "Reembolsos y anulaciones" }, cents: t.refundsCents },
    { key: "chargebacks", label: { en: "Chargebacks lost", es: "Contracargos perdidos" }, cents: t.chargebacksCents },
    { key: "expenses", label: { en: "Expenses", es: "Gastos" }, cents: t.expensesCents },
    { key: "fees", label: { en: t.feesEstimated ? "Processing fees (estimate)" : "Processing fees", es: t.feesEstimated ? "Comisiones del procesador (estimado)" : "Comisiones del procesador" }, cents: t.feesCents, estimate: t.feesEstimated },
    { key: "partners", label: { en: "Partner commissions paid", es: "Comisiones pagadas a socios" }, cents: t.partnerCommissionsCents },
  ];
  return { inLines, outLines, inCents: t.cashInCents, outCents: t.cashOutCents, netCents: t.cashInCents - t.cashOutCents };
}

const usDate = (day: string) => {
  const [y, m, d] = day.split("-");
  return `${m}/${d}/${y}`;
};

/** Every ledger line. */
export function ledgerCsv(entries: readonly LedgerEntry[], reveal: boolean): string {
  return toCsv(
    ["Date", "Type", "Invoice", "Client", "Plan", "Round", "Processor", "Method", "Amount", "Amount involved", "Fee (estimate)", "Detail", "Charge ID"],
    entries.map((e) => [
      e.day,
      LEDGER_KIND_LABEL[e.kind].en,
      e.invoice ?? "",
      e.clientName ? shownName(e.clientName, reveal) : "",
      e.planType ? PLAN_TYPE_LABEL[e.planType].en : e.chargeId ? "Per round" : "",
      e.roundNumber ?? "",
      e.processor ?? "",
      e.method === "ach" ? "ACH" : e.method === "card" ? "Card" : "",
      centsToDecimal(e.amountCents),
      centsToDecimal(e.involvedCents),
      centsToDecimal(e.feeEstimateCents),
      e.detail ?? "",
      e.chargeId ?? "",
    ]),
  );
}

export function expensesCsv(expenses: readonly Expense[]): string {
  return toCsv(
    ["Date", "Category", "Vendor", "Description", "Amount", "Paid with", "Source", "Adjusts month", "Receipt", "Voided", "ID"],
    expenses.map((e) => [
      e.spentOn,
      categoryLabel(e.category, "en"),
      e.vendor,
      e.description,
      centsToDecimal(e.amountCents),
      PAYMENT_METHOD_LABEL[e.paymentMethod].en,
      e.source,
      e.adjustsMonth ?? "",
      e.receipt ? e.receipt.name : "",
      e.voidedAt ? `yes: ${e.voidReason ?? ""}` : "",
      e.id,
    ]),
  );
}

export function pnlCsv(month: MonthKey, pnl: Pnl): string {
  return toCsv(
    ["Month", "Section", "Line", "Amount", "Estimate"],
    [
      ...pnl.income.map((l) => [month, "Income", l.label.en, centsToDecimal(l.cents), ""]),
      ...pnl.expenses.map((l) => [month, "Expenses", l.label.en, centsToDecimal(l.cents), l.estimate ? "yes" : ""]),
      [month, "Total", "Net profit", centsToDecimal(pnl.netProfitCents), pnl.expenses.some((l) => l.estimate) ? "includes an estimate" : ""],
    ],
  );
}

/** Account names in the accountant's file, for the lines that are not expense categories. */
export const INCOME_ACCOUNTS = {
  payment: "Sales:Credit Repair Services",
  refund: "Sales:Refunds & Allowances",
  chargeback: "Sales:Chargebacks",
  monitoring: "Other Income:Monitoring Commissions",
  other: "Other Income",
  fees: "Merchant Account Fees",
  partners: "Commissions & Referral Fees",
} as const;

/**
 * The QuickBooks / Xero-friendly file: Date (MM/DD/YYYY), Account,
 * Description, Amount (money in positive, money out negative), Class. One
 * line per money movement in the months asked for. No client names: the
 * invoice number identifies a charge.
 */
export function accountantCsv(entries: readonly LedgerEntry[], expenses: readonly Expense[], months: readonly MonthKey[], partnerPaid: ReadonlyArray<{ at: string; cents: number; partner: string }> = []): string {
  const inMonths = new Set(months);
  const rows: Array<[string, string, string, string, string]> = [];
  for (const e of entries) {
    if (!inMonths.has(e.month) || e.amountCents === 0) continue;
    const cls = e.planType ? PLAN_TYPE_LABEL[e.planType].en : e.chargeId ? "Per round" : "Other";
    const account =
      e.kind === "payment" ? INCOME_ACCOUNTS.payment : e.kind === "refund" || e.kind === "void" ? INCOME_ACCOUNTS.refund : e.kind === "chargeback_lost" ? INCOME_ACCOUNTS.chargeback : e.kind === "monitoring_commission" ? INCOME_ACCOUNTS.monitoring : INCOME_ACCOUNTS.other;
    const what = e.invoice ? `${LEDGER_KIND_LABEL[e.kind].en} ${e.invoice}${e.roundNumber ? ` (round ${e.roundNumber})` : ""}` : `${LEDGER_KIND_LABEL[e.kind].en}${e.detail ? `: ${e.detail}` : ""}`;
    rows.push([e.day, account, what, centsToDecimal(e.amountCents), cls]);
    if (e.kind === "payment" && e.feeEstimateCents > 0 && !expenses.some((x) => !x.voidedAt && x.category === "processing_fees" && monthOf(x.spentOn) === e.month)) {
      rows.push([e.day, INCOME_ACCOUNTS.fees, `Processing fee ESTIMATE ${e.invoice ?? ""}`.trim(), centsToDecimal(-e.feeEstimateCents), cls]);
    }
  }
  for (const x of activeExpenses(expenses)) {
    if (!inMonths.has(monthOf(x.spentOn))) continue;
    const c = CATEGORIES.find((k) => k.key === x.category)!;
    rows.push([x.spentOn, c.account, `${x.vendor}${x.description ? `: ${x.description}` : ""}${x.source === "adjustment" ? ` (adjustment to ${x.adjustsMonth})` : ""}`, centsToDecimal(-x.amountCents), c.group]);
  }
  for (const p of partnerPaid) {
    const day = new Date(p.at).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    if (!inMonths.has(day.slice(0, 7))) continue;
    rows.push([day, INCOME_ACCOUNTS.partners, `Partner commission: ${p.partner}`, centsToDecimal(-p.cents), "partners"]);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  return toCsv(["Date", "Account", "Description", "Amount", "Class"], rows.map((r) => [usDate(r[0]), r[1], r[2], r[3], r[4]]));
}
