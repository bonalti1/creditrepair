// Ideas and experiments (docs/IDEAS.md, migration 0040): the team's board of
// ideas, the tests an administrator runs, what each finished test taught
// (the learnings library), and the experiments Alti (the AI assistant)
// proposes from the numbers the console already computes.

/** The departments an idea is for. The same keys as migration 0040's check (a test keeps them equal). */
export const IDEA_DEPARTMENTS = ["content", "leads", "clients", "support", "money", "letters", "partners", "tech"] as const;
export type IdeaDepartment = (typeof IDEA_DEPARTMENTS)[number];

export const IDEA_EFFORTS = ["S", "M", "L"] as const;
export type IdeaEffort = (typeof IDEA_EFFORTS)[number];

/**
 * The order: New → Approved → Testing → Kept or Dropped (with what was
 * learned); an administrator may say "Not now" (declined) to a new or an
 * approved idea. Kept, dropped and declined are final.
 */
export const IDEA_STATUSES = ["new", "approved", "testing", "kept", "dropped", "declined"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

/** What a person does to an idea. */
export const IDEA_ACTIONS = ["approve", "decline", "start", "keep", "drop", "edit"] as const;
export type IdeaAction = (typeof IDEA_ACTIONS)[number];

export interface Idea {
  id: string;
  title: string;
  why: string;
  department: IdeaDepartment;
  /** A key of IDEA_METRICS: the number the idea expects to move. */
  metric: string;
  /** In the author's words: what they expect to happen to that number. */
  expectedEffect: string;
  effort: IdeaEffort;
  status: IdeaStatus;
  source: "team" | "alti";
  proposalId: string | null;
  createdBy: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  approvedByName: string | null;
  approvedAt: string | null;
  testDays: number | null;
  testStartedAt: string | null;
  testEndsAt: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  /** What was learned (kept, dropped), or why not now (declined). */
  resultNote: string | null;
}

/** One number Alti's proposal is based on, as the server read it (never typed by the model). */
export interface BasedOn {
  key: string;
  value: number;
  unit: "count" | "percent" | "cents" | "minutes" | "days" | "ratio";
  display: string;
}

export interface IdeaProposal {
  id: string;
  runId: string;
  title: string;
  why: string;
  department: IdeaDepartment;
  metric: string;
  expectedEffect: string;
  effort: IdeaEffort;
  testDays: number;
  basedOn: BasedOn[];
  status: "open" | "added" | "dismissed";
  ideaId: string | null;
  createdAt: string;
}

export interface AltiRun {
  id: string;
  createdAt: string;
  trigger: "person" | "cron";
  byName: string;
  status: "ok" | "failed";
  proposed: number;
  dropped: number;
}

/** What the Ideas screen reads. Proposals and runs only for an administrator (they carry business numbers). */
export interface IdeasBoard {
  ideas: Idea[];
  proposals: IdeaProposal[] | null;
  runs: AltiRun[] | null;
  /** Whether Alti can be asked (ANTHROPIC_API_KEY set on the server); null when the viewer may not ask. */
  altiConnected: boolean | null;
  /** The member's own id as `createdBy` holds it (their user id; in the demo, their handle): who may edit what. */
  me: string | null;
  demo: boolean;
}

export const TEST_DAYS_MIN = 7;
export const TEST_DAYS_MAX = 90;
/** The longest test Alti may propose. */
export const ALTI_TEST_DAYS_MAX = 60;
