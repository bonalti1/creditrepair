import type { SupabaseClient } from "@supabase/supabase-js";
import { loadContentSummary } from "../control/server";
import { loadLeads } from "../leads/inboxServer";
import { can } from "../staff/permissions";
import type { StaffMember } from "../staff/access";
import { loadStaffClients } from "../staff/load";
import { ALTI_RUNS_PER_DAY, askAlti, CRON_MIN_DAYS_BETWEEN, type AltiCaller, type AltiProblem } from "./alti";
import { actionRefusal, applyAction, type IdeasBody } from "./rules";
import { collectSignals, type Signal } from "./signals";
import type { AltiRun, BasedOn, Idea, IdeaProposal, IdeasBoard } from "./types";

// The Ideas screen on the database (migration 0040). Reads go through the
// member's OWN connection, so the read policies decide (every active member
// reads ideas; only an administrator reads Alti's runs and proposals). Writes
// go through the service role after the route's requireCapability and the
// rules in rules.ts; the database checks the order again (ideas_guard).

type Row = Record<string, unknown>;
const DAY = 24 * 60 * 60 * 1000;
const str = (v: unknown) => (typeof v === "string" ? v : null);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "string" ? new Date(v).toISOString() : null);

export function ideaFromRow(r: Row): Idea {
  return {
    id: String(r.id),
    title: String(r.title),
    why: String(r.why),
    department: r.department as Idea["department"],
    metric: String(r.metric),
    expectedEffect: String(r.expected_effect),
    effort: r.effort as Idea["effort"],
    status: r.status as Idea["status"],
    source: r.source === "alti" ? "alti" : "team",
    proposalId: str(r.proposal_id),
    createdBy: str(r.created_by),
    createdByName: String(r.created_by_name ?? ""),
    createdAt: iso(r.created_at) ?? "",
    updatedAt: iso(r.updated_at) ?? "",
    approvedByName: str(r.approved_by_name),
    approvedAt: iso(r.approved_at),
    testDays: typeof r.test_days === "number" ? r.test_days : null,
    testStartedAt: iso(r.test_started_at),
    testEndsAt: iso(r.test_ends_at),
    decidedByName: str(r.decided_by_name),
    decidedAt: iso(r.decided_at),
    resultNote: str(r.result_note),
  };
}

function proposalFromRow(r: Row): IdeaProposal {
  return {
    id: String(r.id),
    runId: String(r.run_id),
    title: String(r.title),
    why: String(r.why),
    department: r.department as IdeaProposal["department"],
    metric: String(r.metric),
    expectedEffect: String(r.expected_effect),
    effort: r.effort as IdeaProposal["effort"],
    testDays: Number(r.test_days),
    basedOn: (Array.isArray(r.based_on) ? r.based_on : []) as BasedOn[],
    status: r.status as IdeaProposal["status"],
    ideaId: str(r.idea_id),
    createdAt: iso(r.created_at) ?? "",
  };
}

function runFromRow(r: Row): AltiRun {
  return {
    id: String(r.id),
    createdAt: iso(r.created_at) ?? "",
    trigger: r.trigger === "cron" ? "cron" : "person",
    byName: String(r.by_name ?? ""),
    status: r.status === "ok" ? "ok" : "failed",
    proposed: Number(r.proposed ?? 0),
    dropped: Number(r.dropped ?? 0),
  };
}

async function rows(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return (data as Row[] | null) ?? [];
}

/** The board as this member may read it. */
export async function loadIdeasBoard(reader: SupabaseClient, member: StaffMember, connected: boolean): Promise<IdeasBoard> {
  const ideas = (await rows(reader.from("ideas").select("*").order("updated_at", { ascending: false }).limit(1000), "ideas")).map(ideaFromRow);
  if (!can(member.role, "ideas.approve")) return { ideas, proposals: null, runs: null, altiConnected: null, me: member.userId, demo: false };
  const [proposals, runs] = await Promise.all([
    rows(reader.from("idea_proposals").select("*").order("created_at", { ascending: false }).limit(100), "idea_proposals"),
    rows(reader.from("idea_alti_runs").select("id, created_at, trigger, by_name, status, proposed, dropped").order("created_at", { ascending: false }).limit(20), "idea_alti_runs"),
  ]);
  return { ideas, proposals: proposals.map(proposalFromRow), runs: runs.map(runFromRow), altiConnected: connected, me: member.userId, demo: false };
}

