import type { ReportItem } from "../domain/types";
import type { Locale } from "../i18n/dictionaries";
import { getCategoryExplainers } from "./explainers";

// What the customer sees for one report item: a human title, the facts the
// report states, and one sentence saying what kind of item it is.
//
// Rule for this file: show only what the report says. Every fact comes from a
// field that is present in item.data; a missing or empty field is left out,
// never guessed. Known codes are put in plain words, and anything we do not
// recognise is shown as the report gave it.

export interface ItemFact {
  label: string;
  value: string;
}

type Pair = { es: string; en: string };

/** "Charge-Off", "charge off" and "charge_off" all become "charge_off". */
function code(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const PERSONAL_FIELD: Record<string, Pair> = {
  address: { es: "Dirección", en: "Address" },
  name: { es: "Nombre", en: "Name" },
  employer: { es: "Empleador", en: "Employer" },
  dob: { es: "Fecha de nacimiento", en: "Date of birth" },
  ssn_variant: { es: "Variante de Seguro Social", en: "SSN variant" },
};

const ACCOUNT_TYPE: Record<string, Pair> = {
  credit_card: { es: "Tarjeta de crédito", en: "Credit card" },
  collection: { es: "Cobranza", en: "Collection" },
  auto_loan: { es: "Préstamo de auto", en: "Auto loan" },
  auto: { es: "Préstamo de auto", en: "Auto loan" },
  mortgage: { es: "Hipoteca", en: "Mortgage" },
  student_loan: { es: "Préstamo estudiantil", en: "Student loan" },
  personal_loan: { es: "Préstamo personal", en: "Personal loan" },
  installment: { es: "Préstamo a plazos", en: "Installment loan" },
  revolving: { es: "Crédito revolvente", en: "Revolving credit" },
  line_of_credit: { es: "Línea de crédito", en: "Line of credit" },
};

/** Account status and payment status ("cuenta" is feminine in Spanish). */
const ACCOUNT_STATUS: Record<string, Pair> = {
  open: { es: "Abierta", en: "Open" },
  closed: { es: "Cerrada", en: "Closed" },
  current: { es: "Al corriente", en: "Current" },
  paid: { es: "Pagada", en: "Paid" },
  collection: { es: "En cobranza", en: "In collection" },
  charge_off: { es: "Dada de baja (charge-off)", en: "Charge-off" },
  charged_off: { es: "Dada de baja (charge-off)", en: "Charge-off" },
  chargeoff: { es: "Dada de baja (charge-off)", en: "Charge-off" },
  late: { es: "Con pago tardío", en: "Late" },
  delinquent: { es: "Con atraso", en: "Delinquent" },
  transferred: { es: "Transferida", en: "Transferred" },
  repossession: { es: "Reposesión", en: "Repossession" },
  foreclosure: { es: "Ejecución hipotecaria (foreclosure)", en: "Foreclosure" },
};

const REMARK: Record<string, Pair> = {
  placed_for_collection: { es: "Enviada a cobranza", en: "Placed for collection" },
  closed_by_consumer: { es: "Cerrada por el consumidor", en: "Closed by consumer" },
  account_closed_by_consumer: { es: "Cerrada por el consumidor", en: "Closed by consumer" },
  paid_collection: { es: "Cobranza pagada", en: "Paid collection" },
};

/** Who is responsible for an account. */
export const OWNERSHIP: Record<string, Pair> = {
  individual: { es: "Individual", en: "Individual" },
  joint: { es: "Conjunta", en: "Joint" },
  authorized_user: { es: "Usuario autorizado", en: "Authorized user" },
};

/** A month's payment code is "on time" when it is one of these (anything else is a late or missing payment). */
const ON_TIME_CODES: ReadonlySet<string> = new Set(["ok", "c", "current", "0", "on_time", ""]);

/** True when a payment-history code says the month was paid on time (or has no data). */
export function onTimeCode(status: unknown): boolean {
  return ON_TIME_CODES.has(code(status));
}

/** A payment-history code in plain words: "30" → "30 días de atraso", "OK" → "al corriente". */
export function paymentCodeLabel(status: unknown, locale: Locale): string {
  const key = code(status);
  if (ON_TIME_CODES.has(key)) return locale === "es" ? "al corriente" : "on time";
  const days = key.match(/\d+/)?.[0];
  if (days) return locale === "es" ? `${days} días de atraso` : `${days} days late`;
  return translateStatus(status, locale).toLowerCase();
}

/** "marzo de 2025 (30 días de atraso); …": the months a payment history shows late, oldest first. */
function lateMonths(history: unknown, locale: Locale): string {
  if (!Array.isArray(history)) return "";
  return history
    .filter((m): m is { month: string; status: string } => Boolean(m) && typeof m === "object" && typeof m.month === "string")
    .filter((m) => !onTimeCode(m.status))
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => `${formatDate(m.month, locale)} (${paymentCodeLabel(m.status, locale)})`)
    .join("; ");
}

