import type { SupabaseClient } from "@supabase/supabase-js";
import { queueStatus } from "../autopilot/store";
import { reportError } from "../observability/errors";
import type { StaffClient } from "../staff/types";
import {
  ALL_MILESTONES_ON,
  DEFAULT_REVIEW_SETTINGS,
  EMPTY_PLATFORMS,
  platformUrlProblem,
  PULSE_MOMENTS_WITH_LINKS,
  REVIEW_MILESTONES,
  REVIEW_PLATFORMS,
  reviewRequestDue,
  type ReviewMilestone,
  type ReviewPlatform,
  type ReviewPlatformKey,
  type ReviewRequestRecord,
  type ReviewSettings,
} from "./reviews";

// The review engine on the database (migration 0029). Service role only; the
// callers (the autopilot run, the pulse route, the staff route) have checked
// who is asking.

type Row = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const iso = (v: unknown) => (v ? new Date(text(v)).toISOString() : null);

export async function loadReviewSettings(db: SupabaseClient): Promise<ReviewSettings> {
  const { data, error } = await db.from("review_settings").select("*").eq("id", true).maybeSingle();
  if (error) {
    if (error.code === "42P01") return DEFAULT_REVIEW_SETTINGS;
    throw new Error(`review_settings: ${error.message}`);
  }
  if (!data) return DEFAULT_REVIEW_SETTINGS;
  const row = data as Row;
  const stored = (row.milestones as Record<string, unknown> | null) ?? {};
  return {
    requestsEnabled: row.requests_enabled === true,
    milestones: Object.fromEntries(REVIEW_MILESTONES.map((m) => [m, stored[m] !== false])) as Record<ReviewMilestone, boolean>,
    updatedAt: iso(row.updated_at),
    updatedBy: text(row.updated_by_name) || null,
  };
}

export async function loadReviewPlatforms(db: SupabaseClient): Promise<ReviewPlatform[]> {
  const { data, error } = await db.from("review_platforms").select("*");
  if (error) {
    if (error.code === "42P01") return EMPTY_PLATFORMS;
    throw new Error(`review_platforms: ${error.message}`);
  }
  const rows = (data as Row[] | null) ?? [];
  return REVIEW_PLATFORMS.map((key) => {
    const row = rows.find((r) => r.key === key);
    if (!row) return EMPTY_PLATFORMS.find((p) => p.key === key)!;
    return {
      key,
      url: text(row.url) || null,
      enabled: row.enabled === true,
      rating: row.rating == null ? null : Number(row.rating),
      reviewCount: row.review_count == null ? null : Number(row.review_count),
      ratingUpdatedAt: iso(row.rating_updated_at),
      ratingUpdatedBy: text(row.rating_updated_by_name) || null,
    };
  });
}

export async function loadReviewRequests(db: SupabaseClient): Promise<ReviewRequestRecord[]> {
  const { data, error } = await db.from("review_requests").select("*");
  if (error) {
    if (error.code === "42P01") return [];
    throw new Error(`review_requests: ${error.message}`);
  }
  return ((data as Row[] | null) ?? []).map((r) => ({
    userId: text(r.user_id),
    milestone: text(r.milestone) as ReviewMilestone,
    channel: text(r.channel) === "in_app" ? "in_app" : "whatsapp_or_email",
    at: iso(r.created_at) ?? "",
  }));
}

export interface ReviewSettingsPatch {
  requestsEnabled?: boolean;
  milestones?: Partial<Record<ReviewMilestone, boolean>>;
}

export async function saveReviewSettings(db: SupabaseClient, patch: ReviewSettingsPatch, by: { userId: string; handle: string }): Promise<ReviewSettings> {
  const before = await loadReviewSettings(db);
  const milestones = { ...ALL_MILESTONES_ON, ...before.milestones, ...(patch.milestones ?? {}) };
  const requestsEnabled = patch.requestsEnabled ?? before.requestsEnabled;
  const { error } = await db
    .from("review_settings")
    .update({ requests_enabled: requestsEnabled, milestones, updated_by: by.userId, updated_by_name: by.handle })
    .eq("id", true);
  if (error) throw new Error(`review_settings: ${error.message}`);
  await db.from("team_audit").insert({ actor: by.userId, kind: "reviews_changed", detail: { settings: { from: before, to: { requestsEnabled, milestones } } } });
  return { requestsEnabled, milestones, updatedAt: new Date().toISOString(), updatedBy: by.handle };
}

export interface PlatformPatch {
  key: ReviewPlatformKey;
  url?: string | null;
  enabled?: boolean;
  rating?: number | null;
  reviewCount?: number | null;
}

