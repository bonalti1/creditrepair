import type { ContentPiece } from "./types";

// The calendar's arithmetic: which day a piece sits on, and the days of a
// month or a week. Days are calendar dates (YYYY-MM-DD) in the team's time
// zone, Central by default (Texas), so a post scheduled for 9 p.m. in Houston
// is not shown on the next day.

export const CONTENT_TIME_ZONE = "America/Chicago";

/** YYYY-MM-DD of an instant in a time zone. */
export function dayIn(iso: string, timeZone = CONTENT_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  return parts;
}

/** The day a piece belongs on: when it was posted, else when it is scheduled, else its due date. */
export function pieceDay(piece: ContentPiece, scheduledAt?: string | null): string | null {
  const posted = piece.posts.map((p) => p.postedAt).sort()[0];
  if (posted) return dayIn(posted);
  if (scheduledAt) return dayIn(scheduledAt);
  return piece.dueDate;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function parse(day: string): { y: number; m: number; d: number } {
  const [y, m, d] = day.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}

/** Add days to a YYYY-MM-DD, in plain calendar arithmetic (no time zone). */
export function addDays(day: string, n: number): string {
  const { y, m, d } = parse(day);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** 0 = Sunday. */
export function weekday(day: string): number {
  const { y, m, d } = parse(day);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The Sunday that starts the week of a day. */
export function weekStart(day: string): string {
  return addDays(day, -weekday(day));
}

/** The 7 days of a week, from its Sunday. */
export function weekDays(day: string): string[] {
  const start = weekStart(day);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** The weeks shown for a month: Sunday to Saturday rows covering every day of it. */
export function monthGrid(year: number, month: number): string[][] {
  const first = ymd(year, month, 1);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = ymd(year, month, lastDay);
  const weeks: string[][] = [];
  for (let start = weekStart(first); start <= last; start = addDays(start, 7)) weeks.push(weekDays(start));
  return weeks;
}

/** The pieces on each day. */
export function piecesByDay(pieces: readonly ContentPiece[], scheduled: ReadonlyMap<string, string> = new Map()): Map<string, ContentPiece[]> {
  const out = new Map<string, ContentPiece[]>();
  for (const piece of pieces) {
    if (piece.status === "archived") continue;
    const day = pieceDay(piece, scheduled.get(piece.id));
    if (!day) continue;
    out.set(day, [...(out.get(day) ?? []), piece]);
  }
  return out;
}

/** "Monday, December 7" / "lunes, 7 de diciembre". */
export function dayLabel(day: string, locale: "en" | "es", options: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" }): string {
  const { y, m, d } = parse(day);
  return new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", { ...options, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** The wall-clock time in a zone, as an instant: "2026-12-07" + "18:30" in Central time. */
export function zonedInstant(day: string, time: string, timeZone = CONTENT_TIME_ZONE): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [hh, mm] = time.split(":").map(Number);
  const { y, m, d } = parse(day);
  // Guess the instant as if UTC, then correct by the zone's offset at that moment (twice, for DST edges).
  let guess = Date.UTC(y, m - 1, d, hh!, mm!);
  for (let i = 0; i < 2; i++) {
    const shown = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
    const get = (type: string) => Number(shown.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    guess += Date.UTC(y, m - 1, d, hh!, mm!) - asUtc;
  }
  return new Date(guess).toISOString();
}

/** "Dec 7, 6:30 p.m. CT". */
export function zonedLabel(iso: string, locale: "en" | "es", timeZone = CONTENT_TIME_ZONE): string {
  return new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
}
