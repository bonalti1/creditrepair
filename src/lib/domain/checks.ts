import { dropOffDate, type ItemType } from "../learn/calculators";
import { reasonsFor, type DisputeReasonCode } from "../letters/reasons";
import type { Locale } from "../i18n/dictionaries";
import { formatDate, formatMoney, OWNERSHIP, onTimeCode, paymentCodeLabel, translateStatus } from "../ux/itemDisplay";
import type { Bureau, ItemCategory, ReportItem } from "./types";

// Objective data checks: facts about a report that can be checked from the
// report itself, without knowing anything about the client's life.
//
//   "Equifax shows a balance of $1,250 and Experian shows $900 for the same account."
//   "By the date of first delinquency the report shows, the reporting period ended in 2024."
//
// What a check is NOT:
//   - It is never a verdict. A check says what the data shows, never that an
//     item "is wrong": only the client knows whether it is accurate.
//   - It never answers for the client. Nothing in this file (or anywhere that
//     uses it) marks an item inaccurate, picks a reason, or checks a box. The
//     client reads what we noticed, and decides: an item they call correct is
//     left alone, whatever the checks say.
//   - `suggestedReasons` are the standard reasons (letters/reasons.ts) that
//     have to do with what was noticed, so the review can show them as related
//     options. They are never pre-selected.
//   - `letterFact` reaches a letter only when the client, after picking a
//     reason this check relates to, chooses to include it (see letterFacts).
//
// Pure: report items in, checks out. `asOf` is the day the report was pulled,
// so a check gives the same answer whenever it is run.
//
// Data the report format cannot support today, so not checked (docs/DATA-CHECKS.md):
// the full Metro 2 fields (account status codes, special comments, compliance
// condition codes, ECOA codes beyond `ownership`), and date closed / past due /
// high credit / payment history / original creditor when the partner does not
// send them (they are optional in the parser).

export type CheckKind =
  // The same account, read across bureaus.
  | "balance_mismatch"
  | "limit_mismatch"
  | "past_due_mismatch"
  | "status_mismatch"
  | "date_mismatch"
  | "possible_reaging"
  | "payment_history_mismatch"
  | "account_type_mismatch"
  | "ownership_mismatch"
  // One item by itself.
  | "obsolete"
  | "missing_first_delinquency"
  | "impossible_dates"
  | "future_date"
  | "balance_on_paid"
  | "past_due_over_balance"
  // Items read together on one bureau.
  | "duplicate_debt"
  // Personal information.
  | "personal_info_variants"
  | "name_suffix";

export type CheckStrength = "objective" | "worth_checking";

export interface DataCheck {
  /** Stable for the same finding on the same items: kind, fields and the items' fingerprints. */
  id: string;
  kind: CheckKind;
  /** Fingerprints of the items the finding is about. It is shown on each of them. */
  items: string[];
  /** The report fields involved (parser names: balance, firstDelinquencyAt, …). */
  fields: string[];
  /** The bureaus involved. */
  bureaus: Bureau[];
  /** What the data shows, in plain words. Never says the item is wrong. */
  explanation: { es: string; en: string };
  /**
   * The same fact as one English sentence for a letter. Printed only when the
   * client chooses to include it, after picking a reason this check relates to.
   */
  letterFact: string;
  /** Standard reasons related to what was noticed. Shown as options; never selected for the client. */
  suggestedReasons: DisputeReasonCode[];
  /** objective: the data itself shows it. worth_checking: a common pattern that has innocent explanations too. */
  strength: CheckStrength;
}

export const CHECK_KINDS: readonly CheckKind[] = [
  "balance_mismatch",
  "limit_mismatch",
  "past_due_mismatch",
  "status_mismatch",
  "date_mismatch",
  "possible_reaging",
  "payment_history_mismatch",
  "account_type_mismatch",
  "ownership_mismatch",
  "obsolete",
  "missing_first_delinquency",
  "impossible_dates",
  "future_date",
  "balance_on_paid",
  "past_due_over_balance",
  "duplicate_debt",
  "personal_info_variants",
  "name_suffix",
];

/** A short name for each kind, for the team's screens. */
export const CHECK_KIND_LABEL: Record<CheckKind, { es: string; en: string }> = {
  balance_mismatch: { es: "Saldo distinto entre burós", en: "Balance differs across bureaus" },
  limit_mismatch: { es: "Límite distinto entre burós", en: "Limit differs across bureaus" },
  past_due_mismatch: { es: "Monto vencido distinto entre burós", en: "Past due differs across bureaus" },
  status_mismatch: { es: "Estado distinto entre burós", en: "Status differs across bureaus" },
  date_mismatch: { es: "Fecha distinta entre burós", en: "Date differs across bureaus" },
  possible_reaging: { es: "Primer atraso distinto entre burós", en: "First delinquency differs across bureaus" },
  payment_history_mismatch: { es: "Historial de pagos distinto entre burós", en: "Payment history differs across bureaus" },
  account_type_mismatch: { es: "Tipo de cuenta distinto entre burós", en: "Account type differs across bureaus" },
  ownership_mismatch: { es: "Responsabilidad distinta entre burós", en: "Responsibility differs across bureaus" },
  obsolete: { es: "Plazo para reportar vencido", en: "Reporting period over" },
  missing_first_delinquency: { es: "Falta la fecha del primer atraso", en: "Date of first delinquency missing" },
  impossible_dates: { es: "Fechas en un orden imposible", en: "Dates in an impossible order" },
  future_date: { es: "Fecha en el futuro", en: "Date in the future" },
  balance_on_paid: { es: "Saldo en una cuenta pagada", en: "Balance on a paid account" },
  past_due_over_balance: { es: "Vencido mayor que el saldo", en: "Past due over balance" },
  duplicate_debt: { es: "Misma deuda con saldo dos veces", en: "Same debt with a balance twice" },
  personal_info_variants: { es: "Varias versiones de un dato personal", en: "Several versions of a personal detail" },
  name_suffix: { es: "Nombre con Jr./Sr./II", en: "Name with Jr./Sr./II" },
};

