// When a person can book a call: the windows the team sets in
// /equipo/llamadas, cut into slots, minus what is booked, from an hour from
// now to three weeks ahead. Times are stored in UTC and shown on the
// person's clock (Texas, Central time, by default). Pure; the database
// checks the same things again (migration 0032, call_bookings_guard).

export const SLOT_MINUTES = [15, 20, 30, 45, 60] as const;
export type SlotMinutes = (typeof SLOT_MINUTES)[number];

/** A slot that starts sooner than this cannot be booked: the team needs a moment to see it. */
export const BOOKING_LEAD_MINUTES = 60;
/** How far ahead slots are offered. */
export const BOOKING_HORIZON_DAYS = 21;
/** The longest window the team can add at once. */
export const MAX_WINDOW_HOURS = 12;

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export interface CallWindow {
  id: string;
  startsAt: string;
  endsAt: string;
  slotMinutes: number;
  timeZone: string;
  createdByName: string;
  removedAt: string | null;
}

export interface CallSlot {
  windowId: string;
  start: string;
  end: string;
}

/** Every slot of the open windows that is free and bookable now. */
export function openSlots(windows: readonly CallWindow[], bookedStarts: Iterable<string>, now: Date): CallSlot[] {
  const taken = new Set([...bookedStarts].map((s) => new Date(s).getTime()));
  const earliest = now.getTime() + BOOKING_LEAD_MINUTES * MINUTE;
  const latest = now.getTime() + BOOKING_HORIZON_DAYS * DAY;
  const out: CallSlot[] = [];
  for (const w of windows) {
    if (w.removedAt) continue;
    const step = w.slotMinutes * MINUTE;
    const end = new Date(w.endsAt).getTime();
    for (let t = new Date(w.startsAt).getTime(); t + step <= end; t += step) {
      if (t < earliest || t > latest || taken.has(t)) continue;
      out.push({ windowId: w.id, start: new Date(t).toISOString(), end: new Date(t + step).toISOString() });
    }
  }
  // Two windows that overlap offer each time once.
  const unique = new Map(out.map((s) => [s.start, s]));
  return [...unique.values()].sort((a, b) => a.start.localeCompare(b.start));
}

export type SlotProblem = "unknown_window" | "not_a_slot" | "too_soon" | "too_far" | "taken";

/** Why this slot cannot be booked now, or null when it can. */
export function slotProblem(
  request: { windowId: string; start: string },
  windows: readonly CallWindow[],
  bookedStarts: Iterable<string>,
  now: Date,
): SlotProblem | null {
  const w = windows.find((x) => x.id === request.windowId && !x.removedAt);
  if (!w) return "unknown_window";
  const t = new Date(request.start).getTime();
  const begin = new Date(w.startsAt).getTime();
  const step = w.slotMinutes * MINUTE;
  if (!Number.isFinite(t) || t < begin || t + step > new Date(w.endsAt).getTime() || (t - begin) % step !== 0) return "not_a_slot";
  if (t < now.getTime() + BOOKING_LEAD_MINUTES * MINUTE) return "too_soon";
  if (t > now.getTime() + BOOKING_HORIZON_DAYS * DAY) return "too_far";
  if ([...bookedStarts].some((s) => new Date(s).getTime() === t)) return "taken";
  return null;
}

/** The end of the slot that starts at `start` in that window. */
export function slotEnd(start: string, slotMinutes: number): string {
  return new Date(new Date(start).getTime() + slotMinutes * MINUTE).toISOString();
}

// ── Time zones ──────────────────────────────────────────────────────────

/** The zone's offset from UTC at that moment, in minutes (Central: -360 or -300). */
export function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour") % 24, n("minute"), n("second"));
  return Math.round((wall - Math.floor(at.getTime() / 1000) * 1000) / MINUTE);
}

/** A wall-clock time in a zone ("2026-12-02", "10:00", Central) as the UTC moment. */
export function zonedToUtc(day: string, time: string, timeZone: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const [y, mo, da, h, mi] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  // Two passes settle the offset on either side of a daylight-saving change.
  let at = guess - zoneOffsetMinutes(new Date(guess), timeZone) * MINUTE;
  at = guess - zoneOffsetMinutes(new Date(at), timeZone) * MINUTE;
  return new Date(at);
}

const dateLocale = (locale: "es" | "en") => (locale === "es" ? "es-MX" : "en-US");

/** "Tuesday, December 2" / "martes, 2 de diciembre", on that clock. */
export function slotDay(iso: string, timeZone: string, locale: "es" | "en"): string {
  return new Date(iso).toLocaleDateString(dateLocale(locale), { weekday: "long", month: "long", day: "numeric", timeZone });
}

/** "10:20 AM" / "10:20 a. m.", on that clock. */
export function slotTime(iso: string, timeZone: string, locale: "es" | "en"): string {
  return new Date(iso).toLocaleTimeString(dateLocale(locale), { hour: "numeric", minute: "2-digit", timeZone });
}

/** The zone's short name at that moment: "CST", "CDT" ("hora del centro" in Spanish). */
export function zoneLabel(iso: string, timeZone: string, locale: "es" | "en"): string {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(new Date(iso))
      .find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  if (locale === "es" && timeZone === "America/Chicago") return "hora del centro";
  return name;
}

/** The calendar day on that clock, "2026-12-02", for grouping. */
export function slotDayKey(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone });
}

/** Slots grouped by day on the person's clock, in order. */
export function slotsByDay(slots: readonly CallSlot[], timeZone: string): Array<{ day: string; slots: CallSlot[] }> {
  const map = new Map<string, CallSlot[]>();
  for (const s of slots) {
    const key = slotDayKey(s.start, timeZone);
    map.set(key, [...(map.get(key) ?? []), s]);
  }
  return [...map.entries()].map(([day, list]) => ({ day, slots: list }));
}

// ── Adding a window (the team) ──────────────────────────────────────────

export interface WindowRequest {
  /** "2026-12-02" on the team's clock. */
  day: string;
  /** "10:00". */
  from: string;
  /** "12:00". */
  to: string;
  slotMinutes: number;
  timeZone: string;
}

export type WindowProblem = "invalid_time" | "end_before_start" | "too_long" | "in_the_past" | "too_far" | "slot_length" | "not_whole_slots";

/** The window as UTC moments, or why it cannot be added. */
export function windowFromRequest(req: WindowRequest, now: Date): { ok: true; startsAt: string; endsAt: string } | { ok: false; problems: WindowProblem[] } {
  const problems: WindowProblem[] = [];
  if (!(SLOT_MINUTES as readonly number[]).includes(req.slotMinutes)) problems.push("slot_length");
  const start = zonedToUtc(req.day, req.from, req.timeZone);
  const end = zonedToUtc(req.day, req.to, req.timeZone);
  if (!start || !end) return { ok: false, problems: [...problems, "invalid_time"] };
  const length = end.getTime() - start.getTime();
  if (length <= 0) problems.push("end_before_start");
  else {
    if (length > MAX_WINDOW_HOURS * 60 * MINUTE) problems.push("too_long");
    if (req.slotMinutes > 0 && length % (req.slotMinutes * MINUTE) !== 0) problems.push("not_whole_slots");
  }
  if (start.getTime() <= now.getTime()) problems.push("in_the_past");
  if (start.getTime() > now.getTime() + (BOOKING_HORIZON_DAYS + 60) * DAY) problems.push("too_far");
  return problems.length > 0 ? { ok: false, problems } : { ok: true, startsAt: start.toISOString(), endsAt: end.toISOString() };
}
