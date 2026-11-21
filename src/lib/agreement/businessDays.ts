// The cancellation window.
//
// The Credit Repair Organizations Act lets the client cancel "at any time
// before midnight of the 3rd business day after the date on which you signed
// the contract" (15 U.S.C. §1679d(b)(4), §1679e(a)), and forbids providing any
// service before that period ends (§1679d(a)(2)).
//
// The Act does not define "business day". This file takes the reading that is
// safest for the client: Saturdays, Sundays and U.S. federal holidays do not
// count, and a holiday that falls on a weekend also takes out the weekday it is
// observed on. That makes the window longer for the client and makes us start
// later; neither can hurt the client. Whether a shorter reading is allowed
// (for example counting Saturdays, as some federal rules do) is question 1 for
// the attorney in docs/AGREEMENT.md. Do not shorten this without that answer.
//
// Days are counted on the calendar of one time zone, Texas by default, because
// "midnight" has to be somebody's midnight and the business is in Texas.

export const AGREEMENT_TIME_ZONE = "America/Chicago";
export const CANCELLATION_BUSINESS_DAYS = 3;

/** A calendar date with no time and no zone. Month is 1-12. */
export interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtc(d: CalendarDay): Date {
  return new Date(Date.UTC(d.year, d.month - 1, d.day));
}

function fromUtc(date: Date): CalendarDay {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function addCalendarDays(d: CalendarDay, days: number): CalendarDay {
  return fromUtc(new Date(toUtc(d).getTime() + days * DAY_MS));
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(d: CalendarDay): number {
  return toUtc(d).getUTCDay();
}

export function dayKey(d: CalendarDay): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function zonedParts(instant: Date, timeZone: string): { day: CalendarDay; hour: number; minute: number; second: number } {
  let formatter = partsFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(timeZone, formatter);
  }
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    day: { year: parts.year!, month: parts.month!, day: parts.day! },
    hour: parts.hour! % 24,
    minute: parts.minute!,
    second: parts.second!,
  };
}

/** The calendar date an instant falls on in a time zone. */
export function calendarDayIn(instant: Date, timeZone: string = AGREEMENT_TIME_ZONE): CalendarDay {
  return zonedParts(instant, timeZone).day;
}

