// The parts of "When would I pay?" the browser needs (payTimeline.ts builds
// the events on the server, from the billing rules): the event shape and the
// slider's filters. Nothing here imports the billing code.

export const TIMELINE_MONTHS = 6;
export const TIMELINE_DAYS = TIMELINE_MONTHS * 30;

export type PayEventKind = "signed" | "cancelEnds" | "mailed" | "charge" | "quiet";

export interface PayEvent {
  day: number;
  kind: PayEventKind;
  /** The round mailed, or the round(s) a charge pays for. */
  round?: number;
  /** "$89.00", only from a reviewed plan; null shows the rule ("a charge can happen"). */
  amount: string | null;
}

/** The events up to a month on the slider (1–6). */
export function eventsThrough(events: readonly PayEvent[], months: number): PayEvent[] {
  const m = Math.min(TIMELINE_MONTHS, Math.max(1, Math.round(months)));
  return events.filter((e) => e.day <= m * 30);
}

/** Rounds mailed and charges, up to a month on the slider. */
export function timelineCounts(events: readonly PayEvent[], months: number): { rounds: number; charges: number } {
  const shown = eventsThrough(events, months);
  return { rounds: shown.filter((e) => e.kind === "mailed").length, charges: shown.filter((e) => e.kind === "charge").length };
}
