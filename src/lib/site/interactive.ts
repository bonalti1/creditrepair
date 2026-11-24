import { QUIZ_ITEM_IDS, type QuizItemId } from "./live";

// The logic of the website's small interactive pieces, apart from the screens
// so it can be tested: the report check, the home-ready teaser, and motion.
// No personal data goes into any of them, and nothing leaves the page.

// ── Motion ──────────────────────────────────────────────────────────────

/** The media query a visitor uses to ask for less motion. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

type MatchMedia = (query: string) => { matches: boolean };

/**
 * True when the visitor asked for reduced motion. With no window (the server)
 * or no matchMedia, false: the server renders the finished, still state anyway.
 */
export function prefersReducedMotion(matchMedia: MatchMedia | undefined = typeof window !== "undefined" ? window.matchMedia?.bind(window) : undefined): boolean {
  try {
    return Boolean(matchMedia?.(REDUCED_MOTION_QUERY).matches);
  } catch {
    return false;
  }
}

/** A step's delay: the designed one, or 0 for reduced motion (every state shows at once). */
export function motionDelay(ms: number, reduced: boolean): number {
  return reduced ? 0 : Math.max(0, ms);
}

/**
 * The hero example's timings (ms), in order: Alti's two opening lines (each
 * after a typing indicator), the reply to the visitor's answer, then the
 * mailing animation's three stops. Reduced motion: all zero.
 */
export const DEMO_TIMING = {
  typing: 750,
  betweenLines: 350,
  intoCase: 700,
  mailed: 600,
  transit: 900,
  delivered: 900,
} as const;

export function demoTimings(reduced: boolean): Record<keyof typeof DEMO_TIMING, number> {
  const out = {} as Record<keyof typeof DEMO_TIMING, number>;
  for (const [key, ms] of Object.entries(DEMO_TIMING)) out[key as keyof typeof DEMO_TIMING] = motionDelay(ms, reduced);
  return out;
}

/** The mailing animation's stops, in order. */
export const MAIL_STOPS = ["mailed", "transit", "delivered"] as const;
export type MailStop = (typeof MAIL_STOPS)[number];

/** How far along the track the envelope is at a stop, 0 to 1. */
export function mailProgress(stop: MailStop | null): number {
  if (stop === null) return 0;
  return (MAIL_STOPS.indexOf(stop) + 1) / MAIL_STOPS.length;
}

// ── "What's on your report?" ───────────────────────────────────────────

export type QuizChoice = QuizItemId | "none";

/**
 * Toggle one chip. "None of these" clears everything else, and picking an
 * item clears "none": the two can't be on together.
 */
export function toggleQuizChoice(selected: readonly QuizChoice[], choice: QuizChoice): QuizChoice[] {
  if (choice === "none") return selected.includes("none") ? [] : ["none"];
  const without = selected.filter((c) => c !== "none");
  return without.includes(choice) ? without.filter((c) => c !== choice) : [...without, choice];
}

export interface QuizResult {
  /** The explanations to show, in the list's own order (not the order tapped). */
  items: QuizItemId[];
  /** "None of these": show the "good to know" card and AnnualCreditReport.com. */
  none: boolean;
}

/** What the result screen shows for a selection. Never a score and never a prediction: only explanations. */
export function quizResult(selected: readonly QuizChoice[]): QuizResult {
  const none = selected.includes("none");
  return { items: none ? [] : QUIZ_ITEM_IDS.filter((id) => selected.includes(id)), none };
}

// ── The home-ready teaser ───────────────────────────────────────────────

export type TeaserGoal = "home" | "build" | "check";
export type TeaserId = "ssn" | "itin" | "skip";
export type TeaserFeature = "build" | "home" | "itin" | "check";

/**
 * The after-care features to point to (docs/AFTERCARE.md), from two answers.
 * Every client gets all of them; this only puts the relevant ones first.
 */
export function teaserFeatures(goal: TeaserGoal, id: TeaserId): TeaserFeature[] {
  const first: TeaserFeature[] = goal === "home" ? ["home", "build"] : goal === "build" ? ["build", "home"] : ["check", "build"];
  if (id === "itin") first.splice(1, 0, "itin");
  return first;
}
