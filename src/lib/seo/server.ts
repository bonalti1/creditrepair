import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "../supabase/config";
import { applyGuideAction, blockingIssues, checkGuide, cleanBody, cleanSources, guideHash, type GuideAction, type GuideResult } from "./guides";
import { starterGuides } from "./starters";
import type { Guide, GuideEvent, GuideStatus, HealthReport, LocalTicks, PublishedGuide, SearchRow, TrackedPhrase } from "./types";

// The SEO department on the database (migration 0039). The routes call these
// after requireCapability; the screens never touch the tables. Reads for the
// team go through the service role after the route's check (the policies
// allow the same people); the public pages read only the published versions,
// through the two security-definer functions, with the anon key.

type Row = Record<string, unknown>;

export interface Actor {
  userId: string;
  handle: string;
}

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const ts = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

function publishedFrom(value: unknown): PublishedGuide | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Partial<PublishedGuide>;
  if (!p.slug || !p.body || !p.hash) return null;
  return {
    slug: String(p.slug),
    body: { en: cleanBody(p.body.en), es: cleanBody(p.body.es) },
    sources: cleanSources(p.sources),
    hash: String(p.hash),
    publishedAt: str(p.publishedAt),
    firstPublishedAt: str(p.firstPublishedAt, str(p.publishedAt)),
    approvedBy: str(p.approvedBy),
  };
}

