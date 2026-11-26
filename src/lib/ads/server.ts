import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanText, metaAdsConfig, MetaAdsError, readAccount, readInsights, readStructure, type Http } from "./meta";
import { adsSummary, buildReport, type AdsSummary } from "./report";
import type { Ad, AdAccount, AdBrief, AdCampaign, AdCreative, AdDay, AdLead, AdSet, AdsPayload, AdsSnapshot, AccountStatus, ResultKind, SyncRun } from "./types";
import { addDays, adWindow, dayInZone } from "./window";

// The Ads Manager on the server (migration 0037).
//
// Reads go through the signed-in member's OWN connection, so the read
// policies decide: the ad account, the campaigns and the numbers are for
// administrators; the leads are read under the lead inbox's own policies
// (migration 0034). The sync writes with the service role, from the cron
// route (shared secret) or from an administrator's «Sync now», and only ever
// READS Meta (meta.ts).

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const iso = (v: unknown): string | null => {
  const s = typeof v === "string" ? v : v instanceof Date ? v.toISOString() : null;
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
const day = (v: unknown): string | null => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
};
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

async function rows(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return (data as Row[] | null) ?? [];
}

const ACCOUNT_STATUSES: readonly AccountStatus[] = ["active", "disabled", "unsettled", "review", "grace", "closing", "closed", "unknown"];
const RESULT_KINDS: readonly ResultKind[] = ["leads_form", "conversations", "website_leads", "website_other", "link_clicks", "landing_page_views", "results"];

function creativeOf(value: unknown): AdCreative {
  const c = value && typeof value === "object" ? (value as Row) : {};
  const s = (k: string) => str(c[k]);
  return { title: s("title"), body: s("body"), thumbnailUrl: s("thumbnailUrl"), imageUrl: s("imageUrl"), videoId: s("videoId"), callToAction: s("callToAction"), link: s("link") };
}

/**
 * The cached account, its campaigns, ad sets and ads, and the numbers from
 * `sinceFor(account's time zone)` (an account day) on. With no account synced
 * yet: an empty snapshot (and the last run, if one failed).
 */
export async function loadAdsSnapshot(reader: SupabaseClient, sinceFor: (timeZone: string) => string): Promise<AdsSnapshot> {
  const accounts = await rows(reader.from("ads_accounts").select("*").order("updated_at", { ascending: false }).limit(1), "ads_accounts");
  const a = accounts[0];
  const lastRuns = await rows(reader.from("ads_sync_runs").select("at, ok, since, until, rows, error").order("at", { ascending: false }).limit(1), "ads_sync_runs");
  const run = lastRuns[0];
  const lastRun: SyncRun | null = run ? { at: iso(run.at)!, ok: run.ok === true, since: day(run.since), until: day(run.until), rows: num(run.rows), error: str(run.error) } : null;
  if (!a) return { platform: "meta", account: null, campaigns: [], adsets: [], ads: [], days: [], syncedAt: null, lastRun };
  const accountId = String(a.id);
  const account: AdAccount = {
    id: accountId,
    name: String(a.name),
    currency: String(a.currency),
    timeZone: String(a.time_zone),
    status: ACCOUNT_STATUSES.includes(a.status as AccountStatus) ? (a.status as AccountStatus) : "unknown",
    statusCode: a.status_code === null || a.status_code === undefined ? null : num(a.status_code),
  };
  const [objects, insights] = await Promise.all([
    rows(reader.from("ads_objects").select("*").eq("account_id", accountId).limit(5000), "ads_objects"),
    rows(reader.from("ads_insights_daily").select("ad_id, adset_id, campaign_id, day, spend_cents, impressions, clicks, results").eq("account_id", accountId).gte("day", sinceFor(account.timeZone)).order("day", { ascending: true }).limit(50_000), "ads_insights_daily"),
  ]);
  const campaigns: AdCampaign[] = [];
  const adsets: AdSet[] = [];
  const ads: Ad[] = [];
  for (const o of objects) {
    const base = { id: String(o.id), name: String(o.name), status: String(o.status), createdAt: iso(o.meta_created_at) };
    if (o.level === "campaign") {
      campaigns.push({
        ...base,
        objective: str(o.objective),
        specialAdCategories: Array.isArray(o.special_ad_categories) ? (o.special_ad_categories as unknown[]).map(String) : [],
        dailyBudgetCents: o.daily_budget_cents === null || o.daily_budget_cents === undefined ? null : num(o.daily_budget_cents),
        lifetimeBudgetCents: o.lifetime_budget_cents === null || o.lifetime_budget_cents === undefined ? null : num(o.lifetime_budget_cents),
      });
    } else if (o.level === "adset") {
      adsets.push({
        ...base,
        campaignId: String(o.campaign_id),
        optimizationGoal: str(o.optimization_goal),
        resultAction: str(o.result_action),
        resultKind: RESULT_KINDS.includes(o.result_kind as ResultKind) ? (o.result_kind as ResultKind) : "results",
      });
    } else if (o.level === "ad") {
      ads.push({ ...base, campaignId: String(o.campaign_id), adsetId: String(o.adset_id), creative: creativeOf(o.creative), previewUrl: str(o.preview_url) });
    }
  }
  const days: AdDay[] = insights.map((r) => ({
    adId: String(r.ad_id),
    adsetId: String(r.adset_id),
    campaignId: String(r.campaign_id),
    day: day(r.day)!,
    spendCents: num(r.spend_cents),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    results: r.results === null || r.results === undefined ? null : num(r.results),
  }));
  return { platform: "meta", account, campaigns, adsets, ads, days, syncedAt: iso(a.last_synced_at), lastRun };
}

