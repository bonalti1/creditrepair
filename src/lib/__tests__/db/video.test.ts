import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SAMPLE_MEDIA } from "../../video/demo";
import { projectHash } from "../../video/hash";
import { applyVideoOnServer, loadProject } from "../../video/server";
import { clipFromMedia } from "../../video/timeline";
import type { VideoProject } from "../../video/types";
import { startHarness, type Harness } from "./pg";
import { addClient, addStaff } from "./seed";

// Migration 0038 against the real migrations, with row level security: the
// Video Studio's videos, exports, music library and history. The routes run
// as in production with the two Supabase clients swapped for the test
// database's. What is tested: who reads what (administrators and specialists
// only; sales, clients and signed-out visitors nothing), who may do what
// through the routes (an administrator approves), and the rules the database
// holds by itself: approval only of an exported version, an edit drops it,
// records never change, a published video stays as it is, the music's rights.

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
    headers: { "content-type": "application/json", "x-forwarded-for": `10.38.${Math.floor(++ip / 250)}.${ip % 250}`, "user-agent": "vitest" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

let admin: Awaited<ReturnType<typeof addStaff>>;
let specialist: Awaited<ReturnType<typeof addStaff>>;
let sales: Awaited<ReturnType<typeof addStaff>>;
let client: string;

async function post(body: unknown) {
  const route = await import("@/app/api/staff/video/route");
  return json(await route.POST(request("/api/staff/video", body)));
}
async function get(query = "") {
  const route = await import("@/app/api/staff/video/route");
  return json(await route.GET(request(`/api/staff/video${query}`)));
}

const WORDS = {
  hook: "Something on your report looks wrong?",
  script: "You have the right to dispute it. You tell us what is inaccurate, and our team prepares and mails the letters.",
  postCaption: "You tell us what is wrong on your report; our team prepares and mails the letters. Results vary.",
};

/** A video by the specialist: the sample clips on the timeline, captions, the checklist done. */
async function readyToExport(title: string): Promise<VideoProject> {
  as(h.as(specialist.userId));
  const created = await post({ action: "create", title, language: "en", brief: { format: "reel", hook: WORDS.hook, goal: "Explain the right to dispute." } });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  const id = String((created.body.project as { id: string }).id);
  const withMedia = await post({ action: "update", id, patch: { media: SAMPLE_MEDIA, plan: { script: WORDS.script, postCaption: WORDS.postCaption } } });
  expect(withMedia.status, JSON.stringify(withMedia.body)).toBe(200);
  const project = withMedia.body.project as VideoProject;
  const edit = { ...project.edit, clips: [clipFromMedia(SAMPLE_MEDIA[0]!, "cl_dbtest01"), clipFromMedia(SAMPLE_MEDIA[3]!, "cl_dbtest02")], captions: [{ id: "cc_dbtest01", start: 0, end: 3, text: "You have the right to dispute it." }] };
  const edited = await post({ action: "update", id, patch: { edit, checklist: { footageRights: true, noScoreVisuals: true, captionsMatch: true }, clientAppears: false } });
  expect(edited.status, JSON.stringify(edited.body)).toBe(200);
  return edited.body.project as VideoProject;
}

/** Record an export of the video as it is now (the files route does this after the upload; storage is not emulated). */
async function exportNow(project: VideoProject, by = specialist): Promise<VideoProject> {
  const exportId = `ex_${project.id.slice(3, 15)}${Math.random().toString(36).slice(2, 6)}`;
  const result = await applyVideoOnServer(h.service, { userId: by.userId, handle: by.handle }, {
    action: "add_export",
    id: project.id,
    export: { id: exportId, at: new Date().toISOString(), by: by.handle, hash: projectHash(project), width: 1080, height: 1920, duration: 10, bytes: 123456, ref: `${project.id}/${exportId}.mp4` },
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return (result as { project: VideoProject }).project;
}

beforeAll(async () => {
  h = await startHarness();
  admin = await addStaff(h, "admin", "carmen", "Carmen Ruiz");
  specialist = await addStaff(h, "specialist", "marta", "Marta Leal");
  sales = await addStaff(h, "sales", "ana", "Ana Prieto");
  client = await addClient(h, { name: "Rosa Martínez" });
}, 60_000);

describe("video: who may do what (routes)", () => {
  it("a specialist makes and submits a video; only an administrator approves; sales can't open it", async () => {
    const project = await exportNow(await readyToExport("Your right to dispute"));
    as(h.as(specialist.userId));
    const submitted = await post({ action: "submit", id: project.id });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect((submitted.body.project as VideoProject).status).toBe("ready");
    const refused = await post({ action: "approve", id: project.id });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("forbidden_for_role");

    as(h.as(admin.userId));
    const approved = await post({ action: "approve", id: project.id });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const row = (await h.sql<{ status: string; approved_hash: string; project_hash: string; approved_by: string }>("select status, approved_hash, project_hash, approved_by from public.video_projects where id = $1", [project.id]))[0]!;
    expect(row.status).toBe("approved");
    expect(row.approved_hash).toBe(row.project_hash);
    expect(row.approved_by).toBe(admin.userId);

    as(h.as(sales.userId));
    expect((await get()).status).toBe(403);
    expect((await post({ action: "create", title: "Nope", language: "en", brief: { format: "reel" } })).status).toBe(403);
    as(h.anon);
    expect((await get()).status).toBe(403);
    as(h.as(client));
    expect((await get()).status).toBe(403);
  });

  it("submitting without an export of this version is refused, by the rules and by the database", async () => {
    const project = await readyToExport("No export yet");
    as(h.as(specialist.userId));
    const refused = await post({ action: "submit", id: project.id });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe("no_export");
    await expect(h.sql("update public.video_projects set status = 'ready' where id = $1", [project.id])).rejects.toThrow(/needs an export of exactly this version/);
  });

  it("an edit after approval drops it and sends the video back to editing", async () => {
    const project = await exportNow(await readyToExport("Edit after approval"));
    as(h.as(specialist.userId));
    expect((await post({ action: "submit", id: project.id })).status).toBe(200);
    as(h.as(admin.userId));
    expect((await post({ action: "approve", id: project.id })).status).toBe(200);
    as(h.as(specialist.userId));
    const loaded = (await loadProject(h.service, project.id))!.project;
    const changed = await post({ action: "update", id: project.id, patch: { edit: { ...loaded.edit, captions: [{ id: "cc_dbtest02", start: 0, end: 2, text: "A new caption." }] } } });
    expect(changed.status).toBe(200);
    expect((changed.body.project as VideoProject).status).toBe("editing");
    expect((changed.body.project as VideoProject).approval).toBeNull();
    const row = (await h.sql<{ approved_hash: string | null }>("select approved_hash from public.video_projects where id = $1", [project.id]))[0]!;
    expect(row.approved_hash).toBeNull();
    const events = await h.sql<{ kind: string }>("select kind from public.video_events where project_id = $1 order by at", [project.id]);
    expect(events.map((e) => e.kind)).toContain("approval_reset");
  });

  it("an approved video is handed to a Content piece and then stays as it is", async () => {
    const project = await exportNow(await readyToExport("Handed off"));
    as(h.as(specialist.userId));
    expect((await post({ action: "submit", id: project.id })).status).toBe(200);
    as(h.as(admin.userId));
    expect((await post({ action: "approve", id: project.id })).status).toBe(200);
    // A Content piece (made by the content hub's own route in the app).
    const content = await import("@/app/api/staff/content/route");
    as(h.as(specialist.userId));
    const piece = await json(await content.POST(request("/api/staff/content", { action: "create", title: "Handed off", type: "short_video", channels: ["instagram"], language: "en", audience: "consumers", theme: "rights" })));
    expect(piece.status).toBe(200);
    const pieceId = String((piece.body.piece as { id: string }).id);
    expect((await post({ action: "link_piece", id: project.id, pieceId })).status).toBe(200);
    const published = await post({ action: "publish", id: project.id, pieceId });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect((published.body.project as VideoProject).status).toBe("published");
    const again = await post({ action: "update", id: project.id, patch: { title: "Changed" } });
    expect(again.status).toBe(422);
    await expect(h.sql("update public.video_projects set project_hash = repeat('a', 64), edit = '{}'::jsonb where id = $1", [project.id])).rejects.toThrow(/published video no longer changes/);
    await expect(h.sql("update public.video_projects set status = 'published', content_piece_id = null where id = $1", [project.id])).rejects.toThrow();
  });

  it("the same Ads brief is not turned into two live videos", async () => {
    as(h.as(specialist.userId));
    const brief = { format: "tiktok", source: "ads", ref: "ad-123", title: "From an ad" };
    expect((await post({ action: "create", title: "From an ad", language: "en", brief })).status).toBe(200);
    const second = await post({ action: "create", title: "From an ad", language: "en", brief });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("duplicate_brief");
  });
});

describe("video: row level security", () => {
  it("administrators and specialists read videos, exports, history and music; sales, a client and anon read nothing", async () => {
    await exportNow(await readyToExport("Readable"));
    await h.service.from("video_music").insert({ id: "mu_dbtestmusic1", name: "Team jingle", path: "music/mu_dbtestmusic1.mp3", media_type: "audio/mpeg", bytes: 1000, rights_confirmed_by_handle: "carmen", rights_note: "Made by the team" });
    for (const reader of [admin, specialist]) {
      const db = h.as(reader.userId);
      for (const table of ["video_projects", "video_exports", "video_events", "video_music"]) {
        const { data, error } = await db.from(table).select("*");
        expect(error, table).toBeNull();
        expect((data ?? []).length, `${reader.handle} ${table}`).toBeGreaterThan(0);
      }
    }
    for (const db of [h.as(sales.userId), h.as(client), h.anon]) {
      for (const table of ["video_projects", "video_exports", "video_events", "video_music"]) {
        const { data } = await db.from(table).select("*");
        expect((data ?? []).length, table).toBe(0);
      }
    }
  });

  it("nobody but the server writes: a specialist's own connection can't insert or change a video", async () => {
    const db = h.as(specialist.userId);
    const { error } = await db.from("video_projects").insert({ id: "vp_sneaky00001", title: "Sneaky", language: "en", project_hash: "a".repeat(64), created_by_handle: "marta" });
    expect(error).not.toBeNull();
    await db.from("video_projects").update({ title: "Changed by hand" }).neq("id", "");
    const titles = await h.sql<{ title: string }>("select title from public.video_projects");
    expect(titles.map((t) => t.title)).not.toContain("Changed by hand");
  });

  it("the private bucket has staff-only policies", async () => {
    const bucket = await h.sql<{ public: boolean }>("select public from storage.buckets where id = 'video-studio'");
    expect(bucket[0]?.public).toBe(false);
    const policies = await h.sql<{ policyname: string; cmd: string; qual: string | null; with_check: string | null }>(
      "select policyname, cmd, qual, with_check from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'content team%video%'",
    );
    expect(policies.map((p) => p.cmd).sort()).toEqual(["INSERT", "SELECT"]);
    for (const p of policies) expect(`${p.qual ?? ""}${p.with_check ?? ""}`).toMatch(/video-studio[\s\S]*staff_role\(\)/);
  });
});

describe("video: the records the database holds", () => {
  it("a video is never deleted; its edit can't change without its hash; history and exports never change", async () => {
    const project = await exportNow(await readyToExport("Records"));
    await expect(h.sql("delete from public.video_projects where id = $1", [project.id])).rejects.toThrow(/archived, never deleted/);
    await expect(h.sql("update public.video_projects set edit = '{}'::jsonb where id = $1", [project.id])).rejects.toThrow(/project_hash must change/);
    await expect(h.sql("update public.video_events set note = 'x' where project_id = $1", [project.id])).rejects.toThrow(/cannot be changed/);
    await expect(h.sql("delete from public.video_exports where project_id = $1", [project.id])).rejects.toThrow(/cannot be changed/);
  });

  it("a music track always carries who confirmed its rights; the record stays when it's removed", async () => {
    await expect(h.sql("insert into public.video_music (id, name, path, media_type, bytes) values ('mu_norights001', 'No rights', 'music/mu_norights001.mp3', 'audio/mpeg', 10)")).rejects.toThrow();
    await h.sql("insert into public.video_music (id, name, path, media_type, bytes, rights_confirmed_by_handle) values ('mu_withrights1', 'Ours', 'music/mu_withrights1.mp3', 'audio/mpeg', 10, 'carmen')");
    await expect(h.sql("update public.video_music set rights_note = 'changed' where id = 'mu_withrights1'")).rejects.toThrow(/only the name and the removal/);
    await h.sql("update public.video_music set removed_at = now() where id = 'mu_withrights1'");
    await expect(h.sql("delete from public.video_music where id = 'mu_withrights1'")).rejects.toThrow(/never deleted/);
  });
});
