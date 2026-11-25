import type { CommissionClient, CommissionLine } from "./commissions";
import type { MonitoringCheck } from "./monitoring";

// The commissions screen's data, from the database or from the demo. Rows
// → lines; the demo's invented statement lines (labelled on the screen).

type Row = Record<string, unknown>;

const text = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const iso = (v: unknown) => (v == null || v === "" ? null : new Date(String(v)).toISOString());
const day = (v: unknown) => (v == null || v === "" ? null : v instanceof Date ? v.toISOString().slice(0, 10) : text(v).slice(0, 10));

export function commissionLineFromRow(r: Row): CommissionLine {
  return {
    id: text(r.id),
    clientId: r.user_id ? text(r.user_id) : null,
    provider: text(r.provider) || "IdentityIQ",
    month: text(r.month),
    amountCents: Number(r.amount_cents) || 0,
    kind: r.kind === "reversal" ? "reversal" : "commission",
    memberRef: text(r.member_ref),
    paidOn: day(r.paid_on),
    source: r.source === "csv" ? "csv" : "manual",
    note: text(r.note),
    postedIncomeId: r.posted_income_id ? text(r.posted_income_id) : null,
    voidedAt: iso(r.voided_at),
    voidReason: r.void_reason ? text(r.void_reason) : null,
    by: text(r.created_by_name) || "equipo",
    at: iso(r.created_at) ?? "",
  };
}

export interface CommissionsView {
  lines: CommissionLine[];
  clients: CommissionClient[];
  /** Monitoring income Accounting already has, by month of the day received (YYYY-MM → cents). */
  booksByMonth: Record<string, number>;
}

/** DEMO DATA: two months of an invented IdentityIQ statement for the invented clients. */
export function demoCommissionLines(now: Date): CommissionLine[] {
  const month = (back: number) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    return d.toISOString().slice(0, 7);
  };
  const paid = (back: number) => `${month(back - 1)}-05`;
  const base = { provider: "IdentityIQ", kind: "commission" as const, source: "csv" as const, note: "", voidedAt: null, voidReason: null, by: "Carmen Ruiz" };
  return [
    { ...base, id: "dl-1", clientId: "c10", month: month(2), amountCents: 4000, memberRef: "Ernesto Villasenor", paidOn: paid(2), postedIncomeId: "demo-income", at: `${paid(2)}T15:00:00.000Z` },
    { ...base, id: "dl-2", clientId: "c13", month: month(2), amountCents: 4000, memberRef: "Paulina Arriaga", paidOn: paid(2), postedIncomeId: "demo-income", at: `${paid(2)}T15:00:00.000Z` },
    { ...base, id: "dl-3", clientId: "c10", month: month(1), amountCents: 4000, memberRef: "Ernesto Villasenor", paidOn: paid(1), postedIncomeId: null, at: `${paid(1)}T15:00:00.000Z` },
    { ...base, id: "dl-4", clientId: null, month: month(1), amountCents: 4000, memberRef: "R. Villalobos", paidOn: paid(1), postedIncomeId: null, at: `${paid(1)}T15:00:00.000Z` },
    { ...base, id: "dl-5", clientId: "c20", month: month(1), amountCents: -4000, kind: "reversal", memberRef: "Leticia Varela", paidOn: paid(1), postedIncomeId: null, at: `${paid(1)}T15:00:00.000Z` },
  ];
}

export function commissionClientsFrom(clients: ReadonlyArray<{ id: string; firstName: string; lastName: string; email?: string | null; monitoringChecks?: MonitoringCheck[] }>): CommissionClient[] {
  return clients.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`.trim(), email: c.email ?? null, checks: c.monitoringChecks ?? [] }));
}
