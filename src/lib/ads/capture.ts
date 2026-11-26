import type { AdTouch, AttributionUtm } from "./types";

// Where a visitor came from, kept so a lead can be credited to the ad that
// brought them (docs/ADS.md, "Where each number comes from").
//
// A Meta ad's link carries tags in its URL (set once in Ads Manager, "URL
// parameters"): utm_source, utm_medium, utm_campaign, utm_content, utm_term,
// and ad_id / adset_id / campaign_id (Meta's {{ad.id}}, {{adset.id}},
// {{campaign.id}}). Meta adds fbclid by itself. On the first page the visitor
// opens, the tags are read (AttributionCapture, in the root layout) and kept
// in this browser for 28 days (Meta's click window); the chat signup sends
// them with its start, and the database copies them into the lead's first
// touch (migration 0037). First touch wins: tags are never overwritten while
// they are fresh.
//
// Marketing tags only, cleaned and capped. The Facebook click id is never
// kept: only the fact that there was one. Nothing personal is read or stored.

export const ATTRIBUTION_KEY = "credalti.attribution.v1";
export const ATTRIBUTION_DAYS = 28;

export interface CapturedAttribution {
  utm?: AttributionUtm;
  ad?: AdTouch;
  /** When it was captured (ISO), to let it expire. */
  at?: string;
}

const UTM_KEYS = ["source", "medium", "campaign", "content", "term"] as const;

/** A tag's value: letters, digits and a few separators, at most 120 characters; anything else is dropped. */
export function cleanTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  return v && v.length <= 120 && /^[\p{L}\p{N} ._\-|:+/()·#&,]+$/u.test(v) ? v : null;
}

const metaId = (value: unknown): string | null => (typeof value === "string" && /^\d{3,25}$/.test(value.trim()) ? value.trim() : null);

/** The tags in a URL's query string, or null when there are none. */
export function attributionFromSearch(search: string, now: Date = new Date()): CapturedAttribution | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  } catch {
    return null;
  }
  const utm: AttributionUtm = {};
  for (const key of UTM_KEYS) {
    const v = cleanTag(params.get(`utm_${key}`));
    if (v) utm[key] = v;
  }
  const ad: AdTouch = {};
  const adId = metaId(params.get("ad_id"));
  const adsetId = metaId(params.get("adset_id"));
  const campaignId = metaId(params.get("campaign_id"));
  if (adId) ad.adId = adId;
  if (adsetId) ad.adsetId = adsetId;
  if (campaignId) ad.campaignId = campaignId;
  if ((params.get("fbclid") ?? "").trim().length > 0) ad.fbclid = true;
  const hasUtm = Object.keys(utm).length > 0;
  const hasAd = Object.keys(ad).length > 0;
  if (!hasUtm && !hasAd) return null;
  return { ...(hasUtm ? { utm } : {}), ...(hasAd ? { ad: { ...ad, via: "link" as const } } : {}), at: now.toISOString() };
}

/**
 * What a browser sent (the signup's start), checked again on the server:
 * only the known keys, each cleaned. Null when nothing is left. `at` is
 * dropped: the database keeps its own time.
 */
export function sanitizeAttribution(value: unknown): Omit<CapturedAttribution, "at"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const utmIn = v.utm && typeof v.utm === "object" ? (v.utm as Record<string, unknown>) : {};
  const adIn = v.ad && typeof v.ad === "object" ? (v.ad as Record<string, unknown>) : {};
  const utm: AttributionUtm = {};
  for (const key of UTM_KEYS) {
    const tag = cleanTag(utmIn[key]);
    if (tag) utm[key] = tag;
  }
  const ad: AdTouch = {};
  const adId = metaId(adIn.adId);
  const adsetId = metaId(adIn.adsetId);
  const campaignId = metaId(adIn.campaignId);
  if (adId) ad.adId = adId;
  if (adsetId) ad.adsetId = adsetId;
  if (campaignId) ad.campaignId = campaignId;
  if (adIn.fbclid === true) ad.fbclid = true;
  const hasUtm = Object.keys(utm).length > 0;
  const hasAd = Object.keys(ad).length > 0;
  if (!hasUtm && !hasAd) return null;
  return { ...(hasUtm ? { utm } : {}), ...(hasAd ? { ad: { ...ad, via: "link" as const } } : {}) };
}

/** Still fresh: captured within the last 28 days. */
export function isFresh(captured: CapturedAttribution | null, now: Date = new Date()): boolean {
  if (!captured?.at) return false;
  const at = Date.parse(captured.at);
  return Number.isFinite(at) && now.getTime() - at <= ATTRIBUTION_DAYS * 86_400_000 && at <= now.getTime() + 60_000;
}

// ── In the browser ──────────────────────────────────────────────────────

/** The tags kept in this browser, when fresh. */
export function readAttribution(now: Date = new Date()): Omit<CapturedAttribution, "at"> | null {
  try {
    const raw = window.localStorage.getItem(ATTRIBUTION_KEY);
    const parsed = raw ? (JSON.parse(raw) as CapturedAttribution) : null;
    return parsed && isFresh(parsed, now) ? sanitizeAttribution(parsed) : null;
  } catch {
    return null;
  }
}

/** Keeps this page's tags, unless fresh ones are already kept (first touch wins). */
export function rememberAttribution(search: string, now: Date = new Date()): void {
  const found = attributionFromSearch(search, now);
  if (!found) return;
  try {
    const raw = window.localStorage.getItem(ATTRIBUTION_KEY);
    if (raw && isFresh(JSON.parse(raw) as CapturedAttribution, now)) return;
    window.localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(found));
  } catch {
    // Storage blocked: the lead is simply not credited to an ad.
  }
}
