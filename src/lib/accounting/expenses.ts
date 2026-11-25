import { sniffFile } from "../intake/files";
import { CATEGORIES, isCategoryKey, isPaymentMethod, plainText, type CategoryKey, type PaymentMethod } from "./categories";
import { MAX_AMOUNT_CENTS } from "./money";
import { dayInMonth, dayOf, isDay, monthOf, type MonthKey } from "./periods";
import type { Bilingual, Expense, MonthClose, ReceiptKind, RecurringRule } from "./types";

// Expenses: what a person enters, what a monthly rule posts, and what a bank
// file brings in. The same checks run in the browser, on the server and (the
// closed-month rule) in the database.

export interface Problem {
  field: string;
  message: Bilingual;
}

export interface ExpenseInput {
  spentOn: string;
  amountCents: number;
  category: string;
  vendor: string;
  description: string;
  paymentMethod: string;
}

const clean = (text: string, max: number) => text.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export function isClosed(month: MonthKey, closes: readonly MonthClose[]): boolean {
  return closes.some((c) => c.month === month);
}

export const CLOSED_MONTH: Bilingual = {
  en: "That month is closed. Record an adjustment instead; the closed figures stay as they were.",
  es: "Ese mes está cerrado. Registra un ajuste; las cifras cerradas se quedan como estaban.",
};

/**
 * A new expense (or an edit), checked. `adjustment`: a correction to a closed
 * month, which may be negative and must be dated in that month.
 */
export function checkExpense(
  input: ExpenseInput,
  context: { today: string; closes: readonly MonthClose[]; adjustment?: boolean },
): { ok: true; value: Pick<Expense, "spentOn" | "amountCents" | "category" | "vendor" | "description" | "paymentMethod"> } | { ok: false; problems: Problem[] } {
  const problems: Problem[] = [];
  if (!isDay(input.spentOn)) problems.push({ field: "spentOn", message: { en: "Pick the day it was paid.", es: "Elige el día en que se pagó." } });
  else if (input.spentOn > context.today) problems.push({ field: "spentOn", message: { en: "An expense can't be in the future. Monthly ones post themselves.", es: "Un gasto no puede ser futuro. Los mensuales se registran solos." } });
  else if (!context.adjustment && isClosed(monthOf(input.spentOn), context.closes)) problems.push({ field: "spentOn", message: CLOSED_MONTH });
  else if (context.adjustment && !isClosed(monthOf(input.spentOn), context.closes)) problems.push({ field: "spentOn", message: { en: "An adjustment is only for a closed month. This month is open: edit the expense itself.", es: "Un ajuste es solo para un mes cerrado. Este mes está abierto: edita el gasto." } });
  const amountOk = Number.isSafeInteger(input.amountCents) && Math.abs(input.amountCents) <= MAX_AMOUNT_CENTS && (context.adjustment ? input.amountCents !== 0 : input.amountCents > 0);
  if (!amountOk) problems.push({ field: "amountCents", message: { en: "Write the amount, like 49.99 (up to $1,000,000).", es: "Escribe el monto, como 49.99 (hasta $1,000,000)." } });
  if (!isCategoryKey(input.category)) problems.push({ field: "category", message: { en: "Pick a category.", es: "Elige una categoría." } });
  const vendor = clean(input.vendor ?? "", 120);
  if (vendor.length < 2) problems.push({ field: "vendor", message: { en: "Who was paid? (2 characters or more)", es: "¿A quién se le pagó? (2 caracteres o más)" } });
  const description = clean(input.description ?? "", 500);
  if (context.adjustment && description.length < 5) problems.push({ field: "description", message: { en: "Say why the closed month needs this adjustment.", es: "Di por qué el mes cerrado necesita este ajuste." } });
  if (!isPaymentMethod(input.paymentMethod)) problems.push({ field: "paymentMethod", message: { en: "Pick how it was paid.", es: "Elige cómo se pagó." } });
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: { spentOn: input.spentOn, amountCents: input.amountCents, category: input.category as CategoryKey, vendor, description, paymentMethod: input.paymentMethod as PaymentMethod },
  };
}

/** An expense may be changed or voided only while its month is open (the receipt can be attached any time). */
export function editableExpense(expense: Expense, closes: readonly MonthClose[]): { ok: true } | { ok: false; message: Bilingual } {
  if (expense.voidedAt) return { ok: false, message: { en: "This expense was voided.", es: "Este gasto fue anulado." } };
  if (expense.source === "adjustment") return { ok: false, message: { en: "An adjustment is never changed. Record another adjustment to correct it.", es: "Un ajuste no se cambia. Registra otro ajuste para corregirlo." } };
  if (isClosed(monthOf(expense.spentOn), closes)) return { ok: false, message: CLOSED_MONTH };
  return { ok: true };
}

export const activeExpenses = (expenses: readonly Expense[]): Expense[] => expenses.filter((e) => !e.voidedAt);

export function expensesInMonth(expenses: readonly Expense[], month: MonthKey): Expense[] {
  return activeExpenses(expenses).filter((e) => monthOf(e.spentOn) === month);
}

export function byCategory(expenses: readonly Expense[]): Array<{ category: CategoryKey; cents: number; count: number }> {
  const totals = new Map<CategoryKey, { cents: number; count: number }>();
  for (const e of expenses) {
    const t = totals.get(e.category) ?? { cents: 0, count: 0 };
    totals.set(e.category, { cents: t.cents + e.amountCents, count: t.count + 1 });
  }
  return CATEGORIES.filter((c) => totals.has(c.key)).map((c) => ({ category: c.key, ...totals.get(c.key)! }));
}

