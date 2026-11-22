import { centsToDecimal, formatCents } from "./money";
import { PLAN_TYPE_LABEL, type PlanType } from "./plans";
import { receiptNumber } from "./receipts";
import { billingDate, PERIOD_DAYS, subscriptionPeriods } from "./rules";
import { unitWork } from "./schedule";
import type { Bilingual, BillingCharge, BillingContext, L, MethodKind } from "./types";

// Invoices, statements and exports. Every charge is an invoice: its number is
// given by the database when the charge is created (INV-2026-000123; a charge
// from before invoice numbers keeps its receipt number), and its status is
// read from the charge, its refund and its chargeback. Nothing here changes a
// record: these are views and files.

export type InvoiceStatus = "paid" | "processing" | "failed" | "refunded" | "voided" | "disputed";

export const INVOICE_STATUSES: readonly InvoiceStatus[] = ["paid", "processing", "failed", "refunded", "voided", "disputed"];

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, Bilingual> = {
  paid: { en: "Paid", es: "Pagado" },
  processing: { en: "Processing", es: "En proceso" },
  failed: { en: "Failed", es: "No pasó" },
  refunded: { en: "Refunded", es: "Reembolsado" },
  voided: { en: "Voided", es: "Anulado" },
  disputed: { en: "Disputed", es: "En disputa" },
};

export function invoiceNumber(charge: Pick<BillingCharge, "id" | "invoiceNumber">): string {
  return charge.invoiceNumber ?? receiptNumber(charge.id);
}

/** An open or lost chargeback makes it disputed; a void is told apart from a refund. */
export function invoiceStatus(charge: BillingCharge): InvoiceStatus {
  if (charge.chargeback && (charge.chargeback.status === "open" || charge.chargeback.status === "lost")) return "disputed";
  if (charge.status === "refunded") return charge.refund?.kind === "void" ? "voided" : "refunded";
  if (charge.status === "succeeded") return "paid";
  if (charge.status === "failed") return "failed";
  return "processing";
}

/** What the processor took: the charge less any referral credit applied to it. */
export function collectedCents(charge: Pick<BillingCharge, "amountCents" | "creditCents">): number {
  return Math.max(0, charge.amountCents - (charge.creditCents ?? 0));
}

// ── Processing fees: an ESTIMATE ────────────────────────────────────────
// What the processor keeps is in its own statements, not in our records. The
// rates below are assumptions for planning (high-risk card pricing is often
// 3.5–5% + a per-transaction fee; ACH is usually under 1% with a cap), set by
// the owner with NEXT_PUBLIC_BILLING_FEE_* once the merchant account's real
// pricing is known. Every screen and file labels the figure an estimate.

export interface FeeSchedule {
  cardBps: number;
  cardFixedCents: number;
  achBps: number;
  achFixedCents: number;
  achCapCents: number;
}

const int = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
};

export const FEE_SCHEDULE: FeeSchedule = {
  cardBps: int(process.env.NEXT_PUBLIC_BILLING_FEE_CARD_BPS, 390),
  cardFixedCents: int(process.env.NEXT_PUBLIC_BILLING_FEE_CARD_FIXED_CENTS, 30),
  achBps: int(process.env.NEXT_PUBLIC_BILLING_FEE_ACH_BPS, 100),
  achFixedCents: int(process.env.NEXT_PUBLIC_BILLING_FEE_ACH_FIXED_CENTS, 30),
  achCapCents: int(process.env.NEXT_PUBLIC_BILLING_FEE_ACH_CAP_CENTS, 500),
};

/** The estimated processing fee on money actually taken (0 when nothing was taken). */
export function feeEstimateCents(charge: BillingCharge, schedule: FeeSchedule = FEE_SCHEDULE): number {
  if (!charge.chargedAt) return 0;
  const taken = collectedCents(charge);
  if (taken === 0) return 0;
  if ((charge.methodKind ?? "card") === "ach") {
    return Math.min(schedule.achCapCents, Math.round((taken * schedule.achBps) / 10_000) + schedule.achFixedCents);
  }
  return Math.round((taken * schedule.cardBps) / 10_000) + schedule.cardFixedCents;
}

// ── Rows for the staff list and the files ───────────────────────────────

