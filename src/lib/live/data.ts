import { isDemoMode } from "../supabase/config";
import { demoLeadForToken, demoLeadFunnels, demoTokenForLead } from "./demoFunnels";
import type { ReviewItem, ReviewVideo } from "./review";
import type { FunnelStage, LeadFunnel } from "./stages";

// Where the review queue's screen gets its reviews and records what a member
// does (docs/LIVE-FUNNEL.md). With a database: /api/staff/live, which checks
// everything again. In the demo: the same route answers the sample queue, and
// what the person at the keyboard records or sends is kept in this browser
// only (nothing is uploaded or sent).

export interface ReviewQueue {
  items: ReviewItem[];
  /** The names of the plans the attorney approved (the catalogue); empty in the demo. */
  plans: string[];
  keywords: Array<{ word: string; campaign: string | null }>;
  sms: boolean;
  demo: boolean;
}

export type SendChannel = "whatsapp" | "sms" | "email" | "copy";

export interface SendOptions {
  whatsapp: "text" | "template" | "window_closed" | "opted_out";
  sms: "ready" | "off" | "no_consent" | "opted_out" | "quiet_hours";
  email: boolean;
}

const DEMO_KEY = "credalti.demo.live.v1";

/** What the person did on their demo video page (/v/demo-…), by lead id. */
type DemoPageEvents = Partial<Record<"openedAt" | "watchedAt" | "startedAt", string>>;

interface DemoActions {
  videos: Record<string, ReviewVideo[]>;
  deleted: string[];
  events: Record<string, DemoPageEvents>;
}

function readDemo(): DemoActions {
  try {
    const raw = JSON.parse(window.localStorage.getItem(DEMO_KEY) ?? "null") as Partial<DemoActions> | null;
    return { videos: raw?.videos ?? {}, deleted: raw?.deleted ?? [], events: raw?.events ?? {} };
  } catch {
    return { videos: {}, deleted: [], events: {} };
  }
}

/**
 * The demo leads' funnel line with what was done in this browser (a video sent
 * from the review queue, the demo video page watched, «Get started»), so the
 * Lead Manager, the review queue and the Webinars console tell the same story.
 */
export function demoLeadFunnelsHere(now: Date = new Date()): Record<string, LeadFunnel> {
  const base = demoLeadFunnels(now);
  if (typeof window === "undefined") return base;
  const local = readDemo();
  const out: Record<string, LeadFunnel> = {};
  for (const [leadId, funnel] of Object.entries(base)) {
    const reviewId = leadId.replace(/^lead-/, "demo-review-");
    const sent = (local.videos[reviewId] ?? []).find((v) => v.sentAt && !v.deleted);
    const page = local.events[leadId] ?? {};
    const reached: { stage: FunnelStage; at: string | null | undefined } | null = page.startedAt ? { stage: "started", at: page.startedAt } : page.watchedAt ? { stage: "watched", at: page.watchedAt } : sent ? { stage: "video_sent", at: sent.sentAt } : null;
    out[leadId] = reached && STAGE_ORDER[reached.stage] > STAGE_ORDER[funnel.stage] ? { ...funnel, stage: reached.stage, stageAt: reached.at ?? funnel.stageAt } : funnel;
  }
  return out;
}

/** The demo's review ids are "demo-review-<x>", their leads "lead-<x>" (live/demo.ts). */
const leadOfDemoReview = (reviewId: string) => reviewId.replace(/^demo-review-/, "lead-");

/** The demo video page records what the person did, in this browser only (nothing is sent). */
export function recordDemoVideoEvent(token: string, event: "opened" | "watched" | "started" | "chat"): void {
  const leadId = demoLeadForToken(token);
  if (!leadId || event === "chat") return;
  const local = readDemo();
  const at = new Date().toISOString();
  const mine = { ...(local.events[leadId] ?? {}) };
  // Facts only move forward: the first time is kept; watching counts as opening, «Get started» as watching enough.
  mine.openedAt ??= at;
  if (event === "watched" || event === "started") mine.watchedAt ??= at;
  if (event === "started") mine.startedAt ??= at;
  local.events[leadId] = mine;
  writeDemo(local);
  try {
    window.dispatchEvent(new Event(LIVE_CHANGED_EVENT));
  } catch {
    // No window events: the next refresh shows it.
  }
}

const STAGE_ORDER: Record<FunnelStage, number> = { new: 0, reviewing: 1, video_sent: 2, watched: 3, started: 4, signed: 5 };

/**
 * The demo's live-funnel facts for the Webinars section, by lead id: the
 * sample leads' own stage (demoFunnels.ts) plus what was done in this
 * browser (a video sent from the review queue, the video page watched,
 * «Get started» tapped). The webinars' demo merges it with its sample leads.
 */
