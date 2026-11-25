import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "../../observability/errors";
import { CONTENT_BUCKET } from "../assets";
import { isImageAsset, isVideoAsset } from "../check";
import { approvalHolds } from "../hash";
import { loadConnectionViews, loadPiece, loadPublishSettings, loadSecrets, log, scheduleFromRow, type ScheduleView } from "../server";
import type { ContentPiece, PublishChannel } from "../types";
import { tokenKey } from "./crypto";
import { composePost, HOLDING_GATES, providerFor, publishGates, GATE_TEXT, type GateCode } from "./gates";
import { PROVIDER_OF, type ConnectionSecrets, type Http, type ProviderId, type PublishMedia, type PublishOutcome } from "./types";

// The scheduler: one idempotent run, called by POST /api/cron/content with the
// shared secret (like /api/cron/autopilot). For each schedule that is due:
//
//   1. Read the piece, the settings and the connection; check every gate
//      (gates.ts). A gate that only holds it back (publishing off, channel off,
//      account not connected) leaves it waiting, logged once; after 24 hours
//      past its time it fails, so nothing old goes out late by surprise. A gate
//      about the piece (not approved, changed after approval, blocking issues,
//      no file for the channel) cancels it.
//   2. Claim it: scheduled/retry → publishing, in one conditional update. Only
//      the run that gets the row calls the provider; a second run finds nothing.
//      The publish key (piece, channel, approved hash) is unique in the
//      database, so the same approved content is never posted twice.
//   3. Call the provider with exactly the composed post; log what was sent and
//      what came back.
//   4. Posted: record the post on the schedule and the piece. Temporary error:
//      back to retry with backoff (5, 15, 60, 240 minutes; 5 attempts). Permanent
//      or expired account: Failed, the reason in plain words on the piece, and
//      an alert to the owner (ERROR_WEBHOOK_URL, the app's alert channel).
//   A schedule left in "publishing" (a run that died mid-call) is never sent
//   again blindly: after 15 minutes it fails with "check the account first".
//
// Then it reads the numbers of recent posts (read only), at most every 6 hours
// per post, into content_results.

export const BACKOFF_MINUTES = [5, 15, 60, 240] as const;
export const MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1;
const HOLD_LIMIT_MS = 24 * 60 * 60 * 1000;
const STUCK_MS = 15 * 60 * 1000;
const METRICS_EVERY_MS = 6 * 60 * 60 * 1000;
const METRICS_FOR_DAYS = 30;

export interface RunDeps {
  http: Http;
  env: NodeJS.ProcessEnv;
  /** Override for tests: the media URLs (signed links in production). */
  mediaUrl?: (path: string) => Promise<string | null>;
  /** Alert the owner (default: reportError to the alert webhook). */
  alert?: (text: string) => Promise<void>;
}

export interface RunSummary {
  due: number;
  posted: number;
  retried: number;
  failed: number;
  held: number;
  cancelled: number;
  skipped: number;
  metrics: number;
}

type Row = Record<string, unknown>;

const SYSTEM = "system" as const;

async function defaultAlert(text: string): Promise<void> {
  await reportError(new Error(text), { where: "content/publish" });
}

async function signedMedia(db: SupabaseClient, piece: ContentPiece, deps: RunDeps): Promise<PublishMedia[]> {
  const out: PublishMedia[] = [];
  for (const asset of piece.assets) {
    if (asset.kind !== "upload" || !asset.mediaType) continue;
    if (!isImageAsset(asset) && !isVideoAsset(asset)) continue;
    const url = deps.mediaUrl ? await deps.mediaUrl(asset.ref) : (await db.storage.from(CONTENT_BUCKET).createSignedUrl(asset.ref, 6 * 60 * 60)).data?.signedUrl ?? null;
    if (url) out.push({ url, mediaType: asset.mediaType, altText: asset.altText });
  }
  return out;
}

