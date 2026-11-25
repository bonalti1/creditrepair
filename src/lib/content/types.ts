// The content hub (/equipo/contenido, docs/CONTENT.md, migration 0035): what a
// piece of marketing content is, from the first idea to its measured results.
//
// The board follows the lesson of the owner's other business: creation happens
// in outside tools (CapCut, Canva, the ad pipeline in content/), a person
// approves, and only then does a piece go out. Publishing can be done by a
// person (who records the post's link) or, once the owner connects the
// accounts and turns it on, by the app itself (src/lib/content/publish), under
// the same gates. Results are real numbers only: nothing measured reads
// "No data yet", never 0.

export const CONTENT_TYPES = [
  "short_video",
  "carousel",
  "image",
  "story",
  "youtube",
  "whatsapp_status",
  "partner",
  "email",
  "blog",
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/** Types that are video: they need captions on screen before approval. */
export const VIDEO_TYPES: readonly ContentType[] = ["short_video", "story", "youtube"];
/** Types that are pictures: every image they carry needs alt text. */
export const IMAGE_TYPES: readonly ContentType[] = ["carousel", "image", "story", "partner", "whatsapp_status"];

export const CHANNELS = ["instagram", "facebook", "tiktok", "youtube", "whatsapp", "partners", "email", "website"] as const;
export type Channel = (typeof CHANNELS)[number];

/** The channels the app can publish to itself, once connected (src/lib/content/publish). */
export const PUBLISH_CHANNELS = ["facebook", "instagram", "tiktok", "youtube"] as const;
export type PublishChannel = (typeof PUBLISH_CHANNELS)[number];
export function isPublishChannel(value: string): value is PublishChannel {
  return (PUBLISH_CHANNELS as readonly string[]).includes(value);
}

export const LANGUAGES = ["en", "es", "both"] as const;
export type ContentLanguage = (typeof LANGUAGES)[number];
export type CopyLang = "en" | "es";

export const AUDIENCES = ["consumers", "hispanic", "partners"] as const;
export type Audience = (typeof AUDIENCES)[number];

/** Themes, for results by theme. */
export const THEMES = ["rights", "myths", "disputes", "process", "itin", "partners", "aftercare", "team"] as const;
export type Theme = (typeof THEMES)[number];

export const STATUSES = [
  "idea",
  "planned",
  "in_production",
  "review",
  "changes",
  "approved",
  "scheduled",
  "posted",
  "measured",
  "failed",
  "archived",
] as const;
export type ContentStatus = (typeof STATUSES)[number];

/** The board's columns, in order. "Changes requested" sits beside review; failed and archived are folded away. */
export const BOARD_COLUMNS: readonly ContentStatus[] = ["idea", "planned", "in_production", "review", "changes", "approved", "scheduled", "posted", "measured"];

/** Statuses in which the approval stands (an edit sends the piece back to review). */
export const APPROVED_STATUSES: readonly ContentStatus[] = ["approved", "scheduled", "posted", "measured"];

/** The text fields every check reads, per language. */
export const COPY_FIELDS = ["hook", "onScreen", "script", "caption", "cta"] as const;
export type CopyField = (typeof COPY_FIELDS)[number];

export type Bilingual = { en: string; es: string };
export type PieceCopy = Record<CopyField, Bilingual>;

export const CHARACTERS = ["alti", "altibot"] as const;
export type CharacterUse = (typeof CHARACTERS)[number];

export const CHECKLIST_KEYS = [
  // Brand
  "logo",
  "colours",
  "fonts",
  "altiLabel",
  "altibotCameo",
  // Legal
  "resultsVary",
  "monitoringDisclosure",
  "partnerPaid",
  "languagesMatch",
  // Accessibility
  "captions",
  "altText",
] as const;
export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];
export type ChecklistGroup = "brand" | "legal" | "access";

export interface ContentAsset {
  id: string;
  kind: "upload" | "url";
  /** For an upload: the storage path in the private content-assets bucket. For a link: the https address. */
  ref: string;
  name: string;
  mediaType: string | null;
  bytes: number | null;
  /** Describes the picture for people who cannot see it. Required on images before approval. */
  altText: string;
  addedBy: string;
  addedAt: string;
}

