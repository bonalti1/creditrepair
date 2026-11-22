// The client's first week, as four steps with a time estimate each, and the
// timestamps of how long each step really took on this device.
//
//   1  Tus datos       the welcome (invited) or goal and state
//   2  Tu acuerdo      rights, contract and signature (/acuerdo)
//   3  Tu monitoreo    the monitoring subscription
//   4  Tu revisión     the first item on screen in the review
//
// "Paso 2 de 4 · unos 5 minutos" is shown on onboarding and on the agreement
// when the client comes from onboarding, so the first week reads as one path.
//
// The timestamps are kept on the device only (no tracking service, nothing is
// sent): they measure the demo's onboarding so friction can be found
// (docs/UX.md, "First-week speed"). They also let onboarding resume where the
// client left off.

export type FirstWeekStep = "details" | "agreement" | "monitoring" | "review";

export const FIRST_WEEK: ReadonlyArray<{ key: FirstWeekStep; minutes: number; label: { es: string; en: string } }> = [
  { key: "details", minutes: 1, label: { es: "Tus datos", en: "Your details" } },
  { key: "agreement", minutes: 5, label: { es: "Tu acuerdo", en: "Your agreement" } },
  { key: "monitoring", minutes: 2, label: { es: "Tu monitoreo", en: "Your monitoring" } },
  { key: "review", minutes: 10, label: { es: "Tu revisión", en: "Your review" } },
];

/** "Paso 2 de 4 · Tu acuerdo · unos 5 minutos" */
export function firstWeekLabel(step: FirstWeekStep, locale: "es" | "en"): { index: number; total: number; text: string } {
  const index = FIRST_WEEK.findIndex((s) => s.key === step) + 1;
  const s = FIRST_WEEK[index - 1]!;
  const total = FIRST_WEEK.length;
  const minutes = s.minutes === 1 ? (locale === "es" ? "1 minuto" : "1 minute") : locale === "es" ? `unos ${s.minutes} minutos` : `about ${s.minutes} minutes`;
  return {
    index,
    total,
    text: locale === "es" ? `Paso ${index} de ${total} · ${s.label.es} · ${minutes}` : `Step ${index} of ${total} · ${s.label.en} · ${minutes}`,
  };
}

// ── Timestamps ──────────────────────────────────────────────────────────

export const FIRST_WEEK_TIMES_KEY = "bonalti.firstWeekTimes.v1";

export const MILESTONES = [
  "invite_opened",
  "details_done",
  "disclosures_acknowledged",
  "agreement_signed",
  "monitoring_done",
  "review_started",
] as const;
export type Milestone = (typeof MILESTONES)[number];
export type MilestoneTimes = Partial<Record<Milestone, string>>;

export function readMilestones(): MilestoneTimes {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(FIRST_WEEK_TIMES_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    return Object.fromEntries(MILESTONES.filter((m) => typeof parsed[m] === "string").map((m) => [m, parsed[m] as string]));
  } catch {
    return {};
  }
}

/** Record a milestone the first time it happens on this device. Later calls keep the first time. */
export function markMilestone(milestone: Milestone, at: Date = new Date()): void {
  if (typeof window === "undefined") return;
  const times = readMilestones();
  if (times[milestone]) return;
  try {
    window.localStorage.setItem(FIRST_WEEK_TIMES_KEY, JSON.stringify({ ...times, [milestone]: at.toISOString() }));
  } catch {
    // Storage unavailable: nothing is measured, nothing breaks.
  }
}

/** Seconds between each milestone and the one before it that was recorded. Pure. */
export function milestoneDurations(times: MilestoneTimes): Array<{ milestone: Milestone; seconds: number }> {
  const out: Array<{ milestone: Milestone; seconds: number }> = [];
  let previous: number | null = null;
  for (const m of MILESTONES) {
    const at = times[m] ? Date.parse(times[m]!) : Number.NaN;
    if (Number.isNaN(at)) continue;
    if (previous !== null) out.push({ milestone: m, seconds: Math.max(0, Math.round((at - previous) / 1000)) });
    previous = at;
  }
  return out;
}

/**
 * Where onboarding should pick up for a client who comes back: the first step
 * not finished. `signed` is whether the agreement is signed (the agreement
 * itself is the record of that step, not the timestamp).
 */
export function resumeStep(times: MilestoneTimes, signed: boolean): FirstWeekStep {
  if (!times.details_done && !signed) return "details";
  if (!signed) return "agreement";
  if (!times.monitoring_done) return "monitoring";
  return "review";
}
