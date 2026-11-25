import { NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { VIDEO_ACTION_CAPABILITY, type VideoAction } from "@/lib/video/rules";
import { videoBodySchema } from "@/lib/video/schemas";
import { applyVideoOnServer, loadEvents, loadProject, loadProjects, loadTracks, signedLinks } from "@/lib/video/server";

// /equipo/video on the database (src/lib/video, migration 0038).
//
// GET   The board (content.view): every video and the music library; or one
//       video (?id=) with its history and short-lived links to its files
//       (clips, pictures, exports, and the music it uses).
// POST  One action. The capability is checked first (VIDEO_ACTION_CAPABILITY:
//       content.edit, approval content.approve), then the same rules as the
//       demo, then the database (whose triggers hold the approval again).

export async function GET(req: Request) {
  const allowed = await requireCapability("content.view");
  if (!allowed.ok) return allowed.response;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  try {
    // The menu's red circle: statuses only (lib/video/badge.ts).
    if (url.searchParams.get("needs") === "1") {
      const { data, error } = await allowed.db.from("video_projects").select("status, owner, changes_note").neq("status", "archived").limit(1000);
      if (error) throw new Error(error.message);
      const projects = ((data ?? []) as Array<{ status: string; owner: string | null; changes_note: string | null }>).map((r) => ({ status: r.status, owner: r.owner, changesNote: r.changes_note }));
      return NextResponse.json({ projects });
    }
    if (id) {
      if (!/^[a-z]{2}_[a-z0-9]{6,40}$/.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
      const [loaded, tracks] = await Promise.all([loadProject(allowed.db, id), loadTracks(allowed.db)]);
      if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const events = await loadEvents(allowed.db, id);
      const project = loaded.project;
      const track = tracks.find((t) => t.id === project.edit.music.trackId);
      const fileUrls = await signedLinks(allowed.db, [
        ...project.media.filter((m) => m.source === "upload").map((m) => m.ref),
        ...project.exports.slice(0, 3).map((e) => e.ref),
        ...(track && track.source === "upload" ? [track.ref] : []),
      ]);
      return NextResponse.json({ project, events, tracks, fileUrls });
    }
    const [projects, tracks] = await Promise.all([loadProjects(allowed.db), loadTracks(allowed.db)]);
    return NextResponse.json({ projects, tracks });
  } catch (error) {
    await reportError(error, { where: "api/staff/video GET", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not load." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-video", { limit: 240, windowMs: 60_000 });
  if (limited) return limited;
  // The edit decisions of a long video with many captions: up to 256 KB.
  const body = await readJsonBody(req, 256_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = videoBodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data as VideoAction;
  const allowed = await requireCapability(VIDEO_ACTION_CAPABILITY[input.action]);
  if (!allowed.ok) return allowed.response;
  try {
    const result = await applyVideoOnServer(allowed.db, { userId: allowed.member.userId, handle: allowed.member.handle }, input);
    if (!result.ok) {
      const status = result.code === "not_found" ? 404 : result.code === "conflict" || result.code === "duplicate_brief" ? 409 : result.code === "db_error" ? 500 : 422;
      return NextResponse.json({ error: result.message.en, code: result.code, message: result.message }, { status });
    }
    return NextResponse.json({ ok: true, project: result.project });
  } catch (error) {
    await reportError(error, { where: "api/staff/video POST", userId: allowed.member.userId, extra: { action: input.action } });
    return NextResponse.json({ error: "Could not save it. Nothing changed." }, { status: 500 });
  }
}
