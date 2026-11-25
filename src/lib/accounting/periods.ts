import { STAFF_TIME_ZONE } from "../staff/stage";

// Months and days on the Texas calendar. The books close by Texas month: a
// payment taken at 11 p.m. on October 31 in Houston is October's, whatever
// the server's clock says. A date written by a person ("2026-10-31") is
// already a calendar day and is read as it is.

/** "2026-11" */
export type MonthKey = string;

export const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DAY_KEY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** The Texas calendar day of an instant, or a calendar day as written: "2026-11-25". */
export function dayOf(value: string | Date): string {
  if (typeof value === "string" && DAY_KEY.test(value)) return value;
  return new Date(value).toLocaleDateString("en-CA", { timeZone: STAFF_TIME_ZONE });
}

/** The Texas month of an instant or a calendar day: "2026-11". */
export function monthOf(value: string | Date): MonthKey {
  return dayOf(value).slice(0, 7);
}

export function isMonthKey(value: unknown): value is MonthKey {
  return typeof value === "string" && MONTH_KEY.test(value);
}

/** True when the string is a real calendar day ("2026-02-30" is not). */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY_KEY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return date.getUTCMonth() === m! - 1 && date.getUTCDate() === d;
}

export function addMonths(month: MonthKey, n: number): MonthKey {
  const [y, m] = month.split("-").map(Number);
  const index = y! * 12 + (m! - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export const previousMonth = (month: MonthKey): MonthKey => addMonths(month, -1);

/** Days in the month (28–31). */
export function daysInMonth(month: MonthKey): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

/** "2026-11" and day 31 → "2026-11-30": a day of the month, kept inside it. */
export function dayInMonth(month: MonthKey, day: number): string {
  return `${month}-${String(Math.min(Math.max(1, Math.round(day)), daysInMonth(month))).padStart(2, "0")}`;
}

/** January to this month of the same year. */
export function yearToDate(month: MonthKey): MonthKey[] {
  const [y, m] = month.split("-").map(Number);
  return Array.from({ length: m! }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`);
}

/** The last `count` months ending with `month`, oldest first. */
export function monthsEnding(month: MonthKey, count: number): MonthKey[] {
  return Array.from({ length: count }, (_, i) => addMonths(month, i - count + 1));
}

/** True once the month is over on the Texas calendar. */
export function monthEnded(month: MonthKey, now: Date): boolean {
  return monthOf(now) > month;
}

/** "November 2026" / "noviembre de 2026". */
export function monthLabel(month: MonthKey, locale: "en" | "es"): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 15)).toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "Nov 2026" / "nov 2026". */
export function shortMonth(month: MonthKey, locale: "en" | "es"): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 15)).toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { month: "short", year: "numeric", timeZone: "UTC" }).replace(".", "");
}

/** Whole days from one calendar day to another (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${dayOf(to)}T12:00:00Z`) - Date.parse(`${dayOf(from)}T12:00:00Z`)) / 86_400_000);
}

/** "2026-11-25" + 3 → "2026-11-28". */
export function addDaysToDay(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