/** Meta's spend per month, from `sinceDay` on (for the books' reconciliation). */
export async function loadMonthlySpend(reader: SupabaseClient, sinceDay: string): Promise<Array<{ month: string; spendCents: number }>> {
  const list = await rows(reader.from("ads_insights_daily").select("day, spend_cents").gte("day", sinceDay).limit(100_000), "ads_insights_daily");
  const months = new Map<string, number>();
  for (const r of list) {
    const d = day(r.day);
    if (d) months.set(d.slice(0, 7), (months.get(d.slice(0, 7)) ?? 0) + num(r.spend_cents));
  }
  return [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, spendCents]) => ({ month, spendCents }));
}

/** "Rosa Elena Gutiérrez" → "Rosa G.": all the Ads Manager shows of a lead. */
export function shortName(name: string | null): string | null {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const last = parts.length > 1 ? parts[parts.length - 1]! : "";
  return `${parts[0]}${last ? ` ${last.charAt(0).toUpperCase()}.` : ""}`.slice(0, 40);
}

/** A lead row (migration 0034) as the Ads Manager needs it: no phone, no message, only the first touch's tags. */
export function adLeadFromRow(row: Row): AdLead {
  const touch = row.first_touch && typeof row.first_touch === "object" ? (row.first_touch as Row) : {};
  const utmIn = touch.utm && typeof touch.utm === "object" ? (touch.utm as Row) : null;
  const utm = utmIn ? Object.fromEntries(["source", "medium", "campaign", "content", "term"].map((k) => [k, str(utmIn[k])]).filter(([, v]) => v)) : null;
  const adIn = touch.ad && typeof touch.ad === "object" ? (touch.ad as Row) : null;
  const id = (x: unknown) => (typeof x === "string" && /^\d{3,25}$/.test(x) ? x : null);
  const via = adIn && (adIn.via === "link" || adIn.via === "ctwa" || adIn.via === "form") ? adIn.via : null;
  return {
    id: String(row.id),
    name: shortName(str(row.display_name)),
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    signedAt: iso(row.signed_at),
    source: String(row.source ?? ""),
    utm: utm && Object.keys(utm).length > 0 ? utm : null,
    ad: adIn ? { adId: id(adIn.adId), adsetId: id(adIn.adsetId), campaignId: id(adIn.campaignId), fbclid: adIn.fbclid === true, via } : null,
  };
}

/** The leads that arrived from `sinceIso` on, through the member's own connection (the lead inbox's policies). */
export async function loadAdLeads(reader: SupabaseClient, sinceIso: string): Promise<AdLead[]> {
  const list = await rows(reader.from("leads").select("id, display_name, created_at, signed_at, source, first_touch").gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(20_000), "leads");
  return list.map(adLeadFromRow);
}

// ── Video briefs ────────────────────────────────────────────────────────

export async function loadBriefs(reader: SupabaseClient): Promise<AdBrief[]> {
  const list = await rows(reader.from("ads_briefs").select("id, created_at, created_by_handle, title, source_ad_id, format, goal, language, status").order("created_at", { ascending: false }).limit(50), "ads_briefs");
  return list.map((r) => ({
    id: String(r.id),
    createdAt: iso(r.created_at)!,
    by: String(r.created_by_handle),
    title: String(r.title),
    sourceAdId: str(r.source_ad_id),
    format: String(r.format),
    goal: String(r.goal),
    language: String(r.language),
    status: String(r.status),
  }));
}

