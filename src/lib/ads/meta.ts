import { createHmac } from "node:crypto";
import type { AccountStatus, Ad, AdAccount, AdCampaign, AdCreative, AdDay, AdSet, ResultKind } from "./types";

// Meta's Marketing API, READ ONLY. The Ads Manager pulls the ad account, its
// campaigns, ad sets and ads (with each ad's creative) and the numbers per ad
// per day. It never creates, edits, pauses or pays for anything: every call
// here is a GET, and the token only needs `ads_read` (docs/ADS.md).
//
// Server only. The token is read from the environment and sent in the
// Authorization header (never in a URL that could be logged). When
// META_APP_SECRET is set (the same Meta app that publishes content,
// docs/CONTENT.md), every call also carries appsecret_proof, as Meta
// recommends.
//
// The parsers below are pure and strict: every string is trimmed and capped,
// every link must be https, every id must look like a Meta id. What does not
// fit is dropped, never guessed.

export const DEFAULT_GRAPH_VERSION = "v21.0";
const GRAPH_HOST = "https://graph.facebook.com/";

export type Http = (url: string, init?: RequestInit) => Promise<Response>;

export interface MetaAdsConfig {
  token: string;
  /** "act_1234567890". */
  accountId: string;
  version: string;
  appSecret: string | null;
}

export { META_ADS_ENV } from "./types";

export function metaAdsConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): { ok: true; config: MetaAdsConfig } | { ok: false; missing: string[] } {
  const token = String(env.META_ADS_ACCESS_TOKEN ?? "").trim();
  const rawAccount = String(env.META_AD_ACCOUNT_ID ?? "").trim().replace(/^act_/, "");
  const missing: string[] = [];
  if (!token) missing.push("META_ADS_ACCESS_TOKEN");
  if (!/^\d{3,25}$/.test(rawAccount)) missing.push("META_AD_ACCOUNT_ID");
  if (missing.length > 0) return { ok: false, missing };
  const version = String(env.META_GRAPH_VERSION ?? "").trim();
  const secret = String(env.META_APP_SECRET ?? "").trim();
  return {
    ok: true,
    config: { token, accountId: `act_${rawAccount}`, version: /^v\d{1,2}\.\d$/.test(version) ? version : DEFAULT_GRAPH_VERSION, appSecret: secret || null },
  };
}

export class MetaAdsError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** "auth": the token or its permission; "rate": too many calls; "other". */
    readonly kind: "auth" | "rate" | "other",
  ) {
    super(message);
  }
}

// ── Small, strict readers ───────────────────────────────────────────────

type Row = Record<string, unknown>;
const obj = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Plain text: control characters and angle brackets out, spaces folded, capped. Null when empty. */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const out = v.replace(/[\u0000-\u0008\u000b-\u001f<>]/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return out ? out.slice(0, max) : null;
}

const metaId = (v: unknown): string | null => {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  return /^\d{3,25}$/.test(s) ? s : null;
};

/** An https link Meta gave (a thumbnail on its CDN, the ad's landing page); null for anything else. */
export function httpsUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 2000) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** "12.34" (currency units, as insights report spend) → 1234 cents. */
export function unitsToCents(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

/** "5000" (minor units, as Meta writes budgets) → 5000 cents; null when absent. */
function minorUnits(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const count = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

const status = (v: unknown): string => (typeof v === "string" && /^[A-Z_]{2,40}$/.test(v) ? v : "UNKNOWN");
const when = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

// ── The account ─────────────────────────────────────────────────────────

const ACCOUNT_STATUS: Record<number, AccountStatus> = { 1: "active", 2: "disabled", 3: "unsettled", 7: "review", 8: "unsettled", 9: "grace", 100: "closing", 101: "closed" };

function validTimeZone(v: unknown): string | null {
  if (typeof v !== "string" || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/.test(v)) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return v;
  } catch {
    return null;
  }
}

export function parseAccount(json: unknown, fallbackId: string): AdAccount {
  const a = obj(json);
  const id = typeof a.id === "string" && /^act_\d{3,25}$/.test(a.id) ? a.id : fallbackId;
  const code = Number(a.account_status);
  return {
    id,
    name: cleanText(a.name, 120) ?? id,
    currency: typeof a.currency === "string" && /^[A-Z]{3}$/.test(a.currency) ? a.currency : "USD",
    // Ads Manager's days are the account's; Texas when Meta did not say.
    timeZone: validTimeZone(a.timezone_name) ?? "America/Chicago",
    status: ACCOUNT_STATUS[code] ?? "unknown",
    statusCode: Number.isFinite(code) ? code : null,
  };
}

// ── What Meta counts as a result ────────────────────────────────────────

/** Meta's lead actions, in the order Ads Manager falls back on them. */
export const LEAD_ACTIONS = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "leadgen_grouped", "onsite_web_lead"] as const;
export const CONVERSATION_ACTION = "onsite_conversion.messaging_conversation_started_7d";