export type IdeaResult = { ok: true; id?: string; message?: string } | { ok: false; status: number; code: string };

async function loadIdea(db: SupabaseClient, id: string): Promise<Idea | null> {
  const { data } = await db.from("ideas").select("*").eq("id", id).maybeSingle();
  return data ? ideaFromRow(data as Row) : null;
}

async function logEvent(db: SupabaseClient, ideaId: string, action: string, from: string | null, to: string, member: StaffMember, note: string | null = null) {
  const { error } = await db.from("idea_events").insert({ idea_id: ideaId, action, from_status: from, to_status: to, by_user: member.userId, by_name: member.name, note });
  if (error) throw new Error(`idea_events: ${error.message}`);
}

/** One change to the board (everything but asking Alti). */
export async function applyIdeaAction(db: SupabaseClient, member: StaffMember, body: Exclude<IdeasBody, { action: "ask_alti" }>, now: Date): Promise<IdeaResult> {
  if (body.action === "add") {
    const { data, error } = await db
      .from("ideas")
      .insert({ title: body.title, why: body.why, department: body.department, metric: body.metric, expected_effect: body.expectedEffect, effort: body.effort, created_by: member.userId, created_by_name: member.name })
      .select("id")
      .single();
    if (error || !data) throw new Error(`ideas: ${error?.message ?? "no row"}`);
    const id = String((data as Row).id);
    await logEvent(db, id, "added", null, "new", member);
    return { ok: true, id };
  }

  if (body.action === "add_proposal" || body.action === "dismiss_proposal") {
    if (!can(member.role, "ideas.approve")) return { ok: false, status: 403, code: "role" };
    const { data } = await db.from("idea_proposals").select("*").eq("id", body.id).maybeSingle();
    if (!data) return { ok: false, status: 404, code: "not_found" };
    const proposal = proposalFromRow(data as Row);
    if (proposal.status !== "open") return { ok: false, status: 409, code: "status" };
    if (body.action === "dismiss_proposal") {
      const { error } = await db.from("idea_proposals").update({ status: "dismissed", decided_by_name: member.name, decided_at: now.toISOString() }).eq("id", proposal.id).eq("status", "open");
      if (error) throw new Error(`idea_proposals: ${error.message}`);
      return { ok: true };
    }
    // The idea carries the words, the metric and the length; the numbers stay on the proposal (administrators only).
    const { data: idea, error } = await db
      .from("ideas")
      .insert({
        title: proposal.title,
        why: proposal.why,
        department: proposal.department,
        metric: proposal.metric,
        expected_effect: proposal.expectedEffect,
        effort: proposal.effort,
        source: "alti",
        proposal_id: proposal.id,
        created_by: member.userId,
        created_by_name: member.name,
      })
      .select("id")
      .single();
    if (error || !idea) throw new Error(`ideas: ${error?.message ?? "no row"}`);
    const id = String((idea as Row).id);
    await logEvent(db, id, "added", null, "new", member, `From Alti's proposal; suggested test length ${proposal.testDays} days.`);
    const { error: mark } = await db.from("idea_proposals").update({ status: "added", idea_id: id, decided_by_name: member.name, decided_at: now.toISOString() }).eq("id", proposal.id).eq("status", "open");
    if (mark) throw new Error(`idea_proposals: ${mark.message}`);
    return { ok: true, id };
  }

  const idea = await loadIdea(db, body.id);
  if (!idea) return { ok: false, status: 404, code: "not_found" };
  const refusal = actionRefusal(body.action, idea, { role: member.role, userId: member.userId });
  if (refusal) return { ok: false, status: refusal === "status" ? 409 : 403, code: refusal };
  const next = applyAction(idea, body, member.name, now);
  const patch: Row = {
    title: next.title,
    why: next.why,
    department: next.department,
    metric: next.metric,
    expected_effect: next.expectedEffect,
    effort: next.effort,
    status: next.status,
    approved_by_name: next.approvedByName,
    approved_at: next.approvedAt,
    test_days: next.testDays,
    test_started_at: next.testStartedAt,
    test_ends_at: next.testEndsAt,
    decided_by_name: next.decidedByName,
    decided_at: next.decidedAt,
    result_note: next.resultNote,
  };
  // Only if nobody moved it in the meantime.
  const { data: updated, error } = await db.from("ideas").update(patch).eq("id", idea.id).eq("status", idea.status).select("id");
  if (error) throw new Error(`ideas: ${error.message}`);
  if (!updated || (updated as Row[]).length === 0) return { ok: false, status: 409, code: "status" };
  const action = { edit: "edited", approve: "approved", decline: "declined", start: "started", keep: "kept", drop: "dropped" }[body.action];
  const note = body.action === "decline" ? body.note : body.action === "keep" || body.action === "drop" ? body.learned : body.action === "start" ? `${body.testDays} days` : null;
  await logEvent(db, idea.id, action, idea.status, next.status, member, note);
  return { ok: true, id: idea.id };
}