// ── What the screen reads ───────────────────────────────────────────────

/**
 * Everything the Ads Manager shows for one window, read through the member's
 * own connection: the snapshot (from the window's first day, and the last two
 * days for "still spending"), the leads that arrived in it, Meta's spend per
 * month (13 months, for the books) and the video briefs. The Meta settings
 * say only whether they are there, and which names are missing.
 */
export async function loadAdsPayload(
  reader: SupabaseClient,
  input: { preset?: unknown; since?: unknown; until?: unknown },
  now: Date,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  options: { briefs?: boolean } = {},
): Promise<AdsPayload> {
  let window = adWindow(input, now, "America/Chicago");
  const snapshot = await loadAdsSnapshot(reader, (timeZone) => {
    window = adWindow(input, now, timeZone);
    const recent = addDays(dayInZone(now, timeZone), -2);
    return window.since < recent ? window.since : recent;
  });
  const monthStart = `${addDays(dayInZone(now, snapshot.account?.timeZone ?? "America/Chicago"), -400).slice(0, 7)}-01`;
  const [leads, monthly, briefs] = await Promise.all([
    loadAdLeads(reader, new Date(Date.parse(`${window.since}T00:00:00Z`) - 86_400_000).toISOString()),
    loadMonthlySpend(reader, monthStart),
    options.briefs === false ? Promise.resolve([] as AdBrief[]) : loadBriefs(reader),
  ]);
  const setup = metaAdsConfig(env);
  return { window, snapshot, leads, monthly, meta: { configured: setup.ok, missing: setup.ok ? [] : setup.missing }, briefs, sample: false };
}

/** The last 7 days in short, for the Overview's card, the department strip and the menu's red circle. */
export async function loadAdsSummary(reader: SupabaseClient, now: Date, env: NodeJS.ProcessEnv | Record<string, string | undefined>): Promise<AdsSummary> {
  const payload = await loadAdsPayload(reader, { preset: 7 }, now, env, { briefs: false });
  const connected = payload.meta.configured && payload.snapshot.account !== null;
  const report = payload.snapshot.account ? buildReport(payload.snapshot, payload.leads, payload.window) : null;
  return adsSummary(report, { connected, sample: false, syncedAt: payload.snapshot.syncedAt });
}

// ── The sync (READ ONLY against Meta) ───────────────────────────────────

export interface SyncOutcome {
  ok: boolean;
  /** Not configured: the variables that are missing (nothing was called, nothing recorded). */
  missing?: string[];
  since?: string;
  until?: string;
  rows?: number;
  error?: string;
}

/** Days re-read on every sync (Meta revises recent numbers, conversions up to a week later), and on the first. */
export const SYNC_DAYS = { recent: 7, first: 90 } as const;

/** The sync's heartbeat (cron_heartbeats, migration 0034), the same row shape as the other jobs'. Never fails the sync. */
async function beat(db: SupabaseClient, now: Date, outcome: { ok: boolean; error?: string; rows?: number }): Promise<void> {
  try {
    await db.from("cron_heartbeats").upsert({
      job: "ads",
      last_run_at: now.toISOString(),
      ...(outcome.ok ? { last_ok_at: now.toISOString(), last_error: null } : { last_error: (outcome.error ?? "error").slice(0, 300) }),
      detail: outcome.rows === undefined ? {} : { rows: outcome.rows },
    });
  } catch {
    // The heartbeat is a convenience.
  }
}