const PIXEL_EVENT: Record<string, string> = {
  LEAD: "offsite_conversion.fb_pixel_lead",
  COMPLETE_REGISTRATION: "offsite_conversion.fb_pixel_complete_registration",
  CONTACT: "offsite_conversion.fb_pixel_contact",
  SUBMIT_APPLICATION: "offsite_conversion.fb_pixel_submit_application",
};

/** The action that is an ad set's "result", from its optimization goal (what Ads Manager's Results column counts). */
export function resultOf(goal: unknown, promoted: unknown): { action: string | null; kind: ResultKind } {
  const g = typeof goal === "string" ? goal.toUpperCase() : "";
  if (g === "LEAD_GENERATION" || g === "QUALITY_LEAD") return { action: "lead", kind: "leads_form" };
  if (g === "CONVERSATIONS") return { action: CONVERSATION_ACTION, kind: "conversations" };
  if (g === "LINK_CLICKS") return { action: "link_click", kind: "link_clicks" };
  if (g === "LANDING_PAGE_VIEWS") return { action: "landing_page_view", kind: "landing_page_views" };
  if (g === "OFFSITE_CONVERSIONS" || g === "VALUE") {
    const event = String(obj(promoted).custom_event_type ?? "").toUpperCase();
    if (event === "LEAD" || !event) return { action: PIXEL_EVENT.LEAD!, kind: "website_leads" };
    return PIXEL_EVENT[event] ? { action: PIXEL_EVENT[event]!, kind: "website_other" } : { action: null, kind: "results" };
  }
  return { action: null, kind: "results" };
}

function actionValue(actions: unknown, type: string): number | null {
  const found = list(actions).map(obj).find((a) => a.action_type === type);
  return found ? count(found.value) : null;
}

/**
 * Meta's results for one ad on one day. With the ad set's result action: its
 * value (0 when Meta listed nothing for it). Without one: the first lead or
 * conversation action Meta reported, else null (we do not know what a result is).
 */
export function resultsOf(actions: unknown, action: string | null): number | null {
  if (action) return actionValue(actions, action) ?? 0;
  for (const type of [...LEAD_ACTIONS, CONVERSATION_ACTION]) {
    const v = actionValue(actions, type);
    if (v !== null) return v;
  }
  return null;
}

// ── Campaigns, ad sets, ads ─────────────────────────────────────────────

export function parseCampaign(json: unknown): AdCampaign | null {
  const c = obj(json);
  const id = metaId(c.id);
  if (!id) return null;
  return {
    id,
    name: cleanText(c.name, 200) ?? id,
    status: status(c.effective_status ?? c.status),
    objective: typeof c.objective === "string" && /^[A-Z_]{2,40}$/.test(c.objective) ? c.objective : null,
    specialAdCategories: list(c.special_ad_categories).filter((x): x is string => typeof x === "string" && /^[A-Z_]{2,40}$/.test(x)),
    dailyBudgetCents: minorUnits(c.daily_budget),
    lifetimeBudgetCents: minorUnits(c.lifetime_budget),
    createdAt: when(c.created_time),
  };
}

export function parseAdSet(json: unknown): AdSet | null {
  const s = obj(json);
  const id = metaId(s.id);
  const campaignId = metaId(s.campaign_id);
  if (!id || !campaignId) return null;
  const result = resultOf(s.optimization_goal, s.promoted_object);
  return {
    id,
    campaignId,
    name: cleanText(s.name, 200) ?? id,
    status: status(s.effective_status ?? s.status),
    optimizationGoal: typeof s.optimization_goal === "string" && /^[A-Z_]{2,40}$/.test(s.optimization_goal) ? s.optimization_goal : null,
    resultAction: result.action,
    resultKind: result.kind,
    createdAt: when(s.created_time),
  };
}

