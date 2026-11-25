import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CONTENT_TEMPLATES } from "../../content/templates";
import { pieceHash } from "../../content/hash";
import { decryptToken, encryptToken, tokenKey } from "../../content/publish/crypto";
import { BACKOFF_MINUTES, runContentPublishing, type RunDeps } from "../../content/publish/run";
import type { Http } from "../../content/publish/types";
import { loadPiece, loadSecrets, saveConnection, schedulePiece } from "../../content/server";
import { startHarness, type Harness } from "./pg";
import { addClient, addStaff } from "./seed";

// Migration 0035 against the real migrations, with row level security: the
// content hub's pieces, files, history, results, settings, connections,
// schedules and publish log. The routes run as in production with the two
// Supabase clients swapped for the test database's; the social networks are
// a mocked fetch (no live call). What is tested: who reads what, who may do
// what, the approval held by the database, append-only records, encrypted
// tokens, and the scheduler's gates, claims, retries and failures.

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
const request = (path: string, body?: unknown) =>
  new Request(`https://app.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.35.${Math.floor(++ip / 250)}.${ip % 250}`, "user-agent": "vitest" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

const KEY_B64 = Buffer.alloc(32, 7).toString("base64");
const ENV = { META_APP_ID: "app", META_APP_SECRET: "secret", CONTENT_TOKEN_KEY: KEY_B64 } as unknown as NodeJS.ProcessEnv;
const ticked = { logo: true, colours: true, fonts: true, altiLabel: true, altibotCameo: true, languagesMatch: true, captions: true };
const template = (id: string) => CONTENT_TEMPLATES.find((t) => t.id === id)!;

let admin: Awaited<ReturnType<typeof addStaff>>;
let specialist: Awaited<ReturnType<typeof addStaff>>;
let sales: Awaited<ReturnType<typeof addStaff>>;
let client: string;

async function post(body: unknown) {
  const route = await import("@/app/api/staff/content/route");
  return json(await route.POST(request("/api/staff/content", body)));
}

/** A piece made by the specialist from a template, submitted, ticked, and approved by the administrator. */
async function approvedPiece(templateId: string, channels: string[]): Promise<string> {
  as(h.as(specialist.userId));
  const t = template(templateId);
  const created = await post({ action: "create", title: t.title.en, type: t.type, channels, language: "both", audience: t.audience, theme: t.theme, copy: t.copy, characters: t.characters, templateId: t.id });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  const id = String((created.body.piece as { id: string }).id);
  expect((await post({ action: "update", id, patch: { checklist: ticked } })).status).toBe(200);
  expect((await post({ action: "submit", id })).status).toBe(200);
  as(h.as(admin.userId));
  const approved = await post({ action: "approve", id });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return id;
}

beforeAll(async () => {
  h = await startHarness();
  admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  specialist = await addStaff(h, "specialist", "marta", "Marta Leal");
  sales = await addStaff(h, "sales", "ana", "Ana Prieto");
  client = await addClient(h, { name: "Rosa Martínez" });
}, 60_000);

describe("content: who may do what (routes)", () => {
  it("a specialist creates, edits and submits; only an administrator approves; sales cannot create", async () => {
    as(h.as(specialist.userId));
    const created = await post({ action: "create", title: "Reel: free credit fix", type: "short_video", channels: ["instagram"], language: "en", audience: "consumers", theme: "myths" });
    expect(created.status).toBe(200);
    const id = String((created.body.piece as { id: string }).id);
    expect((await post({ action: "update", id, patch: { copy: { hook: { en: "Fix your credit FREE!", es: "" }, caption: { en: "Guaranteed.", es: "" } } } })).status).toBe(200);
    expect((await post({ action: "submit", id })).status).toBe(200);
    const denied = await post({ action: "approve", id });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("forbidden_for_role");
    // The administrator cannot approve it either while it breaks the rules.
    as(h.as(admin.userId));
    const blocked = await post({ action: "approve", id });
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe("blocked");
    const [row] = await h.sql<{ status: string; blocking_issues: number; approved_hash: string | null }>(`select status, blocking_issues, approved_hash from public.content_pieces where id = $1`, [id]);
    expect(row).toMatchObject({ status: "review", approved_hash: null });
    expect(row!.blocking_issues).toBeGreaterThan(2);
    as(h.as(sales.userId));
    expect((await post({ action: "create", title: "Nope", type: "image", channels: [], language: "en", audience: "consumers", theme: "myths" })).status).toBe(403);
    as(h.as(client));
    expect((await post({ action: "create", title: "Nope", type: "image", channels: [], language: "en", audience: "consumers", theme: "myths" })).status).toBe(403);
  });

  it("approval is stored as the hash of exactly what was approved; an edit sends it back to review", async () => {
    const id = await approvedPiece("myth-fact", ["facebook", "instagram"]);
    const loaded = await loadPiece(h.service, id);
    expect(loaded!.piece.status).toBe("approved");
    const [row] = await h.sql<{ approved_hash: string; content_hash: string; approved_by_handle: string; approved_by: string }>(`select * from public.content_pieces where id = $1`, [id]);
    expect(row!.approved_hash).toBe(row!.content_hash);
    expect(row!.approved_hash).toBe(pieceHash(loaded!.piece));
    expect(row).toMatchObject({ approved_by_handle: "carmen", approved_by: admin.userId });
    as(h.as(specialist.userId));
    const edited = await post({ action: "update", id, patch: { copy: { hook: { en: "A different hook.", es: "Un gancho distinto." } } } });
    expect(edited.status).toBe(200);
    const after = await loadPiece(h.service, id);
    expect(after!.piece).toMatchObject({ status: "review", approval: null });
    const kinds = (await h.sql<{ kind: string }>(`select kind from public.content_events where piece_id = $1 order by at`, [id])).map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(["created", "submitted", "checked", "approved", "edited", "approval_reset"]));
  });

  it("sales reads approved partner material only, through their own connection", async () => {
    const partnerId = await approvedPiece("partner-good-hands", ["partners", "email"]);
    const route = await import("@/app/api/staff/content/route");
    as(h.as(sales.userId));
    const res = await json(await route.GET(request("/api/staff/content")));
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe("partner");
    const ids = (res.body.pieces as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain(partnerId);
    expect(ids.length).toBe(1);
    as(h.as(specialist.userId));
    const team = await json(await route.GET(request("/api/staff/content")));
    expect(team.body.scope).toBe("team");
    expect((team.body.pieces as unknown[]).length).toBeGreaterThan(2);
    // Connections (never their tokens) are for content.publish only.
    expect(team.body.connections).toBeNull();
    as(h.as(client));
    expect((await route.GET(request("/api/staff/content"))).status).toBe(403);
  });
});

describe("content: row level security and the database's own rules", () => {
  it("clients, partners' and signed-out connections read nothing; nobody but the server reads the tokens", async () => {
    await saveConnection(h.service, { userId: admin.userId, handle: "carmen" }, "meta", { account: { pageId: "p1", pageName: "Credalti" }, scopes: ["pages_manage_posts"], accessToken: "EAAB-secret-token", refreshToken: null, expiresAt: null, refreshExpiresAt: null }, tokenKey(ENV)!);
    for (const table of ["content_pieces", "content_assets", "content_events", "content_results", "content_settings", "content_connections", "content_schedules", "content_publish_log"]) {
      const asClient = await h.as(client).from(table).select("*");
      expect(asClient.data ?? [], `client ${table}`).toEqual([]);
      const anon = await h.anon.from(table).select("*");
      expect(anon.data ?? [], `anon ${table}`).toEqual([]);
    }
    for (const who of [admin.userId, specialist.userId, sales.userId]) {
      expect((await h.as(who).from("content_connections").select("*")).data ?? []).toEqual([]);
    }
    // Staff cannot write directly: the server does, after the role check.
    const insert = await h.as(admin.userId).from("content_pieces").insert({ id: "pc_direct00001", title: "Direct", type: "image", language: "en", audience: "consumers", theme: "myths", campaign_code: "cnt-direct", content_hash: "a".repeat(64), created_by_handle: "carmen" });
    expect(insert.error).not.toBeNull();
  });

  it("the token is stored encrypted (AES-256-GCM) and only the right key reads it", async () => {
    const [row] = await h.sql<{ token_enc: string }>(`select token_enc from public.content_connections where provider = 'meta'`);
    expect(row!.token_enc).toMatch(/^v1\./);
    expect(row!.token_enc).not.toContain("EAAB-secret-token");
    expect(decryptToken(row!.token_enc, tokenKey(ENV)!)).toBe("EAAB-secret-token");
    expect(decryptToken(row!.token_enc, Buffer.alloc(32, 9))).toBeNull();
    // A changed byte is refused (GCM's tag).
    const tampered = row!.token_enc.slice(0, -2) + (row!.token_enc.endsWith("A") ? "B" : "A") + row!.token_enc.slice(-1);
    expect(decryptToken(tampered, tokenKey(ENV)!)).toBeNull();
    expect(encryptToken("x", tokenKey(ENV)!)).not.toBe(encryptToken("x", tokenKey(ENV)!));
    expect((await loadSecrets(h.service, "meta", tokenKey(ENV)!))!.accessToken).toBe("EAAB-secret-token");
  });

  it("changing the words without a new hash is refused; a new hash drops the approval; a new file too", async () => {
    const id = await approvedPiece("fcra-30s", ["facebook"]);
    await expect(h.sql(`update public.content_pieces set copy = '{}'::jsonb where id = $1`, [id])).rejects.toThrow(/content_hash must change/);
    await h.sql(`update public.content_pieces set copy = '{}'::jsonb, content_hash = $2 where id = $1`, [id, "b".repeat(64)]);
    const [row] = await h.sql<{ status: string; approved_hash: string | null }>(`select status, approved_hash from public.content_pieces where id = $1`, [id]);
    expect(row).toMatchObject({ status: "review", approved_hash: null });
    // Back to approved, then a file is added directly: the trigger drops the approval.
    const other = await approvedPiece("dispute-letter", ["facebook"]);
    await h.sql(`insert into public.content_assets (id, piece_id, kind, ref, name, added_by_handle) values ('as_direct00001', $1, 'url', 'https://canva.example/x', 'Canva', 'marta')`, [other]);
    const [after] = await h.sql<{ status: string; approved_hash: string | null }>(`select status, approved_hash from public.content_pieces where id = $1`, [other]);
    expect(after).toMatchObject({ status: "review", approved_hash: null });
    await expect(h.sql(`delete from public.content_pieces where id = $1`, [other])).rejects.toThrow(/archived, never deleted/);
    await expect(h.sql(`delete from public.content_assets where id = 'as_direct00001'`)).rejects.toThrow(/never deleted/);
  });

  it("history, results and the publish log are append-only", async () => {
    const [event] = await h.sql<{ id: string }>(`select id from public.content_events limit 1`);
    await expect(h.sql(`update public.content_events set note = 'x' where id = $1`, [event!.id])).rejects.toThrow(/cannot be changed/);
    await expect(h.sql(`delete from public.content_events where id = $1`, [event!.id])).rejects.toThrow(/cannot be changed/);
    const [log] = await h.sql<{ id: string }>(`select id from public.content_publish_log limit 1`);
    await expect(h.sql(`delete from public.content_publish_log where id = $1`, [log!.id])).rejects.toThrow(/cannot be changed/);
  });

  it("a schedule is accepted only for an approved piece, on its channels; one live schedule per approved version", async () => {
    const [draft] = await h.sql<{ id: string; content_hash: string }>(`select id, content_hash from public.content_pieces where status = 'review' limit 1`);
    await expect(
      h.sql(`insert into public.content_schedules (piece_id, channel, lang, scheduled_at, next_attempt_at, approval_hash, publish_key, created_by_handle) values ($1, 'facebook', 'en', now(), now(), $2, $3, 'carmen')`, [draft!.id, draft!.content_hash, `${draft!.id}:facebook:x`]),
    ).rejects.toThrow(/only an approved piece/);
    const id = await approvedPiece("aftercare-building", ["facebook"]);
    const first = await schedulePiece(h.service, { userId: admin.userId, handle: "carmen" }, { id, channel: "facebook", at: new Date(Date.now() + 3600_000).toISOString() });
    expect(first.ok).toBe(true);
    const again = await schedulePiece(h.service, { userId: admin.userId, handle: "carmen" }, { id, channel: "facebook", at: new Date(Date.now() + 7200_000).toISOString() });
    expect(again).toMatchObject({ ok: false, code: "already_scheduled" });
    const wrongChannel = await schedulePiece(h.service, { userId: admin.userId, handle: "carmen" }, { id, channel: "youtube", at: new Date(Date.now() + 3600_000).toISOString() });
    expect(wrongChannel).toMatchObject({ ok: false, code: "channel_not_on_piece" });
    expect((await loadPiece(h.service, id))!.piece.status).toBe("scheduled");
  });
});

describe("content: the scheduler (mocked networks)", () => {
  function metaHttp(answers: Array<{ status: number; body: unknown }>): { http: Http; calls: string[] } {
    const calls: string[] = [];
    const http: Http = async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url.split("?")[0]}`);
      const next = answers.shift() ?? { status: 200, body: { id: "fallback" } };
      return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
    };
    return { http, calls };
  }
  const alerts: string[] = [];
  const deps = (http: Http): RunDeps => ({ http, env: ENV, mediaUrl: async (p) => `https://storage.test/${p}`, alert: async (t) => void alerts.push(t) });

  async function due(id: string): Promise<string> {
    const result = await schedulePiece(h.service, { userId: admin.userId, handle: "carmen" }, { id, channel: "facebook", at: new Date(Date.now() - 1000).toISOString() });
    if (!result.ok) throw new Error(result.code);
    return result.schedule.id;
  }
  const schedule = async (id: string) => (await h.sql<Record<string, unknown>>(`select * from public.content_schedules where id = $1`, [id]))[0]!;

  it("with publishing off (the default), nothing is posted: the schedule waits, logged once", async () => {
    const id = await approvedPiece("itin-spanish", ["facebook"]);
    const sid = await due(id);
    const { http, calls } = metaHttp([]);
    const summary = await runContentPublishing(h.service, new Date(), deps(http));
    expect(summary.held).toBeGreaterThanOrEqual(1);
    expect(calls).toEqual([]);
    expect((await schedule(sid)).status).toBe("scheduled");
    await runContentPublishing(h.service, new Date(), deps(http));
    const held = await h.sql(`select * from public.content_publish_log where schedule_id = $1 and event = 'held'`, [sid]);
    expect(held).toHaveLength(1);
  });

  it("turned on, it claims, posts once, records the post, and a second run posts nothing", async () => {
    as(h.as(specialist.userId));
    expect((await post({ action: "settings", enabled: true })).status).toBe(403);
    as(h.as(admin.userId));
    expect((await post({ action: "settings", enabled: true, channels: { facebook: true } })).status).toBe(200);
    const { http, calls } = metaHttp([{ status: 200, body: { id: "1001_2002" } }]);
    const summary = await runContentPublishing(h.service, new Date(), deps(http));
    expect(summary.posted).toBeGreaterThanOrEqual(1);
    expect(calls.filter((c) => c.endsWith("/feed")).length).toBe(summary.posted);
    const posted = await h.sql<{ status: string; external_id: string; url: string; attempts: number }>(`select status, external_id, url, attempts from public.content_schedules where external_id = '1001_2002'`);
    expect(posted[0]).toMatchObject({ status: "posted", url: "https://www.facebook.com/1001_2002", attempts: 1 });
    const log = await h.sql<{ event: string; payload: Record<string, unknown> | null; approved_by_handle: string | null }>(
      `select event, payload, approved_by_handle from public.content_publish_log where schedule_id = (select id from public.content_schedules where external_id = '1001_2002') order by at`,
    );
    expect(log.map((l) => l.event)).toEqual(expect.arrayContaining(["scheduled", "claimed", "sent", "posted"]));
    const sent = log.find((l) => l.event === "sent")!;
    expect(sent.approved_by_handle).toBe("carmen");
    expect(String(sent.payload!.text)).toMatch(/Los resultados varían|Results vary/);
    expect(JSON.stringify(log)).not.toContain("EAAB-secret-token");
    const again = metaHttp([]);
    const second = await runContentPublishing(h.service, new Date(), deps(again.http));
    expect(second.posted).toBe(0);
    expect(again.calls.filter((c) => c.startsWith("POST"))).toEqual([]);
  });

  it("a temporary error is retried with backoff; a permanent one fails the piece, says why, and alerts the owner", async () => {
    const id = await approvedPiece("myth-fact", ["facebook"]);
    const sid = await due(id);
    const now = new Date();
    await runContentPublishing(h.service, now, deps(metaHttp([{ status: 503, body: { error: { message: "busy", code: 2 } } }]).http));
    const retry = await schedule(sid);
    expect(retry.status).toBe("retry");
    expect(new Date(retry.next_attempt_at as string | Date).getTime() - now.getTime()).toBe(BACKOFF_MINUTES[0] * 60_000);
    // Not due yet: nothing happens.
    const early = metaHttp([]);
    await runContentPublishing(h.service, new Date(now.getTime() + 60_000), deps(early.http));
    expect(early.calls).toEqual([]);
    // Then Facebook refuses it for good.
    await runContentPublishing(h.service, new Date(now.getTime() + 6 * 60_000), deps(metaHttp([{ status: 400, body: { error: { message: "Invalid parameter", code: 100 } } }]).http));
    expect((await schedule(sid)).status).toBe("failed");
    const piece = (await loadPiece(h.service, id))!.piece;
    expect(piece.status).toBe("failed");
    expect(piece.failure).toMatch(/Facebook refused the post: Invalid parameter/);
    expect(alerts.some((a) => a.includes("Content publishing failed") && a.includes("facebook"))).toBe(true);
  });

  it("an expired connection fails with 'connect it again'; a claim left mid-call is never sent again", async () => {
    const id = await approvedPiece("partner-good-hands", ["facebook"]);
    const sid = await due(id);
    await runContentPublishing(h.service, new Date(), deps(metaHttp([{ status: 401, body: { error: { message: "Session expired", code: 190 } } }]).http));
    expect((await loadPiece(h.service, id))!.piece.failure).toMatch(/connect the account again/);
    const [conn] = await h.sql<{ status: string }>(`select status from public.content_connections where provider = 'meta'`);
    expect(conn!.status).toBe("error");
    expect((await schedule(sid)).status).toBe("failed");
    // Reconnect, then a run that "died" after claiming.
    await saveConnection(h.service, { userId: admin.userId, handle: "carmen" }, "meta", { account: { pageId: "p1", pageName: "Credalti" }, scopes: ["pages_manage_posts"], accessToken: "EAAB-new", refreshToken: null, expiresAt: null, refreshExpiresAt: null }, tokenKey(ENV)!);
    const other = await approvedPiece("fcra-30s", ["facebook"]);
    const stuck = await due(other);
    await h.sql(`update public.content_schedules set status = 'publishing', claimed_at = now() - interval '20 minutes' where id = $1`, [stuck]);
    const { http, calls } = metaHttp([]);
    await runContentPublishing(h.service, new Date(), deps(http));
    expect(calls).toEqual([]);
    expect((await schedule(stuck)).status).toBe("failed");
    expect((await loadPiece(h.service, other))!.piece.failure).toMatch(/could not confirm whether this was posted/);
  });

  it("an edit after approval cancels the schedule: the old version is never posted", async () => {
    const id = await approvedPiece("dispute-letter", ["facebook"]);
    const sid = await due(id);
    as(h.as(specialist.userId));
    expect((await post({ action: "update", id, patch: { copy: { cta: { en: "See an example", es: "Ver un ejemplo" } } } })).status).toBe(200);
    expect((await schedule(sid)).status).toBe("cancelled");
    const { http, calls } = metaHttp([]);
    await runContentPublishing(h.service, new Date(), deps(http));
    expect(calls).toEqual([]);
  });

  it("reads the numbers of posted pieces (read only) into results, at most every 6 hours", async () => {
    const insights = { data: [{ name: "post_impressions", values: [{ value: 900 }] }, { name: "post_impressions_unique", values: [{ value: 700 }] }, { name: "post_clicks", values: [{ value: 12 }] }] };
    await h.sql(`update public.content_schedules set metrics_at = null where status = 'posted'`);
    const { http, calls } = metaHttp([
      { status: 200, body: { shares: { count: 3 }, comments: { summary: { total_count: 4 } }, reactions: { summary: { total_count: 25 } } } },
      { status: 200, body: insights },
    ]);
    const summary = await runContentPublishing(h.service, new Date(), deps(http));
    expect(summary.metrics).toBe(1);
    expect(calls.every((c) => c.startsWith("GET"))).toBe(true);
    const [result] = await h.sql<{ source: string; metrics: Record<string, number> }>(`select source, metrics from public.content_results where source = 'meta'`);
    expect(result).toMatchObject({ source: "meta", metrics: { views: 900, reach: 700, clicks: 12, likes: 25, comments: 4, shares: 3 } });
    const again = metaHttp([]);
    expect((await runContentPublishing(h.service, new Date(), deps(again.http))).metrics).toBe(0);
  });
});

describe("content: results typed in", () => {
  it("only measured numbers are kept, and a posted piece becomes measured", async () => {
    const id = await approvedPiece("aftercare-building", ["instagram"]);
    as(h.as(specialist.userId));
    expect((await post({ action: "record_post", id, channel: "instagram", url: "https://www.instagram.com/p/abc" })).status).toBe(200);
    expect((await post({ action: "add_result", id, channel: "instagram", values: {} })).status).toBe(422);
    expect((await post({ action: "add_result", id, channel: "instagram", values: { views: 1200, leads: 3, signed: 1 } })).status).toBe(200);
    const [row] = await h.sql<{ metrics: Record<string, number> }>(`select metrics from public.content_results where piece_id = $1`, [id]);
    expect(row!.metrics).toEqual({ views: 1200, leads: 3, signed: 1 });
    expect((await loadPiece(h.service, id))!.piece.status).toBe("measured");
  });
});