const INQUIRY_TYPE: Record<string, Pair> = {
  hard: { es: "Dura", en: "Hard" },
  soft: { es: "Suave", en: "Soft" },
};

const RECORD_TYPE: Record<string, Pair> = {
  bankruptcy: { es: "Bancarrota", en: "Bankruptcy" },
  chapter_7_bankruptcy: { es: "Bancarrota (Capítulo 7)", en: "Chapter 7 bankruptcy" },
  chapter_13_bankruptcy: { es: "Bancarrota (Capítulo 13)", en: "Chapter 13 bankruptcy" },
  lien: { es: "Gravamen", en: "Lien" },
  tax_lien: { es: "Gravamen fiscal", en: "Tax lien" },
  judgment: { es: "Sentencia", en: "Judgment" },
  civil_judgment: { es: "Sentencia civil", en: "Civil judgment" },
  foreclosure: { es: "Ejecución hipotecaria (foreclosure)", en: "Foreclosure" },
};

/** Public-record status ("registro" is masculine in Spanish). */
const RECORD_STATUS: Record<string, Pair> = {
  open: { es: "Abierto", en: "Open" },
  closed: { es: "Cerrado", en: "Closed" },
  filed: { es: "Presentado", en: "Filed" },
  paid: { es: "Pagado", en: "Paid" },
  satisfied: { es: "Satisfecho", en: "Satisfied" },
  released: { es: "Liberado", en: "Released" },
  discharged: { es: "Descargado", en: "Discharged" },
  dismissed: { es: "Desestimado", en: "Dismissed" },
};

/**
 * A known code in plain words; otherwise the value as the report gave it
 * (in English, with underscores opened up so it reads as words).
 */
function translate(value: unknown, table: Record<string, Pair>, locale: Locale): string {
  const raw = text(value);
  if (!raw) return "";
  const known = table[code(raw)];
  if (known) return known[locale];
  return locale === "en" ? capitalise(raw.replace(/_/g, " ")) : raw;
}

/** An account status in plain words ("30_days_late" → "30 días de atraso"). */
export function translateStatus(value: unknown, locale: Locale): string {
  const key = code(value);
  // "30_days_late", "late_60": the number of days is in the report; keep it.
  const days = /late/.test(key) ? key.match(/\d+/)?.[0] : undefined;
  if (days) return locale === "es" ? `${days} días de atraso` : `${days} days late`;
  return translate(value, ACCOUNT_STATUS, locale);
}

function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** $1,250 — whole dollars without cents, anything else with two decimals. */
export function formatMoney(amount: number): string {
  const digits = Number.isInteger(amount) ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}

/** ISO dates in the reader's language; anything else is shown as given. */
export function formatDate(value: unknown, locale: Locale): string {
  const raw = text(value);
  if (!raw) return "";
  const tag = locale === "es" ? "es-MX" : "en-US";
  const full = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (full) {
    const date = new Date(Date.UTC(Number(full[1]), Number(full[2]) - 1, Number(full[3])));
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleDateString(tag, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  }
  const month = raw.match(/^(\d{4})-(\d{2})$/);
  if (month) {
    const date = new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1));
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleDateString(tag, { month: "long", year: "numeric", timeZone: "UTC" });
  }
  return raw;
}

