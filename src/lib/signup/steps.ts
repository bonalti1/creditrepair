// The five steps of the chat signup with Alti (/registro, docs/SIGNUP-CHAT.md),
// shown as the progress bar at the top: Get started → Your info → Verify
// identity → Your report → Sign up. "done" is after the signature.
//
// Progress is kept on the device (SIGNUP_STORAGE_KEY) so the person picks
// up where they stopped, and on the server (signup_cases.step) so the team
// sees where a signup is. Only the answers the chat asks for are kept on the
// device: first and last name, goal, state, which kind of taxpayer number
// (never the number), an optional email, and the report's counts (how many
// collections, inquiries…; never a score, a name or an account).

import type { ReportCounts } from "./reportSummary";

export const SIGNUP_STEPS = ["start", "info", "identity", "report", "signup"] as const;
export type SignupStep = (typeof SIGNUP_STEPS)[number];
export type SignupStage = SignupStep | "done";

export const STEP_LABELS: Record<"en" | "es", Record<SignupStep, string>> = {
  en: { start: "Get started", info: "Your info", identity: "Verify identity", report: "Your report", signup: "Sign up" },
  es: { start: "Empezar", info: "Tus datos", identity: "Verifica tu identidad", report: "Tu reporte", signup: "Regístrate" },
};

export function isSignupStage(value: unknown): value is SignupStage {
  return value === "done" || (SIGNUP_STEPS as readonly unknown[]).includes(value);
}

/** 0 for "start" … 4 for "signup", 5 for "done". */
export function stageRank(stage: SignupStage): number {
  return stage === "done" ? SIGNUP_STEPS.length : SIGNUP_STEPS.indexOf(stage);
}

/** "Step 2 of 5 · Your info" / "Paso 2 de 5 · Tus datos". */
export function stepLabel(stage: SignupStage, locale: "en" | "es"): string {
  const step = stage === "done" ? "signup" : stage;
  const n = SIGNUP_STEPS.indexOf(step) + 1;
  return locale === "es" ? `Paso ${n} de ${SIGNUP_STEPS.length} · ${STEP_LABELS.es[step]}` : `Step ${n} of ${SIGNUP_STEPS.length} · ${STEP_LABELS.en[step]}`;
}

export function nextStage(stage: SignupStage): SignupStage {
  const i = stageRank(stage);
  return i >= SIGNUP_STEPS.length - 1 ? "done" : SIGNUP_STEPS[i + 1]!;
}

export type GoalKey = "mortgage" | "auto" | "card" | "general";
export type IdKind = "ssn" | "itin";

export interface SignupAnswers {
  firstName: string | null;
  goal: GoalKey | null;
  state: string | null;
  lastName: string | null;
  idType: IdKind | null;
  /** Optional; "" when the person chose to skip it. */
  email: string | null;
}

export interface SignupProgress {
  version: 1;
  caseRef: string;
  /** The device's proof that it started this signup (null in the demo). */
  token: string | null;
  stage: SignupStage;
  /** "chat" once they chose to sign up with Alti; null on the first screen. */
  path: "chat" | null;
  answers: SignupAnswers;
  /** Signed in with their phone (or, in the demo, past that question). */
  signedIn: boolean;
  /** The ID and proof of address step was finished or put off. */
  identity: "done" | "later" | null;
  /** The report step was read. */
  reportSeen: boolean;
  /** The plan was shown in the chat. */
  planSeen: boolean;
  /**
   * The option the person chose (docs/SERVICE-OPTIONS.md): Credalti Complete or
   * Credalti DIY. Null until they choose; never pre-selected (a website link
   * that says which one they started with counts as their choice).
   */
  option: "full_service" | "diy" | null;
  /** What the report listed, in counts only (never a score), when one was on file. */
  reportCounts: ReportCounts | null;
  /** The counts are the demo's example report. */
  reportDemo: boolean;
  /** After signing: the name signed and the end of the window to cancel at no cost. */
  signedName: string | null;
  deadlineIso: string | null;
  startedAt: string;
}

export const EMPTY_ANSWERS: SignupAnswers = { firstName: null, goal: null, state: null, lastName: null, idType: null, email: null };