export interface InvoiceSource {
  clientId: string;
  clientName: string;
  charges: BillingCharge[];
  planType: PlanType | null;
  /** The method kind on file, for charges recorded before the method kind was kept. */
  methodKind: MethodKind | null;
}

export interface InvoiceRow {
  chargeId: string;
  invoice: string;
  clientId: string;
  clientName: string;
  /** When the money was taken, or the charge was created when none was (ISO). */
  date: string;
  workDate: string;
  planType: PlanType | null;
  work: string;
  amountCents: number;
  creditCents: number;
  collectedCents: number;
  refundedCents: number;
  feeEstimateCents: number;
  netCents: number;
  method: MethodKind;
  status: InvoiceStatus;
  chargebackStatus: string | null;
}

export function invoiceRows(sources: InvoiceSource[], locale: L = "en", schedule: FeeSchedule = FEE_SCHEDULE): InvoiceRow[] {
  return sources
    .flatMap((source) =>
      source.charges.map((charge): InvoiceRow => {
        const status = invoiceStatus(charge);
        const taken = charge.chargedAt ? collectedCents(charge) : 0;
        const refunded = charge.refund?.completedAt ? charge.refund.amountCents : 0;
        const lost = charge.chargeback?.status === "lost" ? charge.chargeback.amountCents : 0;
        const fee = feeEstimateCents({ ...charge, methodKind: charge.methodKind ?? source.methodKind ?? "card" }, schedule);
        return {
          chargeId: charge.id,
          invoice: invoiceNumber(charge),
          clientId: source.clientId,
          clientName: source.clientName,
          date: charge.chargedAt ?? charge.createdAt,
          workDate: charge.workDate,
          planType: charge.planType ?? source.planType,
          work: unitWork(charge, locale),
          amountCents: charge.amountCents,
          creditCents: charge.creditCents ?? 0,
          collectedCents: taken,
          refundedCents: refunded,
          feeEstimateCents: fee,
          netCents: taken - refunded - lost - fee,
          method: charge.methodKind ?? source.methodKind ?? "card",
          status,
          chargebackStatus: charge.chargeback?.status ?? null,
        };
      }),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
}

export interface InvoiceFilter {
  status?: InvoiceStatus | "all";
  method?: MethodKind | "all";
  planType?: PlanType | "all";
  /** YYYY-MM-DD, inclusive, on the Texas calendar date of `date`. */
  from?: string;
  to?: string;
  query?: string;
}

const texasDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

export function filterInvoices(rows: InvoiceRow[], f: InvoiceFilter): InvoiceRow[] {
  const q = f.query?.trim().toLowerCase() ?? "";
  return rows.filter(
    (r) =>
      (!f.status || f.status === "all" || r.status === f.status) &&
      (!f.method || f.method === "all" || r.method === f.method) &&
      (!f.planType || f.planType === "all" || r.planType === f.planType) &&
      (!f.from || texasDay(r.date) >= f.from) &&
      (!f.to || texasDay(r.date) <= f.to) &&
      (!q || r.clientName.toLowerCase().includes(q) || r.invoice.toLowerCase().includes(q)),
  );
}

// ── CSV ─────────────────────────────────────────────────────────────────

/** One CSV cell: quoted when needed, and never read by a spreadsheet as a formula. */
export function csvCell(value: string | number | null): string {
  let text = value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: Array<Array<string | number | null>>): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Every transaction, with everything we know about it. */
export function transactionsCsv(rows: InvoiceRow[]): string {
  return toCsv(
    ["Date", "Invoice", "Client", "Client ID", "Plan", "Work", "Amount", "Credit", "Collected", "Refunded", "Fee (estimate)", "Net", "Method", "Status", "Chargeback", "Charge ID"],
    rows.map((r) => [
      texasDay(r.date),
      r.invoice,
      r.clientName,
      r.clientId,
      r.planType ? PLAN_TYPE_LABEL[r.planType].en : "Per round",
      r.work,
      centsToDecimal(r.amountCents),
      centsToDecimal(r.creditCents),
      centsToDecimal(r.collectedCents),
      centsToDecimal(r.refundedCents),
      centsToDecimal(r.feeEstimateCents),
      centsToDecimal(r.netCents),
      r.method === "ach" ? "ACH" : "Card",
      INVOICE_STATUS_LABEL[r.status].en,
      r.chargebackStatus ?? "",
      r.chargeId,
    ]),
  );
}

/** The QuickBooks-friendly file: one line per invoice, US dates, plain numbers. */
export function quickBooksCsv(rows: InvoiceRow[]): string {
  const us = (iso: string) => {
    const [y, m, d] = texasDay(iso).split("-");
    return `${m}/${d}/${y}`;
  };
  return toCsv(
    ["Date", "Invoice", "Client", "Amount", "Fee Estimate", "Net", "Method", "Status"],
    rows.map((r) => [
      us(r.date),
      r.invoice,
      r.clientName,
      centsToDecimal(r.collectedCents),
      centsToDecimal(r.feeEstimateCents),
      centsToDecimal(r.netCents),
      r.method === "ach" ? "ACH" : "Card",
      INVOICE_STATUS_LABEL[r.status].en,
    ]),
  );
}

// ── Monthly statements for "Mis pagos" ──────────────────────────────────

export interface StatementLine {
  kind: "charge" | "refund" | "no_work";
  at: string;
  text: string;
  cents: number | null;
  invoice?: string;
  status?: InvoiceStatus;
}

export interface StatementMonth {
  /** "2026-11" */
  key: string;
  label: string;
  lines: StatementLine[];
  chargedCents: number;
  refundedCents: number;
}

/** "noviembre de 2026" / "November 2026". */
function monthLabel(key: string, locale: L): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 15)).toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