const chunks = <T>(list: readonly T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

/**
 * Reads the ad account from Meta and caches it: the account, every campaign,
 * ad set and ad, and the numbers per ad per day for the last 7 days (90 on
 * the first sync). Every sync is recorded, worked or not. `by`: "cron" or a
 * member's handle. Nothing is ever sent to Meta but GET requests.
 */
export async function runAdsSync(db: SupabaseClient, now: Date, deps: { http: Http; env: NodeJS.ProcessEnv | Record<string, string | undefined>; by?: string; days?: number }): Promise<SyncOutcome> {
  const setup = metaAdsConfig(deps.env);
  if (!setup.ok) return { ok: false, missing: setup.missing };
  const config = setup.config;
  const by = (deps.by ?? "cron").slice(0, 40);
  let since: string | undefined;
  let until: string | undefined;
  try {
    const account = await readAccount(config, deps.http);
    const { data: existing } = await db.from("ads_insights_daily").select("day").eq("account_id", account.id).limit(1);
    const span = deps.days ?? ((existing as Row[] | null)?.length ? SYNC_DAYS.recent : SYNC_DAYS.first);
    until = dayInZone(now, account.timeZone);
    since = addDays(until, -(Math.min(Math.max(span, 1), 400) - 1));

    const { error: accountError } = await db.from("ads_accounts").upsert({
      id: account.id,
      name: account.name,
      currency: account.currency,
      time_zone: account.timeZone,
      status: account.status,
      status_code: account.statusCode,
      updated_at: now.toISOString(),
    });
    if (accountError) throw new Error(`ads_accounts: ${accountError.message}`);

    const structure = await readStructure(config, deps.http);
    const at = now.toISOString();
    const objects: Row[] = [
      ...structure.campaigns.map((c) => ({
        id: c.id,
        account_id: account.id,
        level: "campaign",
        campaign_id: null,
        adset_id: null,
        name: c.name,
        status: c.status,
        objective: c.objective,
        special_ad_categories: c.specialAdCategories,
        optimization_goal: null,
        result_action: null,
        result_kind: null,
        daily_budget_cents: c.dailyBudgetCents,
        lifetime_budget_cents: c.lifetimeBudgetCents,
        creative: {},
        preview_url: null,
        meta_created_at: c.createdAt,
        synced_at: at,
      })),
      ...structure.adsets.map((s) => ({
        id: s.id,
        account_id: account.id,
        level: "adset",
        campaign_id: s.campaignId,
        adset_id: null,
        name: s.name,
        status: s.status,
        objective: null,
        special_ad_categories: [],
        optimization_goal: s.optimizationGoal,
        result_action: s.resultAction ? cleanText(s.resultAction, 80) : null,
        result_kind: s.resultKind,
        daily_budget_cents: null,
        lifetime_budget_cents: null,
        creative: {},
        preview_url: null,
        meta_created_at: s.createdAt,
        synced_at: at,
      })),
      ...structure.ads.map((a) => ({
        id: a.id,
        account_id: account.id,
        level: "ad",
        campaign_id: a.campaignId,
        adset_id: a.adsetId,
        name: a.name,
        status: a.status,
        objective: null,
        special_ad_categories: [],
        optimization_goal: null,
        result_action: null,
        result_kind: null,
        daily_budget_cents: null,
        lifetime_budget_cents: null,
        creative: a.creative,
        preview_url: a.previewUrl,
        meta_created_at: a.createdAt,
        synced_at: at,
      })),
    ];
    for (const part of chunks(objects, 500)) {
      const { error } = await db.from("ads_objects").upsert(part);
      if (error) throw new Error(`ads_objects: ${error.message}`);
    }

    const insights = await readInsights(config, deps.http, { since, until }, structure.adsets);
    const values = insights.map((d) => ({
      account_id: account.id,
      ad_id: d.adId,
      adset_id: d.adsetId,
      campaign_id: d.campaignId,
      day: d.day,
      spend_cents: d.spendCents,
      impressions: d.impressions,
      clicks: d.clicks,
      results: d.results,
      synced_at: at,
    }));
    for (const part of chunks(values, 500)) {
      const { error } = await db.from("ads_insights_daily").upsert(part, { onConflict: "ad_id,day" });
      if (error) throw new Error(`ads_insights_daily: ${error.message}`);
    }

    await db.from("ads_accounts").update({ last_synced_at: at }).eq("id", account.id);
    await db.from("ads_sync_runs").insert({ account_id: account.id, ok: true, since, until, rows: values.length, error: null, by_handle: by });
    await beat(db, now, { ok: true, rows: values.length });
    return { ok: true, since, until, rows: values.length };
  } catch (error) {
    const message = (error instanceof MetaAdsError ? `Meta: ${error.message}` : error instanceof Error ? error.message : "The sync stopped.").slice(0, 500);
    await db.from("ads_sync_runs").insert({ account_id: config.accountId, ok: false, since: since ?? null, until: until ?? null, rows: 0, error: message, by_handle: by }).then(() => undefined, () => undefined);
    await beat(db, now, { ok: false, error: message });
    return { ok: false, since, until, error: message };
  }
}
