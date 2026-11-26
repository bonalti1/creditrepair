import { slotDay, slotTime, zonedToUtc } from "../calls/slots";
import type { Webinar, WebinarPhase } from "./types";

// Webinars run on Texas time (America/Chicago): entered, shown and reminded
// on that clock, whatever the browser's zone. The reminders' quiet hours are
// Texas's too (21:00–8:00), like every automatic message (docs/AUTOPILOT.md).

export const TEXAS_TZ = "America/Chicago";

/** 9 p.m. to 8 a.m. Texas: no reminder is sent. */
export const WEBINAR_QUIET = { quietStartHour: 21, quietEndHour: 8 } as const;

/** "2026-12-10" + "19:00" on Texas time → the instant. Null for a day or time that is not one. */
export function texasToIso(day: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return null;
  return zonedToUtc(day, time, TEXAS_TZ)?.toISOString() ?? null;
}

/** The instant as the form's two fields on Texas time: { day: "2026-12-10", time: "19:00" }. */
export function isoToTexas(iso: string): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TEXAS_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** "Thursday, December 10" / "jueves, 10 de diciembre", on Texas's calendar. */
export function webinarDay(iso: string, locale: "en" | "es"): string {
  return slotDay(iso, TEXAS_TZ, locale);
}

/** "7:00 PM" / "7:00 p. m.", on Texas's clock. */
export function webinarTime(iso: string, locale: "en" | "es"): string {
  return slotTime(iso, TEXAS_TZ, locale);
}

/** "Thursday, December 10 · 7:00 PM (Texas time)". */
export function webinarWhen(iso: string, locale: "en" | "es"): string {
  return `${webinarDay(iso, locale)} · ${webinarTime(iso, locale)} (${locale === "es" ? "hora de Texas" : "Texas time"})`;
}

export function endsAt(webinar: Pick<Webinar, "startsAt" | "durationMinutes">): string {
  return new Date(Date.parse(webinar.startsAt) + webinar.durationMinutes * 60_000).toISOString();
}

/** Where a webinar is in time: a draft, upcoming, live (from its start to its end), ended, or cancelled. */
export function phaseOf(webinar: Pick<Webinar, "status" | "startsAt" | "durationMinutes">, now: Date): WebinarPhase {
  if (webinar.status === "draft") return "draft";
  if (webinar.status === "cancelled") return "cancelled";
  const start = Date.parse(webinar.startsAt);
  const end = Date.parse(endsAt(webinar));
  if (now.getTime() < start) return "upcoming";
  if (now.getTime() < end) return "live";
  return "ended";
}

/** Minutes from the start (negative before it), for the live console's timer. */
export function minutesIn(webinar: Pick<Webinar, "startsAt">, now: Date): number {
  return (now.getTime() - Date.parse(webinar.startsAt)) / 60_000;
}
