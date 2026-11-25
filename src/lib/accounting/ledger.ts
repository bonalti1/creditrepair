import { feeEstimateCents } from "../billing/invoices";
import type { PlanType } from "../billing/plans";
import type { MethodKind } from "../billing/types";
import type { ChargeFact } from "./facts";
import { dayOf, monthOf, type MonthKey } from "./periods";
import type { OtherIncome } from "./types";

// The income ledger, built from the billing records, never typed in.
//
// THE MONEY RULE (one, used by every number in the books):
//   - Revenue is money a processor actually took for a real charge: the
//     charge's collected amount (amount less a referral credit) on the day it
//     was taken (charged_at). A test charge (demo gateway) is never revenue.
//   - A refund or void counts against revenue on the day the processor
//     confirmed it. One still being sent counts nothing yet.
//   - A chargeback counts against revenue when it is lost or accepted, on the
//     day it was received. An open one is shown, at risk, but not counted; a
//     won one counts nothing.
//   - A declined payment is never revenue; it is listed (amount 0) so the
//     failed attempts are visible. An ACH payment the bank sent back leaves
//     the charge unpaid, so it was never counted; the return is listed too.
//   - Money from elsewhere (monitoring commissions) is its own line.
//
// Cash basis: everything on the day money moved. Nothing is "earned" here
// before it is collected; what is owed is accounts receivable (summary.ts).

export type LedgerKind =
  | "payment"
  | "refund"
  | "void"
  | "refund_pending"
  | "chargeback_lost"
  | "chargeback_open"
  | "chargeback_won"
  | "ach_return"
  | "failed_attempt"
  | "processing"
  | "monitoring_commission"
  | "other_income";

export const LEDGER_KIND_LABEL: Record<LedgerKind, { en: string; es: string }> = {
  payment: { en: "Payment collected", es: "Pago cobrado" },
  refund: { en: "Refund", es: "Reembolso" },
  void: { en: "Void", es: "Anulación" },
  refund_pending: { en: "Refund being sent", es: "Reembolso en proceso" },
  chargeback_lost: { en: "Chargeback (lost)", es: "Contracargo (perdido)" },
  chargeback_open: { en: "Chargeback (open, at risk)", es: "Contracargo (abierto, en riesgo)" },
  chargeback_won: { en: "Chargeback (won)", es: "Contracargo (ganado)" },
  ach_return: { en: "ACH returned", es: "ACH devuelto" },
  failed_attempt: { en: "Payment declined", es: "Pago rechazado" },
  processing: { en: "Processing", es: "En proceso" },
  monitoring_commission: { en: "Monitoring commission", es: "Comisión de monitoreo" },
  other_income: { en: "Other income", es: "Otro ingreso" },
};

export interface LedgerEntry {
  id: string;
  /** ISO instant, or a calendar day for income entered by hand. */
  at: string;
  day: string;
  month: MonthKey;
  kind: LedgerKind;
  /** Signed: money in is positive, money out negative, 0 for what moved nothing. */
  amountCents: number;
  /** For entries that count nothing: the amount involved (a declined charge, an open chargeback). */
  involvedCents: number;
  /** Estimated processor fee on a payment (an estimate, labelled so). */
  feeEstimateCents: number;
  chargeId: string | null;
  clientId: string | null;
  clientName: string | null;
  invoice: string | null;
  planType: PlanType | null;
  roundNumber: number | null;
  method: MethodKind | null;
  processor: string | null;
  /** The processor's code (decline, ACH return), or the source of other income. */
  detail: string | null;
}

function entry(fact: ChargeFact, kind: LedgerKind, at: string, amountCents: number, extra: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: `${kind}:${fact.id}`,
    at,
    day: dayOf(at),
    month: monthOf(at),
    kind,
    amountCents,
    involvedCents: Math.abs(amountCents),
    feeEstimateCents: 0,
    chargeId: fact.id,
    clientId: fact.clientId,
    clientName: fact.clientName,
    invoice: fact.invoice,
    planType: fact.planType,
    roundNumber: fact.roundNumber,
    method: fact.method,
    processor: fact.gateway,
    detail: null,
    ...extra,
  };
}