export function newProgress(caseRef: string, token: string | null, now: Date = new Date()): SignupProgress {
  return { version: 1, caseRef, token, stage: "start", path: null, answers: { ...EMPTY_ANSWERS }, signedIn: false, identity: null, reportSeen: false, planSeen: false, option: null, reportCounts: null, reportDemo: false, signedName: null, deadlineIso: null, startedAt: now.toISOString() };
}

export const SIGNUP_STORAGE_KEY = "bonalti.signupChat.v1";

const GOAL_KEYS: readonly string[] = ["mortgage", "auto", "card", "general"];
const s = (v: unknown, max: number) => (typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, max) : null);

/** What the device kept, checked field by field; null when it is not a signup we wrote. */
export function parseProgress(raw: string | null): SignupProgress | null {
  if (!raw) return null;
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!v || v.version !== 1 || typeof v.caseRef !== "string" || !/^CR-[2-9A-HJKMNP-TW-Z]{5}$/.test(v.caseRef)) return null;
  const a = (v.answers ?? {}) as Record<string, unknown>;
  const state = s(a.state, 2);
  return {
    version: 1,
    caseRef: v.caseRef,
    token: typeof v.token === "string" && /^[0-9a-f]{64}$/.test(v.token) ? v.token : null,
    stage: isSignupStage(v.stage) ? v.stage : "start",
    path: v.path === "chat" ? "chat" : null,
    answers: {
      firstName: s(a.firstName, 60),
      goal: typeof a.goal === "string" && GOAL_KEYS.includes(a.goal) ? (a.goal as GoalKey) : null,
      state: state && /^[A-Z]{2}$/.test(state) ? state : null,
      lastName: s(a.lastName, 80),
      idType: a.idType === "ssn" || a.idType === "itin" ? a.idType : null,
      email: typeof a.email === "string" ? a.email.trim().slice(0, 120) : null,
    },
    signedIn: v.signedIn === true,
    identity: v.identity === "done" || v.identity === "later" ? v.identity : null,
    reportSeen: v.reportSeen === true,
    planSeen: v.planSeen === true,
    option: v.option === "diy" || v.option === "full_service" ? v.option : null,
    reportCounts: parseCounts(v.reportCounts),
    reportDemo: v.reportDemo === true,
    signedName: s(v.signedName, 120),
    deadlineIso: typeof v.deadlineIso === "string" && !Number.isNaN(Date.parse(v.deadlineIso)) ? v.deadlineIso : null,
    startedAt: typeof v.startedAt === "string" ? v.startedAt : new Date().toISOString(),
  };
}

const COUNT_KEYS = ["accounts", "collections", "latePayments", "inquiries", "publicRecords", "personalInfo"] as const;

function parseCounts(v: unknown): ReportCounts | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const out = {} as ReportCounts;
  for (const k of COUNT_KEYS) {
    const n = o[k];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 999) return null;
    out[k] = n;
  }
  return out;
}

/** The question on screen now, from what has been answered. */
export type SignupQuestion =
  | "choose"
  | "firstName"
  | "goal"
  | "state"
  | "lastName"
  | "idType"
  | "email"
  | "phone"
  | "identity"
  | "report"
  | "option"
  | "plan"
  | "agreement"
  | "done";

export function currentQuestion(p: SignupProgress): SignupQuestion {
  if (p.path === null) return "choose";
  const a = p.answers;
  if (!a.firstName) return "firstName";
  if (!a.goal) return "goal";
  if (!a.state) return "state";
  if (!a.lastName) return "lastName";
  if (!a.idType) return "idType";
  if (a.email === null) return "email";
  if (!p.signedIn) return "phone";
  if (!p.identity) return "identity";
  if (!p.reportSeen) return "report";
  if (!p.option) return "option";
  if (!p.planSeen) return "plan";
  if (p.stage !== "done") return "agreement";
  return "done";
}

/** The step a question belongs to (the progress bar). */
export function stageOf(question: SignupQuestion): SignupStage {
  switch (question) {
    case "choose":
    case "firstName":
    case "goal":
    case "state":
      return "start";
    case "lastName":
    case "idType":
    case "email":
    case "phone":
      return "info";
    case "identity":
      return "identity";
    case "report":
      return "report";
    case "option":
    case "plan":
    case "agreement":
      return "signup";
    case "done":
      return "done";
  }
}

/** A loose check of an email typed in the chat (the server checks again where it matters). */
export function looksLikeEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/i.test(value.trim());
}