// ── Reading the data ────────────────────────────────────────────────────

const BUREAU_NAME: Record<Bureau, string> = { equifax: "Equifax", experian: "Experian", transunion: "TransUnion" };
const BUREAU_ORDER: readonly Bureau[] = ["equifax", "experian", "transunion"];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function norm(value: unknown): string {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

/** "Charge-Off", "charge off", "charged_off" → "charge_off". */
function code(value: unknown): string {
  const c = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  return /^charge(d)?_?off$/.test(c) ? "charge_off" : c;
}

function amount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

interface Day {
  /** YYYY-MM-DD (the first of the month for a month-only date). */
  iso: string;
  month: string;
  precision: "day" | "month";
  time: number;
}

/** "2023-07-15" or "2023-07" → a day; null for anything else or an impossible date. */
function day(value: unknown): Day | null {
  const raw = text(value);
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:$|T)/.exec(raw);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3] ?? "1")];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  const iso = date.toISOString().slice(0, 10);
  return { iso, month: iso.slice(0, 7), precision: m[3] ? "day" : "month", time: date.getTime() };
}

/** Same date, at the precision both share (a month-only date matches any day in that month). */
function sameDay(a: Day, b: Day): boolean {
  return a.precision === "day" && b.precision === "day" ? a.iso === b.iso : a.month === b.month;
}

/** a strictly before b, at the precision both share. */
function before(a: Day, b: Day): boolean {
  return a.precision === "day" && b.precision === "day" ? a.iso < b.iso : a.month < b.month;
}

/**
 * What makes two items "the same account" across bureaus: the creditor and the
 * masked account number. Null when the item cannot be matched. Shared with the
 * review's cross-bureau note (ux/crossBureau.ts) so both always agree.
 */
export function sameAccountKey(item: ReportItem): string | null {
  if (item.category === "tradeline") {
    const creditor = norm(item.data.creditor) || norm(item.name);
    const number = norm(item.data.accountNumberMasked);
    return creditor && number ? `tradeline|${creditor}|${number}` : null;
  }
  if (item.category === "inquiry") {
    const inquirer = norm(item.data.inquirer) || norm(item.name);
    const date = norm(item.data.date);
    return inquirer && date ? `inquiry|${inquirer}|${date}` : null;
  }
  return null;
}

function isCollection(item: ReportItem): boolean {
  return /collection/i.test(text(item.data.accountType)) || /collection/i.test(text(item.data.status));
}

function isChargeOff(item: ReportItem): boolean {
  return [item.data.status, item.data.paymentStatus].some((v) => code(v) === "charge_off");
}

function isDerogatory(item: ReportItem): boolean {
  const NEG = /collection|charge.?off|late|delinquen|repossess|foreclos|derog|default/i;
  return [item.data.status, item.data.paymentStatus, item.data.accountType].some((v) => NEG.test(text(v)));
}

/** "paid", "paid in full", "settled", "paid collection": the report says nothing is owed. */
function reportedPaid(item: ReportItem): boolean {
  const PAID = /^(paid|paid_in_full|settled|paid_collection|paid_charge_off|paid_settled|zero_balance)$/;
  const remarks = Array.isArray(item.data.remarks) ? item.data.remarks : [];
  return [item.data.status, item.data.paymentStatus, ...remarks].some((v) => PAID.test(code(v)));
}

// ── Saying it ───────────────────────────────────────────────────────────

type Field =
  | "balance"
  | "creditLimit"
  | "highCredit"
  | "pastDue"
  | "status"
  | "paymentStatus"
  | "openedAt"
  | "lastPaymentAt"
  | "closedAt"
  | "firstDelinquencyAt"
  | "lastReportedAt"
  | "accountType"
  | "ownership"
  | "date"
  | "filedAt";

const FIELD_NAME: Record<Field, { es: string; en: string; letter: string }> = {
  balance: { es: "el saldo", en: "the balance", letter: "balance" },
  creditLimit: { es: "el límite de crédito", en: "the credit limit", letter: "credit limit" },
  highCredit: { es: "el crédito más alto", en: "the high credit", letter: "high credit" },
  pastDue: { es: "el monto vencido", en: "the past-due amount", letter: "past-due amount" },
  status: { es: "el estado", en: "the status", letter: "account status" },
  paymentStatus: { es: "el estado de pago", en: "the payment status", letter: "payment status" },
  openedAt: { es: "la fecha de apertura", en: "the date opened", letter: "date opened" },
  lastPaymentAt: { es: "la fecha del último pago", en: "the date of last payment", letter: "date of last payment" },
  closedAt: { es: "la fecha de cierre", en: "the date closed", letter: "date closed" },
  firstDelinquencyAt: { es: "la fecha del primer atraso", en: "the date of first delinquency", letter: "date of first delinquency" },
  lastReportedAt: { es: "la fecha del último reporte", en: "the date last reported", letter: "date last reported" },
  accountType: { es: "el tipo de cuenta", en: "the account type", letter: "account type" },
  ownership: { es: "quién es responsable de la cuenta", en: "who is responsible for the account", letter: "account responsibility" },
  date: { es: "la fecha de la consulta", en: "the inquiry date", letter: "inquiry date" },
  filedAt: { es: "la fecha de registro", en: "the date filed", letter: "date filed" },
};

const AMOUNT_FIELDS: ReadonlySet<Field> = new Set(["balance", "creditLimit", "highCredit", "pastDue"]);
const DATE_FIELDS: ReadonlySet<Field> = new Set(["openedAt", "lastPaymentAt", "closedAt", "firstDelinquencyAt", "lastReportedAt", "date", "filedAt"]);