const LABELS = {
  es: {
    accountType: "Tipo de cuenta",
    accountNumber: "Número de cuenta",
    status: "Estado",
    paymentStatus: "Estado de pago",
    balance: "Saldo",
    creditLimit: "Límite de crédito",
    highCredit: "Crédito más alto",
    pastDue: "Monto vencido",
    ownership: "Responsabilidad",
    originalCreditor: "Acreedor original",
    opened: "Fecha de apertura",
    lastPayment: "Último pago",
    firstDelinquency: "Primer atraso",
    lastReported: "Último reporte",
    closed: "Fecha de cierre",
    lateMonths: "Meses con atraso",
    remarks: "Notas",
    inquiryDate: "Fecha",
    inquiryType: "Tipo de consulta",
    recordType: "Tipo de registro",
    court: "Tribunal",
    filed: "Fecha de registro",
  },
  en: {
    accountType: "Account type",
    accountNumber: "Account number",
    status: "Status",
    paymentStatus: "Payment status",
    balance: "Balance",
    creditLimit: "Credit limit",
    highCredit: "High credit",
    pastDue: "Past due",
    ownership: "Responsibility",
    originalCreditor: "Original creditor",
    opened: "Opened",
    lastPayment: "Last payment",
    firstDelinquency: "First late payment",
    lastReported: "Last reported",
    closed: "Closed",
    lateMonths: "Months reported late",
    remarks: "Remarks",
    inquiryDate: "Date",
    inquiryType: "Inquiry type",
    recordType: "Record type",
    court: "Court",
    filed: "Filed",
  },
} as const;

/** The heading for an item. Personal info gets a human label above its value. */
export function itemTitle(item: ReportItem, locale: Locale): { kicker: string | null; title: string } {
  if (item.category !== "personal_info") return { kicker: null, title: item.name };
  const field = text(item.data.field);
  const value = text(item.data.value);
  if (!field || !value) return { kicker: null, title: item.name };
  const known = PERSONAL_FIELD[code(field)];
  return { kicker: known ? known[locale] : capitalise(field.replace(/_/g, " ")), title: value };
}

/** The same heading on one line: "Dirección: 123 Old Street…" or "Capital One". */
export function itemLabel(item: ReportItem, locale: Locale): string {
  const { kicker, title } = itemTitle(item, locale);
  return kicker ? `${kicker}: ${title}` : title;
}

/** The facts the report states about this item, in reading order. */
export function itemFacts(item: ReportItem, locale: Locale): ItemFact[] {
  const data = item.data;
  const label = LABELS[locale];
  const facts: ItemFact[] = [];
  const add = (name: string, value: string) => {
    if (value) facts.push({ label: name, value });
  };

  if (item.category === "tradeline") {
    add(label.accountType, translate(data.accountType, ACCOUNT_TYPE, locale));
    add(label.accountNumber, text(data.accountNumberMasked));
    add(label.originalCreditor, text(data.originalCreditor));
    add(label.ownership, translate(data.ownership, OWNERSHIP, locale));
    add(label.status, translateStatus(data.status, locale));
    add(label.paymentStatus, translateStatus(data.paymentStatus, locale));
    if (isAmount(data.balance)) add(label.balance, formatMoney(data.balance));
    if (isAmount(data.pastDue)) add(label.pastDue, formatMoney(data.pastDue));
    if (isAmount(data.creditLimit)) add(label.creditLimit, formatMoney(data.creditLimit));
    if (isAmount(data.highCredit)) add(label.highCredit, formatMoney(data.highCredit));
    add(label.opened, formatDate(data.openedAt, locale));
    add(label.lastPayment, formatDate(data.lastPaymentAt, locale));
    add(label.firstDelinquency, formatDate(data.firstDelinquencyAt, locale));
    add(label.closed, formatDate(data.closedAt, locale));
    add(label.lastReported, formatDate(data.lastReportedAt, locale));
    add(label.lateMonths, lateMonths(data.paymentHistory, locale));
    if (Array.isArray(data.remarks)) {
      const remarks = data.remarks.map((r) => translate(r, REMARK, locale)).filter(Boolean);
      add(label.remarks, remarks.join("; "));
    }
  } else if (item.category === "inquiry") {
    add(label.inquiryDate, formatDate(data.date, locale));
    add(label.inquiryType, translate(data.type, INQUIRY_TYPE, locale));
  } else if (item.category === "public_record") {
    add(label.recordType, translate(data.recordType, RECORD_TYPE, locale));
    add(label.court, text(data.court));
    add(label.filed, formatDate(data.filedAt, locale));
    add(label.status, translate(data.status, RECORD_STATUS, locale));
  }
  // Personal info: the title already is the whole fact.

  return facts;
}

