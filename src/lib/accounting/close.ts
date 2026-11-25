import { activeExpenses, isClosed, recurringDue } from "./expenses";
import { monthEnded, monthOf, type MonthKey } from "./periods";
import type { Reconciliation } from "./reconcile";
import { snapshotOf, type MonthTotals } from "./summary";
import type { AccountingBook, Bilingual, MonthTotalsSnapshot } from "./types";

// Closing a month: its figures are kept as they were that day, and nothing
// dated in it can be added, changed or voided afterwards (the database
// refuses it: trigger accounting_closed_month_guard). A mistake found later
// is fixed with an ADJUSTMENT: a new, append-only line dated in the closed
// month and marked as such, shown apart from the closed figures ("drift").
// There is no reopen.

export type CloseCheck = { ok: true; snapshot: MonthTotalsSnapshot } | { ok: false; message: Bilingual };

export function checkClose(month: MonthKey, totals: MonthTotals, book: Pick<AccountingBook, "closes">, now: Date): CloseCheck {
  if (isClosed(month, book.closes)) return { ok: false, message: { en: "This month is already closed.", es: "Este mes ya está cerrado." } };
  if (!monthEnded(month, now)) return { ok: false, message: { en: "A month can be closed once it is over.", es: "Un mes se puede cerrar cuando ya terminó." } };
  return { ok: true, snapshot: snapshotOf(totals) };
}

export interface ChecklistItem {
  key: string;
  done: boolean;
  text: Bilingual;
}

/** What to look at before closing. Advice, not a gate: the owner decides. */
export function closeChecklist(month: MonthKey, book: AccountingBook, recon: Reconciliation | null, today: string): ChecklistItem[] {
  const expenses = activeExpenses(book.expenses).filter((e) => monthOf(e.spentOn) === month);
  const due = recurringDue(book.recurring, book.expenses, [month], today, book.closes);
  const noReceipt = expenses.filter((e) => !e.receipt && e.source !== "adjustment").length;
  const statement = book.imports.some((i) => i.kind === "bank_statement" && monthOf(i.createdAt) >= month);
  const open = recon ? recon.counts.amount_mismatch + recon.counts.processor_only + recon.counts.app_only + recon.counts.suggested : null;
  const fees = expenses.some((e) => e.category === "processing_fees");
  return [
    { key: "recurring", done: due.length === 0, text: { en: due.length ? `${due.length} monthly expense(s) not posted yet` : "Monthly expenses posted", es: due.length ? `${due.length} gasto(s) mensual(es) sin registrar` : "Gastos mensuales registrados" } },
    { key: "bank", done: statement, text: { en: "Bank statement imported", es: "Estado de cuenta del banco importado" } },
    { key: "recon", done: open === 0, text: { en: open === null ? "Processor export not imported" : open ? `${open} reconciliation line(s) to review` : "Processor export reconciled", es: open === null ? "Exportación del procesador sin importar" : open ? `${open} línea(s) de conciliación por revisar` : "Exportación del procesador conciliada" } },
    { key: "fees", done: fees, text: { en: fees ? "Processor fees entered from the statement" : "Processor fees are still the estimate", es: fees ? "Comisiones del procesador registradas del estado de cuenta" : "Las comisiones del procesador siguen siendo el estimado" } },
    { key: "receipts", done: noReceipt === 0, text: { en: noReceipt ? `${noReceipt} expense(s) without a receipt` : "Every expense has its receipt", es: noReceipt ? `${noReceipt} gasto(s) sin recibo` : "Cada gasto tiene su recibo" } },
  ];
}

/** Live figures of a closed month against what was closed: the adjustments since. */
export function drift(closed: MonthTotalsSnapshot, live: MonthTotals): { netProfitCents: number; changed: boolean } {
  const d = live.netProfitCents - closed.netProfitCents;
  return { netProfitCents: d, changed: d !== 0 };
}