/** A fresh token when the access token is about to expire and the provider can refresh it. */
async function freshSecrets(db: SupabaseClient, secrets: ConnectionSecrets, deps: RunDeps, key: Buffer, now: Date): Promise<ConnectionSecrets | null> {
  if (!secrets.expiresAt || Date.parse(secrets.expiresAt) - now.getTime() > 5 * 60 * 1000) return secrets;
  const provider = providerFor(secrets.provider === "meta" ? "facebook" : secrets.provider);
  if (!provider.refresh || !secrets.refreshToken) return null;
  try {
    const grant = await provider.refresh(secrets, deps.env, deps.http);
    if (!grant) return null;
    const { encryptToken } = await import("./crypto");
    await db
      .from("content_connections")
      .update({
        token_enc: encryptToken(grant.accessToken, key),
        refresh_enc: grant.refreshToken ? encryptToken(grant.refreshToken, key) : null,
        expires_at: grant.expiresAt,
        status: "connected",
        last_error: null,
        updated_at: now.toISOString(),
      })
      .eq("provider", secrets.provider);
    return { ...secrets, accessToken: grant.accessToken, refreshToken: grant.refreshToken, expiresAt: grant.expiresAt };
  } catch {
    await db.from("content_connections").update({ status: "expired", last_error: "The token could not be renewed.", updated_at: now.toISOString() }).eq("provider", secrets.provider);
    return null;
  }
}

async function finishFailed(db: SupabaseClient, schedule: ScheduleView, piece: ContentPiece | null, reason: string, deps: RunDeps, extra: { response?: Row | null } = {}): Promise<void> {
  await db.from("content_schedules").update({ status: "failed", last_error: reason.slice(0, 500) }).eq("id", schedule.id).in("status", ["scheduled", "retry", "publishing"]);
  await log(db, { event: "failed", actor: SYSTEM, scheduleId: schedule.id, pieceId: schedule.pieceId, channel: schedule.channel, note: reason, response: extra.response ?? null });
  if (piece && ["approved", "scheduled"].includes(piece.status)) {
    await db.from("content_pieces").update({ status: "failed", failure: reason.slice(0, 500) }).eq("id", piece.id).in("status", ["approved", "scheduled"]);
    await db.from("content_events").insert({ piece_id: piece.id, actor: null, actor_handle: "system", kind: "failed", from_status: piece.status, to_status: "failed", note: `${schedule.channel}: ${reason}`.slice(0, 1000) });
  }
  await (deps.alert ?? defaultAlert)(`Content publishing failed: "${piece?.title ?? schedule.pieceId}" on ${schedule.channel}. ${reason}`);
}