/** A field's value as a reader sees it, in their language ("letter" is the English of a letter). */
function shown(field: Field, value: unknown, locale: Locale | "letter"): string {
  const lang: Locale = locale === "letter" ? "en" : locale;
  if (AMOUNT_FIELDS.has(field)) return formatMoney(value as number);
  if (DATE_FIELDS.has(field)) return formatDate(value, lang);
  if (field === "status" || field === "paymentStatus") return translateStatus(value, lang);
  if (field === "ownership") return OWNERSHIP[code(value)]?.[lang] ?? text(value).replace(/_/g, " ");
  return text(value).replace(/_/g, " ");
}

/** "A, B y C" / "A, B and C". */
function list(parts: string[], locale: Locale): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} ${locale === "es" ? "y" : "and"} ${parts[parts.length - 1]}`;
}

/** "Equifax muestra $1,250 y Experian muestra $900". */
function perBureau(values: Array<{ bureau: Bureau; value: string }>, locale: Locale | "letter"): string {
  if (locale === "letter") return list(values.map((v) => `${BUREAU_NAME[v.bureau]} reports ${v.value}`), "en");
  const verb = locale === "es" ? "muestra" : "shows";
  return list(values.map((v) => `${BUREAU_NAME[v.bureau]} ${verb} ${v.value}`), locale);
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function checkId(kind: CheckKind, fields: string[], items: ReportItem[]): string {
  const fps = items.map((i) => i.fingerprint.slice(0, 12)).sort();
  return `${kind}:${fields.join("+")}:${fps.join(".")}`;
}

function make(
  kind: CheckKind,
  items: ReportItem[],
  fields: string[],
  explanation: { es: string; en: string },
  letterFact: string,
  suggestedReasons: DisputeReasonCode[],
  strength: CheckStrength,
): DataCheck {
  const bureaus = BUREAU_ORDER.filter((b) => items.some((i) => i.bureau === b));
  return { id: checkId(kind, fields, items), kind, items: items.map((i) => i.fingerprint), fields, bureaus, explanation, letterFact, suggestedReasons, strength };
}

// ── Across bureaus ──────────────────────────────────────────────────────

/** One copy per bureau of each account reported by two or more bureaus, in bureau order. */
function sameAccountGroups(items: readonly ReportItem[]): ReportItem[][] {
  const groups = new Map<string, ReportItem[]>();
  for (const item of items) {
    if (item.category !== "tradeline") continue;
    const key = sameAccountKey(item);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    if (!group.some((other) => other.bureau === item.bureau)) group.push(item);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((g) => [...g].sort((a, b) => BUREAU_ORDER.indexOf(a.bureau) - BUREAU_ORDER.indexOf(b.bureau)));
}

/** True when the account's figures do not move month to month: closed, paid, in collection or charged off on every copy. */
function settledFigures(group: ReportItem[]): boolean {
  return group.every((i) => isCollection(i) || isChargeOff(i) || reportedPaid(i) || code(i.data.status) === "closed");
}

/** True when the bureaus last heard from the creditor on different dates (or a date is missing). */
function reportedOnDifferentDates(group: ReportItem[]): boolean {
  const dates = group.map((i) => day(i.data.lastReportedAt));
  if (dates.some((d) => !d)) return true;
  return dates.some((d) => !sameDay(d!, dates[0]!));
}

const LAG_NOTE = {
  es: " Puede deberse a que cada buró lo actualizó en una fecha distinta.",
  en: " It may be because each bureau updated it on a different date.",
};

function mismatchCheck(group: ReportItem[], field: Field): DataCheck | null {
  const present = group.filter((i) => {
    const v = i.data[field];
    return AMOUNT_FIELDS.has(field) ? amount(v) !== null : DATE_FIELDS.has(field) ? day(v) !== null : text(v) !== "";
  });
  if (present.length < 2) return null;

  const differs = (a: ReportItem, b: ReportItem): boolean => {
    if (AMOUNT_FIELDS.has(field)) return amount(a.data[field]) !== amount(b.data[field]);
    if (DATE_FIELDS.has(field)) return !sameDay(day(a.data[field])!, day(b.data[field])!);
    return code(a.data[field]) !== code(b.data[field]);
  };
  if (!present.some((i) => differs(i, present[0]!))) return null;

  const values = (locale: Locale | "letter") => present.map((i) => ({ bureau: i.bureau, value: shown(field, i.data[field], locale) }));
  const name = FIELD_NAME[field];

  let kind: CheckKind;
  let reasons: DisputeReasonCode[];
  let strength: CheckStrength = "objective";
  switch (field) {
    case "balance":
      kind = "balance_mismatch";
      reasons = ["wrong_balance"];
      if (!settledFigures(group) && reportedOnDifferentDates(present)) strength = "worth_checking";
      break;
    case "pastDue":
      kind = "past_due_mismatch";
      reasons = ["wrong_balance", "never_late"];
      if (!settledFigures(group) && reportedOnDifferentDates(present)) strength = "worth_checking";
      break;
    case "creditLimit":
    case "highCredit":
      kind = "limit_mismatch";
      reasons = ["wrong_balance"];
      if (reportedOnDifferentDates(present)) strength = "worth_checking";
      break;
    case "status":
    case "paymentStatus": {
      kind = "status_mismatch";
      const all = present.map((i) => code(i.data[field])).join(" ");
      reasons = [];
      if (/late|delinquen|charge|collection|derog/.test(all)) reasons.push("never_late");
      if (/paid|settled/.test(all)) reasons.push("paid_or_settled");
      if (/closed/.test(all)) reasons.push("closed_by_me");
      if (reasons.length === 0) reasons.push("other");
      if (reportedOnDifferentDates(present)) strength = "worth_checking";
      break;
    }
    case "firstDelinquencyAt":
      kind = "possible_reaging";
      reasons = ["wrong_dates"];
      break;
    case "lastPaymentAt":
      kind = "date_mismatch";
      reasons = ["wrong_dates"];
      if (reportedOnDifferentDates(present)) strength = "worth_checking";
      break;
    case "accountType":
      kind = "account_type_mismatch";
      reasons = ["other"];
      break;
    case "ownership":
      kind = "ownership_mismatch";
      reasons = ["other"];
      break;
    default:
      kind = "date_mismatch";
      reasons = ["wrong_dates"];
  }

  const lag = strength === "worth_checking" && kind !== "possible_reaging";
  const explanation = {
    es: `Para esta misma cuenta, ${name.es} no es igual en todos los burós: ${perBureau(values("es"), "es")}.${lag ? LAG_NOTE.es : ""}`,
    en: `For this same account, ${name.en} is not the same on every bureau: ${perBureau(values("en"), "en")}.${lag ? LAG_NOTE.en : ""}`,
  };
  if (kind === "possible_reaging") {
    explanation.es +=
      " La fecha del primer atraso no debería cambiar nunca: de ella depende hasta cuándo se puede reportar la cuenta. Una fecha más reciente la mantiene más tiempo en el reporte.";
    explanation.en +=
      " The date of first delinquency should never change: it decides how long the account may be reported. A later date keeps it on the report longer.";
  }
  const letterFact = `The ${name.letter} reported for this account is not the same at every credit bureau: ${perBureau(values("letter"), "letter")}.`;
  return make(kind, present, [field], explanation, letterFact, reasons, strength);
}

function paymentHistoryCheck(group: ReportItem[]): DataCheck | null {
  type Month = { month: string; status: string };
  const histories = group
    .map((item) => ({
      item,
      months: new Map(
        (Array.isArray(item.data.paymentHistory) ? (item.data.paymentHistory as unknown[]) : [])
          .filter((m): m is Month => Boolean(m) && typeof m === "object" && typeof (m as Month).month === "string" && /^\d{4}-\d{2}$/.test((m as Month).month))
          .map((m) => [m.month, String(m.status ?? "")]),
      ),
    }))
    .filter((h) => h.months.size > 0);
  if (histories.length < 2) return null;

  // Months every history with data covers, where one says late and another says on time.
  const months = [...new Set(histories.flatMap((h) => [...h.months.keys()]))].sort();
  const differing = months.filter((month) => {
    const said = histories.filter((h) => h.months.has(month)).map((h) => h.months.get(month)!);
    return said.length >= 2 && said.some((s) => !onTimeCode(s)) && said.some((s) => onTimeCode(s));
  });
  if (differing.length === 0) return null;

  const shownMonths = differing.slice(0, 3);
  const describe = (locale: Locale | "letter") =>
    shownMonths
      .map((month) => {
        const lang: Locale = locale === "letter" ? "en" : locale;
        const said = histories
          .filter((h) => h.months.has(month))
          .map((h) => ({ bureau: h.item.bureau, value: paymentCodeLabel(h.months.get(month), lang) }));
        const when = formatDate(month, lang);
        return locale === "es" ? `en ${when}, ${perBureau(said, "es")}` : locale === "en" ? `in ${when}, ${perBureau(said, "en")}` : `for ${when}, ${perBureau(said, "letter")}`;
      })
      .join("; ");
  const more = differing.length - shownMonths.length;
  const items = histories.map((h) => h.item);
  return make(
    "payment_history_mismatch",
    items,
    ["paymentHistory"],
    {
      es: `Para esta misma cuenta, el historial de pagos no es igual en todos los burós: ${describe("es")}${more > 0 ? ` (y ${more} ${more === 1 ? "mes más" : "meses más"})` : ""}.`,
      en: `For this same account, the payment history is not the same on every bureau: ${describe("en")}${more > 0 ? ` (and ${more} more ${more === 1 ? "month" : "months"})` : ""}.`,
    },
    `The payment history reported for this account is not the same at every credit bureau: ${describe("letter")}.`,
    ["never_late"],
    "objective",
  );
}

const MISMATCH_FIELDS: readonly Field[] = [
  "balance",
  "pastDue",
  "creditLimit",
  "highCredit",
  "status",
  "paymentStatus",
  "openedAt",
  "lastPaymentAt",
  "closedAt",
  "firstDelinquencyAt",
  "accountType",
  "ownership",
];

function crossBureauChecks(items: readonly ReportItem[]): DataCheck[] {
  const out: DataCheck[] = [];
  for (const group of sameAccountGroups(items)) {
    for (const field of MISMATCH_FIELDS) {
      const check = mismatchCheck(group, field);
      if (check) out.push(check);
    }
    const history = paymentHistoryCheck(group);
    if (history) out.push(history);
  }
  return out;
}

// ── One item by itself ──────────────────────────────────────────────────

/** The FCRA § 605 rule an item falls under, from what the report says it is; null when none applies. */
function dropOffType(item: ReportItem): ItemType | null {
  if (item.category === "public_record") return /bankrupt/i.test(text(item.data.recordType)) ? "bankruptcy" : null;
  if (item.category !== "tradeline") return null;
  if (isCollection(item)) return "collection";
  if (isChargeOff(item)) return "charge_off";
  if (isDerogatory(item)) return "late_payment";
  return null;
}

function obsoleteCheck(item: ReportItem, asOf: Date): DataCheck | null {
  const type = dropOffType(item);
  if (!type) return null;
  const field: Field = item.category === "public_record" ? "filedAt" : "firstDelinquencyAt";
  const start = day(item.data[field]);
  if (!start || start.time > asOf.getTime()) return null;
  const result = dropOffDate(type, new Date(start.time), asOf);
  if (!result.alreadyPassed) return null;

  const startEs = formatDate(start.iso, "es");
  const startEn = formatDate(start.iso, "en");
  const untilEs = formatDate(result.until, "es");
  const untilEn = formatDate(result.until, "en");
  const rule =
    type === "bankruptcy"
      ? { es: "la ley permite reportar una bancarrota hasta 10 años desde que se presentó (FCRA § 605)", en: "the law allows a bankruptcy to be reported for up to 10 years from filing (FCRA § 605)", letter: "Section 605(a)(1) of the FCRA allows a bankruptcy to be reported for up to 10 years from the date it was filed" }
      : result.rule.extraDays > 0
        ? { es: "la ley permite reportarla 7 años, contados desde 180 días después del primer atraso (FCRA § 605)", en: "the law allows it to be reported for 7 years, counted from 180 days after the first delinquency (FCRA § 605)", letter: "Section 605(c) of the FCRA measures the seven-year reporting period from 180 days after the start of the delinquency" }
        : { es: "la ley permite reportar un atraso 7 años (FCRA § 605)", en: "the law allows a late payment to be reported for 7 years (FCRA § 605)", letter: "Section 605(a) of the FCRA limits the reporting of this kind of adverse information to seven years" };
  const what = field === "filedAt" ? { es: "la fecha de registro", en: "the filing date", letter: "date filed" } : { es: "la fecha del primer atraso", en: "the date of first delinquency", letter: "date of first delinquency" };

  return make(
    "obsolete",
    [item],
    [field],
    {
      es: `Según ${what.es} que muestra el reporte (${startEs}), ${rule.es}. Con esa fecha, el plazo terminó el ${untilEs}, antes de la fecha de este reporte.`,
      en: `By ${what.en} the report shows (${startEn}), ${rule.en}. With that date, the period ended on ${untilEn}, before the date of this report.`,
    },
    `The ${what.letter} reported for this item is ${startEn}. ${rule.letter}; counted from that date, the period ended on ${untilEn}.`,
    ["obsolete"],
    "objective",
  );
}

function missingFirstDelinquencyCheck(item: ReportItem, items: readonly ReportItem[]): DataCheck | null {
  if (item.category !== "tradeline" || !(isCollection(item) || isChargeOff(item))) return null;
  if (day(item.data.firstDelinquencyAt)) return null;
  // Another bureau's copy of the same account that does show it: say where.
  const key = sameAccountKey(item);
  const shownElsewhere = key ? items.filter((o) => o.bureau !== item.bureau && sameAccountKey(o) === key && day(o.data.firstDelinquencyAt)) : [];
  const elsewhere = shownElsewhere.length > 0;
  const where = shownElsewhere.map((o) => BUREAU_NAME[o.bureau]);
  return make(
    "missing_first_delinquency",
    [item],
    ["firstDelinquencyAt"],
    {
      es: `${BUREAU_NAME[item.bureau]} no muestra la fecha del primer atraso de esta cuenta${elsewhere ? `, aunque ${list(where, "es")} sí la ${where.length === 1 ? "muestra" : "muestran"}` : ""}. En una cuenta en cobranza o dada de baja, esa fecha es la que decide hasta cuándo se puede reportar. Sin ella no se puede comprobar el plazo.`,
      en: `${BUREAU_NAME[item.bureau]} does not show the date of first delinquency for this account${elsewhere ? `, although ${list(where, "en")} ${where.length === 1 ? "does" : "do"}` : ""}. On an account in collection or charged off, that date decides how long it may be reported. Without it the period cannot be checked.`,
    },
    `The date of first delinquency for this account is not shown in the information reported${elsewhere ? `, although ${list(where, "en")} ${where.length === 1 ? "reports" : "report"} one` : ""}, so the period for which it may be reported cannot be determined.`,
    ["wrong_dates", "obsolete"],
    "worth_checking",
  );
}

function impossibleDatesChecks(item: ReportItem): DataCheck[] {
  if (item.category !== "tradeline") return [];
  const d = (f: Field) => day(item.data[f]);
  const opened = d("openedAt");
  const lastPayment = d("lastPaymentAt");
  const dofd = d("firstDelinquencyAt");
  const closed = d("closedAt");
  const reported = d("lastReportedAt");
  const collection = isCollection(item);
  const pairs: Array<{ first: Field; firstDay: Day; then: Field; thenDay: Day } | null> = [
    // A payment, a closing or a report before the account existed. (A collector's
    // "opened" is the day it got the debt, so earlier payments are normal there.)
    !collection && opened && lastPayment && before(lastPayment, opened) ? { first: "lastPaymentAt", firstDay: lastPayment, then: "openedAt", thenDay: opened } : null,
    !collection && opened && dofd && before(dofd, opened) ? { first: "firstDelinquencyAt", firstDay: dofd, then: "openedAt", thenDay: opened } : null,
    opened && closed && before(closed, opened) ? { first: "closedAt", firstDay: closed, then: "openedAt", thenDay: opened } : null,
    opened && reported && before(reported, opened) ? { first: "lastReportedAt", firstDay: reported, then: "openedAt", thenDay: opened } : null,
    // A debt cannot reach a collector before it was ever late.
    collection && opened && dofd && before(opened, dofd) ? { first: "openedAt", firstDay: opened, then: "firstDelinquencyAt", thenDay: dofd } : null,
    // The first delinquency cannot be after the last time the account was reported.
    dofd && reported && before(reported, dofd) ? { first: "lastReportedAt", firstDay: reported, then: "firstDelinquencyAt", thenDay: dofd } : null,
  ];
  return pairs
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map((p) => {
      const a = FIELD_NAME[p.first];
      const b = FIELD_NAME[p.then];
      const why =
        p.then === "firstDelinquencyAt" && p.first === "openedAt"
          ? { es: " Una deuda no puede pasar a cobranza antes de su primer atraso.", en: " A debt cannot go to a collector before its first delinquency." }
          : { es: "", en: "" };
      return make(
        "impossible_dates",
        [item],
        [p.first, p.then],
        {
          es: `${capital(a.es)} (${formatDate(p.firstDay.iso, "es")}) es anterior a ${b.es} (${formatDate(p.thenDay.iso, "es")}). En ese orden no puede ser.${why.es}`,
          en: `${capital(a.en)} (${formatDate(p.firstDay.iso, "en")}) is before ${b.en} (${formatDate(p.thenDay.iso, "en")}). That order is not possible.${why.en}`,
        },
        `The ${a.letter} reported (${formatDate(p.firstDay.iso, "en")}) is earlier than the ${b.letter} reported (${formatDate(p.thenDay.iso, "en")}), which is not possible.`,
        ["wrong_dates"],
        "objective",
      );
    });
}

function futureDateCheck(item: ReportItem, asOf: Date): DataCheck | null {
  const fields: Field[] =
    item.category === "tradeline"
      ? ["openedAt", "lastPaymentAt", "firstDelinquencyAt", "closedAt", "lastReportedAt"]
      : item.category === "inquiry"
        ? ["date"]
        : item.category === "public_record"
          ? ["filedAt"]
          : [];
  // A day of slack: the report's own date may be in another time zone.
  const limit = asOf.getTime() + 24 * 60 * 60 * 1000;
  const future = fields.filter((f) => {
    const d = day(item.data[f]);
    return d !== null && d.time > limit;
  });
  if (future.length === 0) return null;
  const asOfEs = formatDate(asOf.toISOString().slice(0, 10), "es");
  const asOfEn = formatDate(asOf.toISOString().slice(0, 10), "en");
  const named = (locale: Locale | "letter") =>
    list(
      future.map((f) => `${locale === "letter" ? FIELD_NAME[f].letter : FIELD_NAME[f][locale]} (${formatDate(item.data[f], locale === "letter" ? "en" : locale)})`),
      locale === "es" ? "es" : "en",
    );
  return make(
    "future_date",
    [item],
    future,
    {
      es: `${capital(named("es"))} ${future.length === 1 ? "es posterior" : "son posteriores"} a la fecha de este reporte (${asOfEs}). Una fecha que todavía no llega no puede estar en el reporte.`,
      en: `${capital(named("en"))} ${future.length === 1 ? "is" : "are"} after the date of this report (${asOfEn}). A date that has not come yet cannot be on the report.`,
    },
    `The ${named("letter")} ${future.length === 1 ? "is" : "are"} later than the date of the report itself (${asOfEn}).`,
    item.category === "inquiry" ? ["other"] : ["wrong_dates"],
    "objective",
  );
}

function balanceOnPaidCheck(item: ReportItem): DataCheck | null {
  if (item.category !== "tradeline" || !reportedPaid(item)) return null;
  const balance = amount(item.data.balance);
  if (balance === null || balance <= 0) return null;
  const status = translateStatus(item.data.paymentStatus || item.data.status, "es").toLowerCase();
  const statusEn = translateStatus(item.data.paymentStatus || item.data.status, "en").toLowerCase();
  return make(
    "balance_on_paid",
    [item],
    ["balance", "status"],
    {
      es: `El reporte dice que esta cuenta está ${status || "pagada"}, y al mismo tiempo muestra un saldo de ${formatMoney(balance)}.`,
      en: `The report says this account is ${statusEn || "paid"}, and at the same time shows a balance of ${formatMoney(balance)}.`,
    },
    `This account is reported as ${statusEn || "paid"}, yet it is also reported with a balance of ${formatMoney(balance)}.`,
    ["paid_or_settled", "wrong_balance"],
    "objective",
  );
}

function pastDueOverBalanceCheck(item: ReportItem): DataCheck | null {
  if (item.category !== "tradeline") return null;
  const pastDue = amount(item.data.pastDue);
  const balance = amount(item.data.balance);
  if (pastDue === null || balance === null || pastDue <= balance) return null;
  return make(
    "past_due_over_balance",
    [item],
    ["pastDue", "balance"],
    {
      es: `El monto vencido (${formatMoney(pastDue)}) es mayor que el saldo total (${formatMoney(balance)}). Lo vencido es parte del saldo, así que no puede ser mayor.`,
      en: `The past-due amount (${formatMoney(pastDue)}) is more than the whole balance (${formatMoney(balance)}). What is past due is part of the balance, so it cannot be more.`,
    },
    `The past-due amount reported (${formatMoney(pastDue)}) is greater than the balance reported (${formatMoney(balance)}).`,
    ["wrong_balance"],
    "objective",
  );
}

// ── Items read together on one bureau ───────────────────────────────────

/** "Synchrony Bank" and "SYNCHRONY BANK/AMAZON" match; so do names that only differ in punctuation. */
function sameCreditor(a: string, b: string): boolean {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\b(inc|llc|na|n a|corp|co|bank|usa)\b/g, " ").replace(/\s+/g, " ").trim();
  const x = clean(a);
  const y = clean(b);
  return x.length >= 3 && y.length >= 3 && (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `));
}

