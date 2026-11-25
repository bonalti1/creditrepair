import type { SupabaseClient } from "@supabase/supabase-js";
import { blockingVideoIssues, checkVideo } from "./check";
import { VIDEO_BUCKET } from "./files";
import { projectHash } from "./hash";
import { applyVideoAction, cleanBrief, cleanPlan, type VideoAction, type VideoApplyResult } from "./rules";
import { cleanEdit } from "./timeline";
import type { Bilingual, ConsentRecord, MediaItem, MusicTrack, VideoEvent, VideoExport, VideoProject, VideoStatus } from "./types";

// The Video Studio on the database (migration 0038). The routes ask
// requireCapability first; this applies the same rules as the demo
// (rules.ts) and writes with the service role. Every update is conditioned on
// the hash the video had when it was read, so two people editing at once
// never overwrite each other silently (the second gets "changed meanwhile").

type Row = Record<string, unknown>;

export interface Actor {
  userId: string;
  handle: string;
}

const CONFLICT: Bilingual = { en: "Someone changed this video meanwhile. Reload it and try again.", es: "Alguien cambió este video mientras tanto. Vuelve a cargarlo e inténtalo otra vez." };

export function exportFromRow(row: Row): VideoExport {
  return {
    id: String(row.id),
    at: String(row.created_at),
    by: String(row.created_by_handle),
    hash: String(row.hash),
    width: Number(row.width),
    height: Number(row.height),
    duration: Number(row.duration),
    bytes: Number(row.bytes),
    ref: String(row.path),
  };
}