const monthOf = (iso: string) => texasDay(iso).slice(0, 7);

/**
 * The client's charges month by month: what was charged and for which work,
 * what was refunded, and (subscription) each 30-day period that ended with
 * no work, as "No work this month, no charge". Newest month first.
 */
export function statementMonths(context: BillingContext, now: Date, locale: L): StatementMonth[] {
  const months = new Map<string, StatementMonth>();
  const month = (iso: string) => {
    const key = monthOf(iso);
    if (!months.has(key)) months.set(key, { key, label: monthLabel(key, locale), lines: [], chargedCents: 0, refundedCents: 0 });
    return months.get(key)!;
  };
  for (const charge of context.account.charges) {
    const at = charge.chargedAt ?? charge.createdAt;
    const m = month(at);
    const status = invoiceStatus(charge);
    m.lines.push({ kind: "charge", at, text: unitWork(charge, locale), cents: charge.amountCents, invoice: invoiceNumber(charge), status });
    if (charge.chargedAt) m.chargedCents += collectedCents(charge);
    if (charge.refund?.completedAt) {
      const r = month(charge.refund.completedAt);
      r.lines.push({
        kind: "refund",
        at: charge.refund.completedAt,
        text: locale === "es" ? `Reembolso de ${invoiceNumber(charge)}` : `Refund of ${invoiceNumber(charge)}`,
        cents: -charge.refund.amountCents,
      });
      r.refundedCents += charge.refund.amountCents;
    }
  }
  if (context.plan?.terms.type === "subscription") {
    for (const period of subscriptionPeriods(context, now)) {
      if (!period.ended || period.rounds.length > 0) continue;
      month(period.end).lines.push({
        kind: "no_work",
        at: period.end,
        text:
          locale === "es"
            ? `Sin trabajo este mes, sin cobro (${billingDate(period.start, "es")} – ${billingDate(period.end, "es")})`
            : `No work this month, no charge (${billingDate(period.start, "en")} – ${billingDate(period.end, "en")})`,
        cents: null,
      });
    }
  }
  return [...months.values()]
    .map((m) => ({ ...m, lines: m.lines.sort((a, b) => b.at.localeCompare(a.at)) }))
    .sort((a, b) => b.key.localeCompare(a.key));
}

/** "Charged so far: $178.00 of $534.00". */
export function chargedSoFar(context: BillingContext, locale: L): string | null {
  if (!context.plan) return null;
  const charged = context.account.charges.filter((c) => c.status !== "refunded").reduce((n, c) => n + c.amountCents, 0);
  const max = formatCents(context.plan.effective.maxTotalCents);
  return locale === "es" ? `Cobrado hasta ahora: ${formatCents(charged)} de ${max}` : `Charged so far: ${formatCents(charged)} of ${max}`;
}

export { PERIOD_DAYS };