function duplicateDebtChecks(items: readonly ReportItem[]): DataCheck[] {
  const out: DataCheck[] = [];
  for (const bureau of BUREAU_ORDER) {
    const owing = items.filter((i) => i.bureau === bureau && i.category === "tradeline" && (amount(i.data.balance) ?? 0) > 0);
    const collections = owing.filter(isCollection);
    const seen = new Set<string>();
    for (const coll of collections) {
      const original = text(coll.data.originalCreditor);
      const dofd = day(coll.data.firstDelinquencyAt);
      // The original creditor's own account, still owing: matched by the collection's "original creditor".
      const partners = owing.filter((other) => {
        if (other === coll) return false;
        if (!isCollection(other)) return original !== "" && sameCreditor(original, text(other.data.creditor) || other.name);
        // Another collector for the same debt: same original creditor, or same first delinquency and same balance.
        const otherOriginal = text(other.data.originalCreditor);
        if (original && otherOriginal) return sameCreditor(original, otherOriginal);
        const otherDofd = day(other.data.firstDelinquencyAt);
        return Boolean(dofd && otherDofd && sameDay(dofd, otherDofd) && amount(other.data.balance) === amount(coll.data.balance));
      });
      for (const other of partners) {
        const pairKey = [coll.fingerprint, other.fingerprint].sort().join("|");
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        const bothCollectors = isCollection(other);
        const [a, b] = [coll, other].sort((x, y) => x.name.localeCompare(y.name));
        const balA = formatMoney(amount(a.data.balance)!);
        const balB = formatMoney(amount(b.data.balance)!);
        const origin = original || text(other.data.originalCreditor);
        out.push(
          make(
            "duplicate_debt",
            [a, b],
            bothCollectors ? ["balance", "originalCreditor"] : ["balance", "originalCreditor", "creditor"],
            bothCollectors
              ? {
                  es: `En ${BUREAU_NAME[bureau]}, ${a.name} (${balA}) y ${b.name} (${balB}) parecen cobrar la misma deuda${origin ? ` de ${origin}` : ""}, y las dos muestran saldo. Una misma deuda no se debe a dos cobradores a la vez.`,
                  en: `On ${BUREAU_NAME[bureau]}, ${a.name} (${balA}) and ${b.name} (${balB}) seem to be collecting the same debt${origin ? ` from ${origin}` : ""}, and both show a balance. One debt is not owed to two collectors at once.`,
                }
              : {
                  es: `En ${BUREAU_NAME[bureau]}, la cobranza de ${coll.name} dice que la deuda viene de ${original}, y la cuenta de ${other.name} también muestra saldo (${formatMoney(amount(other.data.balance)!)}). Cuando una deuda pasa a un cobrador, la cuenta original normalmente queda en $0.`,
                  en: `On ${BUREAU_NAME[bureau]}, the ${coll.name} collection says the debt comes from ${original}, and the ${other.name} account also shows a balance (${formatMoney(amount(other.data.balance)!)}). When a debt passes to a collector, the original account normally shows $0.`,
                },
            bothCollectors
              ? `Both ${a.name} (${balA}) and ${b.name} (${balB}) report a balance for what appears to be the same debt${origin ? `, originally owed to ${origin}` : ""}, so the same debt is counted twice.`
              : `${coll.name} reports this debt as originally owed to ${original}, and ${other.name} still reports a balance of ${formatMoney(amount(other.data.balance)!)} on its own account, so the same debt is reported with a balance twice.`,
            ["duplicate", "wrong_balance"],
            "worth_checking",
          ),
        );
      }
    }
  }
  return out;
}