/** The numbers Alti reads, through `reader` (an administrator's connection, or the service role for the weekly job). */
export async function loadSignals(reader: SupabaseClient, now: Date): Promise<Signal[]> {
  const [clients, leads, content] = await Promise.all([
    loadStaffClients(reader).catch(() => null),
    loadLeads(reader).catch(() => null),
    loadContentSummary(reader, now),
  ]);
  return collectSignals({ clients, leads, content, now });
}

export type AltiRunResult =
  | { ok: true; runId: string; proposed: number; dropped: number }
  | { ok: false; problem: AltiProblem | "limit" | "recent"; status: number };

/**
 * Ask Alti and keep what passed the checks as open proposals. A person may
 * ask ALTI_RUNS_PER_DAY times a day; the weekly job asks only when nobody did
 * in the last CRON_MIN_DAYS_BETWEEN days. Without a key nothing is recorded.
 */
export async function runAltiIdeas(
  db: SupabaseClient,
  reader: SupabaseClient,
  caller: AltiCaller | null,
  by: { trigger: "person"; member: StaffMember } | { trigger: "cron" },
  now: Date,
): Promise<AltiRunResult> {
  if (!caller) return { ok: false, problem: "not_connected", status: 409 };
  const since = new Date(now.getTime() - (by.trigger === "cron" ? CRON_MIN_DAYS_BETWEEN : 1) * DAY).toISOString();
  const recent = await rows(db.from("idea_alti_runs").select("id, trigger").gte("created_at", since), "idea_alti_runs");
  if (by.trigger === "cron" && recent.length > 0) return { ok: false, problem: "recent", status: 200 };
  if (by.trigger === "person" && recent.filter((r) => r.trigger === "person").length >= ALTI_RUNS_PER_DAY) return { ok: false, problem: "limit", status: 429 };

  const signals = await loadSignals(reader, now);
  const titles = (await rows(db.from("ideas").select("title").limit(1000), "ideas")).map((r) => String(r.title));
  const openTitles = (await rows(db.from("idea_proposals").select("title").eq("status", "open"), "idea_proposals")).map((r) => String(r.title));
  const answer = await askAlti(caller, signals, [...titles, ...openTitles]);

  const run = {
    trigger: by.trigger,
    by_user: by.trigger === "person" ? by.member.userId : null,
    by_name: by.trigger === "person" ? by.member.name : "",
    status: answer.ok ? "ok" : "failed",
    model: answer.model,
    signals: signals.map((s) => ({ key: s.key, value: s.value, unit: s.unit, window: s.window })),
    proposed: answer.ok ? answer.proposals.length : 0,
    dropped: Math.min(answer.dropped, 20),
    problem: answer.ok ? null : answer.problem,
  };
  const { data, error } = await db.from("idea_alti_runs").insert(run).select("id").single();
  if (error || !data) throw new Error(`idea_alti_runs: ${error?.message ?? "no row"}`);
  const runId = String((data as Row).id);
  if (!answer.ok) return { ok: false, problem: answer.problem, status: 502 };
  const { error: insertError } = await db.from("idea_proposals").insert(
    answer.proposals.map((p) => ({
      run_id: runId,
      title: p.title,
      why: p.why,
      department: p.department,
      metric: p.metric,
      expected_effect: p.expectedEffect,
      effort: p.effort,
      test_days: p.testDays,
      based_on: p.basedOn,
    })),
  );
  if (insertError) throw new Error(`idea_proposals: ${insertError.message}`);
  return { ok: true, runId, proposed: answer.proposals.length, dropped: answer.dropped };
}
