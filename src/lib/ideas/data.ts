import { isDemoMode } from "../supabase/config";
import { can, type Viewer } from "../staff/permissions";
import { readDemoIdeas, SAMPLE_PROPOSALS, writeDemoIdeas } from "./demo";
import { actionRefusal, applyAction, type IdeasBody } from "./rules";
import type { Idea, IdeasBoard } from "./types";

// Where the Ideas screen reads and writes. With a database: /api/staff/ideas
// (the route checks the role again and the database the order). In the demo:
// this browser's sample board, with the same rules (rules.ts), and Alti's
// SAMPLE proposals; no model is called.

export type IdeasResult = { ok: true; message?: string } | { ok: false; code: string; message?: string };

export interface IdeasData {
  readonly demo: boolean;
  load(): Promise<IdeasBoard>;
  act(body: IdeasBody): Promise<IdeasResult>;
}

export function getIdeasData(viewer: Viewer | null): IdeasData {
  if (isDemoMode()) {
    const admin = can(viewer?.role, "ideas.approve");
    return {
      demo: true,
      async load() {
        const state = readDemoIdeas(new Date());
        return { ideas: state.ideas, proposals: admin ? state.proposals : null, runs: admin ? state.runs : null, altiConnected: admin ? true : null, me: viewer?.handle ?? null, demo: true };
      },
      async act(body) {
        const now = new Date();
        const state = readDemoIdeas(now);
        const by = viewer?.name ?? "";
        if (!viewer || !can(viewer.role, body.action === "add" || body.action === "edit" ? "ideas.add" : "ideas.approve")) return { ok: false, code: "role" };
        if (body.action === "add") {
          const idea: Idea = {
            id: `i-${now.getTime()}`,
            title: body.title,
            why: body.why,
            department: body.department,
            metric: body.metric,
            expectedEffect: body.expectedEffect,
            effort: body.effort,
            status: "new",
            source: "team",
            proposalId: null,
            createdBy: viewer.handle,
            createdByName: by,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            approvedByName: null,
            approvedAt: null,
            testDays: null,
            testStartedAt: null,
            testEndsAt: null,
            decidedByName: null,
            decidedAt: null,
            resultNote: null,
          };
          writeDemoIdeas({ ...state, ideas: [idea, ...state.ideas] });
          return { ok: true };
        }
        if (body.action === "ask_alti") {
          const shown = new Set(state.proposals.map((p) => p.title));
          const fresh = SAMPLE_PROPOSALS.filter((p) => !shown.has(p.title));
          if (fresh.length === 0) return { ok: false, code: "demo_no_more" };
          const runId = `r-${now.getTime()}`;
          writeDemoIdeas({
            ...state,
            runs: [{ id: runId, createdAt: now.toISOString(), trigger: "person", byName: by, status: "ok", proposed: fresh.length, dropped: 0 }, ...state.runs],
            proposals: [...fresh.map((p, i) => ({ ...p, id: `p-${now.getTime()}-${i}`, runId, status: "open" as const, ideaId: null, createdAt: now.toISOString() })), ...state.proposals],
          });
          return { ok: true };
        }
        if (body.action === "add_proposal" || body.action === "dismiss_proposal") {
          const proposal = state.proposals.find((p) => p.id === body.id);
          if (!proposal || proposal.status !== "open") return { ok: false, code: "status" };
          if (body.action === "dismiss_proposal") {
            writeDemoIdeas({ ...state, proposals: state.proposals.map((p) => (p.id === body.id ? { ...p, status: "dismissed" } : p)) });
            return { ok: true };
          }
          const id = `i-${now.getTime()}`;
          const idea: Idea = {
            id,
            title: proposal.title,
            why: proposal.why,
            department: proposal.department,
            metric: proposal.metric,
            expectedEffect: proposal.expectedEffect,
            effort: proposal.effort,
            status: "new",
            source: "alti",
            proposalId: proposal.id,
            createdBy: viewer.handle,
            createdByName: by,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            approvedByName: null,
            approvedAt: null,
            testDays: null,
            testStartedAt: null,
            testEndsAt: null,
            decidedByName: null,
            decidedAt: null,
            resultNote: null,
          };
          writeDemoIdeas({ ...state, ideas: [idea, ...state.ideas], proposals: state.proposals.map((p) => (p.id === body.id ? { ...p, status: "added", ideaId: id } : p)) });
          return { ok: true };
        }
        const idea = state.ideas.find((i) => i.id === body.id);
        if (!idea) return { ok: false, code: "not_found" };
        const refusal = actionRefusal(body.action, idea, { role: viewer.role, userId: viewer.handle });
        if (refusal) return { ok: false, code: refusal };
        writeDemoIdeas({ ...state, ideas: state.ideas.map((i) => (i.id === idea.id ? applyAction(i, body, by, now) : i)) });
        return { ok: true };
      },
    };
  }
  return {
    demo: false,
    async load() {
      const res = await fetch("/api/staff/ideas", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      return ((await res.json()) as { board: IdeasBoard }).board;
    },
    async act(body) {
      try {
        const res = await fetch("/api/staff/ideas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const json = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
        return res.ok ? { ok: true, message: json.message } : { ok: false, code: json.code ?? String(res.status), message: json.message };
      } catch {
        return { ok: false, code: "network" };
      }
    },
  };
}