// ── Personal information ────────────────────────────────────────────────

const FIELD_ES: Record<string, { es: string; en: string; plural: { es: string; en: string } }> = {
  name: { es: "nombre", en: "name", plural: { es: "formas de tu nombre", en: "versions of your name" } },
  address: { es: "dirección", en: "address", plural: { es: "direcciones", en: "addresses" } },
  employer: { es: "empleador", en: "employer", plural: { es: "empleadores", en: "employers" } },
  dob: { es: "fecha de nacimiento", en: "date of birth", plural: { es: "fechas de nacimiento", en: "dates of birth" } },
  ssn_variant: { es: "número de Seguro Social", en: "Social Security number", plural: { es: "variantes de tu número de Seguro Social", en: "variants of your Social Security number" } },
};

/** A person has one date of birth and one SSN: two of them is a fact, not a pattern. */
const ONE_ONLY: ReadonlySet<string> = new Set(["dob", "ssn_variant"]);

function personalInfoChecks(items: readonly ReportItem[]): DataCheck[] {
  const out: DataCheck[] = [];
  const info = items.filter((i) => i.category === "personal_info");
  const byField = new Map<string, ReportItem[]>();
  for (const item of info) {
    const field = code(item.data.field);
    if (!FIELD_ES[field] || !text(item.data.value)) continue;
    byField.set(field, [...(byField.get(field) ?? []), item]);
  }

  for (const [field, entries] of byField) {
    const values = [...new Set(entries.map((e) => norm(e.data.value)))];
    if (values.length < 2) continue;
    const names = FIELD_ES[field]!;
    for (const item of entries) {
      const mine = norm(item.data.value);
      const others = [...new Set(entries.filter((e) => norm(e.data.value) !== mine).map((e) => text(e.data.value)))];
      const where = BUREAU_ORDER.filter((b) => entries.some((e) => e.bureau === b && norm(e.data.value) === mine)).map((b) => BUREAU_NAME[b]);
      const quoted = others.map((o) => `«${o}»`);
      const quotedEn = others.map((o) => `“${o}”`);
      out.push(
        make(
          "personal_info_variants",
          [item],
          ["value"],
          {
            es: `Tu reporte muestra ${values.length} ${names.plural.es}. Esta aparece en ${list(where, "es")}; ${others.length === 1 ? "la otra es" : "las otras son"} ${list(quoted, "es")}.${ONE_ONLY.has(field) ? " Una persona tiene una sola." : " Revisa si las reconoces todas."}`,
            en: `Your report shows ${values.length} ${names.plural.en}. This one is on ${list(where, "en")}; the ${others.length === 1 ? "other is" : "others are"} ${list(quotedEn, "en")}.${ONE_ONLY.has(field) ? " A person has only one." : " Check whether you recognize them all."}`,
          },
          `My credit file shows ${values.length} different ${names.plural.en.replace("your ", "my ")}; this one appears alongside ${list(quotedEn, "en")}.`,
          ["wrong_personal_info", "mixed_file"],
          ONE_ONLY.has(field) ? "objective" : "worth_checking",
        ),
      );
    }
  }

  // Jr., Sr., II, III: a sign that a relative's file may be mixed in.
  for (const item of byField.get("name") ?? []) {
    const suffix = text(item.data.value).match(/\b(JR|SR|II|III|IV)\b\.?/i)?.[1];
    if (!suffix) continue;
    out.push(
      make(
        "name_suffix",
        [item],
        ["value"],
        {
          es: `Este nombre lleva «${suffix.toUpperCase()}». Si tú no usas «${suffix.toUpperCase()}», podría ser información de un familiar con tu mismo nombre.`,
          en: `This name includes “${suffix.toUpperCase()}”. If you do not use “${suffix.toUpperCase()}”, it may be information about a relative with your same name.`,
        },
        `This name on my file includes the suffix "${suffix.toUpperCase()}", which may belong to a relative with the same name.`,
        ["wrong_personal_info", "mixed_file"],
        "worth_checking",
      ),
    );
  }
  return out;
}

