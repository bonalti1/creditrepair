import { readdirSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AltiCaller } from "../../ideas/alti";
import { runAltiIdeas } from "../../ideas/server";
import { checkService, loadDbFacts, loadLaunch } from "../../launch/server";
import { startHarness, type Harness } from "./pg";
import { addClient, addStaff } from "./seed";

// Migration 0040 (Ideas and Launch readiness) against the real migrations,
// with row level security: who reads ideas (every active member of staff;
// never a client, a partner or anon), that nobody writes them directly, the
// order of statuses checked by the database itself, the records nobody can
// rewrite, Alti's proposals and the launch ticks for administrators only, the
// routes, and the heartbeats the cron routes record.

const session = vi.hoisted(() => ({ reader: null as unknown, admin: null as unknown }));
vi.mock("@/lib/supabase/server", () => {
  const user = async () => {
    const reader = session.reader as SupabaseClient | null;
    return reader ? (await reader.auth.getUser()).data.user : null;
  };
  return {
    getServerSupabase: async () => session.reader,
    getSessionUser: user,
    resolveActingUser: async () => {
      const u = await user();
      return u ? { userId: u.id, via: "session" as const } : null;
    },
  };
});
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => session.admin }));

let h: Harness;
let ip = 0;
const as = (who: SupabaseClient | null) => {
  session.reader = who;
  session.admin = h.service;
};
const request = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://app.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.40.${Math.floor(++ip / 250)}.${ip % 250}`, "user-agent": "vitest", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

let admin: Awaited<ReturnType<typeof addStaff>>;
let ana: Awaited<ReturnType<typeof addStaff>>;
let marta: Awaited<ReturnType<typeof addStaff>>;
let client: string;

const words = { title: "Faster first replies to leads", why: "Leads wait hours for a person's first reply.", department: "leads", metric: "lead_first_reply", expected_effect: "The median first reply goes down", effort: "S" };
const insertIdea = async (extra: Record<string, unknown> = {}) => {
  const { data, error } = await h.service.from("ideas").insert({ ...words, created_by: admin.userId, created_by_name: "Carmen Ruiz", ...extra }).select("id").single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
};

const SECRET = "n8n-test-secret-value";

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.N8N_WEBHOOK_SECRET = SECRET;
  delete process.env.ANTHROPIC_API_KEY;
  h = await startHarness();
  admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  ana = await addStaff(h, "sales", "ana", "Ana Prieto");
  marta = await addStaff(h, "specialist", "marta", "Marta Leal");
  client = await addClient(h, { name: "Rosa Martínez", phone: "+17135550142" });

}, 90_000);

afterAll(async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.N8N_WEBHOOK_SECRET;
  await h?.pg.close();
});

describe("row level security", () => {
  it("every active member of staff reads the ideas; a client and a signed-out visitor read none", async () => {
    await insertIdea();
    for (const who of [admin, ana, marta]) {
      const { data, error } = await h.as(who.userId).from("ideas").select("id, title");
      expect(error, who.handle).toBeNull();
      expect((data ?? []).length, who.handle).toBeGreaterThan(0);
    }
    expect((await h.as(client).from("ideas").select("id")).data ?? []).toEqual([]);
    expect((await h.anon.from("ideas").select("id")).data ?? []).toEqual([]);
    expect((await h.as(client).from("idea_events").select("id")).data ?? []).toEqual([]);
  });

  it("nobody writes an idea directly, not even an administrator: only the server, after the role check", async () => {
    for (const who of [admin.userId, ana.userId, client]) {
      const { error } = await h.as(who).from("ideas").insert({ ...words });
      expect(error, who).not.toBeNull();
    }
    const id = await insertIdea();
    await h.as(admin.userId).from("ideas").update({ status: "approved" }).eq("id", id);
    const { data } = await h.service.from("ideas").select("status").eq("id", id).single();
    expect((data as { status: string }).status).toBe("new");
  });

  it("Alti's runs and proposals, the launch ticks and checks: an administrator reads them; nobody else", async () => {
    const { data: run } = await h.service.from("idea_alti_runs").insert({ trigger: "person", status: "ok", proposed: 1 }).select("id").single();
    await h.service.from("idea_proposals").insert({ run_id: (run as { id: string }).id, title: "Weekly answer post", why: "The same questions come in every week.", department: "content", metric: "content_posted_week", expected_effect: "Steady posts", effort: "M", test_days: 21, based_on: [{ key: "content_posted_week", value: 1, unit: "count", display: "1" }] });
    await h.service.from("launch_ticks").insert({ item: "test_pass", done: true, by_user: admin.userId, by_name: "Carmen Ruiz" });
    await h.service.from("launch_probes").upsert({ service: "lob", checked_at: new Date().toISOString(), ok: true, code: "ok", by_name: "Carmen Ruiz" });
    for (const table of ["idea_alti_runs", "idea_proposals", "launch_ticks", "launch_probes"]) {
      expect(((await h.as(admin.userId).from(table).select("*")).data ?? []).length, table).toBeGreaterThan(0);
      for (const who of [ana.userId, marta.userId, client]) expect((await h.as(who).from(table).select("*")).data ?? [], `${table} ${who}`).toEqual([]);
      expect((await h.anon.from(table).select("*")).data ?? [], table).toEqual([]);
      const { error } = await h.as(admin.userId).from(table).insert({});
      expect(error, `${table}: no insert policy`).not.toBeNull();
    }
  });
});

