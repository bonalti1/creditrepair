// The dates the Ads Manager looks at: the last 7, 14, 30 or 90 days, or a
// custom range, always as calendar days in the AD ACCOUNT's time zone (the
// days Ads Manager shows and Meta's insights are cut by). A lead is counted on
// its day in the same zone, so "the last 7 days" means the same days for the
// spend and for the leads.

export const WINDOW_PRESETS = [7, 14, 30, 90] as const;
export type WindowPreset = (typeof WINDOW_PRESETS)[number];

/** The longest custom range, in days. */
export const MAX_CUSTOM_DAYS = 400;

export interface AdWindow {
  /** "YYYY-MM-DD", inclusive. */
  since: string;
  until: string;
  /** How many calendar days. */
  days: number;
  preset: WindowPreset | "custom";
}

const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isDayKey(value: unknown): value is string {
  if (typeof value !== "string" || !DAY_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return date.getUTCMonth() === m! - 1 && date.getUTCDate() === d;
}

/** The calendar day of an instant in a time zone: "2026-11-25". */
export function dayInZone(at: Date | string, timeZone: string): string {
  const date = typeof at === "string" ? new Date(at) : at;
  try {
    return date.toLocaleDateString("en-CA", { timeZone });
  } catch {
    return date.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  }
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/** Days from `a` to `b`, counting both. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
}

export function isPreset(value: unknown): value is WindowPreset {
  return (WINDOW_PRESETS as readonly number[]).includes(Number(value));
}

/**
 * The window to show. A preset ends today (the account's today). A custom
 * range must be real days, in order, not in the future and at most
 * MAX_CUSTOM_DAYS long; otherwise the last 7 days.
 */
export function adWindow(input: { preset?: unknown; since?: unknown; until?: unknown }, now: Date, timeZone: string): AdWindow {
  const today = dayInZone(now, timeZone);
  if (input.preset === "custom" || (input.since !== undefined && input.preset === undefined)) {
    const since = input.since;
    const until = input.until;
    if (isDayKey(since) && isDayKey(until) && since <= until && until <= today && daysBetween(since, until) <= MAX_CUSTOM_DAYS) {
      return { since, until, days: daysBetween(since, until), preset: "custom" };
    }
  }
  const preset: WindowPreset = isPreset(input.preset) ? (Number(input.preset) as WindowPreset) : 7;
  return { since: addDays(today, -(preset - 1)), until: today, days: preset, preset };
}

export function inWindow(day: string, window: Pick<AdWindow, "since" | "until">): boolean {
  return day >= window.since && day <= window.until;
}