// ── All of it ───────────────────────────────────────────────────────────

/**
 * Every check for a report, in report order of the first item each is about.
 * `asOf` is the date of the report (NormalizedReport.pulledAt); obsolescence
 * and future dates are measured against it.
 */
export function dataChecks(items: readonly ReportItem[], asOf: string | Date): DataCheck[] {
  const when = typeof asOf === "string" ? new Date(asOf) : asOf;
  const at = Number.isNaN(when.getTime()) ? new Date(0) : when;
  const single = items.flatMap((item) => [
    obsoleteCheck(item, at),
    missingFirstDelinquencyCheck(item, items),
    ...impossibleDatesChecks(item),
    futureDateCheck(item, at),
    balanceOnPaidCheck(item),
    pastDueOverBalanceCheck(item),
  ]);
  const all = [...crossBureauChecks(items), ...single.filter((c): c is DataCheck => c !== null), ...duplicateDebtChecks(items), ...personalInfoChecks(items)];
  const order = new Map(items.map((item, index) => [item.fingerprint, index]));
  const first = (c: DataCheck) => Math.min(...c.items.map((fp) => order.get(fp) ?? Number.MAX_SAFE_INTEGER));
  return all.map((c, index) => ({ c, index })).sort((a, b) => first(a.c) - first(b.c) || a.index - b.index).map(({ c }) => c);
}