export async function savePlatform(db: SupabaseClient, patch: PlatformPatch, by: { userId: string; handle: string }): Promise<{ ok: true } | { ok: false; code: string }> {
  const update: Row = {};
  if (patch.url !== undefined) {
    const url = patch.url?.trim() || null;
    if (url && platformUrlProblem(patch.key, url)) return { ok: false, code: platformUrlProblem(patch.key, url)! };
    update.url = url;
    if (!url) update.enabled = false;
  }
  if (patch.enabled !== undefined) update.enabled = patch.enabled;
  if (patch.rating !== undefined || patch.reviewCount !== undefined) {
    if (patch.rating !== undefined) update.rating = patch.rating === null ? null : Math.round(patch.rating * 10) / 10;
    if (patch.reviewCount !== undefined) update.review_count = patch.reviewCount;
    update.rating_updated_at = new Date().toISOString();
    update.rating_updated_by_name = by.handle;
  }
  const { error } = await db.from("review_platforms").update(update).eq("key", patch.key);
  if (error) {
    if (error.code === "23514") return { ok: false, code: "invalid" };
    throw new Error(`review_platforms: ${error.message}`);
  }
  await db.from("team_audit").insert({ actor: by.userId, kind: "reviews_changed", detail: { platform: patch.key, ...update } });
  return { ok: true };
}

/** Writes the one request a client gets. "duplicate": they were asked already (any channel). */
async function claimRequest(db: SupabaseClient, userId: string, milestone: ReviewMilestone, channel: ReviewRequestRecord["channel"], now: Date): Promise<"claimed" | "duplicate"> {
  const { error } = await db.from("review_requests").insert({ user_id: userId, milestone, channel, created_at: now.toISOString() });
  if (!error) return "claimed";
  if (error.code === "23505") return "duplicate";
  throw new Error(`review_requests: ${error.message}`);
}

/**
 * The pulse was answered (any face) at a moment that shows the links: the
 * links are shown in the app, which is this client's one ask. Recorded only
 * when asking is on and a site is set up, as the screen shows them only then.
 */
export async function recordInAppReviewRequest(db: SupabaseClient, userId: string, moment: string, now: Date = new Date()): Promise<"claimed" | "duplicate" | "skipped"> {
  try {
    if (!PULSE_MOMENTS_WITH_LINKS.includes(moment)) return "skipped";
    const [settings, platforms] = await Promise.all([loadReviewSettings(db), loadReviewPlatforms(db)]);
    if (!settings.requestsEnabled || !settings.milestones.pulse_answered || !platforms.some((p) => p.enabled && p.url)) return "skipped";
    return await claimRequest(db, userId, "pulse_answered", "in_app", now);
  } catch (error) {
    await reportError(error, { where: "reviews:inApp", userId });
    return "skipped";
  }
}

/** Clients someone they referred has signed up through (client_referrals + a signed agreement). */
async function referrersWithSignedReferral(db: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await db.from("client_referrals").select("referrer_user_id, referred_user_id");
  if (error) return new Set();
  const pairs = (data as Row[] | null) ?? [];
  if (pairs.length === 0) return new Set();
  const { data: signed } = await db.from("service_agreements").select("user_id, signed_at, cancelled_at").in("user_id", pairs.map((p) => text(p.referred_user_id)));
  const ok = new Set(((signed as Row[] | null) ?? []).filter((r) => r.signed_at && !r.cancelled_at).map((r) => text(r.user_id)));
  return new Set(pairs.filter((p) => ok.has(text(p.referred_user_id))).map((p) => text(p.referrer_user_id)));
}

export interface ReviewRunSummary {
  asked: number;
  byMilestone: Partial<Record<ReviewMilestone, number>>;
}

/**
 * One pass of the autopilot run: every client who reached a milestone and was
 * never asked gets the request queued, through the outbound log and its rules
 * (opt-out, quiet hours, the daily cap, the dedupe key, WhatsApp then email,
 * never SMS). The record is claimed first, so a run twice asks once.
 */
export async function runReviewRequests(db: SupabaseClient, clients: readonly StaffClient[], now: Date): Promise<ReviewRunSummary> {
  const summary: ReviewRunSummary = { asked: 0, byMilestone: {} };
  const settings = await loadReviewSettings(db);
  if (!settings.requestsEnabled) return summary;
  const [platforms, requests, referrers] = await Promise.all([loadReviewPlatforms(db), loadReviewRequests(db), referrersWithSignedReferral(db)]);
  const asked = new Set(requests.map((r) => r.userId));
  for (const client of clients) {
    const milestone = reviewRequestDue({ client, settings, platforms, alreadyAsked: asked.has(client.id), referralSigned: referrers.has(client.id) });
    if (!milestone) continue;
    if ((await claimRequest(db, client.id, milestone, "whatsapp_or_email", now)) !== "claimed") continue;
    await queueStatus(db, client.id, { kind: "review_request", milestone }, now);
    summary.asked += 1;
    summary.byMilestone[milestone] = (summary.byMilestone[milestone] ?? 0) + 1;
  }
  return summary;
}