const KIND: Record<string, Pair> = {
  "tradeline:collection": {
    es: "Una cobranza: una deuda que pasó a una agencia de cobro.",
    en: "A collection: a debt that was passed to a collection agency.",
  },
  "tradeline:credit_card": { es: "Una tarjeta de crédito a tu nombre.", en: "A credit card in your name." },
  "tradeline:auto_loan": { es: "Un préstamo de auto a tu nombre.", en: "An auto loan in your name." },
  "tradeline:auto": { es: "Un préstamo de auto a tu nombre.", en: "An auto loan in your name." },
  "tradeline:mortgage": { es: "Una hipoteca a tu nombre.", en: "A mortgage in your name." },
  "tradeline:student_loan": { es: "Un préstamo estudiantil a tu nombre.", en: "A student loan in your name." },
  "tradeline:personal_loan": { es: "Un préstamo personal a tu nombre.", en: "A personal loan in your name." },
  "inquiry:hard": {
    es: "Una consulta dura: una empresa revisó tu crédito por una solicitud de crédito.",
    en: "A hard inquiry: a company checked your credit for a credit application.",
  },
  "inquiry:soft": {
    es: "Una consulta suave: una revisión de tu crédito que no viene de una solicitud de crédito.",
    en: "A soft inquiry: a check of your credit that does not come from a credit application.",
  },
  "public_record:bankruptcy": {
    es: "Una bancarrota en los registros públicos de un tribunal.",
    en: "A bankruptcy in a court's public records.",
  },
  "public_record:lien": { es: "Un gravamen en los registros públicos.", en: "A lien in the public records." },
  "public_record:tax_lien": {
    es: "Un gravamen fiscal en los registros públicos.",
    en: "A tax lien in the public records.",
  },
  "public_record:judgment": {
    es: "Una sentencia de un tribunal en los registros públicos.",
    en: "A court judgment in the public records.",
  },
  "personal_info:address": {
    es: "Una dirección que este buró tiene en tu expediente.",
    en: "An address this bureau has on your file.",
  },
  "personal_info:name": {
    es: "Un nombre o variante de tu nombre que este buró tiene en tu expediente.",
    en: "A name or name variant this bureau has on your file.",
  },
  "personal_info:employer": {
    es: "Un empleador que este buró tiene en tu expediente.",
    en: "An employer this bureau has on your file.",
  },
  "personal_info:dob": {
    es: "Una fecha de nacimiento que este buró tiene en tu expediente.",
    en: "A date of birth this bureau has on your file.",
  },
  "personal_info:ssn_variant": {
    es: "Una variante de tu número de Seguro Social que este buró tiene en tu expediente.",
    en: "A variant of your Social Security number this bureau has on your file.",
  },
};

/** Every sentence itemKindLine can produce on its own, for the copy checks. */
export const ITEM_KIND_LINES: readonly Pair[] = Object.values(KIND);

/** One plain sentence saying what THIS item is; the category explainer when the data does not say. */
export function itemKindLine(item: ReportItem, locale: Locale): string {
  const data = item.data;
  let key = "";
  if (item.category === "tradeline") {
    const isCollection = /collection/i.test(text(data.accountType)) || /collection/i.test(text(data.status));
    key = isCollection ? "collection" : code(data.accountType);
  } else if (item.category === "inquiry") {
    key = code(data.type);
  } else if (item.category === "public_record") {
    key = code(data.recordType);
  } else {
    key = code(data.field);
  }
  const specific = KIND[`${item.category}:${key}`];
  return specific ? specific[locale] : getCategoryExplainers(locale)[item.category].what;
}

/**
 * The card read aloud: title, what it is, then each fact. A masked account
 * number ("****1234") is spoken as its visible digits so the voice does not
 * read out the asterisks.
 */