/** The checks shown on one item: every check the item is part of. */
export function checksForItem(checks: readonly DataCheck[], fingerprint: string): DataCheck[] {
  return checks.filter((c) => c.items.includes(fingerprint));
}

/** A check's related reasons that can be given for this kind of item, in the catalogue's order. */
export function relatedReasons(check: DataCheck, category: ItemCategory): DisputeReasonCode[] {
  return reasonsFor(category)
    .map((r) => r.code)
    .filter((c) => check.suggestedReasons.includes(c));
}

/** Every reason related to any of an item's checks, in the catalogue's order. */
export function relatedReasonsForItem(checks: readonly DataCheck[], category: ItemCategory): DisputeReasonCode[] {
  return reasonsFor(category)
    .map((r) => r.code)
    .filter((c) => checks.some((check) => check.suggestedReasons.includes(c)));
}

/**
 * The checks on an item that relate to the reason the client picked: the ones
 * the client may choose to include in their letter. Empty without a reason.
 */
export function checksSupporting(checks: readonly DataCheck[], fingerprint: string, reasonCode: string | null | undefined): DataCheck[] {
  if (!reasonCode) return [];
  return checksForItem(checks, fingerprint).filter((c) => (c.suggestedReasons as string[]).includes(reasonCode));
}

/**
 * The facts a client chose to include, by item fingerprint, for the letters
 * (LetterContext.itemDetails). An item gets facts only when ALL of these hold:
 *   - the client confirmed the item as inaccurate (state "attested", with a time);
 *   - the client picked a reason, and chose to include facts (`checkIds`);
 *   - each included check still exists on the current report AND relates to
 *     the reason the client picked.
 * Anything else is dropped silently: a letter never carries a fact the client
 * did not choose, or a fact about a reason they did not give.
 */
export function letterFacts(
  checks: readonly DataCheck[],
  answers: Readonly<Record<string, { state?: string; reasonCode?: string | null; attestedAt?: string | null; checkIds?: readonly string[] | null } | undefined>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [fingerprint, answer] of Object.entries(answers)) {
    if (!answer || answer.state !== "attested" || !answer.attestedAt || !answer.checkIds || answer.checkIds.length === 0) continue;
    const chosen = new Set(answer.checkIds);
    const facts = checksSupporting(checks, fingerprint, answer.reasonCode)
      .filter((c) => chosen.has(c.id))
      .map((c) => c.letterFact);
    if (facts.length > 0) out[fingerprint] = facts.join(" ");
  }
  return out;
}

/** The text read aloud for an item's checks, with the reminder that only the client knows. */
export function checksReadAloud(checks: readonly DataCheck[], locale: Locale): string {
  if (checks.length === 0) return "";
  const lead = locale === "es" ? "Lo que notamos en tus datos." : "What we noticed in your data.";
  const close = locale === "es" ? "Solo tú sabes si es correcto. Tú decides." : "Only you know whether it is accurate. You decide.";
  return [lead, ...checks.map((c) => c.explanation[locale]), close].join(" ");
}
