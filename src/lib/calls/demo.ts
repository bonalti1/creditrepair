import { CALL_TIME_ZONE } from "./config";
import { zonedToUtc, type CallWindow } from "./slots";

// The demo's call schedule (no database): the next three weekdays, 10:00 to
// 12:00 and 2:00 to 4:00 p.m. Central, in 20-minute slots. Labelled as an
// example on the booking page; a booking made in the demo is not stored.

export function demoWindows(now: Date, timeZone: string = CALL_TIME_ZONE): CallWindow[] {
  const out: CallWindow[] = [];
  const day = new Date(now.getTime());
  while (out.length < 6) {
    day.setUTCDate(day.getUTCDate() + 1);
    const key = day.toLocaleDateString("en-CA", { timeZone });
    const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (const [from, to] of [["10:00", "12:00"], ["14:00", "16:00"]] as const) {
      const start = zonedToUtc(key, from, timeZone);
      const end = zonedToUtc(key, to, timeZone);
      if (start && end) out.push({ id: `demo-${key}-${from}`, startsAt: start.toISOString(), endsAt: end.toISOString(), slotMinutes: 20, timeZone, createdByName: "Demo", removedAt: null });
    }
  }
  return out;
}
