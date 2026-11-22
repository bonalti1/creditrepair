import { z } from "zod";
import { latestMailedRound, type CaseFacts, type CaseState } from "../case/timeline";

// "¿Cómo vamos?": a one-tap satisfaction pulse after a few key moments.
//
//   agreement_signed     the client signed their agreement
//   first_round_mailed   their first round of letters went out
//   first_answer         the first answer to a round came in
//
// Each moment is asked about once, in the app, with three faces and an
// optional comment; skipping it is fine and it is not asked again. When the
// client reaches a later moment before answering an earlier one, only the
// latest is asked. Answers are stored per client and moment (migration 0018,
// POST /api/pulse); the business dashboard reads them through pulseSummary.
//
// The question is about how the service feels, never about results.

export const PULSE_MOMENTS = ["agreement_signed", "first_round_mailed", "first_answer"] as const;
export type PulseMoment = (typeof PULSE_MOMENTS)[number];

export const PULSE_RATINGS = [1, 2, 3] as const;
export type PulseRating = (typeof PULSE_RATINGS)[number];

export const PULSE_COMMENT_MAX = 500;

/** What POST /api/pulse accepts. */
export const pulseSubmissionSchema = z.object({
  moment: z.enum(PULSE_MOMENTS),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  comment: z
    .string()
    .max(PULSE_COMMENT_MAX)
    .transform((v) => v.trim())
    .optional()
    .transform((v) => (v ? v : undefined)),
  locale: z.enum(["es", "en"]).default("en"),
});
export type PulseSubmission = z.infer<typeof pulseSubmissionSchema>;

/** The comment a client adds after tapping a face: once, to an answer that has none. */
export const pulseCommentSchema = z.object({
  moment: z.enum(PULSE_MOMENTS),
  comment: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1).max(PULSE_COMMENT_MAX)),
});

/** The moments the case has reached, oldest first. */
export function reachedMoments(facts: CaseFacts, state: CaseState): PulseMoment[] {
  const out: PulseMoment[] = [];
  const a = facts.agreement;
  if (a?.signedAt && !a.cancelledAt && !a.serviceEndRequestedAt) out.push("agreement_signed");
  if (state === "cancelled" || state === "end_requested") return [];
  if (latestMailedRound(facts)) out.push("first_round_mailed");
  if (facts.rounds.some((r) => r.answers.length > 0)) out.push("first_answer");
  return out;
}

/**
 * The moment to ask about now, or null. Only the latest reached moment is
 * asked, and only if the client has not answered or skipped it.
 */
export function duePulse(facts: CaseFacts, state: CaseState, done: ReadonlySet<PulseMoment>): PulseMoment | null {
  const reached = reachedMoments(facts, state);
  const latest = reached.at(-1);
  return latest && !done.has(latest) ? latest : null;
}

export const PULSE_COPY = {
  es: {
    title: "¿Cómo vamos?",
    question: {
      agreement_signed: "Ya firmaste tu acuerdo. ¿Cómo te sentiste con el inicio?",
      first_round_mailed: "Tus primeras cartas ya salieron. ¿Cómo te sientes con el servicio?",
      first_answer: "Llegó la primera respuesta a tus cartas. ¿Cómo te sientes con el servicio?",
    } satisfies Record<PulseMoment, string>,
    ratings: { 1: "No muy bien", 2: "Más o menos", 3: "Bien" } satisfies Record<PulseRating, string>,
    commentLabel: "¿Quieres contarnos algo más? (opcional)",
    send: "Enviar",
    skip: "Ahora no",
    thanks: "Gracias. Tu equipo lee cada respuesta.",
    once: "Solo te lo preguntamos una vez.",
  },
  en: {
    title: "How are we doing?",
    question: {
      agreement_signed: "You signed your agreement. How did getting started feel?",
      first_round_mailed: "Your first letters went out. How do you feel about the service?",
      first_answer: "The first answer to your letters came in. How do you feel about the service?",
    } satisfies Record<PulseMoment, string>,
    ratings: { 1: "Not well", 2: "So-so", 3: "Well" } satisfies Record<PulseRating, string>,
    commentLabel: "Anything else you want to tell us? (optional)",
    send: "Send",
    skip: "Not now",
    thanks: "Thank you. Your team reads every answer.",
    once: "We only ask once.",
  },
} as const;

// ── For the business dashboard ──────────────────────────────────────────

/** One stored answer, as staff read it (a row of client_pulses). */
export interface PulseRow {
  userId: string;
  moment: PulseMoment;
  rating: PulseRating;
  comment: string | null;
  createdAt: string;
}

export interface PulseSummary {
  /** Answers counted. */
  count: number;
  /** Average rating, 1 to 3, rounded to two decimals; null with no answers. */
  average: number | null;
  /** How many of each face. */
  distribution: Record<PulseRating, number>;
  byMoment: Record<PulseMoment, { count: number; average: number | null }>;
  /** Answers with a comment, newest first. */
  comments: Array<{ userId: string; moment: PulseMoment; rating: PulseRating; comment: string; createdAt: string }>;
}

const avg = (ratings: number[]) => (ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100 : null);

/**
 * The pulse for the business dashboard, over the rows given (filter them by
 * date first for a period). Pure. Definition: the average of the ratings
 * (1 = "no muy bien", 2 = "más o menos", 3 = "bien") of every answer given in
 * the period, one answer per client per moment; skipped questions are not
 * answers and are not counted.
 */
export function pulseSummary(rows: readonly PulseRow[]): PulseSummary {
  const byMoment = Object.fromEntries(
    PULSE_MOMENTS.map((m) => {
      const ratings = rows.filter((r) => r.moment === m).map((r) => r.rating);
      return [m, { count: ratings.length, average: avg(ratings) }];
    }),
  ) as PulseSummary["byMoment"];
  return {
    count: rows.length,
    average: avg(rows.map((r) => r.rating)),
    distribution: { 1: rows.filter((r) => r.rating === 1).length, 2: rows.filter((r) => r.rating === 2).length, 3: rows.filter((r) => r.rating === 3).length },
    byMoment,
    comments: rows
      .filter((r): r is PulseRow & { comment: string } => typeof r.comment === "string" && r.comment.trim() !== "")
      .map((r) => ({ userId: r.userId, moment: r.moment, rating: r.rating, comment: r.comment.trim(), createdAt: r.createdAt }))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
  };
}

/** A row of public.client_pulses as a PulseRow; null for anything malformed. */
export function pulseFromRow(row: Record<string, unknown>): PulseRow | null {
  const moment = PULSE_MOMENTS.find((m) => m === row.moment);
  const rating = PULSE_RATINGS.find((r) => r === Number(row.rating));
  if (!moment || !rating || typeof row.user_id !== "string" || typeof row.created_at !== "string") return null;
  return { userId: row.user_id, moment, rating, comment: typeof row.comment === "string" ? row.comment : null, createdAt: row.created_at };
}
