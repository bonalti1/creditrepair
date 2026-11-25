import type { SupabaseClient } from "@supabase/supabase-js";
import { blockingIssues, checkPiece } from "./check";
import { pieceHash } from "./hash";
import { pieceGates, providerFor, PROVIDERS, DEFAULT_PUBLISH_SETTINGS, GATE_TEXT, type GateCode, type PublishSettings } from "./publish/gates";
import { decryptToken, encryptToken } from "./publish/crypto";
import type { ConnectionGrant, ConnectionSecrets, ConnectionView, ProviderId } from "./publish/types";
import { resultEntryProblem, type LeadTouch } from "./results";
import { applyContentAction, type ApplyResult, type ContentAction } from "./rules";
import { partnerMaterialOf } from "./share";
import {
  CHANNELS,
  emptyCopy,
  isPublishChannel,
  PUBLISH_CHANNELS,
  RESULT_METRICS,
  type Bilingual,
  type Channel,
  type ContentAsset,
  type ContentEvent,
  type ContentPiece,
  type ContentResult,
  type PieceCopy,
  type PostRecord,
  type PublishChannel,
  type ResultMetric,
} from "./types";

// The content hub on the database (migration 0035). The routes call these
// after requireCapability; every write goes through the same pure rules as
// the demo (rules.ts), then to the database, whose triggers hold the approval
// rule again. Service role.

type Row = Record<string, unknown>;

export interface Actor {
  userId: string | null;
  handle: string;
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const iso = (v: unknown): string | null => {
  const s = typeof v === "string" ? v : v instanceof Date ? v.toISOString() : null;
  return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null;
};

function copyFrom(value: unknown): PieceCopy {
  const out = emptyCopy();
  if (!value || typeof value !== "object") return out;
  for (const key of Object.keys(out) as Array<keyof PieceCopy>) {
    const v = (value as Row)[key] as Row | undefined;
    out[key] = { en: typeof v?.en === "string" ? v.en : "", es: typeof v?.es === "string" ? v.es : "" };
  }
  return out;
}

export function assetFromRow(row: Row): ContentAsset {
  return {
    id: String(row.id),
    kind: row.kind === "upload" ? "upload" : "url",
    ref: String(row.ref),
    name: String(row.name),
    mediaType: str(row.media_type),
    bytes: typeof row.bytes === "number" ? row.bytes : row.bytes ? Number(row.bytes) : null,
    altText: String(row.alt_text ?? ""),
    addedBy: String(row.added_by_handle ?? ""),
    addedAt: iso(row.added_at) ?? new Date(0).toISOString(),
  };
}

export function pieceFromRow(row: Row, assets: ContentAsset[]): ContentPiece {
  const approvedHash = str(row.approved_hash);
  return {
    id: String(row.id),
    title: String(row.title),
    type: row.type as ContentPiece["type"],
    channels: (Array.isArray(row.channels) ? row.channels : []) as Channel[],
    language: row.language as ContentPiece["language"],
    audience: row.audience as ContentPiece["audience"],
    theme: row.theme as ContentPiece["theme"],
    goal: String(row.goal ?? ""),
    copy: copyFrom(row.copy),
    characters: (Array.isArray(row.characters) ? row.characters : []) as ContentPiece["characters"],
    links: (Array.isArray(row.links) ? row.links : []) as string[],
    assets,
    owner: str(row.owner),
    dueDate: typeof row.due_date === "string" ? row.due_date.slice(0, 10) : null,
    status: row.status as ContentPiece["status"],
    campaignCode: String(row.campaign_code),
    templateId: str(row.template_id),
    aiDraft: Boolean(row.ai_draft),
    checklist: (row.checklist && typeof row.checklist === "object" ? row.checklist : {}) as ContentPiece["checklist"],
    approval: approvedHash ? { hash: approvedHash, by: String(row.approved_by_handle ?? ""), at: iso(row.approved_at) ?? "" } : null,
    changesNote: str(row.changes_note),
    posts: (Array.isArray(row.posts) ? row.posts : []) as PostRecord[],
    failure: str(row.failure),
    createdBy: String(row.created_by_handle ?? ""),
    createdAt: iso(row.created_at) ?? "",
    updatedAt: iso(row.updated_at) ?? "",
  };
}

/** The columns a piece writes. The hash and the blocking count are the server's, from the piece as it is. */
function pieceColumns(piece: ContentPiece): Row {
  const hash = pieceHash(piece);
  return {
    title: piece.title,
    type: piece.type,
    channels: piece.channels,
    language: piece.language,
    audience: piece.audience,
    theme: piece.theme,
    goal: piece.goal,
    copy: piece.copy,
    characters: piece.characters,
    links: piece.links,
    owner: piece.owner,
    due_date: piece.dueDate,
    status: piece.status,
    template_id: piece.templateId,
    ai_draft: piece.aiDraft,
    checklist: piece.checklist,
    content_hash: hash,
    blocking_issues: blockingIssues(checkPiece(piece)).length,
    approved_hash: piece.approval?.hash ?? null,
    approved_at: piece.approval?.at ?? null,
    approved_by_handle: piece.approval?.by ?? null,
    changes_note: piece.changesNote,
    posts: piece.posts,
    failure: piece.failure,
  };
}

export interface LoadedPiece {
  piece: ContentPiece;
  /** The content_hash on the row: the token every update is conditioned on. */
  storedHash: string;
}

async function loadAssets(db: SupabaseClient, pieceIds: string[]): Promise<Map<string, ContentAsset[]>> {
  const out = new Map<string, ContentAsset[]>();
  if (pieceIds.length === 0) return out;
  const { data, error } = await db.from("content_assets").select("*").in("piece_id", pieceIds).is("removed_at", null).order("added_at", { ascending: true });
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as Row[]) out.set(String(row.piece_id), [...(out.get(String(row.piece_id)) ?? []), assetFromRow(row)]);
  return out;
}