describe("the database keeps the order", () => {
  it("new → approved → testing → kept; no skipping, no going back, final is final, nothing deleted", async () => {
    const id = await insertIdea();
    const set = (patch: Record<string, unknown>) => h.service.from("ideas").update(patch).eq("id", id);
    expect((await set({ status: "testing", test_days: 14, test_started_at: new Date().toISOString(), test_ends_at: new Date().toISOString(), approved_at: new Date().toISOString() })).error).not.toBeNull();
    expect((await set({ status: "approved", approved_at: new Date().toISOString(), approved_by_name: "Carmen Ruiz" })).error).toBeNull();
    // The words are kept as they were approved.
    expect((await set({ title: "Something else entirely" })).error).not.toBeNull();
    expect((await set({ status: "new" })).error).not.toBeNull();
    expect((await set({ status: "testing", test_days: 14, test_started_at: new Date().toISOString(), test_ends_at: new Date().toISOString() })).error).toBeNull();
    // Kept needs what was learned.
    expect((await set({ status: "kept", decided_at: new Date().toISOString() })).error).not.toBeNull();
    expect((await set({ status: "kept", decided_at: new Date().toISOString(), result_note: "It worked: replies were faster." })).error).toBeNull();
    expect((await set({ status: "dropped" })).error).not.toBeNull();
    expect((await set({ result_note: "Rewritten later" })).error).not.toBeNull();
    expect((await h.service.from("ideas").delete().eq("id", id)).error).not.toBeNull();
    // A new idea always starts as new.
    expect((await h.service.from("ideas").insert({ ...words, status: "kept" })).error).not.toBeNull();
  });

  it("the history, Alti's runs and the ticks cannot be rewritten; a proposal is decided once", async () => {
    const id = await insertIdea();
    await h.service.from("idea_events").insert({ idea_id: id, action: "added", to_status: "new", by_name: "Carmen Ruiz" });
    expect((await h.service.from("idea_events").update({ by_name: "Someone" }).eq("idea_id", id)).error).not.toBeNull();
    expect((await h.service.from("idea_events").delete().eq("idea_id", id)).error).not.toBeNull();
    expect((await h.service.from("launch_ticks").update({ done: false }).eq("item", "test_pass")).error).not.toBeNull();
    expect((await h.service.from("idea_alti_runs").delete().eq("trigger", "person")).error).not.toBeNull();
    const { data: p } = await h.service.from("idea_proposals").select("id").eq("status", "open").limit(1).single();
    const pid = (p as { id: string }).id;
    expect((await h.service.from("idea_proposals").update({ title: "Changed words" }).eq("id", pid)).error).not.toBeNull();
    expect((await h.service.from("idea_proposals").update({ status: "dismissed", decided_at: new Date().toISOString(), decided_by_name: "Carmen" }).eq("id", pid)).error).toBeNull();
    expect((await h.service.from("idea_proposals").update({ status: "open", decided_at: null }).eq("id", pid)).error).not.toBeNull();
  });
});

