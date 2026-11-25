import type { Capability } from "../staff/permissions";
import { videoApprovalBlockers } from "./check";
import { approvalHolds, currentExport, projectHash } from "./hash";
import { cleanEdit, newEdit, newVideoId } from "./timeline";
import {
  FORMAT_ASPECT,
  VIDEO_CHECKLIST_KEYS,
  VIDEO_FORMATS,
  VIDEO_LIMITS,
  type Bilingual,
  type ConsentRecord,
  type MediaItem,
  type MusicTrack,
  type VideoBrief,
  type VideoEvent,
  type VideoExport,
  type VideoPlan,
  type VideoProject,
  type VideoStatus,
} from "./types";

export type { Bilingual } from "./types";

// What can happen to a video, as pure functions: the demo (this browser) and
// the server (server.ts, on the database) apply the same rules, and the
// routes ask the capability first (VIDEO_ACTION_CAPABILITY). The board:
//
//   Planned → Editing → Ready (waiting for approval) → Approved → Published
//
// - Ready needs an export of the video as it is now (the file to approve).
// - Approval needs content.approve, no blocking issue, the checklist done and
//   that export: it stores the project's hash. Any change to the edit, the
//   media or the words afterwards drops it and the video goes back to Editing.
// - Published means handed to a Content piece (its id is kept); the Content
//   piece goes through the existing publishing. A published video no longer
//   changes (duplicate it to make another).

export type VideoAction =
  | { action: "create"; id?: string; title: string; language: VideoProject["language"]; brief: Partial<VideoBrief> & { format: VideoBrief["format"] }; plan?: Partial<VideoPlan> }
  | { action: "update"; id: string; patch: VideoPatch }
  | { action: "move"; id: string; to: VideoStatus }
  | { action: "add_export"; id: string; export: VideoExport }
  | { action: "submit"; id: string }
  | { action: "approve"; id: string }
  | { action: "request_changes"; id: string; note: string }
  | { action: "link_piece"; id: string; pieceId: string }
  | { action: "publish"; id: string; pieceId: string }
  | { action: "duplicate"; id: string; newId?: string };

export type VideoPatch = Partial<Pick<VideoProject, "title" | "language" | "brief" | "plan" | "media" | "edit" | "checklist" | "clientAppears" | "consents" | "owner">>;

/** The capability each action needs. The server asks requireCapability for it before anything else. */
export const VIDEO_ACTION_CAPABILITY: Record<VideoAction["action"], Capability> = {
  create: "content.edit",
  update: "content.edit",
  move: "content.edit",
  add_export: "content.edit",
  submit: "content.edit",
  approve: "content.approve",
  request_changes: "content.approve",
  link_piece: "content.edit",
  publish: "content.edit",
  duplicate: "content.edit",
};

export type VideoRuleCode = "not_found" | "bad_input" | "not_allowed_move" | "no_export" | "blocked" | "not_ready" | "not_approved" | "published" | "too_many";

export type VideoApplyResult =
  | { ok: true; project: VideoProject; events: VideoEvent[]; created?: boolean }
  | { ok: false; code: VideoRuleCode; message: Bilingual };

const FAIL: Record<VideoRuleCode, Bilingual> = {
  not_found: { en: "That video no longer exists.", es: "Ese video ya no existe." },
  bad_input: { en: "Something in the form is not valid.", es: "Algo del formulario no es válido." },
  not_allowed_move: { en: "A video can't move there from where it is.", es: "El video no puede pasar ahí desde donde está." },
  no_export: { en: "Export the MP4 of this version first: the file that is approved is the file that goes out.", es: "Primero exporta el MP4 de esta versión: el archivo aprobado es el que se publica." },
  blocked: { en: "It can't be approved yet: fix the blocking issues and finish the checklist.", es: "Todavía no se puede aprobar: corrige los problemas y termina la lista." },
  not_ready: { en: "Only a video that is ready (waiting for approval) can be approved or sent back.", es: "Solo un video listo (esperando aprobación) se puede aprobar o devolver." },
  not_approved: { en: "Only an approved video, as it was approved, can be handed to Content.", es: "Solo un video aprobado, tal como se aprobó, se puede pasar a Contenido." },
  published: { en: "It's already handed to Content. Make a copy to change it.", es: "Ya se pasó a Contenido. Haz una copia para cambiarlo." },
  too_many: { en: "There are too many videos or files. Archive old ones first.", es: "Hay demasiados videos o archivos. Archiva los viejos primero." },
};

