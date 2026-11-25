import { parseDay } from "../accounting/csv";
import { parseMoney } from "../accounting/money";
import type { MonitoringCheck } from "./monitoring";

// Monitoring referral commissions (migration 0041, monitoring_commissions;
// /equipo/monitoreo, administrators; docs/FULFILLMENT.md, "Monitoring").
//
// What the monitoring provider (IdentityIQ) pays Credalti for a client who
// enrolled through our link, recorded by hand or from the provider's
// statement CSV, then reconciled per client and month against what the team
// recorded about each client's monitoring (fulfillment/monitoring.ts).
//
// THE MONEY RULE (src/lib/accounting/ledger.ts) counts money from elsewhere
// as its own line, on the day it moved (cash basis), from other_income. So
// these lines never count by themselves: "Post to the books" is an explicit
// reconciliation step that adds ONE other_income row (kind
// monitoring_commission) for the month's unposted lines, dated the day the
// provider paid. Automatic posting would risk counting the same money twice
// (Accounting already lets a person type or import monitoring income), so it
// is not done; posting warns when Accounting already has monitoring income
// for that month.
//
// Commission amounts are never shown to a client or a partner (only
// administrators read the table), and the commission disclosure on the
// monitoring step (src/lib/monitoring/offer.ts) is unchanged.

export interface CommissionLine {
  id: string;
  clientId: string | null;
  provider: string;
  /** YYYY-MM: the period the commission is for. */
  month: string;
  amountCents: number;
  kind: "commission" | "reversal";
  memberRef: string;
  paidOn: string | null;
  source: "manual" | "csv";
  note: string;
  postedIncomeId: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  by: string;
  at: string;
}

export interface CommissionClient {
  id: string;
  name: string;
  email: string | null;
  checks: readonly MonitoringCheck[];
}

/** "2026-11" from "2026-11-03", "11/2026", "Nov 2026", "11/03/2026"; null otherwise. */
export function toMonth(value: string): string | null {
  const v = value.trim();
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return v;
  const mmYyyy = v.match(/^(0?[1-9]|1[0-2])[/-](\d{4})$/);
  if (mmYyyy) return `${mmYyyy[2]}-${mmYyyy[1]!.padStart(2, "0")}`;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const named = v.toLowerCase().match(/^([a-z]{3})[a-z]*\.?\s+(\d{4})$/);
  if (named && months.includes(named[1]!)) return `${named[2]}-${String(months.indexOf(named[1]!) + 1).padStart(2, "0")}`;
  const day = parseDay(v);
  return day ? day.slice(0, 7) : null;
}

// ── The statement CSV ───────────────────────────────────────────────────

export type StatementField = "month" | "amount" | "member" | "email" | "paidOn";

/**
 * Column names a partner statement may use. IDIQ's partner statement format
 * is not public (docs/IDENTITYIQ.md): UNVERIFIED. The screen shows the
 * detected columns and lets the administrator choose others.
 */
export const STATEMENT_ALIASES: Record<StatementField, readonly string[]> = {
  month: ["period", "month", "commission period", "statement period", "enrollment month", "enrollment date", "date", "transaction date"],
  amount: ["commission", "amount", "commission amount", "payout", "earned", "total", "net"],
  member: ["member", "member name", "customer", "customer name", "name", "member id", "customer id", "subscriber"],
  email: ["email", "member email", "customer email"],
  paidOn: ["paid on", "paid date", "payment date", "payout date", "paid"],
};

export type StatementMapping = Partial<Record<StatementField, number>>;

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function detectStatementMapping(headers: readonly string[]): StatementMapping {
  const normalized = headers.map(norm);
  const mapping: StatementMapping = {};
  const used = new Set<number>();
  for (const field of Object.keys(STATEMENT_ALIASES) as StatementField[]) {
    for (const alias of STATEMENT_ALIASES[field]) {
      const i = normalized.findIndex((h, idx) => h === alias && !used.has(idx));
      if (i >= 0) {
        mapping[field] = i;
        used.add(i);
        break;
      }
    }
  }
  return mapping;
}