export function demoLiveFunnelEvents(now: Date = new Date()): { sent: Set<string>; watched: Set<string>; reports: Set<string>; started: Set<string> } {
  const out = { sent: new Set<string>(), watched: new Set<string>(), reports: new Set<string>(), started: new Set<string>() };
  const local = typeof window === "undefined" ? { videos: {}, deleted: [], events: {} } : readDemo();
  for (const [leadId, funnel] of Object.entries(demoLeadFunnels(now))) {
    const reached = STAGE_ORDER[funnel.stage];
    if (reached >= STAGE_ORDER.reviewing) out.reports.add(leadId);
    if (reached >= STAGE_ORDER.video_sent) out.sent.add(leadId);
    if (reached >= STAGE_ORDER.watched) out.watched.add(leadId);
    if (reached >= STAGE_ORDER.started) out.started.add(leadId);
  }
  for (const [reviewId, videos] of Object.entries(local.videos)) {
    if (videos.some((v) => v.sentAt && !v.deleted)) out.sent.add(leadOfDemoReview(reviewId));
  }
  for (const [leadId, e] of Object.entries(local.events)) {
    if (e.watchedAt) out.watched.add(leadId);
    if (e.startedAt) out.started.add(leadId);
  }
  return out;
}

function writeDemo(actions: DemoActions): void {
  try {
    window.localStorage.setItem(DEMO_KEY, JSON.stringify(actions));
  } catch {
    // Storage blocked: lasts for this visit.
  }
}

export function resetDemoLive(): void {
  try {
    window.localStorage.removeItem(DEMO_KEY);
  } catch {
    // Nothing kept.
  }
}

/** Recordings made in this demo visit (object URLs do not survive a reload: the sample video stands in). */
const sessionUrls = new Map<string, string>();

export function isLiveDemo(): boolean {
  return isDemoMode();
}

export async function fetchQueue(): Promise<ReviewQueue> {
  const res = await fetch("/api/staff/live", { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  const body = (await res.json()) as Partial<ReviewQueue>;
  let items = body.items ?? [];
  if (body.demo) {
    const local = readDemo();
    items = items
      .map((item) => {
        if (local.deleted.includes(item.id)) return { ...item, status: "deleted" as const, overview: null };
        const mine = (local.videos[item.id] ?? []).map((v) => ({ ...v, localUrl: sessionUrls.get(v.id) ?? "/live/sample-video.webm" }));
        if (mine.length === 0) return item;
        const page = local.events[item.leadId] ?? {};
        // What the person did on the demo video page moves the sent video and the funnel line forward.
        const videos = [...mine.map((v) => (v.sentAt && !v.deleted ? { ...v, openedAt: v.openedAt ?? page.openedAt ?? null, watchedAt: v.watchedAt ?? page.watchedAt ?? null, startedAt: v.startedAt ?? page.startedAt ?? null } : v)), ...item.videos];
        const sent = mine.find((v) => v.sentAt && !v.deleted);
        const reached: { stage: FunnelStage; at: string | null | undefined } | null = !sent ? null : page.startedAt ? { stage: "started", at: page.startedAt } : page.watchedAt ? { stage: "watched", at: page.watchedAt } : { stage: "video_sent", at: sent.sentAt };
        const funnel = item.funnel && reached && STAGE_ORDER[reached.stage] > STAGE_ORDER[item.funnel.stage] ? { ...item.funnel, stage: reached.stage, stageAt: reached.at ?? item.funnel.stageAt } : item.funnel;
        return { ...item, videos, funnel };
      })
      .filter((item) => item.status !== "deleted");
  }
  return { items, plans: body.plans ?? [], keywords: body.keywords ?? [], sms: body.sms === true, demo: body.demo === true };
}

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch("/api/staff/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { ok: false, status: 0, data: {} };
  }
}

/** Uploads a recording: a signed link, the file straight to the private bucket, then the server checks it. */
export async function uploadVideo(
  reviewId: string,
  blob: Blob,
  durationSeconds: number,
  onProgress: (fraction: number) => void,
  recordedBy: string,
): Promise<{ ok: true; videoId: string } | { ok: false; code: string }> {
  const mediaType = blob.type.startsWith("video/mp4") ? "video/mp4" : "video/webm";
  if (isDemoMode()) {
    const videoId = `demo-${Date.now()}`;
    sessionUrls.set(videoId, URL.createObjectURL(blob));
    const local = readDemo();
    const now = new Date();
    local.videos[reviewId] = [
      { id: videoId, createdAt: now.toISOString(), durationSeconds: Math.round(durationSeconds), recordedBy, sentAt: null, sentVia: [], openedAt: null, watchedAt: null, startedAt: null, expiresAt: new Date(now.getTime() + 14 * 86_400_000).toISOString(), deleted: false },
      ...(local.videos[reviewId] ?? []),
    ];
    writeDemo(local);
    onProgress(1);
    return { ok: true, videoId };
  }
  const ticket = await post({ action: "upload_url", reviewId, mediaType, bytes: blob.size });
  if (!ticket.ok) return { ok: false, code: String(ticket.data.code ?? "upload") };
  const signedUrl = String(ticket.data.signedUrl);
  const videoId = String(ticket.data.videoId);
  const path = String(ticket.data.path);
  const put = await new Promise<boolean>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("content-type", mediaType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.send(blob);
  });
  if (!put) return { ok: false, code: "upload" };
  const confirm = await post({ action: "confirm_video", reviewId, videoId, path, duration: Math.max(5, Math.min(330, durationSeconds)) });
  return confirm.ok ? { ok: true, videoId } : { ok: false, code: String(confirm.data.code ?? "confirm") };
}

