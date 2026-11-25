import { z } from "zod";
import { can, type Capability } from "../staff/permissions";
import type { StaffRole } from "../staff/types";
import { isIdeaMetric } from "./signals";
import { IDEA_DEPARTMENTS, IDEA_EFFORTS, TEST_DAYS_MAX, TEST_DAYS_MIN, type Idea, type IdeaAction, type IdeaStatus } from "./types";

// What may happen to an idea, and who may do it. One set of rules for the
// screen (which buttons show, and why not), the demo (which applies them in
// this browser) and the route (which refuses anything else); the database
// checks the order once more (migration 0040, ideas_guard).
//
//   add        anyone on the team (ideas.add)
//   edit       the author, or an administrator, while the idea is new
//   approve    new → approved                (an administrator: ideas.approve)
//   decline    new or approved → not now     (an administrator), with a reason
//   start      approved → testing, for N days (an administrator)
//   keep/drop  testing → kept / dropped      (an administrator), with what was learned

export const MIN_LEARNING_CHARS = 10;

/** The status each action leads to, from the statuses it may start from. */
export const TRANSITIONS: Record<Exclude<IdeaAction, "edit">, { from: readonly IdeaStatus[]; to: IdeaStatus }> = {
  approve: { from: ["new"], to: "approved" },
  decline: { from: ["new", "approved"], to: "declined" },
  start: { from: ["approved"], to: "testing" },
  keep: { from: ["testing"], to: "kept" },
  drop: { from: ["testing"], to: "dropped" },
};

export const FINAL_STATUSES: readonly IdeaStatus[] = ["kept", "dropped", "declined"];

/** A finished test: what the learnings library holds. */
export function isLearning(idea: Pick<Idea, "status">): boolean {
  return idea.status === "kept" || idea.status === "dropped";
}

export type ActionRefusal = "role" | "status" | "not_author";

/** Why this member may not do this to this idea, or null when they may. */
export function actionRefusal(action: IdeaAction, idea: Pick<Idea, "status" | "createdBy">, member: { role: StaffRole | null; userId: string | null }): ActionRefusal | null {
  if (action === "edit") {
    if (idea.status !== "new") return "status";
    if (can(member.role, "ideas.approve")) return null;
    if (!can(member.role, "ideas.add")) return "role";
    return idea.createdBy && idea.createdBy === member.userId ? null : "not_author";
  }
  if (!can(member.role, "ideas.approve")) return "role";
  return TRANSITIONS[action].from.includes(idea.status) ? null : "status";
}

/** The capability an action needs (for the route's requireCapability). */
export function capabilityFor(action: IdeaAction | "add" | "ask_alti" | "add_proposal" | "dismiss_proposal"): Capability {
  return action === "add" || action === "edit" ? "ideas.add" : "ideas.approve";
}

const title = z.string().trim().min(3).max(120);
const why = z.string().trim().min(10).max(1000);
const words = z.object({
  title,
  why,
  department: z.enum(IDEA_DEPARTMENTS),
  metric: z.string().refine(isIdeaMetric, "Pick a metric from the list."),
  expectedEffect: z.string().trim().min(3).max(200),
  effort: z.enum(IDEA_EFFORTS),
});

export type IdeaWords = z.infer<typeof words>;

const id = z.string().min(1).max(64);
const learning = z.string().trim().min(MIN_LEARNING_CHARS).max(2000);

/** POST /api/staff/ideas. Strict: a field the route does not expect is refused. */
export const ideasBodySchema = z.discriminatedUnion("action", [
  words.extend({ action: z.literal("add") }).strict(),
  words.extend({ action: z.literal("edit"), id }).strict(),
  z.object({ action: z.literal("approve"), id }).strict(),
  z.object({ action: z.literal("decline"), id, note: z.string().trim().min(3).max(500) }).strict(),
  z.object({ action: z.literal("start"), id, testDays: z.number().int().min(TEST_DAYS_MIN).max(TEST_DAYS_MAX) }).strict(),
  z.object({ action: z.literal("keep"), id, learned: learning }).strict(),
  z.object({ action: z.literal("drop"), id, learned: learning }).strict(),
  z.object({ action: z.literal("ask_alti") }).strict(),
  z.object({ action: z.literal("add_proposal"), id }).strict(),
  z.object({ action: z.literal("dismiss_proposal"), id }).strict(),
]);

export type IdeasBody = z.infer<typeof ideasBodySchema>;

/** The idea after an action, as the demo and the route write it. Assumes actionRefusal said yes. */
export function applyAction(idea: Idea, body: Exclude<IdeasBody, { action: "add" | "ask_alti" | "add_proposal" | "dismiss_proposal" }>, by: string, now: Date): Idea {
  const at = now.toISOString();
  switch (body.action) {
    case "edit":
      return { ...idea, title: body.title, why: body.why, department: body.department, metric: body.metric, expectedEffect: body.expectedEffect, effort: body.effort, updatedAt: at };
    case "approve":
      return { ...idea, status: "approved", approvedByName: by, approvedAt: at, updatedAt: at };
    case "decline":
      return { ...idea, status: "declined", decidedByName: by, decidedAt: at, resultNote: body.note, updatedAt: at };
    case "start":
      return { ...idea, status: "testing", testDays: body.testDays, testStartedAt: at, testEndsAt: new Date(now.getTime() + body.testDays * 86_400_000).toISOString(), updatedAt: at };
    case "keep":
    case "drop":
      return { ...idea, status: body.action === "keep" ? "kept" : "dropped", decidedByName: by, decidedAt: at, resultNote: body.learned, updatedAt: at };
  }
}

/** A test whose days are over: it needs a decision (kept or dropped). */
export function testIsDue(idea: Pick<Idea, "status" | "testEndsAt">, now: Date): boolean {
  return idea.status === "testing" && idea.testEndsAt !== null && Date.parse(idea.testEndsAt) <= now.getTime();
}

/** Days left in a running test (0 when over), or null. */
export function testDaysLeft(idea: Pick<Idea, "status" | "testEndsAt">, now: Date): number | null {
  if (idea.status !== "testing" || !idea.testEndsAt) return null;
  return Math.max(0, Math.ceil((Date.parse(idea.testEndsAt) - now.getTime()) / 86_400_000));
}

/** The learnings library, searched by words (title, why, what was learned, the metric's name). Newest first. */
export function searchLearnings(ideas: readonly Idea[], query: string, label: (metric: string) => string = (m) => m): Idea[] {
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const terms = fold(query).split(/\s+/).filter((w) => w.length >= 2);
  return ideas
    .filter(isLearning)
    .filter((idea) => {
      if (terms.length === 0) return true;
      const text = fold([idea.title, idea.why, idea.resultNote ?? "", idea.expectedEffect, label(idea.metric)].join(" "));
      return terms.every((t) => text.includes(t));
    })
    .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""));
}