const fail = (code: VideoRuleCode): VideoApplyResult => ({ ok: false, code, message: FAIL[code] });

/** Moves a person may make with "move" (export, approval and publishing have their own actions). */
const MOVES: Partial<Record<VideoStatus, readonly VideoStatus[]>> = {
  planned: ["editing", "archived"],
  editing: ["planned", "archived"],
  ready: ["editing", "archived"],
  approved: ["archived"],
  published: ["archived"],
  archived: ["planned"],
};

export function canMoveVideo(from: VideoStatus, to: VideoStatus): boolean {
  return MOVES[from]?.includes(to) ?? false;
}

const clip = (value: unknown, max: number) => String(value ?? "").replace(/\u0000/g, "").slice(0, max);
const ID = /^[a-z]{2}_[a-z0-9]{6,40}$/;

export function cleanBrief(brief: Partial<VideoBrief> | undefined, fallbackTitle = ""): VideoBrief {
  return {
    title: clip(brief?.title ?? fallbackTitle, 120).trim(),
    goal: clip(brief?.goal, 300).trim(),
    hook: clip(brief?.hook, 200).trim(),
    script: clip(brief?.script, 4000).trim(),
    format: VIDEO_FORMATS.includes(brief?.format as VideoBrief["format"]) ? (brief!.format as VideoBrief["format"]) : "reel",
    source: brief?.source === "ads" ? "ads" : "studio",
    ref: brief?.ref ? clip(brief.ref, 80).trim() || null : null,
  };
}

export function cleanPlan(plan: Partial<VideoPlan> | undefined, current?: VideoPlan): VideoPlan {
  const base: VideoPlan = current ?? { script: "", shots: [], postCaption: "", cta: "", aiDraft: false };
  if (!plan) return base;
  const shots = Array.isArray(plan.shots)
    ? plan.shots.slice(0, 30).map((s) => ({ id: clip(s?.id, 48) || newVideoId("sh"), seconds: Math.min(60, Math.max(0.5, Number(s?.seconds) || 3)), shot: clip(s?.shot, 300), onScreen: clip(s?.onScreen, VIDEO_LIMITS.textMax) }))
    : base.shots;
  return {
    script: plan.script !== undefined ? clip(plan.script, 6000) : base.script,
    shots,
    postCaption: plan.postCaption !== undefined ? clip(plan.postCaption, 2200) : base.postCaption,
    cta: plan.cta !== undefined ? clip(plan.cta, 60) : base.cta,
    aiDraft: plan.aiDraft !== undefined ? Boolean(plan.aiDraft) : base.aiDraft,
  };
}

/** Where a file of a video may be: a bundled sample, this browser's store (demo), or the video's own folder in storage. */
export function mediaRefAllowed(ref: string, projectId: string): boolean {
  if (/^\/video-studio\/samples\/[a-z0-9-]+\.(webm|jpg|ogg)$/.test(ref)) return true;
  if (/^idb:[a-z0-9_]{6,60}$/.test(ref)) return true;
  return ref.startsWith(`${projectId}/`) && /^[a-z0-9_]+\/[a-z0-9_.-]+$/.test(ref) && ref.length <= 300;
}

function cleanMedia(list: unknown, projectId: string): MediaItem[] | null {
  if (!Array.isArray(list) || list.length > VIDEO_LIMITS.mediaPerProject) return null;
  const out: MediaItem[] = [];
  for (const m of list as MediaItem[]) {
    if (!m || typeof m !== "object" || typeof m.id !== "string" || !["video", "image"].includes(m.kind)) return null;
    if (typeof m.ref !== "string" || !mediaRefAllowed(m.ref, projectId)) return null;
    out.push({
      id: m.id.slice(0, 48),
      kind: m.kind,
      name: clip(m.name, 160) || m.id,
      mediaType: clip(m.mediaType, 60),
      bytes: Math.max(0, Math.round(Number(m.bytes) || 0)),
      duration: m.kind === "video" && Number.isFinite(m.duration) ? Math.max(0, Number(m.duration)) : null,
      width: Math.max(1, Math.round(Number(m.width) || 1)),
      height: Math.max(1, Math.round(Number(m.height) || 1)),
      hasAudio: typeof m.hasAudio === "boolean" ? m.hasAudio : null,
      source: m.source === "sample" ? "sample" : "upload",
      ref: m.ref,
      addedBy: clip(m.addedBy, 40),
      addedAt: clip(m.addedAt, 40),
    });
  }
  if (out.reduce((sum, m) => sum + m.bytes, 0) > VIDEO_LIMITS.projectBytes) return null;
  return out;
}

