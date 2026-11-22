// The client's clock: quiet hours and "today" are counted where the client
// lives, not where the server runs. Texas is the default (the business is
// there), on Central time.

export const DEFAULT_CLIENT_TIME_ZONE = "America/Chicago";

// One zone per state, the one most of its people live in. A state split
// between two zones takes the larger one; for a message sent at 8:00, the
// smaller part of the state sees it at 7:00 or 9:00 at worst, never at night
// (quiet hours end at 8 and start at 21).
const STATE_ZONE: Record<string, string> = {
  TX: "America/Chicago",
  OK: "America/Chicago",
  LA: "America/Chicago",
  AR: "America/Chicago",
  KS: "America/Chicago",
  MO: "America/Chicago",
  IL: "America/Chicago",
  NM: "America/Denver",
  CO: "America/Denver",
  UT: "America/Denver",
  AZ: "America/Phoenix",
  NV: "America/Los_Angeles",
  CA: "America/Los_Angeles",
  OR: "America/Los_Angeles",
  WA: "America/Los_Angeles",
  FL: "America/New_York",
  GA: "America/New_York",
  NY: "America/New_York",
  NJ: "America/New_York",
  NC: "America/New_York",
};

/** The client's time zone from their two-letter state; Texas time when unknown. */
export function clientTimeZone(state: string | null | undefined): string {
  return STATE_ZONE[(state ?? "").trim().toUpperCase()] ?? DEFAULT_CLIENT_TIME_ZONE;
}

/** The hour (0–23) on the wall clock in that zone. */
export function localHour(date: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(date);
  return Number(hour) % 24;
}

/** The calendar day in that zone, "2026-11-22". */
export function localDay(date: Date, timeZone: string): string {
  return date.toLocaleDateString("en-CA", { timeZone });
}

/**
 * True inside quiet hours. With the defaults (21 → 8): from 9:00 p.m. until
 * 7:59 a.m. A window that does not wrap midnight (for example 13 → 15) works too.
 */
export function isQuietHour(date: Date, timeZone: string, quiet: { quietStartHour: number; quietEndHour: number }): boolean {
  const { quietStartHour: start, quietEndHour: end } = quiet;
  if (start === end) return false;
  const hour = localHour(date, timeZone);
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

/**
 * The first moment at or after `date` outside quiet hours: `date` itself when
 * it is allowed, else the top of the first allowed hour.
 */
export function nextAllowedTime(date: Date, timeZone: string, quiet: { quietStartHour: number; quietEndHour: number }): Date {
  if (!isQuietHour(date, timeZone, quiet)) return date;
  let t = new Date(date.getTime());
  for (let i = 0; i < 26; i += 1) {
    // To the top of the next hour (whole-hour zones; the minutes do not change across them).
    const minutes = Number(new Intl.DateTimeFormat("en-US", { timeZone, minute: "numeric" }).format(t));
    t = new Date(t.getTime() + (60 - minutes) * 60 * 1000 - t.getUTCSeconds() * 1000 - t.getUTCMilliseconds());
    if (!isQuietHour(t, timeZone, quiet)) return t;
  }
  return t;
}