export async function loadPieces(db: SupabaseClient): Promise<ContentPiece[]> {
  const { data, error } = await db.from("content_pieces").select("*").order("updated_at", { ascending: false }).limit(2500);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  const assets = await loadAssets(db, rows.map((r) => String(r.id)));
  return rows.map((r) => pieceFromRow(r, assets.get(String(r.id)) ?? []));
}

export async function loadPiece(db: SupabaseClient, id: string): Promise<LoadedPiece | null> {
  const { data, error } = await db.from("content_pieces").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const assets = await loadAssets(db, [id]);
  return { piece: pieceFromRow(data as Row, assets.get(id) ?? []), storedHash: String((data as Row).content_hash) };
}

export function eventFromRow(row: Row): ContentEvent {
  return {
    id: String(row.id),
    pieceId: String(row.piece_id),
    at: iso(row.at) ?? "",
    by: String(row.actor_handle),
    kind: row.kind as ContentEvent["kind"],
    from: (str(row.from_status) as ContentEvent["from"]) ?? null,
    to: (str(row.to_status) as ContentEvent["to"]) ?? null,
    note: str(row.note),
    hash: str(row.hash),
    blocking: typeof row.blocking === "number" ? row.blocking : null,
  };
}

export async function loadEvents(db: SupabaseClient, pieceId: string): Promise<ContentEvent[]> {
  const { data, error } = await db.from("content_events").select("*").eq("piece_id", pieceId).order("at", { ascending: true }).limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(eventFromRow);
}

export function resultFromRow(row: Row): ContentResult {
  const metrics = (row.metrics && typeof row.metrics === "object" ? row.metrics : {}) as Row;
  const values: ContentResult["values"] = {};
  for (const m of RESULT_METRICS) if (typeof metrics[m] === "number") values[m] = metrics[m] as number;
  return {
    id: String(row.id),
    pieceId: String(row.piece_id),
    channel: row.channel as Channel,
    source: row.source as ContentResult["source"],
    at: iso(row.at) ?? "",
    by: String(row.entered_by_handle),
    values,
    note: str(row.note),
  };
}