export function itemReadAloud(item: ReportItem, locale: Locale): string {
  const accountLabel = LABELS[locale].accountNumber;
  const facts = itemFacts(item, locale).map((f) => {
    if (f.label !== accountLabel) return `${f.label}: ${f.value}.`;
    const visible = f.value.replace(/^[^\p{L}\p{N}]+/u, "");
    if (!visible || visible === f.value) return `${f.label}: ${f.value}.`;
    return locale === "es" ? `${f.label}: termina en ${visible}.` : `${f.label}: ends in ${visible}.`;
  });
  return [`${itemLabel(item, locale)}.`, itemKindLine(item, locale), ...facts].join(" ");
}

// "Check before you decide" questions. Accounts, inquiries and public records
// are asked only about what their card shows (see HINTS below). A
// personal-information entry gets the questions for its own field: an address
// card should not ask whether an employer is right.
// The questions are neutral on purpose: they help the customer look, and never
// suggest which answer to give.
const PERSONAL_INFO_HINTS: Record<string, { es: string[]; en: string[] }> = {
  name: {
    es: [
      "¿Tu nombre aparece incompleto, con un solo apellido, sin acento o mal escrito? Pasa mucho con nombres hispanos (dos apellidos) y puede mezclar tu expediente con el de otra persona.",
      "¿Reconoces esta forma de escribir tu nombre?",
    ],
    en: [
      "Does your name appear incomplete, with only one surname, without accents, or misspelled? This is very common with Hispanic names (two surnames) and can mix your file with someone else's.",
      "Do you recognize this spelling of your name?",
    ],
  },
  address: {
    es: ["¿Has vivido alguna vez en esta dirección?", "¿Está bien escrita: calle, número, ciudad y código postal?"],
    en: ["Have you ever lived at this address?", "Is it written correctly: street, number, city and ZIP code?"],
  },
  employer: {
    es: ["¿Has trabajado alguna vez para este empleador?", "¿El nombre del empleador está bien escrito?"],
    en: ["Have you ever worked for this employer?", "Is the employer's name spelled correctly?"],
  },
  dob: {
    es: ["¿Es exactamente tu fecha de nacimiento?"],
    en: ["Is this exactly your date of birth?"],
  },
  ssn_variant: {
    es: ["¿Estos dígitos coinciden con tu número de Seguro Social?"],
    en: ["Do these digits match your Social Security number?"],
  },
};

type HintCopy = {
  recognise: string;
  balanceAndLimit: string;
  balance: string;
  limit: string;
  dates: (names: string[]) => string;
  sevenYears: string;
  dateName: { opened: string; lastPayment: string; firstDelinquency: string; lastReported: string };
  inquiryApplied: string;
  inquiryAppliedOnDate: string;
  inquiryAuthorised: string;
  inquiryTwoYears: string;
  recordYours: string;
  recordStatus: string;
  recordPeriod: string;
};

