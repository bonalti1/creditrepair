import { isDemoMode } from "../supabase/config";
import type { ReviewItem, ReviewVideo } from "./review";

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

interface DemoActions {
  videos: Record<string, ReviewVideo[]>;
  deleted: string[];
}

function readDemo(): DemoActions {
  try {
    const raw = JSON.parse(window.localStorage.getItem(DEMO_KEY) ?? "null") as Partial<DemoActions> | null;
    return { videos: raw?.videos ?? {}, deleted: raw?.deleted ?? [] };
  } catch {
    return { videos: {}, deleted: [] };
  }
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
        const videos = [...mine, ...item.videos];
        const sent = mine.find((v) => v.sentAt && !v.deleted);
        return { ...item, videos, funnel: item.funnel && sent && item.funnel.stage === "reviewing" ? { ...item.funnel, stage: "video_sent" as const, stageAt: sent.sentAt } : item.funnel };
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
    const link = `${window.location.origin}/v/demo`;
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