/** An ad's creative: the plain creative fields first, then the story spec (link or video), then a dynamic creative's first asset. */
export function parseCreative(json: unknown): AdCreative {
  const c = obj(json);
  const story = obj(c.object_story_spec);
  const linkData = obj(story.link_data);
  const videoData = obj(story.video_data);
  const feed = obj(c.asset_feed_spec);
  const firstText = (v: unknown) => cleanText(obj(list(v)[0]).text, 2000);
  const cta = obj(linkData.call_to_action).type ?? obj(videoData.call_to_action).type ?? c.call_to_action_type ?? list(feed.call_to_action_types)[0];
  const ctaLink = obj(obj(linkData.call_to_action).value).link ?? obj(obj(videoData.call_to_action).value).link;
  const feedVideo = obj(list(feed.videos)[0]);
  return {
    title: cleanText(c.title, 200) ?? cleanText(linkData.name, 200) ?? cleanText(videoData.title, 200) ?? firstText(feed.titles)?.slice(0, 200) ?? null,
    body: cleanText(c.body, 2000) ?? cleanText(linkData.message, 2000) ?? cleanText(videoData.message, 2000) ?? firstText(feed.bodies),
    thumbnailUrl: httpsUrl(c.thumbnail_url) ?? httpsUrl(videoData.image_url) ?? httpsUrl(feedVideo.thumbnail_url),
    imageUrl: httpsUrl(c.image_url) ?? httpsUrl(linkData.picture),
    videoId: metaId(c.video_id) ?? metaId(videoData.video_id) ?? metaId(feedVideo.video_id),
    callToAction: typeof cta === "string" && /^[A-Z_]{2,40}$/.test(cta) ? cta : null,
    link: httpsUrl(linkData.link) ?? httpsUrl(ctaLink) ?? httpsUrl(obj(list(feed.link_urls)[0]).website_url),
  };
}

export function parseAd(json: unknown): Ad | null {
  const a = obj(json);
  const id = metaId(a.id);
  const adsetId = metaId(a.adset_id);
  const campaignId = metaId(a.campaign_id);
  if (!id || !adsetId || !campaignId) return null;
  return {
    id,
    adsetId,
    campaignId,
    name: cleanText(a.name, 200) ?? id,
    status: status(a.effective_status ?? a.status),
    createdAt: when(a.created_time),
    creative: parseCreative(a.creative),
    previewUrl: httpsUrl(a.preview_shareable_link),
  };
}

/** One row of insights (level=ad, time_increment=1). `resultActions`: each ad set's result action. */
export function parseInsight(json: unknown, resultActions: ReadonlyMap<string, string | null>): AdDay | null {
  const x = obj(json);
  const adId = metaId(x.ad_id);
  const adsetId = metaId(x.adset_id);
  const campaignId = metaId(x.campaign_id);
  const day = typeof x.date_start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.date_start) ? x.date_start : null;
  if (!adId || !adsetId || !campaignId || !day) return null;
  const action = resultActions.has(adsetId) ? resultActions.get(adsetId)! : null;
  return {
    adId,
    adsetId,
    campaignId,
    day,
    spendCents: unitsToCents(x.spend),
    impressions: count(x.impressions),
    clicks: count(x.inline_link_clicks ?? x.clicks),
    results: resultsOf(x.actions, action),
  };
}

// ── Calls ───────────────────────────────────────────────────────────────

export const ACCOUNT_FIELDS = "id,name,account_status,currency,timezone_name";
export const CAMPAIGN_FIELDS = "id,name,effective_status,objective,special_ad_categories,daily_budget,lifetime_budget,created_time";
export const ADSET_FIELDS = "id,name,effective_status,campaign_id,optimization_goal,promoted_object,created_time";
export const AD_FIELDS =
  "id,name,effective_status,adset_id,campaign_id,created_time,preview_shareable_link,creative{title,body,thumbnail_url,image_url,video_id,call_to_action_type,object_story_spec,asset_feed_spec}";
export const INSIGHT_FIELDS = "ad_id,adset_id,campaign_id,spend,impressions,inline_link_clicks,actions";

