import { z } from "zod";
import { proposalWordsProblems, similarTitles } from "./check";
import { basedOnFrom, IDEA_METRICS, IDEA_METRIC_LABELS, type Signal } from "./signals";
import { ALTI_TEST_DAYS_MAX, IDEA_DEPARTMENTS, IDEA_EFFORTS, TEST_DAYS_MIN, type BasedOn, type IdeaDepartment, type IdeaEffort } from "./types";

// «Ask Alti for ideas» (docs/IDEAS.md): Alti, the AI assistant, reads the
// numbers the console already computes (signals.ts) and proposes 3 to 5
// experiments. The rules, taken from ALTO Control's Intelligence Center:
//
//   - Alti CITES numbers by their key; it never types one. The server fills
//     in each figure from its own snapshot (basedOnFrom), so a proposal can't
//     carry a made-up number, and words with a digit in them are dropped.
//   - Every proposal names the metric to watch and a test length (7–60 days).
//   - Every word goes through the claim rules and the house rules
//     (check.ts: no promises, never free, no pressure, never SMS, Texas only).
//   - A repeat of an idea already on the board is dropped.
//   - Nothing is acted on: a proposal waits until an administrator adds it to
//     the board (as a New idea) or dismisses it.
//
// The model call itself is in altiModel.ts; tests pass a caller of their own.

export const MIN_PROPOSALS = 3;
export const MAX_PROPOSALS = 5;
/** How many times a day the team may ask (each ask is a paid model call). */
export const ALTI_RUNS_PER_DAY = 5;
/** The weekly job asks at most once in this many days. */
export const CRON_MIN_DAYS_BETWEEN = 6;

export type AltiProblem = "not_connected" | "api_error" | "refusal" | "empty" | "invalid_json" | "no_valid_proposals";

/** Calls the model with these instructions; null output and a problem when it could not. */
export type AltiCaller = (input: { system: string; user: string }) => Promise<{ output: unknown; problem: AltiProblem | null; model?: string }>;