describe("the ideas route", () => {
  it("anyone adds; only an administrator approves, starts and decides; a learning is required", async () => {
    const route = await import("@/app/api/staff/ideas/route");
    as(h.as(ana.userId));
    const added = await json(await route.POST(request("/api/staff/ideas", { action: "add", title: "Second WhatsApp message on day two", why: "Many leads read the first one and go quiet.", department: "leads", metric: "lead_contacted_rate", expectedEffect: "More leads contacted", effort: "S" })));
    expect(added.status).toBe(200);
    const id = added.body.id as string;
    expect((await route.POST(request("/api/staff/ideas", { action: "approve", id }))).status).toBe(403);
    // Ana edits her own new idea; Marta may not.
    expect((await route.POST(request("/api/staff/ideas", { action: "edit", id, title: "Second WhatsApp message on day two", why: "Many leads read the first one and then go quiet.", department: "leads", metric: "lead_contacted_rate", expectedEffect: "More leads contacted", effort: "S" }))).status).toBe(200);
    as(h.as(marta.userId));
    expect((await json(await route.POST(request("/api/staff/ideas", { action: "edit", id, title: "Hijacked", why: "Someone else's idea, changed.", department: "leads", metric: "other", expectedEffect: "None", effort: "S" })))).body.code).toBe("not_author");
    const board = await json(await route.GET(request("/api/staff/ideas")));
    expect(board.status).toBe(200);
    expect((board.body.board as { proposals: unknown }).proposals).toBeNull();

    as(h.as(admin.userId));
    expect((await route.POST(request("/api/staff/ideas", { action: "start", id, testDays: 14 }))).status).toBe(409);
    expect((await route.POST(request("/api/staff/ideas", { action: "approve", id }))).status).toBe(200);
    expect((await route.POST(request("/api/staff/ideas", { action: "start", id, testDays: 14 }))).status).toBe(200);
    expect((await route.POST(request("/api/staff/ideas", { action: "keep", id, learned: "short" }))).status).toBe(400);
    expect((await route.POST(request("/api/staff/ideas", { action: "keep", id, learned: "Contacted went up; nobody complained." }))).status).toBe(200);
    const { data: events } = await h.service.from("idea_events").select("action, from_status, to_status, by_name").eq("idea_id", id).order("created_at");
    expect((events as Array<{ action: string }>).map((e) => e.action)).toEqual(["added", "edited", "approved", "started", "kept"]);
    const adminBoard = await json(await route.GET(request("/api/staff/ideas")));
    expect((adminBoard.body.board as { proposals: unknown[]; altiConnected: boolean }).altiConnected).toBe(false);
  });

  it("asking Alti without a key says it is not connected and records nothing", async () => {
    const route = await import("@/app/api/staff/ideas/route");
    as(h.as(admin.userId));
    const { count: before } = await h.service.from("idea_alti_runs").select("id", { head: true, count: "exact" });
    const res = await json(await route.POST(request("/api/staff/ideas", { action: "ask_alti" })));
    expect(res).toMatchObject({ status: 409, body: { code: "not_connected" } });
    const { count: after } = await h.service.from("idea_alti_runs").select("id", { head: true, count: "exact" });
    expect(after).toBe(before);
    as(h.as(ana.userId));
    expect((await route.POST(request("/api/staff/ideas", { action: "ask_alti" }))).status).toBe(403);
  });

  it("with a model, Alti's checked proposals wait for an administrator; adding one puts a New idea on the board", async () => {
    const caller: AltiCaller = async () => ({
      model: "claude-opus-5-5",
      problem: null,
      output: {
        proposals: [
          { title: "Remind signed clients to upload their ID on day one", why: "Missing documents push the first round back. A same-day reminder may shorten it.", department: "clients", metric: "days_to_first_round", expectedEffect: "Fewer days to the first round", effort: "S", testDays: 21, basedOn: ["active_clients", "signed"] },
          { title: "Promise every client a higher score in thirty days", why: "We guarantee removal of negative items for everyone.", department: "content", metric: "conversion", expectedEffect: "More signups", effort: "S", testDays: 14, basedOn: ["signed"] },
        ],
      },
    });
    const result = await runAltiIdeas(h.service, h.as(admin.userId), caller, { trigger: "person", member: admin }, new Date());
    expect(result).toMatchObject({ ok: true, proposed: 1, dropped: 1 });
    const { data: run } = await h.service.from("idea_alti_runs").select("signals, proposed, dropped, by_name").eq("id", (result as { runId: string }).runId).single();
    // The run keeps only aggregate numbers: no client's name.
    expect(JSON.stringify(run)).not.toContain("Rosa");
    const { data: proposals } = await h.service.from("idea_proposals").select("id, title, based_on, status").eq("run_id", (result as { runId: string }).runId);
    expect(proposals).toHaveLength(1);
    const p = (proposals as Array<{ id: string; based_on: Array<{ key: string }> }>)[0]!;
    expect(p.based_on.map((b) => b.key)).toEqual(["active_clients", "signed"]);

    const route = await import("@/app/api/staff/ideas/route");
    as(h.as(admin.userId));
    const added = await json(await route.POST(request("/api/staff/ideas", { action: "add_proposal", id: p.id })));
    expect(added.status).toBe(200);
    const { data: idea } = await h.service.from("ideas").select("status, source, proposal_id").eq("id", added.body.id as string).single();
    expect(idea).toEqual({ status: "new", source: "alti", proposal_id: p.id });
    expect((await route.POST(request("/api/staff/ideas", { action: "add_proposal", id: p.id }))).status).toBe(409);

    // The weekly job does not ask again so soon.
    const weekly = await runAltiIdeas(h.service, h.service, caller, { trigger: "cron" }, new Date());
    expect(weekly).toMatchObject({ ok: false, problem: "recent" });
  });

  it("the weekly cron route, without a key, asks nothing and records its heartbeat", async () => {
    const route = await import("@/app/api/cron/ideas/route");
    session.admin = h.service;
    expect((await route.POST(request("/api/cron/ideas", {}))).status).toBe(401);
    const res = await json(await route.POST(request("/api/cron/ideas", {}, { "x-webhook-secret": SECRET })));
    expect(res).toMatchObject({ status: 200, body: { skipped: "not_connected" } });
    const { data } = await h.service.from("cron_heartbeats").select("job, last_ok_at, last_error").eq("job", "ideas").single();
    expect(data).toMatchObject({ job: "ideas", last_error: null });
    expect((data as { last_ok_at: string | null }).last_ok_at).toBeTruthy();
  });
});