function proof(config: MetaAdsConfig): Record<string, string> {
  return config.appSecret ? { appsecret_proof: createHmac("sha256", config.appSecret).update(config.token).digest("hex") } : {};
}

/** The URL of one GET (no token in it: the token goes in the header). */
export function graphUrl(config: MetaAdsConfig, path: string, params: Record<string, string>): string {
  return `${GRAPH_HOST}${config.version}/${path}?${new URLSearchParams({ ...params, ...proof(config) }).toString()}`;
}

async function getJson(config: MetaAdsConfig, http: Http, url: string): Promise<Row> {
  let res: Response;
  try {
    res = await http(url, { method: "GET", headers: { authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    throw new MetaAdsError(`Meta could not be reached: ${error instanceof Error ? error.message.slice(0, 120) : "network error"}`, null, "other");
  }
  const body = obj(await res.json().catch(() => ({})));
  if (!res.ok) {
    const err = obj(body.error);
    const code = Number(err.code);
    const message = cleanText(err.message, 240) ?? `HTTP ${res.status}`;
    // 190: the token expired or was revoked; 10/200-299: a permission (ads_read) is missing.
    const kind = code === 190 || code === 10 || (code >= 200 && code < 300) || res.status === 401 || res.status === 403 ? "auth" : code === 4 || code === 17 || code === 80004 || res.status === 429 ? "rate" : "other";
    throw new MetaAdsError(message, res.status, kind);
  }
  return body;
}

/** Every page of a list answer. Only Meta's own "next" links are followed, at most `maxPages`. */
async function allPages(config: MetaAdsConfig, http: Http, first: string, maxPages = 50): Promise<unknown[]> {
  const rows: unknown[] = [];
  let next: string | null = first;
  for (let page = 0; next && page < maxPages; page++) {
    const body = await getJson(config, http, next);
    rows.push(...list(body.data));
    const link = obj(body.paging).next;
    next = typeof link === "string" && link.startsWith(GRAPH_HOST) ? link : null;
  }
  return rows;
}

export async function readAccount(config: MetaAdsConfig, http: Http): Promise<AdAccount> {
  return parseAccount(await getJson(config, http, graphUrl(config, config.accountId, { fields: ACCOUNT_FIELDS })), config.accountId);
}

export async function readStructure(config: MetaAdsConfig, http: Http): Promise<{ campaigns: AdCampaign[]; adsets: AdSet[]; ads: Ad[] }> {
  const path = (edge: string) => `${config.accountId}/${edge}`;
  const [campaigns, adsets, ads] = await Promise.all([
    allPages(config, http, graphUrl(config, path("campaigns"), { fields: CAMPAIGN_FIELDS, limit: "200" })),
    allPages(config, http, graphUrl(config, path("adsets"), { fields: ADSET_FIELDS, limit: "200" })),
    allPages(config, http, graphUrl(config, path("ads"), { fields: AD_FIELDS, limit: "100" })),
  ]);
  return {
    campaigns: campaigns.map(parseCampaign).filter((x): x is AdCampaign => x !== null),
    adsets: adsets.map(parseAdSet).filter((x): x is AdSet => x !== null),
    ads: ads.map(parseAd).filter((x): x is Ad => x !== null),
  };
}

/** The numbers per ad per day, from `since` to `until` (account days, inclusive). */
export async function readInsights(config: MetaAdsConfig, http: Http, range: { since: string; until: string }, adsets: readonly AdSet[]): Promise<AdDay[]> {
  const actions = new Map(adsets.map((s) => [s.id, s.resultAction]));
  const rows = await allPages(
    config,
    http,
    graphUrl(config, `${config.accountId}/insights`, {
      level: "ad",
      fields: INSIGHT_FIELDS,
      time_range: JSON.stringify(range),
      time_increment: "1",
      limit: "500",
    }),
  );
  return rows.map((r) => parseInsight(r, actions)).filter((x): x is AdDay => x !== null);
}

/** A video ad's playable file, read when a person taps play (Meta's links expire, so they are never stored). */
export async function readVideo(config: MetaAdsConfig, http: Http, videoId: string): Promise<{ src: string | null; poster: string | null }> {
  if (!metaId(videoId)) return { src: null, poster: null };
  const body = await getJson(config, http, graphUrl(config, videoId, { fields: "source,picture" }));
  return { src: httpsUrl(body.source), poster: httpsUrl(body.picture) };
}
