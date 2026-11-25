import type { Capability } from "../staff/permissions";
import { approvalBlockers, checkPiece, blockingIssues } from "./check";
import { approvalHolds, pieceHash } from "./hash";
import {
  APPROVED_STATUSES,
  AUDIENCES,
  campaignCodeFor,
  CHANNELS,
  CHARACTERS,
  CHECKLIST_KEYS,
  CONTENT_TYPES,
  COPY_FIELDS,
  emptyCopy,
  LANGUAGES,
  THEMES,
  type Bilingual,
  type Channel,
  type ContentAsset,
  type ContentEvent,
  type ContentPiece,
  type ContentStatus,
} from "./types";

// What can happen to a piece, as pure functions: the demo (this browser) and
// the server (server.ts, on the database) apply the same rules, so the board
// behaves the same in both. The server checks the caller's capability first
// (ACTION_CAPABILITY) and the database's triggers hold the approval rule again.
//
// The lifecycle:
//   Idea → Planned → In production → Ready for review → Approved → Scheduled → Posted → Measured
//   with "Changes requested" (back from review) and Archived (from anywhere, restorable).
// Only someone with content.approve approves or asks for changes. An approval
// is tied to the hash of the exact words, links and files: any edit to them
// sends an approved or scheduled piece back to review.

export const MAX_PIECES = 2000;

export type ContentAction =
  | {
      action: "create";
      id?: string;
      title: string;
      type: ContentPiece["type"];
      channels: Channel[];
      language: ContentPiece["language"];
      audience: ContentPiece["audience"];
      theme: ContentPiece["theme"];
      goal?: string;
      owner?: string | null;
      dueDate?: string | null;
      templateId?: string | null;
      copy?: ContentPiece["copy"];
      characters?: ContentPiece["characters"];
      aiDraft?: boolean;
    }
  | { action: "update"; id: string; patch: PiecePatch }
  | { action: "move"; id: string; to: ContentStatus }
  | { action: "submit"; id: string }
  | { action: "approve"; id: string }
  | { action: "request_changes"; id: string; note: string }
  | { action: "record_post"; id: string; channel: Channel; url: string; postedAt?: string }
  | { action: "add_asset"; id: string; asset: ContentAsset }
  | { action: "update_asset"; id: string; assetId: string; altText: string }
  | { action: "remove_asset"; id: string; assetId: string }
  | { action: "duplicate"; id: string; newId?: string };

export type PiecePatch = Partial<
  Pick<ContentPiece, "title" | "type" | "channels" | "language" | "audience" | "theme" | "goal" | "characters" | "links" | "owner" | "dueDate" | "checklist" | "aiDraft">
> & { copy?: Partial<ContentPiece["copy"]> };

/** The capability each action needs. The server asks requireCapability for it before anything else. */
export const ACTION_CAPABILITY: Record<ContentAction["action"], Capability> = {
  create: "content.edit",
  update: "content.edit",
  move: "content.edit",
  submit: "content.edit",
  approve: "content.approve",
  request_changes: "content.approve",
  record_post: "content.edit",
  add_asset: "content.edit",
  update_asset: "content.edit",
  remove_asset: "content.edit",
  duplicate: "content.edit",
};

export type RuleCode =
  | "not_found"
  | "bad_input"
  | "not_allowed_move"
  | "blocked"
  | "not_in_review"
  | "not_approved"
  | "already_posted"
  | "too_many";

export type ApplyResult =
  | { ok: true; piece: ContentPiece; events: ContentEvent[]; created?: boolean }
  | { ok: false; code: RuleCode; message: Bilingual };

const FAIL: Record<RuleCode, Bilingual> = {
  not_found: { en: "That piece no longer exists.", es: "Esa pieza ya no existe." },
  bad_input: { en: "Something in the form is not valid.", es: "Algo del formulario no es válido." },
  not_allowed_move: { en: "A piece can't move there from where it is.", es: "La pieza no puede pasar ahí desde donde está." },
  blocked: { en: "It can't be approved yet: fix the blocking issues and tick the checklist.", es: "Todavía no se puede aprobar: corrige los problemas y marca la lista." },
  not_in_review: { en: "Only a piece that is ready for review can be approved or sent back.", es: "Solo una pieza lista para revisión se puede aprobar o devolver." },
  not_approved: { en: "Only an approved piece can be posted. If it was edited, it needs approval again.", es: "Solo una pieza aprobada se puede publicar. Si se editó, necesita aprobación otra vez." },
  already_posted: { en: "It's already posted. Make a copy to change the words.", es: "Ya se publicó. Haz una copia para cambiar el texto." },
  too_many: { en: "The board is full. Archive old pieces first.", es: "El tablero está lleno. Archiva piezas viejas primero." },
};

