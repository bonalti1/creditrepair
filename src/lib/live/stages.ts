import type { FunnelPlatform, FunnelTag } from "./keywords";

// The live funnel's stages, as the Lead Manager shows them (docs/LIVE-FUNNEL.md):
//
//   New → Reviewing report → Video sent → Watched → Started signup → Signed
//
// Facts, never chosen: each comes from what happened (the report arrived, the
// video went out, the link was watched, «Get started» was tapped, the
// agreement was signed). A person still moves the lead's own pipeline stage
// in the inbox; this line sits beside it. Pure, so the console, the demo, the
// Webinars section (migration 0044) and the tests read the same thing.

export const FUNNEL_STAGES = ["new", "reviewing", "video_sent", "watched", "started", "signed"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/** The funnel facts on a lead (live_leads, plus the lead's own signed_at). No credit data. */
export interface FunnelFacts {
  formAt?: string | null;
  reportAt?: string | null;
  readyAt?: string | null;
  videoSentAt?: string | null;
  videoOpenedAt?: string | null;
  videoWatchedAt?: string | null;
  startedAt?: string | null;
  signedAt?: string | null;
}

/** Where a funnel lead is: the furthest fact reached. */
export function funnelStage(f: FunnelFacts): FunnelStage {
  if (f.signedAt) return "signed";
  if (f.startedAt) return "started";
  if (f.videoWatchedAt) return "watched";
  if (f.videoSentAt) return "video_sent";
  if (f.reportAt) return "reviewing";
  return "new";
}

/** When the lead reached that stage (null for "new" with no form). */
export function funnelStageAt(f: FunnelFacts): string | null {
  switch (funnelStage(f)) {
    case "signed":
      return f.signedAt ?? null;
    case "started":
      return f.startedAt ?? null;
    case "watched":
      return f.videoWatchedAt ?? null;
    case "video_sent":
      return f.videoSentAt ?? null;
    case "reviewing":
      return f.reportAt ?? null;
    default:
      return f.formAt ?? null;
  }
}

export const FUNNEL_STAGE_LABELS: Record<"en" | "es", Record<FunnelStage, string>> = {
  en: { new: "New", reviewing: "Reviewing report", video_sent: "Video sent", watched: "Watched", started: "Started signup", signed: "Signed" },
  es: { new: "Nuevo", reviewing: "Revisando reporte", video_sent: "Video enviado", watched: "Lo vio", started: "Empezó el registro", signed: "Firmó" },
};

export const FUNNEL_TAG_LABELS: Record<"en" | "es", Record<FunnelTag, string>> = {
  en: { webinar: "Webinar", ad: "Ad", comment: "Comment", bio: "Bio link", link: "Link", other: "Other" },
  es: { webinar: "Webinar", ad: "Anuncio", comment: "Comentario", bio: "Enlace de la bio", link: "Enlace", other: "Otro" },
};

export const FUNNEL_PLATFORM_LABELS: Record<FunnelPlatform, string> = {
  zoom: "Zoom",
  facebook: "Facebook",
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  whatsapp: "WhatsApp",
  sms: "SMS",
  web: "Web",
};

/** What the Lead Manager carries for a funnel lead. */
export interface LeadFunnel {
  tag: FunnelTag;
  platform: FunnelPlatform | null;
  keyword: string | null;
  campaign: string | null;
  stage: FunnelStage;
  stageAt: string | null;
}

/** "Webinar · CREDIT · nov-webinar" */
export function funnelLine(f: Pick<LeadFunnel, "tag" | "platform" | "keyword" | "campaign">, locale: "en" | "es"): string {
  return [FUNNEL_TAG_LABELS[locale][f.tag], f.platform ? FUNNEL_PLATFORM_LABELS[f.platform] : null, f.keyword, f.campaign].filter(Boolean).join(" · ");
}

// ── Counting by campaign (for the Webinars section, migration 0044) ─────

export interface FunnelRow extends FunnelFacts {
  campaign: string | null;
  keyword: string | null;
  tag: FunnelTag;
}

/** How many leads reached at least each stage (a lead who signed also counts as reviewing, video sent…). */
export type FunnelCounts = Record<FunnelStage, number> & { total: number };

const ORDER: Record<FunnelStage, number> = { new: 0, reviewing: 1, video_sent: 2, watched: 3, started: 4, signed: 5 };

export function emptyCounts(): FunnelCounts {
  return { total: 0, new: 0, reviewing: 0, video_sent: 0, watched: 0, started: 0, signed: 0 };
}

/**
 * The funnel for a set of leads: how many reached each stage or further.
 * `filter` narrows to a campaign and/or a keyword (exact, as stored:
 * campaigns lowercase, keywords uppercase). Pure.
 *
 *   countFunnelStages(rows, { campaign: "webinar-nov" })
 *   → { total: 40, new: 40, reviewing: 18, video_sent: 12, watched: 9, started: 5, signed: 3 }
 */
export function countFunnelStages(rows: readonly FunnelRow[], filter: { campaign?: string | null; keyword?: string | null } = {}): FunnelCounts {
  const out = emptyCounts();
  for (const row of rows) {
    if (filter.campaign !== undefined && filter.campaign !== null && row.campaign !== filter.campaign) continue;
    if (filter.keyword !== undefined && filter.keyword !== null && row.keyword !== filter.keyword) continue;
    out.total += 1;
    const reached = ORDER[funnelStage(row)];
    for (const stage of FUNNEL_STAGES) if (ORDER[stage] <= reached) out[stage] += 1;
  }
  return out;
}

/** The same, per campaign (leads with no campaign under ""). */
export function countFunnelByCampaign(rows: readonly FunnelRow[]): Map<string, FunnelCounts> {
  const out = new Map<string, FunnelCounts>();
  for (const row of rows) {
    const key = row.campaign ?? "";
    out.set(key, addCounts(out.get(key) ?? emptyCounts(), countFunnelStages([row])));
  }
  return out;
}

function addCounts(a: FunnelCounts, b: FunnelCounts): FunnelCounts {
  const out = { ...a };
  for (const key of Object.keys(b) as Array<keyof FunnelCounts>) out[key] = a[key] + b[key];
  return out;
}
