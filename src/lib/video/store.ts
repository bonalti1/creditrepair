"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured } from "../supabase/config";
import { can, deniedReason, type Capability } from "../staff/permissions";
import { useStaffLocale } from "../staff/i18n/StaffLocale";
import { useViewer } from "../staff/useStaff";
import { draftVideoPlan, type VideoAssistRequest, type VideoAssistResult } from "./assist";
import { clearBlobs, getBlob, putBlob } from "./blobStore";
import { buildDemoVideos, SAMPLE_MEDIA, type DemoVideoStudio } from "./demo";
import type { ExportOutcome } from "./exporter";
import { checkStudioFile, STUDIO_FILE_TEXT, type StudioKind } from "./files";
import { browserAudioDuration, readMediaInfo } from "./mediaInfo";
import { applyVideoAction, VIDEO_ACTION_CAPABILITY, type VideoAction } from "./rules";
import { newVideoId } from "./timeline";
import type { Bilingual, CaptionCue, MediaItem, MusicTrack, VideoEvent, VideoProject } from "./types";
import { VIDEO_LIMITS } from "./types";

// The Video Studio's data for the screens. With a database: /api/staff/video
// (and /files, /assist, /transcribe), files in the private bucket. In the
// demo: this browser keeps the board (localStorage) and the files
// (IndexedDB), starting from the invented videos and the bundled sample
// clips, and applies the same rules with the same capability checks as the
// routes. Nothing in the demo is uploaded or sent anywhere.

export const VIDEO_KEY = "bonalti.video.v1";

/** Fired after any change to a video, so the menu's red circle (badge.ts) counts again. */
export const VIDEO_CHANGED_EVENT = "credalti:video-changed";

function announce() {
  try {
    window.dispatchEvent(new Event(VIDEO_CHANGED_EVENT));
  } catch {
    // No window (tests).
  }
}

export type VideoActResult = { ok: true; project?: VideoProject } | { ok: false; message: Bilingual };

const msg = (en: string, es: string): Bilingual => ({ en, es });

function readLocal(): DemoVideoStudio {
  try {
    const raw = window.localStorage.getItem(VIDEO_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoVideoStudio;
      if (Array.isArray(parsed.projects) && Array.isArray(parsed.tracks)) return { projects: parsed.projects, events: parsed.events ?? [], tracks: parsed.tracks };
    }
  } catch {
    // Unreadable: start again from the demo.
  }
  return buildDemoVideos(new Date());
}

function writeLocal(next: DemoVideoStudio): boolean {
  try {
    window.localStorage.setItem(VIDEO_KEY, JSON.stringify({ ...next, events: next.events.slice(-2000) }));
    return true;
  } catch {
    return false;
  }
}

/** The demo's board as this browser keeps it, for the menu's red circle (demo only). */
export function readDemoVideoBoard(): VideoProject[] {
  return readLocal().projects;
}

export async function resetDemoVideos(): Promise<void> {
  try {
    window.localStorage.removeItem(VIDEO_KEY);
  } catch {
    // Nothing to forget.
  }
  await clearBlobs();
}

/** Object URLs of this browser's files, made once per visit. */
const objectUrls = new Map<string, string>();