/** Every money movement of one real charge. A test charge has none. */
export function chargeEntries(fact: ChargeFact): LedgerEntry[] {
  if (fact.test) return [];
  const c = fact.charge;
  const out: LedgerEntry[] = [];
  const taken = fact.collectedCents;
  if (c.chargedAt && taken > 0) {
    out.push(entry(fact, "payment", c.chargedAt, taken, { feeEstimateCents: feeEstimateCents({ ...c, methodKind: fact.method }) }));
  }
  if (c.refund) {
    const back = Math.min(c.refund.amountCents, taken || c.refund.amountCents);
    if (c.refund.completedAt) out.push(entry(fact, c.refund.kind === "void" ? "void" : "refund", c.refund.completedAt, -back, { detail: c.refund.reason }));
    else out.push(entry(fact, "refund_pending", c.refund.at, 0, { involvedCents: back, detail: c.refund.reason }));
  }
  if (c.chargeback) {
    const cb = c.chargeback;
    const kind: LedgerKind = cb.status === "lost" || cb.status === "accepted" ? "chargeback_lost" : cb.status === "won" ? "chargeback_won" : "chargeback_open";
    out.push(entry(fact, kind, cb.receivedAt, kind === "chargeback_lost" ? -cb.amountCents : 0, { involvedCents: cb.amountCents, detail: cb.reasonCode }));
  }
  if (c.status === "failed") {
    const at = c.lastAttemptAt ?? c.createdAt;
    if (c.returnCode) out.push(entry(fact, "ach_return", at, 0, { involvedCents: fact.amountCents, detail: c.returnCode }));
    else out.push(entry(fact, "failed_attempt", at, 0, { involvedCents: fact.amountCents, detail: c.failureCode }));
  }
  if (c.status === "pending") out.push(entry(fact, "processing", c.createdAt, 0, { involvedCents: fact.amountCents }));
  return out;
}

export function otherIncomeEntries(income: readonly OtherIncome[]): LedgerEntry[] {
  return income
    .filter((i) => !i.voidedAt)
    .map((i) => ({
      id: `income:${i.id}`,
      at: i.receivedOn,
      day: i.receivedOn,
      month: monthOf(i.receivedOn),
      kind: i.kind === "monitoring_commission" ? ("monitoring_commission" as const) : ("other_income" as const),
      amountCents: i.amountCents,
      involvedCents: Math.abs(i.amountCents),
      feeEstimateCents: 0,
      chargeId: null,
      clientId: null,
      clientName: null,
      invoice: null,
      planType: null,
      roundNumber: null,
      method: null,
      processor: null,
      detail: i.source,
    }));
}

/** The whole ledger, newest first. */
export function buildLedger(facts: readonly ChargeFact[], income: readonly OtherIncome[]): LedgerEntry[] {
  return [...facts.flatMap(chargeEntries), ...otherIncomeEntries(income)].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

export interface LedgerFilter {
  month?: MonthKey | "all";
  kind?: LedgerKind | "all" | "money";
  query?: string;
}

export function filterLedger(entries: readonly LedgerEntry[], f: LedgerFilter): LedgerEntry[] {
  const q = f.query?.trim().toLowerCase() ?? "";
  return entries.filter(
    (e) =>
      (!f.month || f.month === "all" || e.month === f.month) &&
      (!f.kind || f.kind === "all" || (f.kind === "money" ? e.amountCents !== 0 : e.kind === f.kind)) &&
      (!q || (e.invoice ?? "").toLowerCase().includes(q) || (e.clientName ?? "").toLowerCase().includes(q) || (e.detail ?? "").toLowerCase().includes(q)),
  );
}

/** How many charges were left out as tests, and what they were for: shown, never counted. */
export function testChargesExcluded(facts: readonly ChargeFact[]): { count: number; amountCents: number } {
  const tests = facts.filter((f) => f.test);
  return { count: tests.length, amountCents: tests.reduce((a, f) => a + f.amountCents, 0) };
}