export function projectFromRow(row: Row, exports: VideoExport[]): VideoProject {
  const plan = cleanPlan((row.plan ?? {}) as Partial<VideoProject["plan"]>);
  const brief = cleanBrief((row.brief ?? {}) as Partial<VideoProject["brief"]>, String(row.title ?? ""));
  return {
    id: String(row.id),
    title: String(row.title),
    status: row.status as VideoStatus,
    language: row.language === "es" ? "es" : "en",
    brief,
    plan,
    media: (Array.isArray(row.media) ? row.media : []) as MediaItem[],
    edit: cleanEdit(row.edit),
    checklist: (row.checklist ?? {}) as VideoProject["checklist"],
    clientAppears: typeof row.client_appears === "boolean" ? row.client_appears : null,
    consents: (Array.isArray(row.consents) ? row.consents : []) as ConsentRecord[],
    exports: [...exports].sort((a, b) => b.at.localeCompare(a.at)),
    approval: row.approved_hash ? { by: String(row.approved_by_handle ?? ""), at: String(row.approved_at), hash: String(row.approved_hash) } : null,
    changesNote: (row.changes_note as string | null) ?? null,
    contentPieceId: (row.content_piece_id as string | null) ?? null,
    owner: (row.owner as string | null) ?? null,
    createdBy: String(row.created_by_handle),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function projectColumns(project: VideoProject, tracks: readonly MusicTrack[]) {
  return {
    title: project.title,
    status: project.status,
    language: project.language,
    brief: project.brief,
    plan: project.plan,
    media: project.media,
    edit: project.edit,
    checklist: project.checklist,
    client_appears: project.clientAppears,
    consents: project.consents,
    project_hash: projectHash(project),
    blocking_issues: blockingVideoIssues(checkVideo(project, tracks)).length,
    approved_hash: project.approval?.hash ?? null,
    approved_at: project.approval?.at ?? null,
    approved_by_handle: project.approval?.by ?? null,
    changes_note: project.changesNote,
    content_piece_id: project.contentPieceId,
    brief_ref: project.brief.ref,
    owner: project.owner,
  };
}

export function trackFromRow(row: Row): MusicTrack {
  return {
    id: String(row.id),
    name: String(row.name),
    mediaType: String(row.media_type),
    bytes: Number(row.bytes),
    duration: row.duration === null || row.duration === undefined ? null : Number(row.duration),
    source: "upload",
    ref: String(row.path),
    rights: { confirmedBy: String(row.rights_confirmed_by_handle), confirmedAt: String(row.rights_confirmed_at), note: String(row.rights_note ?? "") },
    addedBy: String(row.rights_confirmed_by_handle),
    addedAt: String(row.added_at),
    removedAt: (row.removed_at as string | null) ?? null,
  };
}

export async function loadTracks(db: SupabaseClient): Promise<MusicTrack[]> {
  const { data, error } = await db.from("video_music").select("*").order("added_at", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(trackFromRow);
}

async function exportsOf(db: SupabaseClient, ids: string[]): Promise<Map<string, VideoExport[]>> {
  const by = new Map<string, VideoExport[]>();
  if (ids.length === 0) return by;
  const { data, error } = await db.from("video_exports").select("*").in("project_id", ids).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as Row[]) by.set(String(row.project_id), [...(by.get(String(row.project_id)) ?? []), exportFromRow(row)]);
  return by;
}

export async function loadProjects(db: SupabaseClient): Promise<VideoProject[]> {
  const { data, error } = await db.from("video_projects").select("*").order("updated_at", { ascending: false }).limit(1000);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  const exports = await exportsOf(db, rows.map((r) => String(r.id)));
  return rows.map((row) => projectFromRow(row, exports.get(String(row.id)) ?? []));
}

export async function loadProject(db: SupabaseClient, id: string): Promise<{ project: VideoProject; storedHash: string } | null> {
  const { data, error } = await db.from("video_projects").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const exports = await exportsOf(db, [id]);
  return { project: projectFromRow(data as Row, exports.get(id) ?? []), storedHash: String((data as Row).project_hash) };
}

export async function loadEvents(db: SupabaseClient, id: string): Promise<VideoEvent[]> {
  const { data, error } = await db.from("video_events").select("*").eq("project_id", id).order("at", { ascending: true }).limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((row) => ({
    id: String(row.id),
    projectId: String(row.project_id),
    at: String(row.at),
    by: String(row.actor_handle),
    kind: row.kind as VideoEvent["kind"],
    from: (row.from_status as VideoStatus | null) ?? null,
    to: (row.to_status as VideoStatus | null) ?? null,
    note: (row.note as string | null) ?? null,
    hash: (row.hash as string | null) ?? null,
  }));
}

export type VideoServerResult = VideoApplyResult | { ok: false; code: "conflict" | "db_error" | "duplicate_brief"; message: Bilingual };

/** One action on the database: the same rules as the demo, then the rows. */
export async function applyVideoOnServer(db: SupabaseClient, actor: Actor, action: VideoAction, now: Date = new Date()): Promise<VideoServerResult> {
  const tracks = await loadTracks(db);
  let board: VideoProject[];
  let storedHash: string | null = null;
  if (action.action === "create" || action.action === "duplicate") {
    const { data, error } = await db.from("video_projects").select("id, status").neq("status", "archived");
    if (error) throw new Error(error.message);
    board = ((data ?? []) as Row[]).map((r) => ({ id: String(r.id), status: r.status }) as unknown as VideoProject);
  } else {
    board = [];
  }
  if (action.action !== "create") {
    const loaded = await loadProject(db, action.id);
    if (!loaded) return applyVideoAction([], action, actor.handle, now, tracks);
    storedHash = loaded.storedHash;
    board = [loaded.project, ...board.filter((p) => p.id !== loaded.project.id)];
  }
  const result = applyVideoAction(board, action, actor.handle, now, tracks);
  if (!result.ok) return result;
  const project = result.project;

  if (result.created) {
    const { error } = await db.from("video_projects").insert({
      id: project.id,
      created_by: actor.userId,
      created_by_handle: actor.handle,
      created_at: project.createdAt,
      ...projectColumns(project, tracks),
    });
    if (error) {
      if (/brief_ref/.test(error.message)) return { ok: false, code: "duplicate_brief", message: { en: "A video from this brief already exists. Open it from the board.", es: "Ya existe un video de este brief. Ábrelo desde el tablero." } };
      return { ok: false, code: "db_error", message: { en: "It could not be saved. Nothing changed.", es: "No se pudo guardar. No cambió nada." } };
    }
  } else {
    if (action.action === "add_export") {
      const record = project.exports[0]!;
      const { error: exportError } = await db.from("video_exports").insert({
        id: record.id,
        project_id: project.id,
        path: record.ref,
        hash: record.hash,
        width: record.width,
        height: record.height,
        duration: record.duration,
        bytes: record.bytes,
        created_by: actor.userId,
        created_by_handle: actor.handle,
        created_at: record.at,
      });
      if (exportError) return { ok: false, code: "db_error", message: { en: "The export could not be recorded.", es: "No se pudo registrar la exportación." } };
    }
    const columns: Record<string, unknown> = projectColumns(project, tracks);
    if (action.action === "approve") columns.approved_by = actor.userId;
    const { data, error } = await db.from("video_projects").update(columns).eq("id", project.id).eq("project_hash", storedHash!).select("id");
    if (error) return { ok: false, code: "db_error", message: { en: `It could not be saved: ${error.message.slice(0, 120)}`, es: `No se pudo guardar: ${error.message.slice(0, 120)}` } };
    if (!data || (data as Row[]).length === 0) return { ok: false, code: "conflict", message: CONFLICT };
  }
  if (result.events.length > 0) {
    await db.from("video_events").insert(
      result.events.map((e) => ({
        project_id: e.projectId,
        at: e.at,
        actor: actor.userId,
        actor_handle: actor.handle,
        kind: e.kind,
        from_status: e.from ?? null,
        to_status: e.to ?? null,
        note: e.note ? e.note.slice(0, 1000) : null,
        hash: e.hash ?? null,
      })),
    );
  }
  return result;
}

/** A track in the library, with who confirmed the rights to it. */
export async function addTrack(db: SupabaseClient, actor: Actor, track: { id: string; name: string; path: string; mediaType: string; bytes: number; duration: number | null; rightsNote: string }): Promise<MusicTrack> {
  const { data, error } = await db
    .from("video_music")
    .insert({
      id: track.id,
      name: track.name.slice(0, 160),
      path: track.path,
      media_type: track.mediaType,
      bytes: track.bytes,
      duration: track.duration,
      rights_confirmed_by: actor.userId,
      rights_confirmed_by_handle: actor.handle,
      rights_note: track.rightsNote.slice(0, 300),
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`video_music: ${error?.message ?? "none"}`);
  return trackFromRow(data as Row);
}

export async function removeTrack(db: SupabaseClient, id: string, now: Date = new Date()): Promise<boolean> {
  const { data, error } = await db.from("video_music").update({ removed_at: now.toISOString() }).eq("id", id).is("removed_at", null).select("id");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).length > 0;
}

/** Short-lived links (an hour) to the files a screen shows: uploads only (samples are public files). */
export async function signedLinks(db: SupabaseClient, paths: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const path of [...new Set(paths)]) {
    if (!/^[a-z0-9_]+\/[a-z0-9_.-]+$/.test(path)) continue;
    const { data } = await db.storage.from(VIDEO_BUCKET).createSignedUrl(path, 3600);
    if (data?.signedUrl) out[path] = data.signedUrl;
  }
  return out;
}