/** The JSON the model must return (structured outputs). */
export const PROPOSALS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["proposals"],
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "why", "department", "metric", "expectedEffect", "effort", "testDays", "basedOn"],
        properties: {
          title: { type: "string" },
          why: { type: "string" },
          department: { type: "string", enum: [...IDEA_DEPARTMENTS] },
          metric: { type: "string" },
          expectedEffect: { type: "string" },
          effort: { type: "string", enum: [...IDEA_EFFORTS] },
          testDays: { type: "integer" },
          basedOn: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

const rawProposal = z.object({
  title: z.string().trim().min(3).max(120),
  why: z.string().trim().min(10).max(1000),
  department: z.enum(IDEA_DEPARTMENTS),
  metric: z.string(),
  expectedEffect: z.string().trim().min(3).max(200),
  effort: z.enum(IDEA_EFFORTS),
  testDays: z.number().int(),
  basedOn: z.array(z.string()).max(12),
});

export interface CheckedProposal {
  title: string;
  why: string;
  department: IdeaDepartment;
  metric: string;
  expectedEffect: string;
  effort: IdeaEffort;
  testDays: number;
  basedOn: BasedOn[];
}

export const ALTI_SYSTEM = [
  "You are Alti, the AI assistant inside Credalti Control, the staff console of Credalti, a full-service credit repair company that serves Texas only, in English with Spanish one tap away.",
  "Your job here: propose experiments the team could run to improve the business, from the numbers you are given. A person decides whether to run any of them; nothing you write is sent to a client.",
  "Rules you must follow in every proposal:",
  "1. Cite numbers ONLY by their key in basedOn (one to six keys from the list you are given, only keys that have a value). Never write a digit in title, why or expectedEffect: the console fills in the figures itself.",
  "2. metric is the one key to watch during the test (from the list). testDays is between 7 and 60.",
  "3. Never promise or imply a result for clients: no deletions, no score changes, no approvals, no guarantees. Talk about the team's work and the business's own numbers.",
  "4. Nothing is free. No pressure, urgency or scarcity tactics. Never SMS or text messages: messages go by WhatsApp or email only.",
  "5. Only Texas is open. Do not propose selling in any other state.",
  "6. Do not repeat an idea already on the board (their titles are given).",
  "7. Write title, why and expectedEffect in plain English, short sentences. why says what the numbers suggest and what to change; expectedEffect says which way the metric should move.",
  `Return ${MIN_PROPOSALS} to ${MAX_PROPOSALS} proposals as JSON in the given schema, the most useful first.`,
].join("\n");

/** The request: the numbers (key, value, window) and the ideas already on the board. Aggregates only. */
export function altiUserMessage(signals: readonly Signal[], existingTitles: readonly string[]): string {
  const numbers = signals.map((s) => ({ key: s.key, label: IDEA_METRIC_LABELS.en[s.key] ?? s.key, value: s.value === null ? null : s.display, window: s.window, better: IDEA_METRICS[s.key]?.better ?? null }));
  return JSON.stringify({ numbers, departments: IDEA_DEPARTMENTS, ideasOnTheBoard: existingTitles.slice(0, 200) });
}

/**
 * The model's answer, read strictly: each proposal that passes every rule is
 * kept (at most five), with its numbers filled in from the snapshot; the rest
 * are counted as dropped.
 */
export function checkProposals(output: unknown, signals: readonly Signal[], existingTitles: readonly string[]): { proposals: CheckedProposal[]; dropped: number } {
  const list = z.object({ proposals: z.array(z.unknown()).max(20) }).safeParse(output);
  if (!list.success) return { proposals: [], dropped: 0 };
  const kept: CheckedProposal[] = [];
  let dropped = 0;
  const known = new Set(signals.filter((s) => s.value !== null).map((s) => s.key));
  const titles = existingTitles.map((title) => ({ title }));
  for (const item of list.data.proposals) {
    const parsed = rawProposal.safeParse(item);
    if (!parsed.success || kept.length >= MAX_PROPOSALS) {
      dropped += 1;
      continue;
    }
    const p = parsed.data;
    const basedOn = basedOnFrom(p.basedOn.filter((k) => known.has(k)), signals).slice(0, 6);
    const words = [p.title, p.why, p.expectedEffect].join("\n");
    const repeat = similarTitles(p.title, [...titles, ...kept.map((k) => ({ title: k.title }))]).length > 0;
    if (!Object.hasOwn(IDEA_METRICS, p.metric) || basedOn.length === 0 || p.testDays < TEST_DAYS_MIN || p.testDays > ALTI_TEST_DAYS_MAX || proposalWordsProblems(words).length > 0 || repeat) {
      dropped += 1;
      continue;
    }
    kept.push({ title: p.title, why: p.why, department: p.department, metric: p.metric, expectedEffect: p.expectedEffect, effort: p.effort, testDays: p.testDays, basedOn });
  }
  return { proposals: kept, dropped };
}

/** The whole ask: no caller (no key) says so; otherwise the checked proposals and what was dropped. */
export async function askAlti(
  caller: AltiCaller | null,
  signals: readonly Signal[],
  existingTitles: readonly string[],
): Promise<{ ok: true; proposals: CheckedProposal[]; dropped: number; model: string | null } | { ok: false; problem: AltiProblem; dropped: number; model: string | null }> {
  if (!caller) return { ok: false, problem: "not_connected", dropped: 0, model: null };
  const answer = await caller({ system: ALTI_SYSTEM, user: altiUserMessage(signals, existingTitles) });
  if (answer.problem || answer.output === null) return { ok: false, problem: answer.problem ?? "empty", dropped: 0, model: answer.model ?? null };
  const { proposals, dropped } = checkProposals(answer.output, signals, existingTitles);
  if (proposals.length === 0) return { ok: false, problem: "no_valid_proposals", dropped, model: answer.model ?? null };
  return { ok: true, proposals, dropped, model: answer.model ?? null };
}