// ── Monthly rules ───────────────────────────────────────────────────────

export interface RecurringInput {
  vendor: string;
  description: string;
  category: string;
  amountCents: number;
  dayOfMonth: number;
  paymentMethod: string;
  startsOn: string;
  endsOn: string | null;
}

export function checkRecurring(input: RecurringInput): { ok: true; value: Omit<RecurringRule, "id" | "active" | "createdBy" | "createdAt"> } | { ok: false; problems: Problem[] } {
  const base = checkExpense(
    { spentOn: "2000-01-01", amountCents: input.amountCents, category: input.category, vendor: input.vendor, description: input.description, paymentMethod: input.paymentMethod },
    { today: "2999-12-31", closes: [] },
  );
  const problems = base.ok ? [] : [...base.problems];
  if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 31) problems.push({ field: "dayOfMonth", message: { en: "Day of the month: 1 to 31.", es: "Día del mes: del 1 al 31." } });
  if (!isDay(input.startsOn)) problems.push({ field: "startsOn", message: { en: "Pick the first month it applies.", es: "Elige el primer mes en que aplica." } });
  if (input.endsOn !== null && (!isDay(input.endsOn) || input.endsOn < input.startsOn)) problems.push({ field: "endsOn", message: { en: "The end can't be before the start.", es: "El fin no puede ser antes del inicio." } });
  if (problems.length > 0 || !base.ok) return { ok: false, problems };
  return { ok: true, value: { ...base.value, dayOfMonth: input.dayOfMonth, startsOn: input.startsOn, endsOn: input.endsOn } };
}

/** The day a rule posts in a month, or null when it does not apply that month. */
export function ruleDayIn(rule: RecurringRule, month: MonthKey): string | null {
  if (!rule.active) return null;
  const day = dayInMonth(month, rule.dayOfMonth);
  if (day < rule.startsOn || (rule.endsOn && day > rule.endsOn)) return null;
  return day;
}

/**
 * The monthly expenses that are due by today and not posted yet. Never one
 * for a closed month, never one in the future, never twice for a rule and a month.
 */
export function recurringDue(rules: readonly RecurringRule[], expenses: readonly Expense[], months: readonly MonthKey[], today: string, closes: readonly MonthClose[]): Array<{ rule: RecurringRule; spentOn: string }> {
  const active = activeExpenses(expenses);
  const posted = new Set(active.filter((e) => e.recurringId).map((e) => `${e.recurringId}|${monthOf(e.spentOn)}`));
  // Already in from the bank statement: same month, category and amount, and the vendor's first word.
  const fromBank = (rule: RecurringRule, month: MonthKey) =>
    active.some((e) => !e.recurringId && monthOf(e.spentOn) === month && e.category === rule.category && e.amountCents === rule.amountCents && vendorWords(e.vendor + " " + e.description).includes(vendorWords(rule.vendor).split(" ")[0] ?? "\u0000"));
  return months.flatMap((month) =>
    rules.flatMap((rule) => {
      const day = ruleDayIn(rule, month);
      if (!day || day > today || isClosed(month, closes) || posted.has(`${rule.id}|${month}`) || fromBank(rule, month)) return [];
      return [{ rule, spentOn: day }];
    }),
  );
}

// ── Receipts ────────────────────────────────────────────────────────────

/** A receipt: a photo (JPEG or PNG) or a PDF, up to 10 MB. Decided from the file's first bytes, never its name. */
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const RECEIPT_BUCKET = "accounting-receipts";

export type ReceiptCheck = { ok: true; kind: ReceiptKind; mediaType: string; extension: string } | { ok: false; status: 400 | 413 | 415; message: Bilingual };

export function checkReceipt(bytes: Uint8Array): ReceiptCheck {
  if (bytes.length === 0) return { ok: false, status: 400, message: { en: "The file is empty.", es: "El archivo está vacío." } };
  if (bytes.length > RECEIPT_MAX_BYTES) return { ok: false, status: 413, message: { en: "The receipt is over 10 MB. Take a smaller photo or a PDF.", es: "El recibo pesa más de 10 MB. Toma una foto más pequeña o un PDF." } };
  const kind = sniffFile(bytes);
  if (kind === "heic") return { ok: false, status: 415, message: { en: "HEIC photos (iPhone) can't be read. Share it as JPG or take a screenshot.", es: "Las fotos HEIC (iPhone) no se pueden leer. Compártela como JPG o toma una captura." } };
  if (kind === "pdf") return { ok: true, kind: "pdf", mediaType: "application/pdf", extension: "pdf" };
  if (kind === "jpeg") return { ok: true, kind: "jpeg", mediaType: "image/jpeg", extension: "jpg" };
  if (kind === "png") return { ok: true, kind: "png", mediaType: "image/png", extension: "png" };
  return { ok: false, status: 415, message: { en: "A receipt must be a JPG or PNG photo, or a PDF.", es: "Un recibo debe ser una foto JPG o PNG, o un PDF." } };
}

/** The words of an expense, for finding the same one twice. */
export function vendorWords(text: string): string {
  return plainText(text)
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b\d{3,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 4)
    .join(" ");
}

export const todayOf = (now: Date): string => dayOf(now);