export interface PostRecord {
  channel: Channel;
  url: string;
  postedAt: string;
  by: string;
  /** "person": someone posted it and typed the link; "app": the app published it (publish log). */
  via: "person" | "app";
  externalId?: string | null;
}

export interface Approval {
  by: string;
  at: string;
  /** The hash of the exact text, links and assets that were approved (pieceHash). */
  hash: string;
}

export interface ContentPiece {
  id: string;
  title: string;
  type: ContentType;
  channels: Channel[];
  language: ContentLanguage;
  audience: Audience;
  theme: Theme;
  /** Why it exists and for whom, in a line. */
  goal: string;
  copy: PieceCopy;
  /** Who appears in the visuals. Alti always with his AI label; the robot only as a small cameo. */
  characters: CharacterUse[];
  links: string[];
  assets: ContentAsset[];
  owner: string | null;
  /** YYYY-MM-DD. */
  dueDate: string | null;
  status: ContentStatus;
  /** The code links carry (utm_content) so leads can be traced to the piece. */
  campaignCode: string;
  templateId: string | null;
  /** True while the copy is what Alti (AI) wrote and nobody has edited it. */
  aiDraft: boolean;
  checklist: Partial<Record<ChecklistKey, boolean>>;
  approval: Approval | null;
  /** The last "changes requested" note. */
  changesNote: string | null;
  posts: PostRecord[];
  /** Why publishing failed, in plain words (status "failed"). */
  failure: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type ContentEventKind =
  | "created"
  | "edited"
  | "moved"
  | "submitted"
  | "checked"
  | "approved"
  | "approval_reset"
  | "changes_requested"
  | "posted"
  | "scheduled"
  | "schedule_cancelled"
  | "result_added"
  | "asset_added"
  | "asset_removed"
  | "archived"
  | "restored"
  | "failed";

export interface ContentEvent {
  id: string;
  pieceId: string;
  at: string;
  by: string;
  kind: ContentEventKind;
  from?: ContentStatus | null;
  to?: ContentStatus | null;
  note?: string | null;
  /** For checks and approvals: the hash and the blocking issues at that moment. */
  hash?: string | null;
  blocking?: number | null;
}

export const RESULT_METRICS = ["views", "reach", "likes", "comments", "shares", "clicks", "leads", "signed"] as const;
export type ResultMetric = (typeof RESULT_METRICS)[number];

/** One entry of results: what a person typed in, or what a provider reported. Null means "not measured", never 0. */
export interface ContentResult {
  id: string;
  pieceId: string;
  channel: Channel;
  source: "manual" | "meta" | "tiktok" | "youtube";
  /** When the numbers were read. */
  at: string;
  by: string;
  values: Partial<Record<ResultMetric, number | null>>;
  note?: string | null;
}

export function emptyCopy(): PieceCopy {
  return {
    hook: { en: "", es: "" },
    onScreen: { en: "", es: "" },
    script: { en: "", es: "" },
    caption: { en: "", es: "" },
    cta: { en: "", es: "" },
  };
}

/** The languages a piece is written in. */
export function languagesOf(language: ContentLanguage): CopyLang[] {
  return language === "both" ? ["en", "es"] : [language];
}

/** "cnt-k3x9p2": the code a piece's links carry, from its id. */
export function campaignCodeFor(id: string): string {
  const clean = id.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `cnt-${clean.slice(-6).padStart(6, "0")}`;
}

/** A link with the piece's tags: utm_source is the channel, utm_content the piece's code. */
export function trackedLink(url: string, piece: Pick<ContentPiece, "campaignCode">, channel: Channel): string {
  try {
    const u = new URL(url);
    if (!u.searchParams.has("utm_source")) u.searchParams.set("utm_source", channel);
    if (!u.searchParams.has("utm_medium")) u.searchParams.set("utm_medium", channel === "partners" ? "partner" : channel === "email" ? "email" : "social");
    if (!u.searchParams.has("utm_campaign")) u.searchParams.set("utm_campaign", "content");
    u.searchParams.set("utm_content", piece.campaignCode);
    return u.toString();
  } catch {
    return url;
  }
}