export function useVideoStudio(projectId?: string) {
  const live = isSupabaseConfigured();
  const { viewer, ready: viewerReady } = useViewer();
  const { locale } = useStaffLocale();
  const role = viewer?.role ?? null;
  const handle = viewer?.handle ?? "demo";
  const [projects, setProjects] = useState<VideoProject[] | null>(null);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [events, setEvents] = useState<VideoEvent[]>([]);
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState(false);
  const urlsRef = useRef(fileUrls);
  urlsRef.current = fileUrls;

  const reload = useCallback(async () => {
    if (!live) {
      if (!viewerReady) return;
      const local = readLocal();
      setProjects(local.projects);
      setTracks(local.tracks);
      setEvents(projectId ? local.events.filter((e) => e.projectId === projectId) : []);
      return;
    }
    try {
      const res = await fetch(projectId ? `/api/staff/video?id=${encodeURIComponent(projectId)}` : "/api/staff/video", { cache: "no-store" });
      if (!res.ok) {
        setLoadError(true);
        setProjects((prev) => prev ?? []);
        return;
      }
      const body = (await res.json()) as { projects?: VideoProject[]; project?: VideoProject; tracks?: MusicTrack[]; events?: VideoEvent[]; fileUrls?: Record<string, string> };
      setLoadError(false);
      if (body.project) setProjects((prev) => [body.project!, ...(prev ?? []).filter((p) => p.id !== body.project!.id)]);
      else setProjects(body.projects ?? []);
      setTracks(body.tracks ?? []);
      setEvents(body.events ?? []);
      if (body.fileUrls) setFileUrls((prev) => ({ ...prev, ...body.fileUrls }));
    } catch {
      setLoadError(true);
      setProjects((prev) => prev ?? []);
    }
  }, [live, projectId, viewerReady]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const refuse = useCallback((capability: Capability): VideoActResult | null => (can(role, capability) ? null : { ok: false, message: { en: deniedReason(capability, "en"), es: deniedReason(capability, "es") } }), [role]);

  const post = useCallback(async (url: string, body: unknown): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> => {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    } catch {
      return { ok: false, status: 0, body: { message: msg("No connection. Nothing changed.", "Sin conexión. No cambió nada.") } };
    }
  }, []);

  const failed = (body: Record<string, unknown>): VideoActResult => ({
    ok: false,
    message: (body.message as Bilingual | undefined) ?? (typeof body.code === "string" && STUDIO_FILE_TEXT[body.code] ? STUDIO_FILE_TEXT[body.code]! : msg(typeof body.error === "string" ? body.error : "It could not be saved.", "No se pudo guardar.")),
  });

  /** One action, with the same capability check as the route. */
  const act = useCallback(
    async (action: VideoAction): Promise<VideoActResult> => {
      const denied = refuse(VIDEO_ACTION_CAPABILITY[action.action]);
      if (denied) return denied;
      if (live) {
        const res = await post("/api/staff/video", action);
        if (res.ok && res.body.project) setProjects((prev) => [res.body.project as VideoProject, ...(prev ?? []).filter((p) => p.id !== (res.body.project as VideoProject).id)]);
        if (!res.ok) await reload();
        else announce();
        return res.ok ? { ok: true, project: res.body.project as VideoProject } : failed(res.body);
      }
      const local = readLocal();
      const result = applyVideoAction(local.projects, action, handle, new Date(), local.tracks);
      if (!result.ok) return { ok: false, message: result.message };
      local.projects = result.created ? [result.project, ...local.projects] : local.projects.map((p) => (p.id === result.project.id ? result.project : p));
      local.events = [...local.events, ...result.events];
      if (!writeLocal(local)) return { ok: false, message: msg("This browser's storage is full. Nothing changed.", "El almacenamiento de este navegador está lleno. No cambió nada.") };
      announce();
      await reload();
      return { ok: true, project: result.project };
    },
    [handle, live, post, refuse, reload],
  );

  /** The file behind a reference: a bundled sample, this browser's store (demo), or storage (a signed link). */
  const getFile = useCallback(
    async (ref: string): Promise<Blob | null> => {
      try {
        if (ref.startsWith("/video-studio/")) {
          const res = await fetch(ref);
          return res.ok ? await res.blob() : null;
        }
        if (ref.startsWith("idb:")) return await getBlob(ref);
        let url: string | undefined = urlsRef.current[ref];
        if (!url && live) {
          const res = await post("/api/staff/video/files", { action: "sign", paths: [ref] });
          url = (res.body.fileUrls as Record<string, string> | undefined)?.[ref];
          const signed = url;
          if (signed) setFileUrls((prev) => ({ ...prev, [ref]: signed }));
        }
        if (!url) return null;
        const res = await fetch(url);
        return res.ok ? await res.blob() : null;
      } catch {
        return null;
      }
    },
    [live, post],
  );

  /** A link the preview can play: the sample's path, an object URL (demo), or a signed link. */
  const urlFor = useCallback(
    async (ref: string): Promise<string | null> => {
      if (ref.startsWith("/video-studio/")) return ref;
      if (ref.startsWith("idb:")) {
        const known = objectUrls.get(ref);
        if (known) return known;
        const blob = await getBlob(ref);
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        objectUrls.set(ref, url);
        return url;
      }
      if (urlsRef.current[ref]) return urlsRef.current[ref]!;
      if (!live) return null;
      const res = await post("/api/staff/video/files", { action: "sign", paths: [ref] });
      const url = (res.body.fileUrls as Record<string, string> | undefined)?.[ref] ?? null;
      if (url) setFileUrls((prev) => ({ ...prev, [ref]: url }));
      return url;
    },
    [live, post],
  );

  /** Upload one file straight to storage with a one-time link (database only). */
  const uploadToStorage = useCallback(
    async (purpose: "media" | "export" | "music", projectIdFor: string | null, file: Blob, mediaType: string): Promise<{ ok: true; fileId: string; path: string } | { ok: false; message: Bilingual }> => {
      const ticket = await post("/api/staff/video/files", { action: "upload_url", purpose, projectId: projectIdFor, mediaType, bytes: file.size });
      if (!ticket.ok) return failed(ticket.body) as { ok: false; message: Bilingual };
      try {
        const put = await fetch(String(ticket.body.signedUrl), { method: "PUT", headers: { "content-type": mediaType, "x-upsert": "false" }, body: file });
        if (!put.ok) return { ok: false, message: STUDIO_FILE_TEXT.upload_failed! };
      } catch {
        return { ok: false, message: STUDIO_FILE_TEXT.upload_failed! };
      }
      return { ok: true, fileId: String(ticket.body.fileId), path: String(ticket.body.path) };
    },
    [post],
  );

  /** Add a clip or picture to a video: its type from its first bytes, its size and length read here. */
  const addMediaFile = useCallback(
    async (project: VideoProject, file: File): Promise<VideoActResult> => {
      const denied = refuse("content.edit");
      if (denied) return denied;
      const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
      const kind: StudioKind = file.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(file.name) ? "image" : "video";
      const check = checkStudioFile(head, file.size, kind);
      if (!check.ok) return { ok: false, message: STUDIO_FILE_TEXT[check.code]! };
      if (project.media.length >= VIDEO_LIMITS.mediaPerProject || project.media.reduce((s, m) => s + m.bytes, 0) + file.size > VIDEO_LIMITS.projectBytes) return { ok: false, message: STUDIO_FILE_TEXT.project_full! };
      const info = await readMediaInfo(file, kind, check.mediaType);
      if (!info) return { ok: false, message: msg("This file can't be read as a clip or a picture.", "Este archivo no se puede leer como clip o foto.") };
      const name = file.name.slice(0, 160) || check.mediaType;
      if (live) {
        const up = await uploadToStorage("media", project.id, file, check.mediaType);
        if (!up.ok) return up;
        const res = await post("/api/staff/video/files", { action: "confirm_media", projectId: project.id, fileId: up.fileId, path: up.path, name, kind, duration: kind === "video" ? info.duration : null, width: info.width, height: info.height, hasAudio: info.hasAudio });
        if (res.body.fileUrls) setFileUrls((prev) => ({ ...prev, ...(res.body.fileUrls as Record<string, string>) }));
        await reload();
        return res.ok ? { ok: true, project: res.body.project as VideoProject } : failed(res.body);
      }
      const id = newVideoId("md");
      const ref = `idb:${id}`;
      await putBlob(ref, file);
      const item: MediaItem = { id, kind, name, mediaType: check.mediaType, bytes: file.size, duration: info.duration, width: info.width, height: info.height, hasAudio: info.hasAudio, source: "upload", ref, addedBy: handle, addedAt: new Date().toISOString() };
      return act({ action: "update", id: project.id, patch: { media: [...project.media, item] } });
    },
    [act, handle, live, post, refuse, reload, uploadToStorage],
  );

  /** The bundled sample clips, for trying the editor (labelled as samples). */
  const addSamples = useCallback(
    async (project: VideoProject): Promise<VideoActResult> => {
      const missing = SAMPLE_MEDIA.filter((m) => !project.media.some((x) => x.id === m.id));
      if (missing.length === 0) return { ok: true, project };
      return act({ action: "update", id: project.id, patch: { media: [...project.media, ...missing] } });
    },
    [act],
  );

  /** Keep an export: in storage and recorded with its hash (database), or in this browser (demo). */
  const saveExport = useCallback(
    async (project: VideoProject, outcome: ExportOutcome): Promise<VideoActResult> => {
      const denied = refuse("content.edit");
      if (denied) return denied;
      if (live) {
        const up = await uploadToStorage("export", project.id, outcome.blob, "video/mp4");
        if (!up.ok) return up;
        const res = await post("/api/staff/video/files", { action: "confirm_export", projectId: project.id, fileId: up.fileId, path: up.path, hash: outcome.hash, width: outcome.width, height: outcome.height, duration: outcome.duration });
        if (res.body.fileUrls) setFileUrls((prev) => ({ ...prev, ...(res.body.fileUrls as Record<string, string>) }));
        await reload();
        return res.ok ? { ok: true, project: res.body.project as VideoProject } : failed(res.body);
      }
      const id = newVideoId("ex");
      const ref = `idb:${id}`;
      const kept = await putBlob(ref, outcome.blob);
      const result = await act({ action: "add_export", id: project.id, export: { id, at: new Date().toISOString(), by: handle, hash: outcome.hash, width: outcome.width, height: outcome.height, duration: outcome.duration, bytes: outcome.blob.size, ref } });
      return result.ok && kept === "memory" ? { ok: true, project: result.project } : result;
    },
    [act, handle, live, post, refuse, reload, uploadToStorage],
  );

  /** A track for the music library: only with the person's confirmation that the team has the rights. */
  const addTrack = useCallback(
    async (file: File, input: { name: string; rightsConfirmed: boolean; rightsNote: string }): Promise<VideoActResult> => {
      const denied = refuse("content.edit");
      if (denied) return denied;
      if (!input.rightsConfirmed) return { ok: false, message: STUDIO_FILE_TEXT.no_rights! };
      const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
      const check = checkStudioFile(head, file.size, "audio");
      if (!check.ok) return { ok: false, message: STUDIO_FILE_TEXT[check.code]! };
      const url = URL.createObjectURL(file);
      const duration = await browserAudioDuration(url);
      URL.revokeObjectURL(url);
      const name = (input.name.trim() || file.name).slice(0, 160);
      if (live) {
        const up = await uploadToStorage("music", null, file, check.mediaType);
        if (!up.ok) return up;
        const res = await post("/api/staff/video/files", { action: "confirm_music", fileId: up.fileId, path: up.path, name, duration, rightsConfirmed: true, rightsNote: input.rightsNote.slice(0, 300) });
        await reload();
        return res.ok ? { ok: true } : failed(res.body);
      }
      const id = newVideoId("mu");
      const ref = `idb:${id}`;
      await putBlob(ref, file);
      const local = readLocal();
      const now = new Date().toISOString();
      local.tracks = [{ id, name, mediaType: check.mediaType, bytes: file.size, duration, source: "upload", ref, rights: { confirmedBy: handle, confirmedAt: now, note: input.rightsNote.slice(0, 300) }, addedBy: handle, addedAt: now, removedAt: null }, ...local.tracks];
      writeLocal(local);
      await reload();
      return { ok: true };
    },
    [handle, live, post, refuse, reload, uploadToStorage],
  );

  const removeTrack = useCallback(
    async (id: string): Promise<VideoActResult> => {
      const denied = refuse("content.edit");
      if (denied) return denied;
      if (live) {
        const res = await post("/api/staff/video/files", { action: "remove_music", id });
        await reload();
        return res.ok ? { ok: true } : failed(res.body);
      }
      const local = readLocal();
      local.tracks = local.tracks.map((t) => (t.id === id ? { ...t, removedAt: new Date().toISOString() } : t));
      writeLocal(local);
      await reload();
      return { ok: true };
    },
    [live, post, refuse, reload],
  );

  /** Alti's script and shot list from a brief: the server's (Claude with a key, else templates) or, in the demo, the templates here. */
  const assist = useCallback(
    async (request: VideoAssistRequest): Promise<VideoAssistResult | { error: Bilingual }> => {
      const denied = refuse("content.edit");
      if (denied && !denied.ok) return { error: denied.message };
      if (!live) return draftVideoPlan(request, null);
      const res = await post("/api/staff/video/assist", request);
      return res.ok ? (res.body as unknown as VideoAssistResult) : { error: (res.body.message as Bilingual | undefined) ?? msg("Alti could not write right now.", "Alti no pudo escribir ahora.") };
    },
    [live, post, refuse],
  );

  const [transcribeOn, setTranscribeOn] = useState(false);
  useEffect(() => {
    if (!live || !can(role, "content.edit")) return;
    fetch("/api/staff/video/transcribe", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { configured: false }))
      .then((body: { configured?: boolean }) => setTranscribeOn(Boolean(body.configured)))
      .catch(() => setTranscribeOn(false));
  }, [live, role]);

  /** Automatic captions from the clips' sound (only with a transcription key on the server). */
  const transcribe = useCallback(
    async (wav: Blob, duration: number, language: "en" | "es"): Promise<{ ok: true; cues: CaptionCue[] } | { ok: false; message: Bilingual }> => {
      if (!transcribeOn) return { ok: false, message: msg("Automatic captions are not connected.", "Los subtítulos automáticos no están conectados.") };
      const form = new FormData();
      form.set("file", wav, "speech.wav");
      form.set("language", language);
      form.set("duration", String(duration));
      try {
        const res = await fetch("/api/staff/video/transcribe", { method: "POST", body: form });
        const body = (await res.json().catch(() => ({}))) as { cues?: CaptionCue[] };
        return res.ok && body.cues ? { ok: true, cues: body.cues } : { ok: false, message: msg("The captions service did not answer. Type or paste them instead.", "El servicio de subtítulos no respondió. Escríbelos o pégalos.") };
      } catch {
        return { ok: false, message: msg("No connection.", "Sin conexión.") };
      }
    },
    [transcribeOn],
  );

  return useMemo(
    () => ({
      live,
      ready: projects !== null && viewerReady,
      loadError,
      viewer,
      role,
      locale,
      handle,
      projects: projects ?? [],
      project: projectId ? (projects ?? []).find((p) => p.id === projectId) ?? null : null,
      tracks,
      events,
      act,
      getFile,
      urlFor,
      addMediaFile,
      addSamples,
      saveExport,
      addTrack,
      removeTrack,
      assist,
      transcribeOn,
      transcribe,
      reload,
    }),
    [live, projects, viewerReady, loadError, viewer, role, locale, handle, projectId, tracks, events, act, getFile, urlFor, addMediaFile, addSamples, saveExport, addTrack, removeTrack, assist, transcribeOn, transcribe, reload],
  );
}

export type VideoStudio = ReturnType<typeof useVideoStudio>;