export function guideFromRow(row: Row): Guide {
  const body = (row.body ?? {}) as Partial<Guide["body"]>;
  const phrase = (row.phrase ?? {}) as Partial<Guide["phrase"]>;
  return {
    id: String(row.id),
    slug: String(row.slug),
    status: String(row.status) as GuideStatus,
    topic: str(row.topic),
    brief: str(row.brief),
    phrase: { en: str(phrase.en), es: str(phrase.es) },
    body: { en: cleanBody(body.en), es: cleanBody(body.es) },
    sources: cleanSources(row.sources as Guide["sources"]),
    checklist: (row.checklist ?? {}) as Guide["checklist"],
    aiDraft: Boolean(row.ai_draft),
    approval: row.approved_hash ? { hash: String(row.approved_hash), by: str(row.approved_by_handle), at: ts(row.approved_at)! } : null,
    published: publishedFrom(row.published),
    changesNote: (row.changes_note as string | null) ?? null,
    createdBy: str(row.created_by_handle),
    createdAt: ts(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: ts(row.updated_at) ?? new Date(0).toISOString(),
    sample: Boolean(row.sample),
  };
}

/** The columns a guide writes (everything but who created it and when). */
function guideColumns(guide: Guide): Row {
  return {
    slug: guide.slug,
    status: guide.status,
    topic: guide.topic,
    brief: guide.brief,
    phrase: guide.phrase,
    body: guide.body,
    sources: guide.sources,
    checklist: guide.checklist,
    ai_draft: guide.aiDraft,
    content_hash: guideHash(guide),
    blocking_issues: blockingIssues(checkGuide(guide)).length,
    approved_hash: guide.approval?.hash ?? null,
    approved_by_handle: guide.approval?.by ?? null,
    approved_at: guide.approval?.at ?? null,
    published: guide.published,
    published_hash: guide.published?.hash ?? null,
    published_at: guide.published?.publishedAt ?? null,
    changes_note: guide.changesNote,
  };
}

export async function loadGuides(db: SupabaseClient): Promise<Guide[]> {
  const { data, error } = await db.from("seo_guides").select("*").order("updated_at", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(guideFromRow);
}

export async function loadGuideEvents(db: SupabaseClient, guideId: string): Promise<GuideEvent[]> {
  const { data } = await db.from("seo_guide_events").select("*").eq("guide_id", guideId).order("at", { ascending: true }).limit(200);
  return ((data ?? []) as Row[]).map((r) => ({ id: String(r.id), guideId: String(r.guide_id), at: ts(r.at)!, by: str(r.actor_handle), kind: r.kind as GuideEvent["kind"], note: (r.note as string | null) ?? null }));
}

const CONFLICT = { en: "Someone changed this guide a moment ago. Reload it and try again.", es: "Alguien cambió esta guía hace un momento. Recárgala e inténtalo otra vez." };
const FAILED = (detail: string) => ({ en: `It could not be saved: ${detail.slice(0, 120)}`, es: `No se pudo guardar: ${detail.slice(0, 120)}` });

/** One step of the workflow on the database: the same rules as the demo (applyGuideAction), then the write, conditioned on what was read. */
export async function applyOnServer(db: SupabaseClient, actor: Actor, action: GuideAction, now: Date = new Date()): Promise<GuideResult> {
  const guides = await loadGuides(db);
  const before = action.action === "create" ? null : guides.find((g) => g.id === action.id) ?? null;
  const result = applyGuideAction(guides, action, actor.handle, now);
  if (!result.ok) return result;
  const guide = result.guide;
  if (result.created) {
    const { error } = await db.from("seo_guides").insert({ id: guide.id, created_by: actor.userId, created_by_handle: actor.handle, created_at: guide.createdAt, ...guideColumns(guide) });
    if (error) return { ok: false, code: "db_error", message: FAILED(error.message) };
  } else if (before) {
    const columns = guideColumns(guide);
    if (action.action === "publish") Object.assign(columns, { approved_by: actor.userId, first_published_at: guide.published!.firstPublishedAt });
    const { data, error } = await db.from("seo_guides").update(columns).eq("id", guide.id).eq("content_hash", guideHash(before)).select("id");
    if (error) return { ok: false, code: "db_error", message: FAILED(error.message) };
    if (!data || (data as Row[]).length === 0) return { ok: false, code: "conflict", message: CONFLICT };
  }
  if (result.events.length) {
    const hash = guideHash(guide);
    await db.from("seo_guide_events").insert(result.events.map((e) => ({ guide_id: e.guideId, at: e.at, actor: actor.userId, actor_handle: actor.handle, kind: e.kind, note: e.note, hash })));
  }
  return result;
}

/** The starter drafts (src/lib/seo/starters.ts), added once as drafts. Returns how many were added. */
export async function addStarterGuides(db: SupabaseClient, actor: Actor, now: Date = new Date()): Promise<number> {
  const existing = await loadGuides(db);
  const ids = new Set(existing.map((g) => g.id));
  const slugs = new Set(existing.map((g) => g.slug));
  let added = 0;
  for (const g of starterGuides(now, actor.handle)) {
    if (ids.has(g.id) || slugs.has(g.slug)) continue;
    const draft: Guide = { ...g, status: "draft", sample: false };
    const { error } = await db.from("seo_guides").insert({ id: draft.id, created_by: actor.userId, created_by_handle: actor.handle, created_at: draft.createdAt, ...guideColumns(draft) });
    if (!error) {
      added += 1;
      await db.from("seo_guide_events").insert({ guide_id: draft.id, actor: actor.userId, actor_handle: actor.handle, kind: "created", note: "starter draft", hash: guideHash(draft) });
    }
  }
  return added;
}

// ── Phrases ─────────────────────────────────────────────────────────────

export function phraseFromRow(r: Row): TrackedPhrase {
  return { id: String(r.id), phrase: str(r.phrase), lang: r.lang === "es" ? "es" : "en", city: (r.city as string | null) ?? null, targetPath: (r.target_path as string | null) ?? null, note: str(r.note), createdBy: str(r.created_by_handle), createdAt: ts(r.created_at)! };
}

export async function loadPhrases(db: SupabaseClient): Promise<TrackedPhrase[]> {
  const { data, error } = await db.from("seo_keywords").select("*").is("removed_at", null).order("created_at", { ascending: true }).limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(phraseFromRow);
}

// ── Settings: health, sync status, local ticks ──────────────────────────

export interface SeoSettings {
  health: HealthReport | null;
  searchSyncedAt: string | null;
  searchSyncError: string | null;
  searchRowsSynced: number | null;
  localTicks: LocalTicks;
}

export async function loadSettings(db: SupabaseClient): Promise<SeoSettings> {
  const { data } = await db.from("seo_settings").select("*").eq("id", true).maybeSingle();
  const r = (data ?? {}) as Row;
  return {
    health: (r.health as HealthReport | null) ?? null,
    searchSyncedAt: ts(r.search_synced_at),
    searchSyncError: (r.search_sync_error as string | null) ?? null,
    searchRowsSynced: typeof r.search_rows_synced === "number" ? r.search_rows_synced : null,
    localTicks: (r.local_ticks as LocalTicks | null) ?? {},
  };
}

export async function saveHealth(db: SupabaseClient, report: HealthReport): Promise<void> {
  await db.from("seo_settings").update({ health: report, health_checked_at: report.checkedAt, updated_at: new Date().toISOString() }).eq("id", true);
}

export async function saveLocalTick(db: SupabaseClient, key: string, done: boolean, actor: Actor, now: Date): Promise<LocalTicks> {
  const current = (await loadSettings(db)).localTicks;
  const next: LocalTicks = { ...current, [key]: { done, by: actor.handle, at: now.toISOString() } };
  await db.from("seo_settings").update({ local_ticks: next, updated_at: now.toISOString() }).eq("id", true);
  return next;
}

export async function loadSearchRows(db: SupabaseClient, range: { from: string; to: string }): Promise<SearchRow[]> {
  const { data, error } = await db.from("seo_search_rows").select("day, page, query, clicks, impressions, position").gte("day", range.from).lte("day", range.to).limit(50_000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((r) => ({ day: String(r.day).slice(0, 10), page: str(r.page), query: str(r.query), clicks: Number(r.clicks) || 0, impressions: Number(r.impressions) || 0, position: Number(r.position) || 0 }));
}

// ── The public path ─────────────────────────────────────────────────────

/** A client with the anon key and no session: it can call only what anon may (the two published-guide functions). */
function publicClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}

let cache: { at: number; guides: PublishedGuide[] } | null = null;
const CACHE_MS = 60_000;

/** Every live guide's published version. In the demo there are none (the starters are unpublished). Cached a minute. */
export async function listPublishedGuides(client: SupabaseClient | null = publicClient(), now = Date.now()): Promise<PublishedGuide[]> {
  if (!client) return [];
  if (cache && now - cache.at < CACHE_MS) return cache.guides;
  try {
    const { data, error } = await client.rpc("seo_published_guides");
    if (error) return cache?.guides ?? [];
    const guides = ((data ?? []) as Array<{ published: unknown }>).map((r) => publishedFrom(r.published)).filter((g): g is PublishedGuide => g !== null);
    cache = { at: now, guides };
    return guides;
  } catch {
    return cache?.guides ?? [];
  }
}

export async function publishedGuide(slug: string, client: SupabaseClient | null = publicClient()): Promise<PublishedGuide | null> {
  if (!client || !/^[a-z0-9-]{3,80}$/.test(slug)) return null;
  try {
    const { data, error } = await client.rpc("seo_published_guide", { p_slug: slug });
    if (error) return null;
    return publishedFrom(data);
  } catch {
    return null;
  }
}

/** Forget the cached list (after a publish, so the sitemap and index show it at once on this server). */
export function forgetPublishedCache(): void {
  cache = null;
}