describe("launch readiness on the database", () => {
  it("reads the real database: every migration applied, one administrator, Texas open, the ID bucket", async () => {
    const facts = await loadDbFacts(h.service);
    expect(facts.connected).toBe(true);
    expect(facts.missingMigrations).toEqual([]);
    // The newest migration file in the repository (each new migration moves it).
    const newest = readdirSync("supabase/migrations").filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort().at(-1)!.replace(/\.sql$/, "");
    expect(facts.latestMigration).toBe(newest);
    expect(facts.admins).toBe(1);
    expect(facts.texasOpen).toBe(true);
    expect(facts.otherStatesOpen).toEqual([]);
    expect(facts.plansActive).toBe(0);
    expect(facts.lettersUnapproved).toBeGreaterThan(0);
  });

  it("the route: an administrator only; ticks record who and when; nothing secret comes back", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret-0123456789";
    process.env.LOB_API_KEY = "test_lobsecret0123456789";
    try {
      const route = await import("@/app/api/staff/launch/route");
      for (const who of [ana, marta]) {
        as(h.as(who.userId));
        expect((await route.GET(request("/api/staff/launch"))).status, who.handle).toBe(403);
        expect((await route.POST(request("/api/staff/launch", { action: "tick", item: "attorney_review", done: true }))).status).toBe(403);
      }
      as(h.as(admin.userId));
      expect((await route.POST(request("/api/staff/launch", { action: "tick", item: "supabase", done: true }))).status).toBe(400);
      expect((await route.POST(request("/api/staff/launch", { action: "tick", item: "attorney_review", done: true, note: "Session on Nov 30" }))).status).toBe(200);
      const res = await route.GET(request("/api/staff/launch"));
      const text = await res.text();
      expect(res.status).toBe(200);
      expect(text).not.toContain("service-role-secret");
      expect(text).not.toContain("lobsecret");
      const body = JSON.parse(text) as Awaited<ReturnType<typeof loadLaunch>>;
      expect(body.report.items.find((i) => i.key === "attorney_review")).toMatchObject({ state: "ready", tick: { byName: "Carmen Ruiz", note: "Session on Nov 30" } });
      expect(body.report.items.find((i) => i.key === "db_migrations")!.state).toBe("ready");
      expect(body.report.items.find((i) => i.key === "db_admin")!.state).toBe("ready");
      expect(body.report.items.find((i) => i.key === "lob_live")!.state).toBe("missing");
      expect(body.report.summary.live).toBe(false);
      // The heartbeat the ideas cron recorded shows on the health view.
      expect(body.health.jobs.find((j) => j.job === "ideas")!.heartbeat).not.toBeNull();
      // Unticking is a new row: the newest decides.
      await route.POST(request("/api/staff/launch", { action: "tick", item: "attorney_review", done: false }));
      const again = (await (await route.GET(request("/api/staff/launch"))).json()) as Awaited<ReturnType<typeof loadLaunch>>;
      expect(again.report.items.find((i) => i.key === "attorney_review")!.state).toBe("manual");
    } finally {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.LOB_API_KEY;
    }
  });

  it("a check runs at most once a minute per service, and keeps only a code", async () => {
    let runs = 0;
    const run = async () => {
      runs += 1;
      return { ok: false, code: "refused" as const, httpStatus: 401 };
    };
    const now = new Date();
    await h.service.from("launch_probes").delete().eq("service", "anthropic");
    expect(await checkService(h.service, admin, "anthropic", now, run)).toMatchObject({ ok: true, outcome: { code: "refused" } });
    expect(await checkService(h.service, admin, "anthropic", new Date(now.getTime() + 10_000), run)).toEqual({ ok: false, status: 429, code: "cooldown" });
    expect(runs).toBe(1);
    const { data } = await h.service.from("launch_probes").select("*").eq("service", "anthropic").single();
    expect(data).toMatchObject({ ok: false, code: "refused", http_status: 401, by_name: "Carmen Ruiz" });
  });
});