// Questions for accounts, inquiries and public records. Each one is asked only
// when the card shows the thing it asks about, so the customer is never asked
// to check a limit or a date they cannot see.
const HINTS: Record<Locale, HintCopy> = {
  es: {
    recognise: "¿Reconoces al acreedor y la cuenta?",
    balanceAndLimit: "¿El saldo y el límite de crédito que aparecen son correctos?",
    balance: "¿El saldo que aparece es correcto?",
    limit: "¿El límite de crédito que aparece es correcto?",
    dates: (names) =>
      names.length === 1
        ? `¿La fecha que aparece (${names[0]}) coincide con tu realidad?`
        : `¿Las fechas que aparecen (${names.join(", ")}) coinciden con tu realidad?`,
    sevenYears: "¿Ya pasaron más de 7 años desde el primer atraso? Si sí, podría estar desactualizada.",
    dateName: {
      opened: "apertura",
      lastPayment: "último pago",
      firstDelinquency: "primer atraso",
      lastReported: "último reporte",
    },
    inquiryApplied: "¿Recuerdas haber pedido crédito con esta empresa?",
    inquiryAppliedOnDate: "¿Recuerdas haber pedido crédito con esta empresa en esa fecha?",
    inquiryAuthorised: "¿Autorizaste que revisaran tu crédito?",
    inquiryTwoYears: "¿La consulta tiene más de 2 años? Debería haber caído ya.",
    recordYours: "¿El registro es realmente tuyo (no de alguien con nombre parecido)?",
    recordStatus: "¿El estado es correcto (resuelto, descargado, pagado)?",
    recordPeriod: "¿Ya venció el plazo legal para reportarlo?",
  },
  en: {
    recognise: "Do you recognize the creditor and the account?",
    balanceAndLimit: "Are the balance and the credit limit shown correct?",
    balance: "Is the balance shown correct?",
    limit: "Is the credit limit shown correct?",
    dates: (names) =>
      names.length === 1
        ? `Does the date shown (${names[0]}) match your reality?`
        : `Do the dates shown (${names.join(", ")}) match your reality?`,
    sevenYears: "Has it been more than 7 years since the first late payment? If so, it may be outdated.",
    dateName: {
      opened: "opened",
      lastPayment: "last payment",
      firstDelinquency: "first late payment",
      lastReported: "last reported",
    },
    inquiryApplied: "Do you remember applying for credit with this company?",
    inquiryAppliedOnDate: "Do you remember applying for credit with this company on that date?",
    inquiryAuthorised: "Did you authorize them to check your credit?",
    inquiryTwoYears: "Is the inquiry more than 2 years old? It should have dropped off already.",
    recordYours: "Is the record really yours (not someone with a similar name)?",
    recordStatus: "Is the status correct (resolved, discharged, paid)?",
    recordPeriod: "Has the legal reporting period expired?",
  },
};

function tradelineHints(data: Record<string, unknown>, locale: Locale): string[] {
  const c = HINTS[locale];
  // Always asked: the creditor is the card's title.
  const hints = [c.recognise];

  const hasBalance = isAmount(data.balance);
  const hasLimit = isAmount(data.creditLimit);
  if (hasBalance && hasLimit) hints.push(c.balanceAndLimit);
  else if (hasBalance) hints.push(c.balance);
  else if (hasLimit) hints.push(c.limit);

  const shownDates: string[] = [];
  if (text(data.openedAt)) shownDates.push(c.dateName.opened);
  if (text(data.lastPaymentAt)) shownDates.push(c.dateName.lastPayment);
  if (text(data.firstDelinquencyAt)) shownDates.push(c.dateName.firstDelinquency);
  if (text(data.lastReportedAt)) shownDates.push(c.dateName.lastReported);
  if (shownDates.length > 0) hints.push(c.dates(shownDates));

  if (text(data.firstDelinquencyAt)) hints.push(c.sevenYears);
  return hints;
}

function inquiryHints(data: Record<string, unknown>, locale: Locale): string[] {
  const c = HINTS[locale];
  const hasDate = Boolean(text(data.date));
  const hints = [hasDate ? c.inquiryAppliedOnDate : c.inquiryApplied, c.inquiryAuthorised];
  if (hasDate) hints.push(c.inquiryTwoYears);
  return hints;
}

function publicRecordHints(data: Record<string, unknown>, locale: Locale): string[] {
  const c = HINTS[locale];
  const hints = [c.recordYours];
  if (text(data.status)) hints.push(c.recordStatus);
  if (text(data.filedAt)) hints.push(c.recordPeriod);
  return hints;
}

export function itemCheckHints(item: ReportItem, locale: Locale, max?: number): string[] {
  let hints: string[];
  if (item.category === "tradeline") hints = tradelineHints(item.data, locale);
  else if (item.category === "inquiry") hints = inquiryHints(item.data, locale);
  else if (item.category === "public_record") hints = publicRecordHints(item.data, locale);
  else {
    const field = String((item.data as { field?: unknown }).field ?? "").trim().toLowerCase();
    hints = PERSONAL_INFO_HINTS[field]?.[locale] ?? getCategoryExplainers(locale).personal_info.checkHints;
  }
  return max === undefined ? hints : hints.slice(0, max);
}

/** Every field-specific hint, for the copy checks in the test suite. */
export const PERSONAL_INFO_HINT_LINES: readonly string[] = Object.values(PERSONAL_INFO_HINTS).flatMap((h) => [...h.es, ...h.en]);