function cleanConsents(list: unknown, by: string, now: Date): ConsentRecord[] | null {
  if (!Array.isArray(list) || list.length > VIDEO_LIMITS.consents) return null;
  const out: ConsentRecord[] = [];
  for (const c of list as ConsentRecord[]) {
    const name = clip(c?.name, 120).trim();
    const where = clip(c?.where, 300).trim();
    const signedOn = typeof c?.signedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.signedOn) ? c.signedOn : null;
    if (name.length < 2 || where.length < 2 || !signedOn || signedOn > now.toISOString().slice(0, 10)) return null;
    out.push({ id: clip(c.id, 48) || newVideoId("cn"), name, signedOn, where, recordedBy: clip(c.recordedBy, 40) || by, recordedAt: clip(c.recordedAt, 40) || now.toISOString() });
  }
  return out;
}

export function newProject(input: Extract<VideoAction, { action: "create" }>, by: string, now: Date): VideoProject | null {
  const title = clip(input.title, 120).trim();
  if (title.length < 2 || (input.language !== "en" && input.language !== "es")) return null;
  const brief = cleanBrief({ ...input.brief, title: input.brief.title || title }, title);
  const id = input.id && ID.test(input.id) ? input.id : newVideoId();
  const plan = cleanPlan({ script: brief.script, postCaption: "", cta: input.language === "es" ? "Empezar mi revisión" : "Start my review", ...input.plan });
  return {
    id,
    title,
    status: "planned",
    language: input.language,
    brief,
    plan,
    media: [],
    edit: newEdit(FORMAT_ASPECT[brief.format], input.language),
    checklist: {},
    clientAppears: null,
    consents: [],
    exports: [],
    approval: null,
    changesNote: null,
    contentPieceId: null,
    owner: by,
    createdBy: by,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function event(project: VideoProject, by: string, now: Date, kind: VideoEvent["kind"], extra: Partial<VideoEvent> = {}): VideoEvent {
  return { id: newVideoId("ev"), projectId: project.id, at: now.toISOString(), by, kind, ...extra };
}

/** After a change: an approval or a "ready" that no longer matches the video goes back to Editing. */
function settle(before: VideoProject, after: VideoProject, by: string, now: Date, events: VideoEvent[]): VideoProject {
  if (projectHash(before) === projectHash(after)) return after;
  if (after.approval || after.status === "ready" || after.status === "approved") {
    const reset: VideoProject = { ...after, approval: null, status: "editing", checklist: after.approval ? {} : after.checklist };
    events.push(event(reset, by, now, "approval_reset", { from: before.status, to: "editing", hash: projectHash(reset) }));
    return reset;
  }
  // Planned becomes Editing once someone starts cutting.
  if (after.status === "planned" && after.edit.clips.length > 0) return { ...after, status: "editing" };
  return after;
}

/** Apply one action. `projects` is the whole board (create checks the size; duplicate copies). */
export function applyVideoAction(projects: readonly VideoProject[], action: VideoAction, by: string, now: Date, tracks: readonly MusicTrack[] = []): VideoApplyResult {
  if (action.action === "create") {
    if (projects.filter((p) => p.status !== "archived").length >= VIDEO_LIMITS.projects) return fail("too_many");
    const project = newProject(action, by, now);
    if (!project) return fail("bad_input");
    return { ok: true, project, events: [event(project, by, now, "created", { to: "planned", note: project.brief.source === "ads" ? `brief:${project.brief.ref ?? "ads"}` : null })], created: true };
  }
  const current = projects.find((p) => p.id === action.id);
  if (!current) return fail("not_found");
  const events: VideoEvent[] = [];
  const stamp = (p: VideoProject): VideoProject => ({ ...p, updatedAt: now.toISOString() });

  switch (action.action) {
    case "update": {
      if (current.status === "published" || current.status === "archived") return fail("published");
      const patch = action.patch;
      const next: VideoProject = { ...current };
      if (patch.title !== undefined) {
        const title = clip(patch.title, 120).trim();
        if (title.length < 2) return fail("bad_input");
        next.title = title;
      }
      if (patch.language !== undefined) {
        if (patch.language !== "en" && patch.language !== "es") return fail("bad_input");
        next.language = patch.language;
      }
      if (patch.brief !== undefined) next.brief = cleanBrief({ ...current.brief, ...patch.brief }, current.title);
      if (patch.plan !== undefined) {
        next.plan = cleanPlan(patch.plan, current.plan);
        // Once a person edits Alti's script or shots, they are the person's.
        if (patch.plan.aiDraft === undefined && (next.plan.script !== current.plan.script || JSON.stringify(next.plan.shots) !== JSON.stringify(current.plan.shots))) next.plan = { ...next.plan, aiDraft: false };
      }
      if (patch.media !== undefined) {
        const media = cleanMedia(patch.media, current.id);
        if (!media) return fail("too_many");
        next.media = media;
      }
      if (patch.edit !== undefined) {
        const edit = cleanEdit(patch.edit, current.edit.aspect);
        // Every clip on the timeline points at media the project has.
        const ids = new Set((patch.media !== undefined ? next.media : current.media).map((m) => m.id));
        if (edit.clips.some((c) => !ids.has(c.mediaId))) return fail("bad_input");
        next.edit = edit;
      } else if (patch.media !== undefined) {
        const ids = new Set(next.media.map((m) => m.id));
        next.edit = { ...current.edit, clips: current.edit.clips.filter((c) => ids.has(c.mediaId)) };
      }
      if (patch.checklist !== undefined) {
        const checklist: VideoProject["checklist"] = { ...current.checklist };
        for (const key of VIDEO_CHECKLIST_KEYS) if (typeof patch.checklist[key] === "boolean") checklist[key] = patch.checklist[key];
        next.checklist = checklist;
      }
      if (patch.clientAppears !== undefined) next.clientAppears = patch.clientAppears === null ? null : Boolean(patch.clientAppears);
      if (patch.consents !== undefined) {
        const consents = cleanConsents(patch.consents, by, now);
        if (!consents) return fail("bad_input");
        next.consents = consents;
      }
      if (patch.owner !== undefined) next.owner = patch.owner ? clip(patch.owner, 40).toLowerCase() : null;
      events.push(event(next, by, now, "edited", { note: Object.keys(patch).join(",") }));
      return { ok: true, project: stamp(settle(current, next, by, now, events)), events };
    }
    case "move": {
      if (!canMoveVideo(current.status, action.to)) return fail("not_allowed_move");
      const next: VideoProject = { ...current, status: action.to };
      events.push(event(next, by, now, action.to === "archived" ? "archived" : current.status === "archived" ? "restored" : "moved", { from: current.status, to: action.to }));
      return { ok: true, project: stamp(next), events };
    }
    case "add_export": {
      if (current.status === "published" || current.status === "archived") return fail("published");
      const e = action.export;
      if (!e || typeof e.id !== "string" || !/^ex_[a-z0-9]{6,40}$/.test(e.id) || typeof e.ref !== "string" || !mediaRefAllowed(e.ref, current.id) || !/^[0-9a-f]{64}$/.test(e.hash) || !(e.bytes > 0) || !(e.duration > 0)) return fail("bad_input");
      const record: VideoExport = { id: e.id.slice(0, 48), at: now.toISOString(), by, hash: e.hash, width: Math.round(e.width), height: Math.round(e.height), duration: e.duration, bytes: Math.round(e.bytes), ref: e.ref.slice(0, 300) };
      const next: VideoProject = { ...current, exports: [record, ...current.exports].slice(0, VIDEO_LIMITS.exportsKept), status: current.status === "planned" ? "editing" : current.status };
      events.push(event(next, by, now, "exported", { hash: e.hash, note: `${record.width}x${record.height} ${record.duration}s` }));
      return { ok: true, project: stamp(next), events };
    }
    case "submit": {
      if (!["planned", "editing"].includes(current.status)) return fail("not_allowed_move");
      if (!currentExport(current)) return fail("no_export");
      const next: VideoProject = { ...current, status: "ready", changesNote: null };
      events.push(event(next, by, now, "submitted", { from: current.status, to: "ready", hash: projectHash(current) }));
      return { ok: true, project: stamp(next), events };
    }
    case "approve": {
      if (current.status !== "ready") return fail("not_ready");
      if (!currentExport(current)) return fail("no_export");
      if (videoApprovalBlockers(current, tracks).length > 0) return fail("blocked");
      const hash = projectHash(current);
      const next: VideoProject = { ...current, status: "approved", approval: { by, at: now.toISOString(), hash }, changesNote: null };
      events.push(event(next, by, now, "approved", { from: "ready", to: "approved", hash }));
      return { ok: true, project: stamp(next), events };
    }
    case "request_changes": {
      if (!["ready", "approved"].includes(current.status)) return fail("not_ready");
      const note = clip(action.note, 600).trim();
      if (note.length < 3) return fail("bad_input");
      const next: VideoProject = { ...current, status: "editing", approval: null, changesNote: note };
      events.push(event(next, by, now, "changes_requested", { from: current.status, to: "editing", note }));
      return { ok: true, project: stamp(next), events };
    }
    case "link_piece": {
      if (current.status !== "approved" || !approvalHolds(current)) return fail("not_approved");
      if (!ID.test(action.pieceId)) return fail("bad_input");
      const next: VideoProject = { ...current, contentPieceId: action.pieceId };
      events.push(event(next, by, now, "linked_piece", { note: action.pieceId }));
      return { ok: true, project: stamp(next), events };
    }
    case "publish": {
      if (current.status === "published") return fail("published");
      if (current.status !== "approved" || !approvalHolds(current)) return fail("not_approved");
      if (!ID.test(action.pieceId) || (current.contentPieceId && current.contentPieceId !== action.pieceId)) return fail("bad_input");
      const next: VideoProject = { ...current, status: "published", contentPieceId: action.pieceId };
      events.push(event(next, by, now, "published", { from: "approved", to: "published", note: action.pieceId, hash: current.approval!.hash }));
      return { ok: true, project: stamp(next), events };
    }
    case "duplicate": {
      if (projects.filter((p) => p.status !== "archived").length >= VIDEO_LIMITS.projects) return fail("too_many");
      const id = action.newId && ID.test(action.newId) ? action.newId : newVideoId();
      const copy: VideoProject = {
        ...current,
        id,
        title: clip(`${current.title} (2)`, 120),
        status: current.edit.clips.length > 0 ? "editing" : "planned",
        checklist: {},
        exports: [],
        approval: null,
        changesNote: null,
        contentPieceId: null,
        createdBy: by,
        owner: by,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      return { ok: true, project: copy, events: [event(copy, by, now, "created", { to: copy.status, note: `copy_of:${current.id}` })], created: true };
    }
  }
}

/** The videos in a column, newest change first. */
export function videoColumns(projects: readonly VideoProject[]): Record<VideoStatus, VideoProject[]> {
  const columns = {} as Record<VideoStatus, VideoProject[]>;
  for (const p of projects) (columns[p.status] ??= []).push(p);
  for (const list of Object.values(columns)) list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return columns;
}

/**
 * What needs a person in the Video Studio (the red circle on the menu): for
 * an approver, the videos waiting for approval; for an editor, the changes
 * asked of them (theirs, or nobody's) and the approved videos not yet handed
 * to Content.
 */
export function videoNeeds(projects: readonly VideoProject[], viewer: { approve: boolean; edit: boolean; handle: string | null }): { count: number; ready: number; changes: number; toHandOff: number } {
  const live = projects.filter((p) => p.status !== "archived");
  const ready = viewer.approve ? live.filter((p) => p.status === "ready").length : 0;
  const changes = viewer.edit ? live.filter((p) => p.status === "editing" && p.changesNote && (p.owner === null || p.owner === viewer.handle)).length : 0;
  const toHandOff = viewer.edit ? live.filter((p) => p.status === "approved").length : 0;
  return { count: ready + changes + toHandOff, ready, changes, toHandOff };
}
