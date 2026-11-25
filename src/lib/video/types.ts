import type { AssistantPose } from "../brand";

// The Video Studio (/equipo/video, docs/VIDEO.md, migration 0038): short
// social videos (Reels, TikTok, Shorts) and ads, edited in the browser.
//
// A video is a project: a brief (what it is for), a plan (script and shots),
// the media it uses, and the edit decisions (the timeline, words on screen,
// captions, logo, cards, music) kept as JSON so it can be reopened. The MP4 is
// rendered in the browser from those decisions (src/lib/video/render.ts and
// the ffmpeg worker): nothing is sent to anyone else to edit it.
//
// The board: Planned → Editing → Ready (waiting for approval) → Approved →
// Published (handed to a Content piece, which posts it through the existing
// publishing). Archived from anywhere, restorable.

export const VIDEO_STATUSES = ["planned", "editing", "ready", "approved", "published", "archived"] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

/** The board's columns, in order (archived is folded away). */
export const VIDEO_BOARD: readonly VideoStatus[] = ["planned", "editing", "ready", "approved", "published"];

export const ASPECTS = ["9:16", "1:1", "4:5", "16:9"] as const;
export type Aspect = (typeof ASPECTS)[number];

/** What a brief asks for. Each one has a frame shape and the channels it suits. */
export const VIDEO_FORMATS = ["reel", "tiktok", "short", "feed_square", "feed_portrait", "landscape"] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];

export const FORMAT_ASPECT: Record<VideoFormat, Aspect> = {
  reel: "9:16",
  tiktok: "9:16",
  short: "9:16",
  feed_square: "1:1",
  feed_portrait: "4:5",
  landscape: "16:9",
};

export type VideoLang = "en" | "es";

export type Bilingual = { en: string; es: string };

/** Where the idea came from: made here, or sent by the Ads Manager (/equipo/video?brief=…). */
export interface VideoBrief {
  title: string;
  goal: string;
  hook: string;
  script: string;
  format: VideoFormat;
  source: "studio" | "ads";
  /** The Ads Manager's own id for the brief, so the same brief is not turned into two videos. */
  ref: string | null;
}

/** One shot of the plan: about how long, what we see, and the words on screen. */
export interface Shot {
  id: string;
  seconds: number;
  shot: string;
  onScreen: string;
}

export interface VideoPlan {
  script: string;
  shots: Shot[];
  /** The words that go with the post (the Content piece's caption). */
  postCaption: string;
  /** The call to action on the end card. */
  cta: string;
  /** True while the script and shots are what Alti (AI) drafted and nobody has edited them. */
  aiDraft: boolean;
}

