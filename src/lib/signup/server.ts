import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256Hex } from "../agreement/sha256";
import { isCaseRef, isResumeToken, newCaseRef, newResumeToken } from "./caseRef";
import { isSignupStage, stageRank, type SignupStage } from "./steps";

// The chat signup's record on the database (signup_cases, migration 0032).
// Service role only, from /api/signup: the person is anonymous until they
// sign in with their phone, so the server, not the browser, creates and
// moves the row. The device proves it started the signup with a random
// token; only the token's SHA-256 is stored.

type Row = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export interface SignupCase {
  caseRef: string;
  step: SignupStage;
  state: string | null;
  locale: "es" | "en";
  userId: string | null;
  wantsPerson: boolean;
  startedAt: string;
  completedAt: string | null;
}

export function signupCaseFromRow(row: Row): SignupCase {
  const step = text(row.step);
  return {
    caseRef: text(row.case_ref),
    step: isSignupStage(step) ? step : "start",
    state: text(row.state) || null,
    locale: row.locale === "es" ? "es" : "en",
    userId: text(row.user_id) || null,
    wantsPerson: row.wants_person === true,
    startedAt: new Date(text(row.started_at)).toISOString(),
    completedAt: row.completed_at ? new Date(text(row.completed_at)).toISOString() : null,
  };
}

export const tokenHash = (token: string) => sha256Hex(`credalti-signup:v1:${token}`);

/** A new signup with a fresh reference. Retries the rare collision. */
export async function startSignupCase(db: SupabaseClient, input: { locale: "es" | "en" }, refs: () => string = () => newCaseRef()): Promise<{ caseRef: string; token: string }> {
  const token = newResumeToken();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const caseRef = refs();
    const { error } = await db.from("signup_cases").insert({ case_ref: caseRef, token_hash: tokenHash(token), locale: input.locale });
    if (!error) return { caseRef, token };
    if (error.code !== "23505") throw new Error(`signup_cases: ${error.message}`);
  }
  throw new Error("signup_cases: could not find a free reference");
}

/**
 * The row, when the caller started it (the token it was started with) or it
 * belongs to the signed-in account (another device, after sign-in).
 */
async function ownedCase(db: SupabaseClient, caseRef: string, token: string | null, userId: string | null): Promise<Row | null> {
  if (!isCaseRef(caseRef)) return null;
  const { data } = await db.from("signup_cases").select("*").eq("case_ref", caseRef).maybeSingle();
  const row = (data as Row | null) ?? null;
  if (!row) return null;
  if (token && isResumeToken(token) && text(row.token_hash) === tokenHash(token)) return row;
  return userId && text(row.user_id) === userId ? row : null;
}

export type SignupUpdateResult = { ok: true; signup: SignupCase } | { ok: false; code: "not_found" | "other_account" };

/**
 * Moves the signup forward (never back: a resumed device on an older step
 * does not undo progress), records the state and language, that they asked
 * for a person, and, once signed in, links the account.
 */
export async function updateSignupCase(
  db: SupabaseClient,
  input: { caseRef: string; token: string | null; step?: SignupStage; state?: string | null; locale?: "es" | "en"; wantsPerson?: boolean },
  userId: string | null,
): Promise<SignupUpdateResult> {
  const row = await ownedCase(db, input.caseRef, input.token, userId);
  if (!row) return { ok: false, code: "not_found" };
  if (row.user_id && userId && text(row.user_id) !== userId) return { ok: false, code: "other_account" };
  const current = signupCaseFromRow(row);
  const patch: Row = {};
  if (input.step && stageRank(input.step) > stageRank(current.step)) patch.step = input.step;
  if (input.state !== undefined && input.state !== current.state) patch.state = input.state;
  if (input.locale && input.locale !== current.locale) patch.locale = input.locale;
  if (input.wantsPerson && !current.wantsPerson) patch.wants_person = true;
  if (userId && !current.userId) patch.user_id = userId;
  if (Object.keys(patch).length === 0) return { ok: true, signup: current };
  const { data, error } = await db.from("signup_cases").update(patch).eq("case_ref", current.caseRef).select("*").single();
  if (error) throw new Error(`signup_cases: ${error.message}`);
  return { ok: true, signup: signupCaseFromRow(data as Row) };
}

/** The signed-in person's newest signup, to resume on another device. Read through their own connection (RLS). */
export async function ownSignupCase(db: SupabaseClient, userId: string): Promise<SignupCase | null> {
  const { data } = await db.from("signup_cases").select("*").eq("user_id", userId).order("started_at", { ascending: false }).limit(1);
  const row = ((data as Row[] | null) ?? [])[0];
  return row ? signupCaseFromRow(row) : null;
}