export async function sendOptions(videoId: string): Promise<{ options: SendOptions; locale: "en" | "es" } | null> {
  if (isDemoMode()) return { options: { whatsapp: "text", sms: "off", email: true }, locale: "en" };
  try {
    const res = await fetch(`/api/staff/live?send=${encodeURIComponent(videoId)}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as { options: SendOptions; locale: "en" | "es" }) : null;
  } catch {
    return null;
  }
}

export type SendResult = { ok: true; link: string; message: string; email: string | null; sent: boolean } | { ok: false; code: string };

export async function sendVideo(reviewId: string, videoId: string, channel: SendChannel, demoMessage: (link: string) => string): Promise<SendResult> {
  if (isDemoMode()) {
    const local = readDemo();
    const now = new Date().toISOString();
    local.videos[reviewId] = (local.videos[reviewId] ?? []).map((v) => (v.id === videoId ? { ...v, sentAt: v.sentAt ?? now, sentVia: [...new Set([...v.sentVia, channel])] } : v));
    writeDemo(local);
    const link = `${window.location.origin}/v/${demoTokenForLead(leadOfDemoReview(reviewId))}`;
    return { ok: true, link, message: demoMessage(link), email: channel === "email" ? "sample@example.com" : null, sent: false };
  }
  const answer = await post({ action: "send", videoId, channel });
  if (!answer.ok) return { ok: false, code: String(answer.data.code ?? (answer.status === 0 ? "offline" : "error")) };
  return { ok: true, link: String(answer.data.link), message: String(answer.data.message), email: (answer.data.email as string | null) ?? null, sent: answer.data.sent === true };
}

export async function playUrl(video: ReviewVideo): Promise<string | null> {
  if (video.localUrl) return video.localUrl;
  if (isDemoMode()) return "/live/sample-video.webm";
  try {
    const res = await fetch(`/api/staff/live?play=${encodeURIComponent(video.id)}`, { cache: "no-store" });
    return res.ok ? (((await res.json()) as { url?: string | null }).url ?? null) : null;
  } catch {
    return null;
  }
}

export async function reviewAction(action: "delete_video" | "reread" | "import" | "delete_review", ids: { reviewId?: string; videoId?: string }): Promise<{ ok: boolean; code?: string; message?: string }> {
  if (isDemoMode()) {
    const local = readDemo();
    if (action === "delete_video" && ids.reviewId) local.videos[ids.reviewId] = (local.videos[ids.reviewId] ?? []).filter((v) => v.id !== ids.videoId);
    if (action === "delete_review" && ids.reviewId) local.deleted.push(ids.reviewId);
    writeDemo(local);
    return { ok: true };
  }
  const answer = await post({ action, ...ids });
  return answer.ok ? { ok: true } : { ok: false, code: String(answer.data.code ?? "error"), message: typeof answer.data.message === "string" ? answer.data.message : undefined };
}

/** The red count's number: reviews waiting for a person. */
export async function fetchNeeds(): Promise<number | null> {
  try {
    if (isDemoMode()) {
      const { reviewNeedsYou } = await import("./review");
      return (await fetchQueue()).items.filter(reviewNeedsYou).length;
    }
    const res = await fetch("/api/staff/live?needs=1", { cache: "no-store" });
    const body = res.ok ? ((await res.json()) as { count?: number }) : null;
    return typeof body?.count === "number" ? body.count : null;
  } catch {
    return null;
  }
}

export const LIVE_CHANGED_EVENT = "credalti-live-changed";
