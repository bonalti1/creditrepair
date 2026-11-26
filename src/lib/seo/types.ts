// The SEO department's model (/equipo/seo, docs/SEO.md): guides (articles
// published at /guias/[slug]), the phrases the site wants to be found for,
// Search Console numbers, the local checklist and the site's health.

export type Lang = "en" | "es";
export const LANGS: readonly Lang[] = ["en", "es"];

export type Bilingual = { en: string; es: string };

// ── Guides ──────────────────────────────────────────────────────────────

/**
 * A guide's working copy moves draft → review → approved → published. An
 * edit after approval sends it back to draft; a published guide keeps its
 * published version live on the site until a newer approved version is
 * published, or it is unpublished (archived).
 */
export const GUIDE_STATUSES = ["draft", "review", "changes", "approved", "published", "archived"] as const;
export type GuideStatus = (typeof GUIDE_STATUSES)[number];

export interface GuideSection {
  heading: string;
  /** Plain text with two marks: [words](/path or https://…) for a link, [^source-id] for a citation. */
  paragraphs: string[];
}

export interface GuideFaq {
  q: string;
  a: string;
}

/** One language's article. */
export interface GuideBody {
  /** The <title> and the page's h1. */
  title: string;
  /** The meta description. */
  description: string;
  /** The opening paragraph, under the title. */
  intro: string;
  sections: GuideSection[];
  faq: GuideFaq[];
}

export interface GuideSource {
  /** Referred to in the text as [^id]. Lowercase letters, digits and hyphens. */
  id: string;
  /** "FTC: Disputing Errors on Your Credit Reports" */
  label: string;
  /** "15 U.S.C. § 1681i (FCRA § 611)", when it is a law. */
  cite: string;
  url: string;
}

export interface GuideApproval {
  hash: string;
  by: string;
  at: string;
}

export interface Guide {
  id: string;
  /** One slug for both languages (the site's one-URL rule): /guias/<slug>, ?lang=en and ?lang=es. */
  slug: string;
  status: GuideStatus;
  /** What the guide is about, in the team's words. */
  topic: string;
  /** The brief for the writer (Alti or a person): reader, angle, what to cover. */
  brief: string;
  /** The search phrase it is written for, in each language. */
  phrase: Bilingual;
  body: Record<Lang, GuideBody>;
  sources: GuideSource[];
  /** The ticks a person makes before asking for approval (sources opened, both languages read). */
  checklist: Partial<Record<GuideTick, boolean>>;
  /** Alti (AI) wrote the first draft. */
  aiDraft: boolean;
  approval: GuideApproval | null;
  /** What is live on the site: the version that was approved and published. */
  published: PublishedGuide | null;
  changesNote: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Demo content shipped with the app, never published by itself. */
  sample?: boolean;
}

export interface PublishedGuide {
  slug: string;
  body: Record<Lang, GuideBody>;
  sources: GuideSource[];
  hash: string;
  publishedAt: string;
  /** First time this guide went live (Article schema's datePublished). */
  firstPublishedAt: string;
  approvedBy: string;
}

export const GUIDE_TICKS = ["sourcesOpened", "bothLanguagesRead", "noAdvice"] as const;
export type GuideTick = (typeof GUIDE_TICKS)[number];

export interface GuideEvent {
  id: string;
  guideId: string;
  at: string;
  by: string;
  kind: "created" | "edited" | "drafted" | "submitted" | "changes_requested" | "approved" | "published" | "unpublished" | "archived" | "restored" | "approval_reset";
  note: string | null;
}

// ── Keywords ────────────────────────────────────────────────────────────

export interface TrackedPhrase {
  id: string;
  phrase: string;
  lang: Lang;
  /** A Texas city, or null for statewide / no place. */
  city: string | null;
  /** The page meant to rank for it: a site path ("/precios") or a guide ("/guias/<slug>"). */
  targetPath: string | null;
  note: string;
  createdBy: string;
  createdAt: string;
}

// ── Search Console ──────────────────────────────────────────────────────

/** One day of one query on one page, as Search Console reports it. */
export interface SearchRow {
  day: string;
  page: string;
  query: string;
  clicks: number;
  impressions: number;
  /** Average position that day (1 is the top). */
  position: number;
}

export interface SearchTotals {
  key: string;
  clicks: number;
  impressions: number;
  /** clicks ÷ impressions, 0–1; null with no impressions. */
  ctr: number | null;
  /** Impression-weighted average position; null with no impressions. */
  position: number | null;
}

// ── Site health ─────────────────────────────────────────────────────────

export type CheckState = "pass" | "fix" | "info";

export interface HealthFinding {
  /** The check (title-length, one-h1, …). */
  check: string;
  state: CheckState;
  /** The page it is about ("/precios?lang=es"), or "site" for robots and the sitemap. */
  where: string;
  /** What was found, in plain words (the title's length, the missing tag). English and Spanish. */
  detail: Bilingual;
}

export interface HealthReport {
  checkedAt: string;
  origin: string;
  pages: number;
  findings: HealthFinding[];
  /** Pages that could not be fetched at all (with the reason). */
  errors: Array<{ where: string; reason: string }>;
}

// ── Local SEO ───────────────────────────────────────────────────────────

export interface LocalTick {
  done: boolean;
  by: string;
  at: string;
}

export type LocalTicks = Record<string, LocalTick>;
