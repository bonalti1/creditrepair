import type { StaffClient } from "../staff/types";
import { isAdvertising } from "./categories";
import { activeExpenses } from "./expenses";
import type { ChargeFact } from "./facts";
import { buildLedger } from "./ledger";
import { dayOf } from "./periods";
import type { Bilingual, Expense } from "./types";

// Unit economics: what a client costs to win and what they bring.
//
// Every figure is null, with the reason, when the data to compute it is not
// there: no ad spend entered → no cost per lead; nobody has left yet → no
// lifetime. Never a guess dressed as a number (the Books lesson).
//
// Ad spend comes from expenses in the advertising categories. A provider
// interface for reading spend from the ad platforms later is AdSpendSource
// (off: expenses only, no calls).

const DAY_MS = 86_400_000;
const MONTH_DAYS = 30.44;

export interface AdSpendSource {
  id: "expenses" | "meta_ads";
  /** Spend in cents between two calendar days, inclusive. */
  spendCents(from: string, to: string): number;
}

export function expensesAdSpend(expenses: readonly Expense[]): AdSpendSource {
  const ads = activeExpenses(expenses).filter((e) => isAdvertising(e.category));
  return { id: "expenses", spendCents: (from, to) => ads.filter((e) => e.spentOn >= from && e.spentOn <= to).reduce((a, e) => a + e.amountCents, 0) };
}

export type Missing = Bilingual;

export interface Figure {
  value: number | null;
  /** Why it is null. */
  missing: Missing | null;
}

const fig = (value: number | null, missing: Missing): Figure => (value === null || !Number.isFinite(value) ? { value: null, missing } : { value, missing: null });

export interface UnitEconomics {
  days: number;
  from: string;
  to: string;
  adSpendCents: number;
  leads: number;
  signed: number;
  paying: number;
  costPerLeadCents: Figure;
  costPerSignedCents: Figure;
  leadToSigned: Figure;
  /** Net collected per paying client, per month they were active. */
  revenuePerClientMonthCents: Figure;
  /** Net collected per client who ever paid, all time. */
  revenuePerClientCents: Figure;
  monthsActive: Figure;
  /** Share of the clients active at the window's start who stopped within it, per 30 days. */
  monthlyChurn: Figure;
  lifetimeValueCents: Figure;
  paybackMonths: Figure;
}

const NO_SPEND: Missing = { en: "No data yet: no ad spend entered for these days.", es: "Sin datos todavía: no hay gasto en publicidad en estos días." };
const NO_LEADS: Missing = { en: "No data yet: no leads in these days.", es: "Sin datos todavía: no hubo prospectos en estos días." };
const NO_SIGNED: Missing = { en: "No data yet: nobody signed in these days.", es: "Sin datos todavía: nadie firmó en estos días." };
const NO_PAYING: Missing = { en: "No data yet: no client has paid yet.", es: "Sin datos todavía: ningún cliente ha pagado." };
const NO_CHURN: Missing = { en: "Not enough data: no active client left in these days, so a lifetime can't be measured yet.", es: "Faltan datos: ningún cliente activo se fue en estos días, así que aún no se puede medir la duración." };

function endedAt(c: StaffClient): string | null {
  return [c.agreementCancelledAt, c.serviceEndRequestedAt].filter((d): d is string => Boolean(d)).sort()[0] ?? null;
}

export function unitEconomics(clients: readonly StaffClient[], facts: readonly ChargeFact[], spend: AdSpendSource, now: Date, days = 90): UnitEconomics {
  const start = new Date(now.getTime() - days * DAY_MS);
  const from = dayOf(start);
  const to = dayOf(now);
  const within = (iso: string | null | undefined) => Boolean(iso) && Date.parse(iso!) >= start.getTime() && Date.parse(iso!) <= now.getTime();
  const adSpendCents = spend.spendCents(from, to);
  const leads = clients.filter((c) => within(c.createdAt)).length;
  // Signed and kept: a cancellation inside the 3-day window is not a client.
  const signed = clients.filter((c) => within(c.agreementSignedAt) && !c.cancelledWithinWindow).length;

  // Revenue per client, from the ledger's money rule (real charges, refunds and lost chargebacks netted).
  const ledger = buildLedger(facts, []);
  const netByClient = new Map<string, number>();
  const firstPaid = new Map<string, number>();
  for (const e of ledger) {
    if (!e.clientId || e.amountCents === 0) continue;
    netByClient.set(e.clientId, (netByClient.get(e.clientId) ?? 0) + e.amountCents);
    if (e.kind === "payment") firstPaid.set(e.clientId, Math.min(firstPaid.get(e.clientId) ?? Infinity, Date.parse(e.at)));
  }
  const payingIds = [...firstPaid.keys()];
  const paying = payingIds.length;
  const totalNet = payingIds.reduce((a, id) => a + (netByClient.get(id) ?? 0), 0);
  const byId = new Map(clients.map((c) => [c.id, c]));
  const monthsOf = (id: string) => {
    const end = endedAt(byId.get(id) ?? ({} as StaffClient));
    const until = end ? Math.min(Date.parse(end), now.getTime()) : now.getTime();
    return Math.max(1, (until - firstPaid.get(id)!) / DAY_MS / MONTH_DAYS);
  };
  const clientMonths = payingIds.reduce((a, id) => a + monthsOf(id), 0);

  // Churn: of those active (signed, not ended) at the window's start, who stopped within it.
  const activeAtStart = clients.filter((c) => c.agreementSignedAt && Date.parse(c.agreementSignedAt) < start.getTime() && !(endedAt(c) && Date.parse(endedAt(c)!) < start.getTime()));
  const stopped = activeAtStart.filter((c) => within(endedAt(c))).length;
  const churn = activeAtStart.length === 0 ? null : (stopped / activeAtStart.length) * (30 / days);

  const perMonth = paying === 0 ? null : totalNet / clientMonths;
  const lifetime = churn && churn > 0 ? 1 / churn : null;
  const cac = adSpendCents > 0 && signed > 0 ? adSpendCents / signed : null;

  return {
    days,
    from,
    to,
    adSpendCents,
    leads,
    signed,
    paying,
    costPerLeadCents: fig(adSpendCents > 0 && leads > 0 ? Math.round(adSpendCents / leads) : null, adSpendCents === 0 ? NO_SPEND : NO_LEADS),
    costPerSignedCents: fig(cac === null ? null : Math.round(cac), adSpendCents === 0 ? NO_SPEND : NO_SIGNED),
    leadToSigned: fig(leads > 0 ? signed / leads : null, NO_LEADS),
    revenuePerClientMonthCents: fig(perMonth === null ? null : Math.round(perMonth), NO_PAYING),
    revenuePerClientCents: fig(paying === 0 ? null : Math.round(totalNet / paying), NO_PAYING),
    monthsActive: fig(paying === 0 ? null : Math.round((clientMonths / paying) * 10) / 10, NO_PAYING),
    monthlyChurn: fig(churn, activeAtStart.length === 0 ? NO_PAYING : NO_CHURN),
    lifetimeValueCents: fig(perMonth !== null && lifetime !== null ? Math.round(perMonth * lifetime) : null, perMonth === null ? NO_PAYING : NO_CHURN),
    paybackMonths: fig(cac !== null && perMonth !== null && perMonth > 0 ? Math.round((cac / perMonth) * 10) / 10 : null, adSpendCents === 0 ? NO_SPEND : perMonth === null ? NO_PAYING : NO_SIGNED),
  };
}