async function publishOne(db: SupabaseClient, schedule: ScheduleView, deps: RunDeps, key: Buffer | null, now: Date, summary: RunSummary): Promise<void> {
  const loaded = await loadPiece(db, schedule.pieceId);
  if (!loaded) {
    summary.skipped += 1;
    return;
  }
  const piece = loaded.piece;
  const settings = await loadPublishSettings(db);
  const views = await loadConnectionViews(db, deps.env, now);
  const view = views.find((v) => v.provider === PROVIDER_OF[schedule.channel]) ?? null;
  let gates: GateCode[] = publishGates({ piece, channel: schedule.channel, settings, connection: view, now });
  if (!key && !gates.includes("not_configured")) gates = [...gates, "not_configured"];
  // The schedule is for one approved version: a newer approval is another schedule.
  if (piece.approval && piece.approval.hash !== schedule.approvalHash) gates.push("approval_changed");

  const pieceProblems = gates.filter((g) => !HOLDING_GATES.includes(g));
  if (pieceProblems.length > 0) {
    const reason = GATE_TEXT[pieceProblems[0]!].en;
    await db.from("content_schedules").update({ status: "cancelled", last_error: reason }).eq("id", schedule.id).in("status", ["scheduled", "retry"]);
    await log(db, { event: "blocked", actor: SYSTEM, scheduleId: schedule.id, pieceId: piece.id, channel: schedule.channel, note: pieceProblems.join(",") });
    summary.cancelled += 1;
    return;
  }
  if (gates.length > 0) {
    if (now.getTime() - Date.parse(schedule.scheduledAt) > HOLD_LIMIT_MS) {
      await finishFailed(db, schedule, piece, `It was held for more than a day (${GATE_TEXT[gates[0]!].en}) and missed its time. Schedule it again.`, deps);
      summary.failed += 1;
      return;
    }
    const reason = GATE_TEXT[gates[0]!].en;
    if (schedule.lastError !== reason) {
      await db.from("content_schedules").update({ last_error: reason }).eq("id", schedule.id).in("status", ["scheduled", "retry"]);
      await log(db, { event: "held", actor: SYSTEM, scheduleId: schedule.id, pieceId: piece.id, channel: schedule.channel, note: gates.join(",") });
    }
    summary.held += 1;
    return;
  }

  // Claim it: only the run that moves the row to "publishing" goes on.
  const { data: claimed } = await db
    .from("content_schedules")
    .update({ status: "publishing", claimed_at: now.toISOString(), attempts: schedule.attempts + 1 })
    .eq("id", schedule.id)
    .in("status", ["scheduled", "retry"])
    .select("id");
  if (!claimed || (claimed as Row[]).length === 0) {
    summary.skipped += 1;
    return;
  }
  await log(db, { event: "claimed", actor: SYSTEM, scheduleId: schedule.id, pieceId: piece.id, channel: schedule.channel, note: `attempt ${schedule.attempts + 1}` });

  const providerId: ProviderId = PROVIDER_OF[schedule.channel];
  const secrets = key ? await loadSecrets(db, providerId, key) : null;
  const fresh = secrets && key ? await freshSecrets(db, secrets, deps, key, now) : null;
  const media = await signedMedia(db, piece, deps);
  const job = composePost(piece, schedule.channel, schedule.lang, media, schedule.id);
  const payload = { text: job.text, title: job.title, contentType: job.contentType, language: job.language, assets: piece.assets.map((a) => a.id) };
  await log(db, { event: "sent", actor: SYSTEM, scheduleId: schedule.id, pieceId: piece.id, channel: schedule.channel, approvedBy: piece.approval?.by ?? null, approvalHash: piece.approval?.hash ?? null, payload });

  let outcome: PublishOutcome;
  if (!fresh) outcome = { ok: false, kind: "auth", reason: "The account's connection could not be read or renewed. An administrator has to connect it again." };
  else {
    try {
      outcome = await providerFor(schedule.channel).publish(job, fresh, deps.http, deps.env);
    } catch (error) {
      outcome = { ok: false, kind: "temporary", reason: `Unexpected error: ${error instanceof Error ? error.message.slice(0, 120) : "unknown"}` };
    }
  }

  if (outcome.ok) {
    const url = outcome.url && /^https:\/\//.test(outcome.url) ? outcome.url.slice(0, 500) : null;
    await db.from("content_schedules").update({ status: "posted", posted_at: now.toISOString(), external_id: outcome.externalId.slice(0, 200), url, note: outcome.note?.slice(0, 300) ?? null, last_error: null }).eq("id", schedule.id).eq("status", "publishing");
    await log(db, { event: "posted", actor: SYSTEM, scheduleId: schedule.id, pieceId: piece.id, channel: schedule.channel, response: { externalId: outcome.externalId, url, note: outcome.note ?? null } });
    const posts = [...piece.posts, { channel: schedule.channel, url: url ?? "", postedAt: now.toISOString(), by: "system", via: "app" as const, externalId: outcome.externalId }].filter((p) => p.url || p.externalId);
    const status = piece.status === "measured" ? "measured" : "posted";
    if (approvalHolds(piece)) {
      await db.from("content_pieces").update({ status, posts, failure: null }).eq("id", piece.id).in("status", ["approved", "scheduled", "posted", "measured", "failed"]);
      await db.from("content_events").insert({ piece_id: piece.id, actor: null, actor_handle: "system", kind: "posted", from_status: piece.status, to_status: status, note: `${schedule.channel} ${url ?? outcome.externalId}`.slice(0, 1000) });
    }
    summary.posted += 1;
    return;
  }

  const attempts = schedule.attempts + 1;
  if (outcome.kind === "temporary" && attempts < MAX_ATTEMPTS) {
    const wait = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)]!;
    await db
      .from("content_schedules")
      .update({ status: "retry", next_attempt_at: new Date(now.getTime() + wait * 60_000).toISOString(), last_error: outcome.reason.slice(0, 500) })
      .eq("id", schedule.id)
      .eq("status", "publishing");
    await log(db, { event: "retry", actor: SYSTEM, scheduleId: schedule.id, pieceId: piece.id, channel: schedule.channel, note: `${outcome.reason} (in ${wait} min)`, response: { detail: outcome.detail ?? null } });
    summary.retried += 1;
    return;
  }
  if (outcome.kind === "auth") {
    await db.from("content_connections").update({ status: "error", last_error: outcome.reason.slice(0, 300), updated_at: now.toISOString() }).eq("provider", providerId);
  }
  const reason = outcome.kind === "temporary" ? `${outcome.reason.replace(/ The app will try again\.$/, "")} It failed ${attempts} times.` : outcome.reason;
  await finishFailed(db, schedule, piece, reason, deps, { response: { kind: outcome.kind, detail: outcome.detail ?? null } });
  summary.failed += 1;
}