export async function loadResults(db: SupabaseClient, pieceId?: string): Promise<ContentResult[]> {
  let query = db.from("content_results").select("*");
  if (pieceId) query = query.eq("piece_id", pieceId);
  const { data, error } = await query.order("at", { ascending: true }).limit(10_000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(resultFromRow);
}

/** The leads' first touches (prospects, migration 0017): UTM tags and campaign only, and whether they became clients. */
export async function loadLeadTouches(db: SupabaseClient): Promise<LeadTouch[]> {
  const { data, error } = await db.from("prospects").select("source_detail, converted_user_id").limit(20_000);
  if (error) return [];
  return ((data ?? []) as Row[]).map((row) => {
    const first = (((row.source_detail as Row | null) ?? {}).firstTouch as Row | undefined) ?? {};
    const utm = (first.utm as Row | undefined) ?? {};
    return { campaign: str(first.campaign), utmContent: str(utm.content), utmCampaign: str(utm.campaign), converted: Boolean(row.converted_user_id) };
  });
}

async function insertEvents(db: SupabaseClient, actor: Actor, events: ContentEvent[]): Promise<void> {
  if (events.length === 0) return;
  const rows = events.map((e) => ({
    piece_id: e.pieceId,
    at: e.at,
    actor: actor.userId,
    actor_handle: actor.handle,
    kind: e.kind,
    from_status: e.from ?? null,
    to_status: e.to ?? null,
    note: e.note ? e.note.slice(0, 1000) : null,
    hash: e.hash ?? null,
    blocking: e.blocking ?? null,
  }));
  const { error } = await db.from("content_events").insert(rows);
  if (error) throw new Error(error.message);
}

export type ServerResult = ApplyResult | { ok: false; code: "conflict" | "db_error"; message: Bilingual };

const CONFLICT: Bilingual = { en: "Someone changed this piece a moment ago. Reload it and try again.", es: "Alguien cambió esta pieza hace un momento. Vuelve a cargarla e inténtalo otra vez." };

/** One action, from the caller's role already checked: rules, then the database, then the history. */
export async function applyOnServer(db: SupabaseClient, actor: Actor, action: ContentAction, now: Date = new Date()): Promise<ServerResult> {
  let board: ContentPiece[];
  let storedHash: string | null = null;
  if (action.action === "create") {
    const { data, error } = await db.from("content_pieces").select("id, status").neq("status", "archived");
    if (error) throw new Error(error.message);
    board = ((data ?? []) as Row[]).map((r) => ({ id: String(r.id), status: r.status }) as unknown as ContentPiece);
  } else {
    const loaded = await loadPiece(db, action.id);
    if (!loaded) return applyContentAction([], action, actor.handle, now);
    storedHash = loaded.storedHash;
    board = [loaded.piece];
    if (action.action === "duplicate") {
      const { data } = await db.from("content_pieces").select("id, status").neq("status", "archived");
      board = [loaded.piece, ...((data ?? []) as Row[]).filter((r) => r.id !== loaded.piece.id).map((r) => ({ id: String(r.id), status: r.status }) as unknown as ContentPiece)];
    }
  }
  const result = applyContentAction(board, action, actor.handle, now);
  if (!result.ok) return result;
  const piece = result.piece;

  if (result.created) {
    const { error } = await db.from("content_pieces").insert({
      id: piece.id,
      campaign_code: piece.campaignCode,
      created_by: actor.userId,
      created_by_handle: actor.handle,
      created_at: piece.createdAt,
      ...pieceColumns(piece),
    });
    if (error) return { ok: false, code: "db_error", message: { en: "It could not be saved. Nothing changed.", es: "No se pudo guardar. No cambió nada." } };
  } else {
    // Conditioned on the hash the piece had when it was read: a change in between is a conflict, never overwritten.
    const columns = pieceColumns(piece);
    if (action.action === "approve") Object.assign(columns, { approved_by: actor.userId });
    const { data, error } = await db.from("content_pieces").update(columns).eq("id", piece.id).eq("content_hash", storedHash!).select("id");
    if (error) return { ok: false, code: "db_error", message: { en: `It could not be saved: ${error.message.slice(0, 120)}`, es: `No se pudo guardar: ${error.message.slice(0, 120)}` } };
    if (!data || (data as Row[]).length === 0) return { ok: false, code: "conflict", message: CONFLICT };
    if (action.action === "add_asset") {
      const a = action.asset;
      const { error: assetError } = await db.from("content_assets").insert({
        id: a.id,
        piece_id: piece.id,
        kind: a.kind,
        ref: a.ref,
        name: a.name.slice(0, 160),
        media_type: a.mediaType,
        bytes: a.bytes,
        alt_text: a.altText.slice(0, 500),
        added_by: actor.userId,
        added_by_handle: actor.handle,
      });
      if (assetError) return { ok: false, code: "db_error", message: { en: "The file could not be recorded.", es: "No se pudo registrar el archivo." } };
    } else if (action.action === "update_asset") {
      const { error: assetError } = await db.from("content_assets").update({ alt_text: action.altText.slice(0, 500) }).eq("id", action.assetId).eq("piece_id", piece.id);
      if (assetError) return { ok: false, code: "db_error", message: { en: "The description could not be saved.", es: "No se pudo guardar la descripción." } };
    } else if (action.action === "remove_asset") {
      const { error: assetError } = await db.from("content_assets").update({ removed_at: now.toISOString() }).eq("id", action.assetId).eq("piece_id", piece.id);
      if (assetError) return { ok: false, code: "db_error", message: { en: "The file could not be removed.", es: "No se pudo quitar el archivo." } };
    }
    // An edit after approval also ends the schedules of the old content.
    if (!piece.approval) await cancelLiveSchedules(db, actor, piece.id, "The piece changed after approval.");
  }
  await insertEvents(db, actor, result.events);
  return result;
}

// ── Results ─────────────────────────────────────────────────────────────

export async function addResult(
  db: SupabaseClient,
  actor: Actor,
  input: { id: string; channel: Channel; values: Partial<Record<ResultMetric, number | null>>; at?: string | null; note?: string | null },
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; code: string }> {
  const loaded = await loadPiece(db, input.id);
  if (!loaded) return { ok: false, code: "not_found" };
  const problem = resultEntryProblem(input.values);
  if (problem) return { ok: false, code: problem };
  if (!CHANNELS.includes(input.channel)) return { ok: false, code: "bad_input" };
  const metrics: Row = {};
  for (const m of RESULT_METRICS) if (typeof input.values[m] === "number") metrics[m] = input.values[m];
  const at = input.at && !Number.isNaN(Date.parse(input.at)) ? new Date(input.at).toISOString() : now.toISOString();
  const { error } = await db.from("content_results").insert({
    piece_id: input.id,
    channel: input.channel,
    source: "manual",
    at,
    metrics,
    note: input.note?.slice(0, 300) || null,
    entered_by: actor.userId,
    entered_by_handle: actor.handle,
  });
  if (error) return { ok: false, code: "db_error" };
  const piece = loaded.piece;
  const events: ContentEvent[] = [{ id: "", pieceId: piece.id, at: now.toISOString(), by: actor.handle, kind: "result_added", note: `${input.channel}: ${Object.keys(metrics).join(",")}` }];
  if (piece.status === "posted") {
    await db.from("content_pieces").update({ status: "measured", content_hash: loaded.storedHash }).eq("id", piece.id).eq("status", "posted");
    events.push({ id: "", pieceId: piece.id, at: now.toISOString(), by: actor.handle, kind: "moved", from: "posted", to: "measured" });
  }
  await insertEvents(db, actor, events);
  return { ok: true };
}

// ── Publishing settings and connections ────────────────────────────────

export async function loadPublishSettings(db: SupabaseClient): Promise<PublishSettings> {
  const { data } = await db.from("content_settings").select("publishing_enabled, channels").eq("id", true).maybeSingle();
  if (!data) return DEFAULT_PUBLISH_SETTINGS;
  const channels = { ...DEFAULT_PUBLISH_SETTINGS.channels };
  const stored = ((data as Row).channels ?? {}) as Row;
  for (const c of PUBLISH_CHANNELS) channels[c] = stored[c] === true;
  return { enabled: (data as Row).publishing_enabled === true, channels };
}

export async function savePublishSettings(db: SupabaseClient, actor: Actor, patch: { enabled?: boolean; channels?: Partial<Record<PublishChannel, boolean>> }): Promise<PublishSettings> {
  const current = await loadPublishSettings(db);
  const next: PublishSettings = { enabled: patch.enabled ?? current.enabled, channels: { ...current.channels, ...(patch.channels ?? {}) } };
  const { error } = await db
    .from("content_settings")
    .update({ publishing_enabled: next.enabled, channels: next.channels, updated_by: actor.userId, updated_by_handle: actor.handle })
    .eq("id", true);
  if (error) throw new Error(error.message);
  await log(db, { event: "settings_changed", actor, note: `publishing ${next.enabled ? "on" : "off"}; ${PUBLISH_CHANNELS.map((c) => `${c} ${next.channels[c] ? "on" : "off"}`).join(", ")}` });
  return next;
}

const PROVIDER_IDS: readonly ProviderId[] = ["meta", "tiktok", "youtube"];

/** Each provider's connection as an administrator sees it. Never a token. */
export async function loadConnectionViews(db: SupabaseClient | null, env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): Promise<ConnectionView[]> {
  let rows: Row[] = [];
  if (db) {
    const { data } = await db.from("content_connections").select("provider, account, scopes, expires_at, refresh_enc, status, last_error, connected_by_handle, connected_at");
    rows = (data ?? []) as Row[];
  }
  return PROVIDER_IDS.map((id) => {
    const provider = PROVIDERS[id];
    const configured = provider.configured(env) && Boolean(env.CONTENT_TOKEN_KEY);
    const row = rows.find((r) => r.provider === id);
    const scopes = (Array.isArray(row?.scopes) ? row!.scopes : []) as string[];
    const expiresAt = iso(row?.expires_at);
    const expired = Boolean(expiresAt && Date.parse(expiresAt) <= now.getTime() && !row?.refresh_enc);
    const status: ConnectionView["status"] = !configured ? "not_configured" : !row ? "not_connected" : row.status === "error" ? "error" : expired || row.status === "expired" ? "expired" : "connected";
    return {
      provider: id,
      configured,
      connected: Boolean(row),
      status,
      account: row ? ((row.account ?? {}) as ConnectionView["account"]) : null,
      scopes,
      missingScopes: row ? provider.scopes.filter((s) => !scopes.includes(s)) : [],
      expiresAt,
      connectedAt: iso(row?.connected_at),
      connectedBy: str(row?.connected_by_handle),
      lastError: str(row?.last_error),
    };
  });
}

export async function saveConnection(db: SupabaseClient, actor: Actor, provider: ProviderId, grant: ConnectionGrant, key: Buffer): Promise<void> {
  const { error } = await db.from("content_connections").upsert(
    {
      provider,
      account: grant.account,
      scopes: grant.scopes,
      token_enc: encryptToken(grant.accessToken, key),
      refresh_enc: grant.refreshToken ? encryptToken(grant.refreshToken, key) : null,
      expires_at: grant.expiresAt,
      refresh_expires_at: grant.refreshExpiresAt,
      status: "connected",
      last_error: null,
      connected_by: actor.userId,
      connected_by_handle: actor.handle,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider" },
  );
  if (error) throw new Error(error.message);
  await log(db, { event: "connected", actor, note: `${provider}: ${Object.values(grant.account).filter(Boolean).join(" · ").slice(0, 200)}` });
}

export async function disconnect(db: SupabaseClient, actor: Actor, provider: ProviderId): Promise<void> {
  const { error } = await db.from("content_connections").delete().eq("provider", provider);
  if (error) throw new Error(error.message);
  await log(db, { event: "disconnected", actor, note: provider });
}

/** The decrypted connection for one call. Null when not connected or the key cannot read it. */
export async function loadSecrets(db: SupabaseClient, provider: ProviderId, key: Buffer): Promise<ConnectionSecrets | null> {
  const { data } = await db.from("content_connections").select("*").eq("provider", provider).maybeSingle();
  if (!data) return null;
  const row = data as Row;
  const accessToken = decryptToken(String(row.token_enc), key);
  if (!accessToken) return null;
  const refreshToken = row.refresh_enc ? decryptToken(String(row.refresh_enc), key) : null;
  return {
    provider,
    account: (row.account ?? {}) as ConnectionSecrets["account"],
    scopes: (Array.isArray(row.scopes) ? row.scopes : []) as string[],
    accessToken,
    refreshToken,
    expiresAt: iso(row.expires_at),
  };
}

// ── Schedules ───────────────────────────────────────────────────────────

export interface ScheduleView {
  id: string;
  pieceId: string;
  channel: PublishChannel;
  lang: "en" | "es";
  scheduledAt: string;
  status: "scheduled" | "retry" | "publishing" | "posted" | "failed" | "cancelled";
  attempts: number;
  nextAttemptAt: string;
  postedAt: string | null;
  externalId: string | null;
  url: string | null;
  lastError: string | null;
  note: string | null;
  createdBy: string;
  /** The approved version this schedule posts. */
  approvalHash: string;
}

export function scheduleFromRow(row: Row): ScheduleView {
  return {
    id: String(row.id),
    pieceId: String(row.piece_id),
    channel: row.channel as PublishChannel,
    lang: row.lang === "es" ? "es" : "en",
    scheduledAt: iso(row.scheduled_at) ?? "",
    status: row.status as ScheduleView["status"],
    attempts: Number(row.attempts ?? 0),
    nextAttemptAt: iso(row.next_attempt_at) ?? "",
    postedAt: iso(row.posted_at),
    externalId: str(row.external_id),
    url: str(row.url),
    lastError: str(row.last_error),
    note: str(row.note),
    createdBy: String(row.created_by_handle ?? ""),
    approvalHash: String(row.approval_hash ?? ""),
  };
}

export async function loadSchedules(db: SupabaseClient, pieceId?: string): Promise<ScheduleView[]> {
  let query = db.from("content_schedules").select("*");
  if (pieceId) query = query.eq("piece_id", pieceId);
  const { data, error } = await query.order("scheduled_at", { ascending: true }).limit(5000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(scheduleFromRow);
}

export interface LogInput {
  event: string;
  actor: Actor | "system";
  scheduleId?: string | null;
  pieceId?: string | null;
  channel?: PublishChannel | null;
  approvedBy?: string | null;
  approvalHash?: string | null;
  payload?: Row | null;
  response?: Row | null;
  note?: string | null;
}

export async function log(db: SupabaseClient, input: LogInput): Promise<void> {
  const actor = input.actor === "system" ? { userId: null, handle: "system" } : input.actor;
  const trim = (value: Row | null | undefined, max: number): Row | null => {
    if (!value) return null;
    const text = JSON.stringify(value);
    return text.length <= max ? value : { truncated: text.slice(0, max - 40) };
  };
  await db.from("content_publish_log").insert({
    schedule_id: input.scheduleId ?? null,
    piece_id: input.pieceId ?? null,
    channel: input.channel ?? null,
    event: input.event,
    actor: actor.userId,
    actor_handle: actor.handle,
    approved_by_handle: input.approvedBy ?? null,
    approval_hash: input.approvalHash ?? null,
    payload: trim(input.payload, 11_000),
    response: trim(input.response, 3_800),
    note: input.note ? input.note.slice(0, 500) : null,
  });
}

export type ScheduleResult = { ok: true; schedule: ScheduleView } | { ok: false; code: GateCode | "bad_time" | "already_scheduled" | "not_found" | "db_error"; message: Bilingual };

/** At most this far ahead. */
const MAX_AHEAD_MS = 180 * 24 * 60 * 60 * 1000;

export async function schedulePiece(
  db: SupabaseClient,
  actor: Actor,
  input: { id: string; channel: string; at: string; lang?: "en" | "es" },
  now: Date = new Date(),
): Promise<ScheduleResult> {
  const loaded = await loadPiece(db, input.id);
  if (!loaded) return { ok: false, code: "not_found", message: { en: "That piece no longer exists.", es: "Esa pieza ya no existe." } };
  if (!isPublishChannel(input.channel)) return { ok: false, code: "channel_not_on_piece", message: GATE_TEXT.channel_not_on_piece };
  const piece = loaded.piece;
  const gates = pieceGates(piece, input.channel);
  if (gates.length > 0) return { ok: false, code: gates[0]!, message: GATE_TEXT[gates[0]!] };
  const at = Date.parse(input.at);
  if (Number.isNaN(at) || at < now.getTime() - 60_000 || at > now.getTime() + MAX_AHEAD_MS) {
    return { ok: false, code: "bad_time", message: { en: "Pick a time from now up to six months ahead.", es: "Elige una hora desde ahora hasta seis meses después." } };
  }
  const lang = input.lang ?? (piece.language === "es" ? "es" : "en");
  const hash = piece.approval!.hash;
  const { data, error } = await db
    .from("content_schedules")
    .insert({
      piece_id: piece.id,
      channel: input.channel,
      lang,
      scheduled_at: new Date(at).toISOString(),
      next_attempt_at: new Date(at).toISOString(),
      approval_hash: hash,
      publish_key: `${piece.id}:${input.channel}:${hash}`,
      created_by: actor.userId,
      created_by_handle: actor.handle,
    })
    .select("*")
    .single();
  if (error || !data) {
    const duplicate = /duplicate|unique|23505/i.test(`${error?.message ?? ""} ${(error as { code?: string } | null)?.code ?? ""}`);
    return duplicate
      ? { ok: false, code: "already_scheduled", message: { en: "This approved version is already scheduled or posted on that channel.", es: "Esta versión aprobada ya está programada o publicada en ese canal." } }
      : { ok: false, code: "db_error", message: { en: "It could not be scheduled.", es: "No se pudo programar." } };
  }
  const schedule = scheduleFromRow(data as Row);
  if (piece.status === "approved") {
    await db.from("content_pieces").update({ status: "scheduled", content_hash: loaded.storedHash }).eq("id", piece.id).eq("status", "approved");
  }
  await insertEvents(db, actor, [{ id: "", pieceId: piece.id, at: now.toISOString(), by: actor.handle, kind: "scheduled", from: piece.status, to: "scheduled", note: `${input.channel} ${schedule.scheduledAt}` }]);
  await log(db, { event: "scheduled", actor, scheduleId: schedule.id, pieceId: piece.id, channel: input.channel, approvedBy: piece.approval!.by, approvalHash: hash, note: schedule.scheduledAt });
  return { ok: true, schedule };
}

async function cancelLiveSchedules(db: SupabaseClient, actor: Actor | "system", pieceId: string, reason: string): Promise<number> {
  const { data } = await db.from("content_schedules").update({ status: "cancelled", last_error: reason.slice(0, 500) }).eq("piece_id", pieceId).in("status", ["scheduled", "retry"]).select("id, channel");
  const rows = (data ?? []) as Row[];
  for (const row of rows) await log(db, { event: "cancelled", actor, scheduleId: String(row.id), pieceId, channel: row.channel as PublishChannel, note: reason });
  return rows.length;
}

export async function cancelSchedule(db: SupabaseClient, actor: Actor, scheduleId: string, now: Date = new Date()): Promise<{ ok: boolean }> {
  const { data } = await db.from("content_schedules").update({ status: "cancelled", last_error: "Cancelled by a person." }).eq("id", scheduleId).in("status", ["scheduled", "retry"]).select("*");
  const row = ((data ?? []) as Row[])[0];
  if (!row) return { ok: false };
  const pieceId = String(row.piece_id);
  await log(db, { event: "cancelled", actor, scheduleId, pieceId, channel: row.channel as PublishChannel, note: "by a person" });
  // The last live schedule cancelled: the piece is approved again, not scheduled.
  const { data: live } = await db.from("content_schedules").select("id").eq("piece_id", pieceId).in("status", ["scheduled", "retry", "publishing"]);
  if (((live ?? []) as Row[]).length === 0) {
    const loaded = await loadPiece(db, pieceId);
    if (loaded && loaded.piece.status === "scheduled") {
      await db.from("content_pieces").update({ status: "approved", content_hash: loaded.storedHash }).eq("id", pieceId).eq("status", "scheduled");
    }
  }
  await insertEvents(db, actor, [{ id: "", pieceId, at: now.toISOString(), by: actor.handle, kind: "schedule_cancelled", note: String(row.channel) }]);
  return { ok: true };
}

/** Sales' view: approved partner material only (the database's policy says the same). */
export const partnerMaterial = partnerMaterialOf;

export { providerFor };