export interface StatementLine {
  line: number;
  month: string | null;
  amountCents: number | null;
  memberRef: string;
  email: string | null;
  paidOn: string | null;
  problem: "no_month" | "no_amount" | "zero" | null;
  /** SHA-256 of the line's content (month, amount, member, paid day): the same line is never imported twice. */
  fingerprintSource: string;
}

const SSN_LIKE = /\b\d{3}-?\d{2}-?\d{4}\b/g;

export function readStatement(rows: readonly (readonly string[])[], mapping: StatementMapping): StatementLine[] {
  const [, ...data] = rows;
  return data.map((cells, i) => {
    const get = (f: StatementField) => (mapping[f] === undefined ? "" : (cells[mapping[f]!] ?? "").trim());
    const month = toMonth(get("month"));
    const amountCents = parseMoney(get("amount"));
    // A member id that looks like an SSN is never kept.
    const memberRef = get("member").replace(SSN_LIKE, "").trim().slice(0, 120);
    const emailRaw = get("email").toLowerCase();
    const paidOn = get("paidOn") ? parseDay(get("paidOn")) : null;
    const problem = !month ? "no_month" : amountCents === null ? "no_amount" : amountCents === 0 ? "zero" : null;
    return {
      line: i + 2,
      month,
      amountCents,
      memberRef,
      email: /^[^@ ]+@[^@ ]+\.[a-z]{2,24}$/.test(emailRaw) ? emailRaw : null,
      paidOn,
      problem,
      fingerprintSource: [month, amountCents, memberRef.toLowerCase(), emailRaw, paidOn].join("|"),
    };
  });
}

// ── Matching and reconciliation ─────────────────────────────────────────

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The client a statement line most likely is: same email, or the same full name. A suggestion: a person confirms. */
export function suggestClient(line: { memberRef: string; email?: string | null }, clients: readonly CommissionClient[]): CommissionClient | null {
  if (line.email) {
    const byEmail = clients.filter((c) => c.email && c.email.toLowerCase() === line.email);
    if (byEmail.length === 1) return byEmail[0]!;
  }
  const ref = plain(line.memberRef);
  if (!ref) return null;
  const byName = clients.filter((c) => plain(c.name) === ref || plain(c.name.split(" ").reverse().join(" ")) === ref);
  return byName.length === 1 ? byName[0]! : null;
}

export type MonthStatus = "paid" | "missing" | "reversed" | "not_expected";

export interface ClientMonthRow {
  clientId: string;
  name: string;
  /** The team recorded that they enrolled through our link. */
  expected: boolean;
  netCents: number;
  lines: number;
  status: MonthStatus;
}

export interface MonthReconciliation {
  month: string;
  rows: ClientMonthRow[];
  unmatched: CommissionLine[];
  totalCents: number;
  postedCents: number;
  unpostedCents: number;
  unpostedLineIds: string[];
}

const live = (l: CommissionLine) => !l.voidedAt;

/** True when the newest check at or before the month's end says they enrolled through our link and were active. */
export function expectedInMonth(checks: readonly MonitoringCheck[], month: string): boolean {
  const end = `${month}-31`;
  const before = [...checks].filter((c) => c.checkedOn <= end).sort((a, b) => b.checkedOn.localeCompare(a.checkedOn) || b.at.localeCompare(a.at));
  const newest = before[0];
  const viaLink = before.find((c) => c.enrolledViaLink !== "unknown")?.enrolledViaLink === "yes";
  return Boolean(newest && viaLink && newest.status === "active");
}

