// Dates as documents print them, read strictly. A date that does not name a
// real day (or month) is not a date: it is left out and a person is told.

export interface LooseDate {
  /** "2026-03-14", or "2026-03" when only the month is known. */
  text: string;
  /** Noon UTC on that day (the 1st for a month-only date). */
  time: number;
  precision: "day" | "month";
}

function build(year: number, month: number, day: number | null): LooseDate | null {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  const d = day ?? 1;
  const date = new Date(Date.UTC(year, month - 1, d, 12));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== d) return null;
  const mm = String(month).padStart(2, "0");
  return {
    text: day === null ? `${year}-${mm}` : `${year}-${mm}-${String(d).padStart(2, "0")}`,
    time: date.getTime(),
    precision: day === null ? "month" : "day",
  };
}

/** YYYY-MM-DD, YYYY-MM, YYYY/MM/DD, MM/DD/YYYY, M/D/YYYY, MM-DD-YYYY or MM/YYYY. Null otherwise. */
export function parseLooseDate(value: string | null | undefined): LooseDate | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  let m = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:T.*)?$/);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]));
  m = text.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m) return build(Number(m[1]), Number(m[2]), null);
  m = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return build(Number(m[3]), Number(m[1]), Number(m[2]));
  m = text.match(/^(\d{1,2})[-/](\d{4})$/);
  if (m) return build(Number(m[2]), Number(m[1]), null);
  return null;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from `fromTime` to `toTime` (negative when `to` is earlier). */
export function daysBetween(fromTime: number, toTime: number): number {
  return Math.floor((toTime - fromTime) / DAY_MS);
}
