import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { checkStudioFile, extensionFor, looksLikeMp4, maxBytesForKind, studioPath, VIDEO_BUCKET, type StudioKind } from "@/lib/video/files";
import { videoFilesBodySchema } from "@/lib/video/schemas";
import { addTrack, applyVideoOnServer, loadProject, removeTrack, signedLinks } from "@/lib/video/server";
import { newVideoId } from "@/lib/video/timeline";
import { VIDEO_LIMITS, type MediaItem } from "@/lib/video/types";

// Files of the Video Studio (src/lib/video/files.ts). content.edit.
//
//   upload_url      A one-time signed upload link for one path: a clip or
//                   picture of a video, an exported MP4, or a music track.
//                   Files go straight from the browser to the private bucket.
//   confirm_media   The clip or picture arrived: the server reads its first
//                   bytes from storage (deleting anything that is not a clip
//                   or a picture) and adds it to the video.
//   confirm_export  The MP4 the editor rendered arrived: checked the same way
//                   and recorded with the hash of the version it was made from.
//   confirm_music   A track for the library, only with the person's
//                   confirmation that the team has the rights (recorded with
//                   their name, the time and their note).
//   remove_music    Marks a track removed (the record stays).
//   sign            Short-lived links to view files (an hour).

const PURPOSE_KIND = { media: null, export: "video", music: "audio" } as const;

async function head(db: SupabaseClient, path: string): Promise<{ size: number; bytes: Uint8Array } | null> {
  const signed = await db.storage.from(VIDEO_BUCKET).createSignedUrl(path, 120);
  if (!signed.data?.signedUrl) return null;
  const res = await fetch(signed.data.signedUrl, { headers: { range: "bytes=0-63" } });
  if (!res.ok) return null;
  const size = Number(res.headers.get("content-range")?.split("/")[1] ?? res.headers.get("content-length") ?? 0);
  return { size, bytes: new Uint8Array(await res.arrayBuffer()).subarray(0, 64) };
}

const refuse = (code: string, status = 415) => NextResponse.json({ error: code, code }, { status });

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-video-files", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 8_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = videoFilesBodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data;
  const allowed = await requireCapability(input.action === "sign" ? "content.view" : "content.edit");
  if (!allowed.ok) return allowed.response;
  const db = allowed.db;
  const actor = { userId: allowed.member.userId, handle: allowed.member.handle };

  try {
    switch (input.action) {
      case "upload_url": {
        const kind: StudioKind | null = input.purpose === "media" ? (input.mediaType.startsWith("image/") ? "image" : "video") : PURPOSE_KIND[input.purpose];
        if (!kind || input.bytes > (input.purpose === "export" ? 500 * 1024 * 1024 : maxBytesForKind(kind))) return refuse("too_large", 413);
        if (input.purpose !== "music") {
          if (!input.projectId) return refuse("bad_input", 400);
          const loaded = await loadProject(db, input.projectId);
          if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });
          if (input.purpose === "media") {
            const used = loaded.project.media.reduce((sum, m) => sum + m.bytes, 0);
            if (loaded.project.media.length >= VIDEO_LIMITS.mediaPerProject || used + input.bytes > VIDEO_LIMITS.projectBytes) return refuse("project_full", 422);
          }
        }
        const fileId = newVideoId(input.purpose === "export" ? "ex" : input.purpose === "music" ? "mu" : "md");
        const path = studioPath(input.purpose === "music" ? "music" : input.projectId!, fileId, input.purpose === "export" ? "mp4" : extensionFor(input.mediaType));
        const { data, error } = await db.storage.from(VIDEO_BUCKET).createSignedUploadUrl(path);
        if (error || !data) throw new Error(`storage upload url: ${error?.message ?? "none"}`);
        return NextResponse.json({ ok: true, fileId, path, signedUrl: data.signedUrl, token: data.token });
      }
      case "confirm_media": {
        if (!input.path.startsWith(`${input.projectId}/${input.fileId}.`)) return refuse("bad_input", 400);
        const found = await head(db, input.path);
        if (!found) return refuse("empty", 400);
        const check = checkStudioFile(found.bytes, found.size, input.kind);
        if (!check.ok) {
          await db.storage.from(VIDEO_BUCKET).remove([input.path]);
          return refuse(check.code, check.code === "too_large" ? 413 : 415);
        }
        const loaded = await loadProject(db, input.projectId);
        if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });
        const item: MediaItem = {
          id: input.fileId,
          kind: input.kind,
          name: input.name,
          mediaType: check.mediaType,
          bytes: found.size,
          duration: input.kind === "video" ? input.duration : null,
          width: input.width,
          height: input.height,
          hasAudio: input.kind === "video" ? input.hasAudio : false,
          source: "upload",
          ref: input.path,
          addedBy: actor.handle,
          addedAt: new Date().toISOString(),
        };
        const result = await applyVideoOnServer(db, actor, { action: "update", id: input.projectId, patch: { media: [...loaded.project.media, item] } });
        if (!result.ok) return NextResponse.json({ error: result.message.en, code: result.code, message: result.message }, { status: result.code === "conflict" ? 409 : 422 });
        return NextResponse.json({ ok: true, project: result.project, media: item, fileUrls: await signedLinks(db, [input.path]) });
      }
      case "confirm_export": {
        if (!input.path.startsWith(`${input.projectId}/${input.fileId}.`)) return refuse("bad_input", 400);
        const found = await head(db, input.path);
        if (!found || found.size <= 0) return refuse("empty", 400);
        if (!looksLikeMp4(found.bytes)) {
          await db.storage.from(VIDEO_BUCKET).remove([input.path]);
          return refuse("wrong_type");
        }
        const result = await applyVideoOnServer(db, actor, {
          action: "add_export",
          id: input.projectId,
          export: { id: input.fileId, at: new Date().toISOString(), by: actor.handle, hash: input.hash, width: input.width, height: input.height, duration: input.duration, bytes: found.size, ref: input.path },
        });
        if (!result.ok) return NextResponse.json({ error: result.message.en, code: result.code, message: result.message }, { status: result.code === "conflict" ? 409 : 422 });
        return NextResponse.json({ ok: true, project: result.project, fileUrls: await signedLinks(db, [input.path]) });
      }
      case "confirm_music": {
        if (!input.path.startsWith(`music/${input.fileId}.`)) return refuse("bad_input", 400);
        const found = await head(db, input.path);
        if (!found) return refuse("empty", 400);
        const check = checkStudioFile(found.bytes, found.size, "audio");
        if (!check.ok) {
          await db.storage.from(VIDEO_BUCKET).remove([input.path]);
          return refuse(check.code, check.code === "too_large" ? 413 : 415);
        }
        const track = await addTrack(db, actor, { id: input.fileId, name: input.name, path: input.path, mediaType: check.mediaType, bytes: found.size, duration: input.duration, rightsNote: input.rightsNote });
        return NextResponse.json({ ok: true, track });
      }
      case "remove_music":
        return (await removeTrack(db, input.id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
      case "sign":
        return NextResponse.json({ ok: true, fileUrls: await signedLinks(db, input.paths) });
    }
  } catch (error) {
    await reportError(error, { where: "api/staff/video/files", userId: allowed.member.userId, extra: { action: input.action } });
    return NextResponse.json({ error: "The file could not be kept. Nothing changed." }, { status: 500 });
  }
}