const fail = (code: RuleCode): ApplyResult => ({ ok: false, code, message: FAIL[code] });

/** Moves a person may make with "move" (review, approval and posting have their own actions). */
const MOVES: Partial<Record<ContentStatus, readonly ContentStatus[]>> = {
  idea: ["planned", "in_production", "archived"],
  planned: ["idea", "in_production", "archived"],
  in_production: ["idea", "planned", "archived"],
  review: ["in_production", "archived"],
  changes: ["in_production", "planned", "archived"],
  approved: ["archived"],
  scheduled: ["approved", "archived"],
  posted: ["archived"],
  measured: ["archived"],
  failed: ["approved", "in_production", "archived"],
  archived: ["idea"],
};

export function canMove(from: ContentStatus, to: ContentStatus): boolean {
  return MOVES[from]?.includes(to) ?? false;
}

let counter = 0;
export function newContentId(prefix = "pc"): string {
  counter = (counter + 1) % 1296;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 6)}`;
}

const clip = (value: unknown, max: number) => String(value ?? "").replace(/\u0000/g, "").slice(0, max);
const day = (value: unknown): string | null => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);

function cleanCopy(copy: Partial<ContentPiece["copy"]> | undefined): ContentPiece["copy"] {
  const out = emptyCopy();
  if (!copy) return out;
  for (const field of COPY_FIELDS) {
    const limit = field === "script" ? 6000 : field === "caption" ? 2200 : 400;
    out[field] = { en: clip(copy[field]?.en, limit), es: clip(copy[field]?.es, limit) };
  }
  return out;
}

const only = <T extends string>(list: readonly T[], values: unknown): T[] =>
  Array.isArray(values) ? [...new Set(values.filter((v): v is T => (list as readonly string[]).includes(v as string)))] : [];

function event(piece: ContentPiece, by: string, now: Date, kind: ContentEvent["kind"], extra: Partial<ContentEvent> = {}): ContentEvent {
  return { id: newContentId("ev"), pieceId: piece.id, at: now.toISOString(), by, kind, ...extra };
}

/** What changes the approval: the words, links, channels, type, language, characters or files. */
function touchesApproval(before: ContentPiece, after: ContentPiece): boolean {
  return pieceHash(before) !== pieceHash(after);
}

/** After any change: an approval that no longer matches is dropped, and the piece goes back to review. */
function settleApproval(before: ContentPiece, after: ContentPiece, by: string, now: Date, events: ContentEvent[]): ContentPiece {
  if (!after.approval || approvalHolds(after)) return after;
  const reset: ContentPiece = { ...after, approval: null, status: APPROVED_STATUSES.includes(after.status) || after.status === "failed" ? "review" : after.status };
  events.push(event(reset, by, now, "approval_reset", { from: before.status, to: reset.status, hash: pieceHash(reset) }));
  return reset;
}

export function newPiece(input: Extract<ContentAction, { action: "create" }>, by: string, now: Date): ContentPiece | null {
  const title = clip(input.title, 120).trim();
  if (title.length < 2) return null;
  if (!CONTENT_TYPES.includes(input.type) || !LANGUAGES.includes(input.language) || !AUDIENCES.includes(input.audience) || !THEMES.includes(input.theme)) return null;
  const id = input.id && /^[a-z]{2}_[a-z0-9]{6,40}$/.test(input.id) ? input.id : newContentId();
  return {
    id,
    title,
    type: input.type,
    channels: only(CHANNELS, input.channels),
    language: input.language,
    audience: input.audience,
    theme: input.theme,
    goal: clip(input.goal, 300),
    copy: cleanCopy(input.copy),
    characters: only(CHARACTERS, input.characters ?? []),
    links: [],
    assets: [],
    owner: input.owner ? clip(input.owner, 40).toLowerCase() : by,
    dueDate: day(input.dueDate),
    status: "idea",
    campaignCode: campaignCodeFor(id),
    templateId: input.templateId ? clip(input.templateId, 60) : null,
    aiDraft: Boolean(input.aiDraft),
    checklist: {},
    approval: null,
    changesNote: null,
    posts: [],
    failure: null,
    createdBy: by,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/** Apply one action to the board. `pieces` is the whole board (create checks the size; duplicate copies). */
export function applyContentAction(pieces: readonly ContentPiece[], action: ContentAction, by: string, now: Date): ApplyResult {
  if (action.action === "create") {
    if (pieces.filter((p) => p.status !== "archived").length >= MAX_PIECES) return fail("too_many");
    const piece = newPiece(action, by, now);
    if (!piece) return fail("bad_input");
    return { ok: true, piece, events: [event(piece, by, now, "created", { to: "idea", note: piece.templateId ? `template:${piece.templateId}` : piece.aiDraft ? "alti_draft" : null })], created: true };
  }
  const current = pieces.find((p) => p.id === action.id);
  if (!current) return fail("not_found");
  const events: ContentEvent[] = [];
  const stamp = (p: ContentPiece): ContentPiece => ({ ...p, updatedAt: now.toISOString() });

  switch (action.action) {
    case "update": {
      const patch = action.patch;
      if (["posted", "measured"].includes(current.status)) {
        // After it went out, only the bookkeeping fields may change.
        const touchesWords = ["copy", "type", "channels", "language", "characters", "links"].some((k) => k in patch);
        if (touchesWords) return fail("already_posted");
      }
      const next: ContentPiece = { ...current };
      if (patch.title !== undefined) {
        const title = clip(patch.title, 120).trim();
        if (title.length < 2) return fail("bad_input");
        next.title = title;
      }
      if (patch.type !== undefined) {
        if (!CONTENT_TYPES.includes(patch.type)) return fail("bad_input");
        next.type = patch.type;
      }
      if (patch.language !== undefined) {
        if (!LANGUAGES.includes(patch.language)) return fail("bad_input");
        next.language = patch.language;
      }
      if (patch.audience !== undefined) {
        if (!AUDIENCES.includes(patch.audience)) return fail("bad_input");
        next.audience = patch.audience;
      }
      if (patch.theme !== undefined) {
        if (!THEMES.includes(patch.theme)) return fail("bad_input");
        next.theme = patch.theme;
      }
      if (patch.channels !== undefined) next.channels = only(CHANNELS, patch.channels);
      if (patch.characters !== undefined) next.characters = only(CHARACTERS, patch.characters);
      if (patch.goal !== undefined) next.goal = clip(patch.goal, 300);
      if (patch.copy !== undefined) {
        next.copy = cleanCopy({ ...current.copy, ...patch.copy });
        // Once a person edits Alti's words, they are the person's.
        if (patch.aiDraft === undefined && JSON.stringify(next.copy) !== JSON.stringify(current.copy)) next.aiDraft = false;
      }
      if (patch.aiDraft !== undefined) next.aiDraft = Boolean(patch.aiDraft);
      if (patch.links !== undefined) {
        if (!Array.isArray(patch.links) || patch.links.length > 10) return fail("bad_input");
        next.links = patch.links.map((l) => clip(l, 500).trim()).filter(Boolean);
      }
      if (patch.owner !== undefined) next.owner = patch.owner ? clip(patch.owner, 40).toLowerCase() : null;
      if (patch.dueDate !== undefined) next.dueDate = day(patch.dueDate);
      if (patch.checklist !== undefined) {
        const checklist: ContentPiece["checklist"] = { ...current.checklist };
        for (const key of CHECKLIST_KEYS) if (typeof patch.checklist[key] === "boolean") checklist[key] = patch.checklist[key];
        next.checklist = checklist;
      }
      // A change to the words also means the person ticked the checklist against other words.
      if (touchesApproval(current, next) && Object.keys(current.checklist).length > 0 && patch.checklist === undefined && current.approval) next.checklist = {};
      events.push(event(next, by, now, "edited", { note: Object.keys(patch).join(",") }));
      return { ok: true, piece: stamp(settleApproval(current, next, by, now, events)), events };
    }
    case "move": {
      if (!canMove(current.status, action.to)) return fail("not_allowed_move");
      if (action.to === "approved" && !approvalHolds(current)) return fail("not_approved");
      const next: ContentPiece = { ...current, status: action.to, failure: action.to === "approved" ? null : current.failure };
      events.push(event(next, by, now, action.to === "archived" ? "archived" : current.status === "archived" ? "restored" : "moved", { from: current.status, to: action.to }));
      return { ok: true, piece: stamp(next), events };
    }
    case "submit": {
      if (!["idea", "planned", "in_production", "changes"].includes(current.status)) return fail("not_allowed_move");
      const issues = checkPiece(current);
      const next: ContentPiece = { ...current, status: "review" };
      events.push(event(next, by, now, "submitted", { from: current.status, to: "review", hash: pieceHash(current), blocking: blockingIssues(issues).length }));
      return { ok: true, piece: stamp(next), events };
    }
    case "approve": {
      if (current.status !== "review") return fail("not_in_review");
      const issues = checkPiece(current);
      if (approvalBlockers(current, issues).length > 0) return fail("blocked");
      const hash = pieceHash(current);
      const next: ContentPiece = { ...current, status: "approved", approval: { by, at: now.toISOString(), hash }, changesNote: null, failure: null };
      events.push(event(next, by, now, "checked", { hash, blocking: 0 }));
      events.push(event(next, by, now, "approved", { from: "review", to: "approved", hash, blocking: 0 }));
      return { ok: true, piece: stamp(next), events };
    }
    case "request_changes": {
      if (!["review", "approved", "scheduled", "failed"].includes(current.status)) return fail("not_in_review");
      const note = clip(action.note, 600).trim();
      if (note.length < 3) return fail("bad_input");
      const next: ContentPiece = { ...current, status: "changes", approval: null, changesNote: note };
      events.push(event(next, by, now, "changes_requested", { from: current.status, to: "changes", note }));
      return { ok: true, piece: stamp(next), events };
    }
    case "record_post": {
      if (!["approved", "scheduled", "posted", "measured", "failed"].includes(current.status) || !approvalHolds(current)) return fail("not_approved");
      const url = clip(action.url, 500).trim();
      if (!/^https:\/\/[^\s"'<>]{4,490}$/.test(url) || !CHANNELS.includes(action.channel)) return fail("bad_input");
      const postedAt = action.postedAt && !Number.isNaN(Date.parse(action.postedAt)) ? new Date(action.postedAt).toISOString() : now.toISOString();
      const next: ContentPiece = {
        ...current,
        status: current.status === "measured" ? "measured" : "posted",
        failure: null,
        posts: [...current.posts.filter((p) => !(p.channel === action.channel && p.url === url)), { channel: action.channel, url, postedAt, by, via: "person" as const }],
      };
      events.push(event(next, by, now, "posted", { from: current.status, to: next.status, note: `${action.channel} ${url}` }));
      return { ok: true, piece: stamp(next), events };
    }
    case "add_asset": {
      if (["posted", "measured"].includes(current.status)) return fail("already_posted");
      if (current.assets.length >= 20) return fail("too_many");
      const next: ContentPiece = { ...current, assets: [...current.assets, action.asset] };
      events.push(event(next, by, now, "asset_added", { note: action.asset.name }));
      return { ok: true, piece: stamp(settleApproval(current, next, by, now, events)), events };
    }
    case "update_asset": {
      if (["posted", "measured"].includes(current.status)) return fail("already_posted");
      if (!current.assets.some((a) => a.id === action.assetId)) return fail("not_found");
      const next: ContentPiece = { ...current, assets: current.assets.map((a) => (a.id === action.assetId ? { ...a, altText: clip(action.altText, 500) } : a)) };
      events.push(event(next, by, now, "edited", { note: "alt_text" }));
      return { ok: true, piece: stamp(settleApproval(current, next, by, now, events)), events };
    }
    case "remove_asset": {
      if (["posted", "measured"].includes(current.status)) return fail("already_posted");
      const asset = current.assets.find((a) => a.id === action.assetId);
      if (!asset) return fail("not_found");
      const next: ContentPiece = { ...current, assets: current.assets.filter((a) => a.id !== action.assetId) };
      events.push(event(next, by, now, "asset_removed", { note: asset.name }));
      return { ok: true, piece: stamp(settleApproval(current, next, by, now, events)), events };
    }
    case "duplicate": {
      if (pieces.filter((p) => p.status !== "archived").length >= MAX_PIECES) return fail("too_many");
      const id = action.newId && /^[a-z]{2}_[a-z0-9]{6,40}$/.test(action.newId) ? action.newId : newContentId();
      const copy: ContentPiece = {
        ...current,
        id,
        title: clip(`${current.title} (2)`, 120),
        status: "idea",
        campaignCode: campaignCodeFor(id),
        assets: [],
        checklist: {},
        approval: null,
        changesNote: null,
        posts: [],
        failure: null,
        createdBy: by,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      return { ok: true, piece: copy, events: [event(copy, by, now, "created", { to: "idea", note: `copy_of:${current.id}` })], created: true };
    }
  }
}

/** The pieces in a column, newest change first. */
export function boardColumns(pieces: readonly ContentPiece[]): Record<ContentStatus, ContentPiece[]> {
  const columns = {} as Record<ContentStatus, ContentPiece[]>;
  for (const p of pieces) (columns[p.status] ??= []).push(p);
  for (const list of Object.values(columns)) list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return columns;
}

export interface ContentFilters {
  channel?: Channel | "";
  language?: ContentPiece["language"] | "";
  audience?: ContentPiece["audience"] | "";
  owner?: string;
  q?: string;
}

export function filterPieces(pieces: readonly ContentPiece[], f: ContentFilters): ContentPiece[] {
  const q = f.q?.trim().toLowerCase();
  return pieces.filter(
    (p) =>
      (!f.channel || p.channels.includes(f.channel)) &&
      // "Both" pieces count for each language.
      (!f.language || p.language === f.language || (f.language !== "both" && p.language === "both")) &&
      (!f.audience || p.audience === f.audience) &&
      (!f.owner || p.owner === f.owner) &&
      (!q || `${p.title} ${p.goal} ${p.copy.hook.en} ${p.copy.hook.es}`.toLowerCase().includes(q)),
  );
}