/** One month, per client: paid, missing (expected and nothing came), reversed, or paid without our record of a link enrollment. */
export function reconcileMonth(month: string, lines: readonly CommissionLine[], clients: readonly CommissionClient[]): MonthReconciliation {
  const inMonth = lines.filter((l) => l.month === month && live(l));
  const byClient = new Map<string, CommissionLine[]>();
  for (const l of inMonth) if (l.clientId) byClient.set(l.clientId, [...(byClient.get(l.clientId) ?? []), l]);
  const rows: ClientMonthRow[] = [];
  for (const c of clients) {
    const mine = byClient.get(c.id) ?? [];
    const expected = expectedInMonth(c.checks, month);
    if (!expected && mine.length === 0) continue;
    const net = mine.reduce((s, l) => s + l.amountCents, 0);
    const status: MonthStatus = mine.length === 0 ? "missing" : net <= 0 ? "reversed" : expected ? "paid" : "not_expected";
    rows.push({ clientId: c.id, name: c.name, expected, netCents: net, lines: mine.length, status });
  }
  const order: Record<MonthStatus, number> = { missing: 0, not_expected: 1, reversed: 2, paid: 3 };
  rows.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  const unposted = inMonth.filter((l) => !l.postedIncomeId);
  return {
    month,
    rows,
    unmatched: inMonth.filter((l) => !l.clientId),
    totalCents: inMonth.reduce((s, l) => s + l.amountCents, 0),
    postedCents: inMonth.filter((l) => l.postedIncomeId).reduce((s, l) => s + l.amountCents, 0),
    unpostedCents: unposted.reduce((s, l) => s + l.amountCents, 0),
    unpostedLineIds: unposted.map((l) => l.id),
  };
}

export type PostProblem = "nothing_to_post" | "not_positive" | "needs_paid_day" | "existing_income";

/**
 * Whether this month's unposted lines may go to the books as one other_income
 * row, and with what amount and day. `existingMonitoringIncome`: monitoring
 * income Accounting already has for that month (typed or imported there):
 * posting again needs the administrator's confirmation that it is not the
 * same money.
 */
export function postingPlan(
  rec: MonthReconciliation,
  input: { receivedOn: string | null; existingMonitoringIncomeCents: number; confirmNotDuplicate: boolean },
): { ok: true; amountCents: number; receivedOn: string; lineIds: string[] } | { ok: false; problem: PostProblem } {
  if (rec.unpostedLineIds.length === 0) return { ok: false, problem: "nothing_to_post" };
  if (rec.unpostedCents <= 0) return { ok: false, problem: "not_positive" };
  if (!input.receivedOn || !/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn)) return { ok: false, problem: "needs_paid_day" };
  if (input.existingMonitoringIncomeCents > 0 && !input.confirmNotDuplicate) return { ok: false, problem: "existing_income" };
  return { ok: true, amountCents: rec.unpostedCents, receivedOn: input.receivedOn, lineIds: rec.unpostedLineIds };
}

/** The other_income source line: "IdentityIQ commissions 2026-11 (4 lines)". */
export function incomeSource(provider: string, month: string, lines: number): string {
  return `${provider} commissions ${month} (${lines} ${lines === 1 ? "line" : "lines"})`.slice(0, 120);
}

// ── The words ───────────────────────────────────────────────────────────

type Lang = "en" | "es";

export const MONTH_STATUS_LABEL: Record<Lang, Record<MonthStatus, string>> = {
  en: { paid: "Paid", missing: "Expected, not paid", reversed: "Reversed", not_expected: "Paid, no link enrollment on record" },
  es: { paid: "Pagada", missing: "Esperada, sin pago", reversed: "Revertida", not_expected: "Pagada, sin inscripción con enlace registrada" },
};

export const POST_PROBLEM_TEXT: Record<Lang, Record<PostProblem, string>> = {
  en: {
    nothing_to_post: "Everything for this month is already in the books.",
    not_positive: "This month nets to zero or less. Record the reversal as an adjustment in Accounting instead.",
    needs_paid_day: "Enter the day the provider paid: the books count money on the day it moved.",
    existing_income: "Accounting already has monitoring income for this month. Confirm it is not the same money before posting.",
  },
  es: {
    nothing_to_post: "Todo lo de este mes ya está en los libros.",
    not_positive: "Este mes suma cero o menos. Registra la reversión como un ajuste en Contabilidad.",
    needs_paid_day: "Escribe el día en que pagó el proveedor: los libros cuentan el dinero el día en que se movió.",
    existing_income: "Contabilidad ya tiene ingresos de monitoreo de este mes. Confirma que no es el mismo dinero antes de pasarlo.",
  },
};
