import type { FunnelPlatform, FunnelTag } from "./keywords";
import type { ReviewOverview } from "./overview";
import { funnelStage, funnelStageAt, type LeadFunnel } from "./stages";

// The review queue's records as the console reads them (live/server.ts
// loadReviews, the demo). Pure and browser-safe: the screens, the red count
// on the menu and the tests share them.

type Row = Record<string, unknown>;

export interface ReviewVideo {
  id: string;
  createdAt: string;
  durationSeconds: number;
  recordedBy: string | null;
  sentAt: string | null;
  sentVia: string[];
  openedAt: string | null;
  watchedAt: string | null;
  startedAt: string | null;
  expiresAt: string;
  deleted: boolean;
  /** Demo only: where this browser keeps the recording. */
  localUrl?: string | null;
}

export interface ReviewItem {
  id: string;
  leadId: string;
  firstName: string | null;
  locale: "en" | "es";
  state: string | null;
  goal: string | null;
  status: "receiving" | "reading" | "ready" | "failed" | "deleted" | "imported";
  simulated: boolean;
  createdAt: string;
  readyAt: string | null;
  deleteAfter: string;
  fileCount: number;
  problems: string[];
  overview: ReviewOverview | null;
  funnel: LeadFunnel | null;
  videos: ReviewVideo[];
  signed: boolean;
  clientUserId: string | null;
  importedAt: string | null;
  /** Demo only: a labelled sample. */
  sample?: boolean;
}

/** What waits for a person: a review ready with no video yet, or a signed lead whose report is not imported. */
export function reviewNeedsYou(item: Pick<ReviewItem, "status" | "videos" | "signed" | "importedAt" | "simulated">): boolean {
  if (item.status !== "ready") return false;
  if (item.signed) return !item.importedAt && !item.simulated;
  return !item.videos.some((v) => !v.deleted);
}

const iso = (v: unknown): string | null => {
  const s = typeof v === "string" ? v : v instanceof Date ? v.toISOString() : null;
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** A live_leads row as the Lead Manager carries it (no credit data). */
export function funnelFromRow(live: Row, signedAt: string | null): LeadFunnel {
  const facts = {
    formAt: iso(live.form_at),
    reportAt: iso(live.report_at),
    readyAt: iso(live.ready_at),
    videoSentAt: iso(live.video_sent_at),
    videoOpenedAt: iso(live.video_opened_at),
    videoWatchedAt: iso(live.video_watched_at),
    startedAt: iso(live.started_at),
    signedAt,
  };
  return {
    tag: String(live.tag) as FunnelTag,
    platform: (str(live.platform) as FunnelPlatform | null) ?? null,
    keyword: str(live.keyword),
    campaign: str(live.campaign),
    stage: funnelStage(facts),
    stageAt: funnelStageAt(facts),
  };
}

/** "2:41" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The recording's limits: up to 5 minutes; 2 to 5 is what the script aims for. */
export const RECORDING = { maxSeconds: 300, aimMinSeconds: 120, minSeconds: 20 } as const;