/** Publish what is due, settle stuck claims, then read recent numbers. Safe to run twice. */
export async function runContentPublishing(db: SupabaseClient, now: Date, deps: RunDeps): Promise<RunSummary> {
  const summary: RunSummary = { due: 0, posted: 0, retried: 0, failed: 0, held: 0, cancelled: 0, skipped: 0, metrics: 0 };
  const key = tokenKey(deps.env);

  // A claim older than 15 minutes: the run died mid-call. Never sent again blindly.
  const { data: stuck } = await db.from("content_schedules").select("*").eq("status", "publishing").lte("claimed_at", new Date(now.getTime() - STUCK_MS).toISOString());
  for (const row of (stuck ?? []) as Row[]) {
    const schedule = scheduleFromRow(row);
    const loaded = await loadPiece(db, schedule.pieceId);
    await finishFailed(db, schedule, loaded?.piece ?? null, "The app could not confirm whether this was posted. Check the account before scheduling it again.", deps);
    summary.failed += 1;
  }

  const { data: due, error } = await db.from("content_schedules").select("*").in("status", ["scheduled", "retry"]).lte("next_attempt_at", now.toISOString()).order("next_attempt_at", { ascending: true }).limit(25);
  if (error) throw new Error(error.message);
  for (const row of (due ?? []) as Row[]) {
    summary.due += 1;
    try {
      await publishOne(db, scheduleFromRow(row), deps, key, now, summary);
    } catch (e) {
      await reportError(e, { where: "content/publish", extra: { schedule: String(row.id) } });
    }
  }

  summary.metrics = await pullMetrics(db, now, deps, key);
  return summary;
}

/** Read-only numbers for posts made by the app in the last 30 days, at most every 6 hours each. */
export async function pullMetrics(db: SupabaseClient, now: Date, deps: RunDeps, key: Buffer | null): Promise<number> {
  if (!key) return 0;
  const since = new Date(now.getTime() - METRICS_FOR_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await db.from("content_schedules").select("*").eq("status", "posted").gte("posted_at", since).limit(200);
  let read = 0;
  const secretsBy = new Map<ProviderId, ConnectionSecrets | null>();
  for (const row of (data ?? []) as Row[]) {
    const schedule = scheduleFromRow(row);
    const last = row.metrics_at ? Date.parse(String(row.metrics_at)) : 0;
    if (!schedule.externalId || now.getTime() - last < METRICS_EVERY_MS) continue;
    const providerId = PROVIDER_OF[schedule.channel];
    if (!secretsBy.has(providerId)) secretsBy.set(providerId, await loadSecrets(db, providerId, key));
    const secrets = secretsBy.get(providerId);
    if (!secrets) continue;
    const outcome = await providerFor(schedule.channel).metrics({ channel: schedule.channel as PublishChannel, externalId: schedule.externalId }, secrets, deps.http);
    await db.from("content_schedules").update({ metrics_at: now.toISOString(), ...(outcome.ok && outcome.url && /^https:\/\//.test(outcome.url) ? { url: outcome.url.slice(0, 500) } : {}) }).eq("id", schedule.id);
    if (!outcome.ok) continue;
    const metrics = Object.fromEntries(Object.entries(outcome.values).filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v >= 0));
    if (Object.keys(metrics).length === 0) continue;
    await db.from("content_results").insert({ piece_id: schedule.pieceId, channel: schedule.channel, source: providerId, at: now.toISOString(), metrics, entered_by: null, entered_by_handle: "system" });
    read += 1;
  }
  return read;
}