export const MEDIA_KINDS = ["video", "image"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** A clip or a picture the project can use. The file lives in storage (or, in the demo, in this browser). */
export interface MediaItem {
  id: string;
  kind: MediaKind;
  name: string;
  mediaType: string;
  bytes: number;
  /** Seconds (videos); null for a picture. */
  duration: number | null;
  width: number;
  height: number;
  /** Whether the clip has a sound track (null: not known yet; the export finds out). */
  hasAudio: boolean | null;
  /** "sample": one of the small bundled sample clips; "upload": a file the team added. */
  source: "sample" | "upload";
  /** A sample's public path, a storage path, or (demo) the key in this browser's store. */
  ref: string;
  addedBy: string;
  addedAt: string;
}

export type Fit = "cover" | "contain";

/** One piece of the timeline: a part of a clip (in → out, seconds of the source), or a picture shown for a while. */
export interface TimelineClip {
  id: string;
  mediaId: string;
  /** Seconds into the source where this piece starts (always 0 for a picture). */
  in: number;
  /** Seconds into the source where it ends; for a picture, how long it shows. */
  out: number;
  /** cover: fill the frame and crop; contain: show it whole, with bars. */
  fit: Fit;
  /** Where the crop sits (0 = left/top, 0.5 = centre, 1 = right/bottom). */
  focusX: number;
  focusY: number;
  /** The clip's own sound, 0 to 1. */
  volume: number;
  muted: boolean;
}

export const OVERLAY_KINDS = ["title", "lowerThird"] as const;
export type OverlayKind = (typeof OVERLAY_KINDS)[number];
export type OverlayPosition = "top" | "center" | "bottom";
/** Brand looks only: white words with a navy edge, navy words on white, navy words on a gold band. */
export type OverlayStyle = "white" | "navy" | "gold";

/** Words on screen for a while: a title, or a lower third (a name or a point, with a second line). */
export interface TextOverlay {
  id: string;
  kind: OverlayKind;
  text: string;
  /** A lower third's second, smaller line. */
  sub: string;
  start: number;
  end: number;
  position: OverlayPosition;
  style: OverlayStyle;
}

/** One caption: what is said, and when (seconds on the video's main part, after the intro card). */
export interface CaptionCue {
  id: string;
  start: number;
  end: number;
  text: string;
}

export type Corner = "tl" | "tr" | "bl" | "br";

export interface VideoEdit {
  version: 1;
  aspect: Aspect;
  /** The colour of the bars when a clip is shown whole. */
  background: "black" | "navy";
  clips: TimelineClip[];
  overlays: TextOverlay[];
  captions: CaptionCue[];
  captionPosition: "bottom" | "middle";
  /** The locked logo file, unchanged: white on dark footage, navy on light ("auto" picks per clip). */
  logo: { enabled: boolean; corner: Corner; version: "auto" | "white" | "navy" };
  /** The brand card before the video: navy, the white logo, a title. */
  intro: { enabled: boolean; title: string; seconds: number };
  /** The end card: navy, the white logo, a line, the call to action. */
  outro: { enabled: boolean; line: string; seconds: number };
  /** A track from the team's music library (rights recorded), under the clips. */
  music: { trackId: string | null; volume: number; duck: boolean; duckTo: number; fadeOut: boolean };
  /** Alti's art as an overlay, always with his AI label. */
  alti: { enabled: boolean; pose: AssistantPose; corner: "bl" | "br"; start: number; end: number };
}

/** A track the team uploaded, with who confirmed the rights to use it and when. */
export interface MusicTrack {
  id: string;
  name: string;
  mediaType: string;
  bytes: number;
  duration: number | null;
  source: "sample" | "upload";
  ref: string;
  rights: { confirmedBy: string; confirmedAt: string; note: string };
  addedBy: string;
  addedAt: string;
  removedAt: string | null;
}

/** A person who appears and gave written consent (clients only with it). */
export interface ConsentRecord {
  id: string;
  name: string;
  /** YYYY-MM-DD. */
  signedOn: string;
  /** Where the signed form is kept (a file name, a folder, a link). */
  where: string;
  recordedBy: string;
  recordedAt: string;
}

export interface VideoExport {
  id: string;
  at: string;
  by: string;
  /** The hash of the project when it was rendered (projectHash): approval needs it to be today's. */
  hash: string;
  width: number;
  height: number;
  duration: number;
  bytes: number;
  /** A storage path, or (demo) the key in this browser's store. */
  ref: string;
}

export const VIDEO_CHECKLIST_KEYS = ["footageRights", "noScoreVisuals", "captionsMatch"] as const;
export type VideoChecklistKey = (typeof VIDEO_CHECKLIST_KEYS)[number];

export interface VideoApproval {
  by: string;
  at: string;
  hash: string;
}

export interface VideoProject {
  id: string;
  title: string;
  status: VideoStatus;
  language: VideoLang;
  brief: VideoBrief;
  plan: VideoPlan;
  media: MediaItem[];
  edit: VideoEdit;
  /** What a person ticks before approval (the app decides the rest). */
  checklist: Partial<Record<VideoChecklistKey, boolean>>;
  /** Does a client appear (face, voice or name)? null until someone answers. */
  clientAppears: boolean | null;
  consents: ConsentRecord[];
  exports: VideoExport[];
  approval: VideoApproval | null;
  changesNote: string | null;
  /** The Content piece it was handed to (published). */
  contentPieceId: string | null;
  owner: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type VideoEventKind =
  | "created"
  | "edited"
  | "moved"
  | "exported"
  | "submitted"
  | "approved"
  | "approval_reset"
  | "changes_requested"
  | "linked_piece"
  | "published"
  | "archived"
  | "restored";

export interface VideoEvent {
  id: string;
  projectId: string;
  at: string;
  by: string;
  kind: VideoEventKind;
  from?: VideoStatus | null;
  to?: VideoStatus | null;
  note?: string | null;
  hash?: string | null;
}

/** Limits that keep the editor reliable in a browser tab (ffmpeg runs in memory). */
export const VIDEO_LIMITS = {
  clipBytes: 250 * 1024 * 1024,
  imageBytes: 20 * 1024 * 1024,
  musicBytes: 30 * 1024 * 1024,
  projectBytes: 400 * 1024 * 1024,
  mediaPerProject: 24,
  clipsOnTimeline: 40,
  /** The main part of a video, without the cards. */
  maxSeconds: 180,
  minClipSeconds: 0.2,
  maxImageSeconds: 30,
  overlays: 30,
  captions: 400,
  textMax: 160,
  captionMax: 200,
  exportsKept: 10,
  consents: 20,
  projects: 1000,
} as const;