/** How far the zone's clock is ahead of UTC at an instant, in milliseconds (negative in the Americas). */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(p.day.year, p.day.month - 1, p.day.day, p.hour, p.minute, p.second);
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant a calendar day begins (00:00:00.000) in a time zone. */
export function startOfDayIn(d: CalendarDay, timeZone: string = AGREEMENT_TIME_ZONE): Date {
  const wallClock = Date.UTC(d.year, d.month - 1, d.day);
  // The offset at midnight is not known until the instant is: estimate, then
  // correct once. Enough for any zone whose clock changes away from midnight,
  // which includes every U.S. zone (the change is at 2 a.m.).
  let instant = wallClock - zoneOffsetMs(new Date(wallClock), timeZone);
  instant = wallClock - zoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/** The last millisecond of a calendar day (23:59:59.999) in a time zone. */
export function endOfDayIn(d: CalendarDay, timeZone: string = AGREEMENT_TIME_ZONE): Date {
  return new Date(startOfDayIn(addCalendarDays(d, 1), timeZone).getTime() - 1);
}

// ── Federal holidays (5 U.S.C. §6103) ───────────────────────────────────

/** The nth given weekday of a month (n = 1 is the first). */
function nthWeekday(year: number, month: number, dow: number, n: number): CalendarDay {
  const first: CalendarDay = { year, month, day: 1 };
  const shift = (dow - weekday(first) + 7) % 7;
  return { year, month, day: 1 + shift + (n - 1) * 7 };
}

function lastWeekday(year: number, month: number, dow: number): CalendarDay {
  const firstOfNext: CalendarDay = month === 12 ? { year: year + 1, month: 1, day: 1 } : { year, month: month + 1, day: 1 };
  let d = addCalendarDays(firstOfNext, -1);
  while (weekday(d) !== dow) d = addCalendarDays(d, -1);
  return d;
}

export interface Holiday {
  name: string;
  /** The date the holiday falls on. */
  date: CalendarDay;
  /** The weekday federal offices close for it: the Friday before a Saturday, the Monday after a Sunday. */
  observed: CalendarDay;
}

function observedDate(d: CalendarDay): CalendarDay {
  const dow = weekday(d);
  if (dow === 6) return addCalendarDays(d, -1);
  if (dow === 0) return addCalendarDays(d, 1);
  return d;
}

/**
 * The eleven federal holidays of a year, computed from their rules (no list of
 * years to keep up to date). Juneteenth has been a federal holiday since 2021.
 */
export function federalHolidays(year: number): Holiday[] {
  const fixed = (name: string, month: number, day: number): Holiday => {
    const date = { year, month, day };
    return { name, date, observed: observedDate(date) };
  };
  const floating = (name: string, date: CalendarDay): Holiday => ({ name, date, observed: date });
  return [
    fixed("New Year's Day", 1, 1),
    floating("Birthday of Martin Luther King, Jr.", nthWeekday(year, 1, 1, 3)),
    floating("Washington's Birthday", nthWeekday(year, 2, 1, 3)),
    floating("Memorial Day", lastWeekday(year, 5, 1)),
    ...(year >= 2021 ? [fixed("Juneteenth National Independence Day", 6, 19)] : []),
    fixed("Independence Day", 7, 4),
    floating("Labor Day", nthWeekday(year, 9, 1, 1)),
    floating("Columbus Day", nthWeekday(year, 10, 1, 2)),
    fixed("Veterans Day", 11, 11),
    floating("Thanksgiving Day", nthWeekday(year, 11, 4, 4)),
    fixed("Christmas Day", 12, 25),
  ];
}

const holidayKeysByYear = new Map<number, Set<string>>();

function holidayKeys(year: number): Set<string> {
  let keys = holidayKeysByYear.get(year);
  if (!keys) {
    keys = new Set(federalHolidays(year).flatMap((h) => [dayKey(h.date), dayKey(h.observed)]));
    holidayKeysByYear.set(year, keys);
  }
  return keys;
}

/** True on a federal holiday or on the weekday it is observed. */
export function isFederalHoliday(d: CalendarDay): boolean {
  const key = dayKey(d);
  // New Year's Day on a Saturday is observed on 31 December of the year before.
  return holidayKeys(d.year).has(key) || holidayKeys(d.year + 1).has(key);
}

export function isBusinessDay(d: CalendarDay): boolean {
  const dow = weekday(d);
  return dow !== 0 && dow !== 6 && !isFederalHoliday(d);
}

/** The nth business day after a date. The date itself never counts. */
export function businessDayAfter(d: CalendarDay, n: number): CalendarDay {
  let current = d;
  let counted = 0;
  while (counted < n) {
    current = addCalendarDays(current, 1);
    if (isBusinessDay(current)) counted += 1;
  }
  return current;
}

/**
 * The last instant the client can cancel without penalty: the end of the 3rd
 * business day after the calendar date of signing, on the given zone's clock.
 * The day of signing never counts, at whatever hour the client signed.
 */
export function cancellationDeadline(signedAt: Date, timeZone: string = AGREEMENT_TIME_ZONE): Date {
  const signedOn = calendarDayIn(signedAt, timeZone);
  return endOfDayIn(businessDayAfter(signedOn, CANCELLATION_BUSINESS_DAYS), timeZone);
}

/**
 * The first moment the team may begin: the start of the first business day
 * after the cancellation window has closed. (The law allows the first instant
 * after the deadline; the team works on business days, so this is the date
 * the client is told.)
 */
export function firstWorkingDay(deadline: Date, timeZone: string = AGREEMENT_TIME_ZONE): Date {
  return startOfDayIn(businessDayAfter(calendarDayIn(deadline, timeZone), 1), timeZone);
}
