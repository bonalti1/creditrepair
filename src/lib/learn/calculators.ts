// The two tools in "Aprende". Both only do arithmetic on what the client
// types: no score, no prediction, nothing saved or sent.
//
//  - utilization: balances on open cards divided by their limits (the CFPB's
//    definition; see lessons.ts, "utilizacion").
//  - dropOffYear: the latest a negative item may be reported under the FCRA's
//    time limits (15 U.S.C. § 1681c, "§ 605"), from its type and date. The
//    screen explains the limits of the answer: the exceptions in § 605(b), that
//    accurate items stay until then, and that this is not legal advice.

export interface CardInput {
  balance: number;
  limit: number;
}

export interface UtilizationResult {
  totalBalance: number;
  totalLimit: number;
  /** Whole percent, rounded; null when there is no limit to divide by. */
  percent: number | null;
  /** Each card's own percent (null for a card with no limit). */
  perCard: Array<number | null>;
}

const pct = (balance: number, limit: number): number | null => (limit > 0 ? Math.round((Math.max(0, balance) / limit) * 100) : null);

/** Parses "1,250.50" or "$1250" into a number; NaN for anything else. */
export function parseAmount(text: string): number {
  const clean = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return Number.NaN;
  return Number(clean);
}

export function utilization(cards: readonly CardInput[]): UtilizationResult {
  const valid = cards.filter((c) => Number.isFinite(c.balance) && Number.isFinite(c.limit) && c.balance >= 0 && c.limit >= 0);
  const totalBalance = valid.reduce((sum, c) => sum + c.balance, 0);
  const totalLimit = valid.reduce((sum, c) => sum + c.limit, 0);
  return { totalBalance, totalLimit, percent: pct(totalBalance, totalLimit), perCard: cards.map((c) => pct(c.balance, c.limit)) };
}

export type ItemType = "late_payment" | "collection" | "charge_off" | "bankruptcy" | "hard_inquiry";

export const ITEM_TYPES: readonly ItemType[] = ["late_payment", "collection", "charge_off", "bankruptcy", "hard_inquiry"];

export interface DropOffRule {
  /** What the date the client types means for this type. */
  startsFrom: { es: string; en: string };
  years: number;
  /** Extra days before the years start counting (collections and charge-offs). */
  extraDays: number;
  /** Where the rule comes from. */
  basis: { es: string; en: string };
  /** False for a bureau practice that is not in the law. */
  inLaw: boolean;
}

export const DROP_OFF_RULES: Record<ItemType, DropOffRule & { label: { es: string; en: string } }> = {
  late_payment: {
    label: { es: "Pago tarde", en: "Late payment" },
    startsFrom: { es: "Fecha del pago tarde", en: "Date of the late payment" },
    years: 7,
    extraDays: 0,
    basis: { es: "Ley de reportes de crédito (FCRA § 605): 7 años.", en: "Fair Credit Reporting Act (FCRA § 605): 7 years." },
    inLaw: true,
  },
  collection: {
    label: { es: "Cuenta en cobranza", en: "Collection account" },
    startsFrom: { es: "Fecha de tu primer atraso en esa deuda", en: "Date of your first missed payment on that debt" },
    years: 7,
    extraDays: 180,
    basis: {
      es: "Ley de reportes de crédito (FCRA § 605): 7 años, contados desde 180 días después del primer atraso.",
      en: "FCRA § 605: 7 years, counted from 180 days after the first missed payment.",
    },
    inLaw: true,
  },
  charge_off: {
    label: { es: "Cuenta dada de baja (cancelada)", en: "Charged-off account" },
    startsFrom: { es: "Fecha de tu primer atraso en esa deuda", en: "Date of your first missed payment on that debt" },
    years: 7,
    extraDays: 180,
    basis: {
      es: "Ley de reportes de crédito (FCRA § 605): 7 años, contados desde 180 días después del primer atraso.",
      en: "FCRA § 605: 7 years, counted from 180 days after the first missed payment.",
    },
    inLaw: true,
  },
  bankruptcy: {
    label: { es: "Bancarrota", en: "Bankruptcy" },
    startsFrom: { es: "Fecha en que se presentó la bancarrota", en: "Date the bankruptcy was filed" },
    years: 10,
    extraDays: 0,
    basis: { es: "Ley de reportes de crédito (FCRA § 605): hasta 10 años.", en: "FCRA § 605: up to 10 years." },
    inLaw: true,
  },
  hard_inquiry: {
    label: { es: "Consulta dura", en: "Hard inquiry" },
    startsFrom: { es: "Fecha de la consulta", en: "Date of the inquiry" },
    years: 2,
    extraDays: 0,
    basis: {
      es: "No es una regla de la ley: es lo que suelen hacer los burós. Pendiente de revisión.",
      en: "Not a rule in the law: it is what the bureaus usually do. Pending review.",
    },
    inLaw: false,
  },
};

export interface DropOffResult {
  /** The latest day it may be reported (ISO date). */
  until: string;
  year: number;
  /** 1–12 */
  month: number;
  rule: DropOffRule;
  /** True when that day is already in the past. */
  alreadyPassed: boolean;
}

/** "2023-07" or "2023-07-15" → a UTC date; null when it is not a real past date. */
export function parseMonth(text: string, now: Date = new Date()): Date | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3] ?? "1")];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1950) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getTime() > now.getTime()) return null;
  return date;
}

/** The latest date the item may be reported, by the rule for its type. */
export function dropOffDate(type: ItemType, start: Date, now: Date = new Date()): DropOffResult {
  const rule = DROP_OFF_RULES[type];
  const from = new Date(start.getTime() + rule.extraDays * 24 * 60 * 60 * 1000);
  const until = new Date(Date.UTC(from.getUTCFullYear() + rule.years, from.getUTCMonth(), from.getUTCDate()));
  return {
    until: until.toISOString().slice(0, 10),
    year: until.getUTCFullYear(),
    month: until.getUTCMonth() + 1,
    rule,
    alreadyPassed: until.getTime() <= now.getTime(),
  };
}

/** "enero de 2031" / "January 2031" */
export function monthYearLabel(year: number, month: number, locale: "es" | "en"): string {
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
