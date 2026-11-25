import {
  VIDEO_LIMITS,
  type Aspect,
  type CaptionCue,
  type Fit,
  type MediaItem,
  type TimelineClip,
  type VideoEdit,
} from "./types";

// The timeline's arithmetic, as pure functions: the preview (the canvas in the
// editor) and the export (render.ts, the ffmpeg arguments) both read these,
// so what the team sees is what the file holds.
//
// Times are seconds. The "body" is the clips one after the other; captions,
// words on screen and Alti's overlay are timed on the body, and the intro card
// (when on) comes before it, so turning the intro on never moves a caption
// off the words it belongs to.

/** Seconds to the millisecond, so sums of many clips never drift (0.1 + 0.2). */
export const ms = (seconds: number): number => Math.round(seconds * 1000) / 1000;

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

let counter = 0;
export function newVideoId(prefix = "vp"): string {
  counter = (counter + 1) % 1296;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 6)}`;
}

// ── The frame ───────────────────────────────────────────────────────────

export type Quality = "full" | "quick";

/** The export size of each shape: full is what the networks ask for; quick is smaller and faster (a draft). */
export const FRAME_SIZES: Record<Aspect, Record<Quality, { width: number; height: number }>> = {
  "9:16": { full: { width: 1080, height: 1920 }, quick: { width: 720, height: 1280 } },
  "1:1": { full: { width: 1080, height: 1080 }, quick: { width: 720, height: 720 } },
  "4:5": { full: { width: 1080, height: 1350 }, quick: { width: 720, height: 900 } },
  "16:9": { full: { width: 1920, height: 1080 }, quick: { width: 1280, height: 720 } },
};

export function frameSize(aspect: Aspect, quality: Quality = "full"): { width: number; height: number } {
  return FRAME_SIZES[aspect][quality];
}

export type SafePlatform = "reels" | "tiktok" | "shorts";

/** A safe zone: the share of the frame each network's buttons and captions cover, on each side. */
export interface SafeZone {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Where each network draws its own buttons, name and caption over a 9:16
 * video, as shares of the frame (from the networks' published guides,
 * rounded up; approximate, and they change). Words and the logo stay inside.
 */
export const SAFE_ZONES: Record<SafePlatform, SafeZone> = {
  reels: { top: 0.12, bottom: 0.22, left: 0.05, right: 0.1 },
  tiktok: { top: 0.09, bottom: 0.26, left: 0.05, right: 0.14 },
  shorts: { top: 0.1, bottom: 0.21, left: 0.05, right: 0.13 },
};

/** Margins for the other shapes (feeds and landscape): no buttons on the video, a small border. */
const FEED_MARGIN: SafeZone = { top: 0.06, bottom: 0.06, left: 0.05, right: 0.05 };

/** The zone every word and the logo stay inside: for 9:16, inside all three networks' at once. */
export function safeZone(aspect: Aspect): SafeZone {
  if (aspect !== "9:16") return FEED_MARGIN;
  const zones = Object.values(SAFE_ZONES);
  return {
    top: Math.max(...zones.map((z) => z.top)),
    bottom: Math.max(...zones.map((z) => z.bottom)),
    left: Math.max(...zones.map((z) => z.left)),
    right: Math.max(...zones.map((z) => z.right)),
  };
}

/** The safe area in pixels of a frame. */
export function safeRect(aspect: Aspect, width: number, height: number): { x: number; y: number; w: number; h: number } {
  const z = safeZone(aspect);
  const x = Math.round(width * z.left);
  const y = Math.round(height * z.top);
  return { x, y, w: Math.round(width * (1 - z.left - z.right)), h: Math.round(height * (1 - z.top - z.bottom)) };
}

/** Even numbers: H.264 with 4:2:0 colour needs them. */
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * How a source fits the frame. "cover" crops the source (around the focus
 * point) to the frame's shape and scales it to fill; "contain" scales the
 * whole source down and centres it, with bars. The numbers are the canvas's
 * drawImage arguments and the ffmpeg crop/scale/pad values alike.
 */
export interface FitPlan {
  /** The part of the source used (crop). */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Where it lands in the frame. */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export function fitRect(srcW: number, srcH: number, dstW: number, dstH: number, fit: Fit, focusX = 0.5, focusY = 0.5): FitPlan {
  const w = Math.max(1, srcW);
  const h = Math.max(1, srcH);
  if (fit === "cover") {
    const scale = Math.max(dstW / w, dstH / h);
    const sw = Math.min(w, even(dstW / scale));
    const sh = Math.min(h, even(dstH / scale));
    const sx = Math.round((w - sw) * clamp(focusX, 0, 1));
    const sy = Math.round((h - sh) * clamp(focusY, 0, 1));
    return { sx: Math.min(sx, w - sw), sy: Math.min(sy, h - sh), sw, sh, dx: 0, dy: 0, dw: dstW, dh: dstH };
  }
  const scale = Math.min(dstW / w, dstH / h);
  const dw = Math.min(dstW, even(w * scale));
  const dh = Math.min(dstH, even(h * scale));
  return { sx: 0, sy: 0, sw: w, sh: h, dx: Math.round((dstW - dw) / 2), dy: Math.round((dstH - dh) / 2), dw, dh };
}

// ── Clips on the timeline ───────────────────────────────────────────────

export function clipDuration(clip: Pick<TimelineClip, "in" | "out">): number {
  return ms(Math.max(0, clip.out - clip.in));
}

export interface PlacedClip {
  clip: TimelineClip;
  index: number;
  /** Seconds on the body where it starts and ends. */
  start: number;
  end: number;
}

export function placeClips(clips: readonly TimelineClip[]): PlacedClip[] {
  let at = 0;
  return clips.map((clip, index) => {
    const start = at;
    at = ms(at + clipDuration(clip));
    return { clip, index, start, end: at };
  });
}

/** The clips one after the other, in seconds. */
export function bodyDuration(edit: Pick<VideoEdit, "clips">): number {
  return ms(edit.clips.reduce((sum, c) => sum + clipDuration(c), 0));
}

export function introSeconds(edit: Pick<VideoEdit, "intro">): number {
  return edit.intro.enabled ? ms(clamp(edit.intro.seconds, 1, 5)) : 0;
}

export function outroSeconds(edit: Pick<VideoEdit, "outro">): number {
  return edit.outro.enabled ? ms(clamp(edit.outro.seconds, 1, 6)) : 0;
}

/** The whole video: intro card, the clips, end card. */
export function totalDuration(edit: Pick<VideoEdit, "clips" | "intro" | "outro">): number {
  return ms(introSeconds(edit) + bodyDuration(edit) + outroSeconds(edit));
}

/** Which part of the video a moment is in, and where in it. */
export type Moment =
  | { part: "intro"; t: number }
  | { part: "body"; t: number; placed: PlacedClip | null; sourceTime: number }
  | { part: "outro"; t: number };

export function momentAt(edit: Pick<VideoEdit, "clips" | "intro" | "outro">, time: number): Moment {
  const intro = introSeconds(edit);
  const body = bodyDuration(edit);
  const t = clamp(time, 0, totalDuration(edit));
  if (t < intro) return { part: "intro", t };
  const b = ms(t - intro);
  if (b >= body && outroSeconds(edit) > 0) return { part: "outro", t: ms(b - body) };
  const placed = placeClips(edit.clips);
  // The clip that holds the moment; at the very end, the last one.
  const hit = placed.find((p) => b >= p.start && b < p.end) ?? placed[placed.length - 1] ?? null;
  const sourceTime = hit ? ms(hit.clip.in + clamp(b - hit.start, 0, clipDuration(hit.clip))) : 0;
  return { part: "body", t: b, placed: hit, sourceTime };
}

export type EditResult = { ok: true; edit: VideoEdit } | { ok: false; code: "not_found" | "too_short" | "too_long" | "too_many" };

/** A new piece of the timeline from a clip or a picture: the whole clip, or a picture for 3 seconds. */
export function clipFromMedia(media: Pick<MediaItem, "id" | "kind" | "duration" | "width" | "height">, id: string = newVideoId("cl")): TimelineClip {
  const out = media.kind === "image" ? 3 : ms(Math.min(media.duration ?? 3, VIDEO_LIMITS.maxSeconds));
  return { id, mediaId: media.id, in: 0, out, fit: "cover", focusX: 0.5, focusY: 0.5, volume: 1, muted: false };
}

export function addClip(edit: VideoEdit, clip: TimelineClip): EditResult {
  if (edit.clips.length >= VIDEO_LIMITS.clipsOnTimeline) return { ok: false, code: "too_many" };
  if (bodyDuration(edit) + clipDuration(clip) > VIDEO_LIMITS.maxSeconds + 0.0005) return { ok: false, code: "too_long" };
  return { ok: true, edit: { ...edit, clips: [...edit.clips, clip] } };
}

/**
 * Trim a piece: new in and out points, kept inside the source (a video's
 * length; a picture from 0.2 to 30 seconds), at least 0.2 seconds long, and
 * the whole body inside the length limit.
 */
export function trimClip(edit: VideoEdit, clipId: string, next: { in?: number; out?: number }, media: Pick<MediaItem, "kind" | "duration">): EditResult {
  const clip = edit.clips.find((c) => c.id === clipId);
  if (!clip) return { ok: false, code: "not_found" };
  const limit = media.kind === "image" ? VIDEO_LIMITS.maxImageSeconds : (media.duration ?? clip.out);
  let start = media.kind === "image" ? 0 : ms(clamp(next.in ?? clip.in, 0, limit));
  let end = ms(clamp(next.out ?? clip.out, 0, limit));
  if (end - start < VIDEO_LIMITS.minClipSeconds) {
    // Keep the side that was not moved where it was.
    if (next.in !== undefined && next.out === undefined) start = ms(Math.max(0, end - VIDEO_LIMITS.minClipSeconds));
    else end = ms(Math.min(limit, start + VIDEO_LIMITS.minClipSeconds));
    if (end - start < VIDEO_LIMITS.minClipSeconds - 0.0005) return { ok: false, code: "too_short" };
  }
  const others = bodyDuration(edit) - clipDuration(clip);
  if (others + (end - start) > VIDEO_LIMITS.maxSeconds + 0.0005) return { ok: false, code: "too_long" };
  return { ok: true, edit: { ...edit, clips: edit.clips.map((c) => (c.id === clipId ? { ...c, in: start, out: end } : c)) } };
}

/**
 * Split the piece under a moment of the body into two; each side keeps at
 * least 0.2 seconds. A clip is cut at that moment of its source; a picture
 * becomes two pictures whose lengths add up (a picture has no time inside).
 */
export function splitAt(edit: VideoEdit, bodyTime: number, kindOf: (mediaId: string) => MediaItem["kind"] | undefined = () => "video", newId: string = newVideoId("cl")): EditResult {
  const placed = placeClips(edit.clips).find((p) => bodyTime > p.start && bodyTime < p.end);
  if (!placed) return { ok: false, code: "not_found" };
  if (edit.clips.length >= VIDEO_LIMITS.clipsOnTimeline) return { ok: false, code: "too_many" };
  const firstLength = ms(bodyTime - placed.start);
  const secondLength = ms(placed.end - bodyTime);
  if (firstLength < VIDEO_LIMITS.minClipSeconds || secondLength < VIDEO_LIMITS.minClipSeconds) return { ok: false, code: "too_short" };
  const image = kindOf(placed.clip.mediaId) === "image";
  const cut = ms(placed.clip.in + firstLength);
  const first: TimelineClip = image ? { ...placed.clip, in: 0, out: firstLength } : { ...placed.clip, out: cut };
  const second: TimelineClip = image ? { ...placed.clip, id: newId, in: 0, out: secondLength } : { ...placed.clip, id: newId, in: cut };
  const clips = [...edit.clips];
  clips.splice(placed.index, 1, first, second);
  return { ok: true, edit: { ...edit, clips } };
}

/** Move a piece to another place in the order. */
export function moveClip(edit: VideoEdit, clipId: string, toIndex: number): EditResult {
  const from = edit.clips.findIndex((c) => c.id === clipId);
  if (from < 0) return { ok: false, code: "not_found" };
  const clips = [...edit.clips];
  const [clip] = clips.splice(from, 1);
  clips.splice(clamp(Math.round(toIndex), 0, clips.length), 0, clip!);
  return { ok: true, edit: { ...edit, clips } };
}

export function removeClip(edit: VideoEdit, clipId: string): EditResult {
  if (!edit.clips.some((c) => c.id === clipId)) return { ok: false, code: "not_found" };
  return { ok: true, edit: { ...edit, clips: edit.clips.filter((c) => c.id !== clipId) } };
}

// ── Captions ────────────────────────────────────────────────────────────

/** "0:03.5", "1:02.0": a moment as people read it. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const minutes = Math.floor(s / 60);
  const rest = s - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

/** "00:00:03,500": SRT's time. */
export function srtTime(seconds: number): string {
  const total = Math.round(Math.max(0, seconds) * 1000);
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const milli = total % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(milli).padStart(3, "0")}`;
}

/** A time typed by a person or in a caption file: "3", "3.5", "0:03", "1:02.5", "00:00:03,500", "00:03.500". */
export function parseTime(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  const nums = parts.map(Number);
  const seconds = nums.reduce((total, n) => total * 60 + n, 0);
  return Number.isFinite(seconds) ? ms(seconds) : null;
}

/** About how long people need to read a caption: 15 characters a second, at least 1 second. */
export function readingSeconds(text: string): number {
  return ms(Math.max(1, text.trim().length / 15));
}

/** Faster than people read (more than 20 characters a second). */
export function tooFastToRead(cue: Pick<CaptionCue, "start" | "end" | "text">): boolean {
  const seconds = cue.end - cue.start;
  return seconds > 0 && cue.text.trim().length / seconds > 20;
}

const TIME = String.raw`(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?|\d+(?:[.,]\d{1,3})?)`;
const RANGE = new RegExp(`^\\s*\\[?${TIME}\\s*(?:-->|–|—|-)\\s*${TIME}\\]?\\s*(.*)$`);
const AT = new RegExp(`^\\s*\\[${TIME}\\]\\s*(.+)$`);

/**
 * Captions typed or pasted, in any of these forms:
 *   - an SRT or WebVTT file (numbers, "00:00:01,000 --> 00:00:03,000", text);
 *   - one caption a line with its times: "0:01-0:03 Hello" or "1.5 --> 3 Hello";
 *   - one caption a line with its start: "[0:01] Hello" (it lasts until the next);
 *   - plain lines: spread over the video at reading speed, one after another.
 * The result is cleaned by normalizeCues.
 */
export function parseCaptions(text: string, duration: number, makeId: () => string = () => newVideoId("cc")): CaptionCue[] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/^WEBVTT[^\n]*\n/, "").split("\n");
  const cues: Array<{ start: number; end: number | null; text: string }> = [];
  let pending: { start: number; end: number | null; text: string[] } | null = null;
  const flush = () => {
    if (pending && pending.text.join(" ").trim()) cues.push({ start: pending.start, end: pending.end, text: pending.text.join(" ").trim() });
    pending = null;
  };
  const plain: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const range = line.match(RANGE);
    if (range) {
      const start = parseTime(range[1]!);
      const end = parseTime(range[2]!);
      if (start !== null && end !== null) {
        flush();
        pending = { start, end, text: range[3] ? [range[3]] : [] };
        continue;
      }
    }
    const at = line.match(AT);
    if (at) {
      const start = parseTime(at[1]!);
      if (start !== null) {
        flush();
        pending = { start, end: null, text: [at[2]!] };
        continue;
      }
    }
    // An SRT counter line before a time line.
    if (/^\d+$/.test(line) && !pending) continue;
    if (pending) pending.text.push(line);
    else plain.push(line);
  }
  flush();
  const timed: CaptionCue[] = cues.map((c, i) => ({ id: makeId(), start: c.start, end: c.end ?? cues[i + 1]?.start ?? c.start + readingSeconds(c.text), text: c.text }));
  if (timed.length === 0 && plain.length > 0) {
    let at = 0;
    for (const line of plain) {
      const length = readingSeconds(line);
      timed.push({ id: makeId(), start: at, end: ms(at + length), text: line });
      at = ms(at + length);
    }
  }
  return normalizeCues(timed, duration);
}

/**
 * Captions as they can be shown: in time order, inside the video (0 to its
 * length), each at least half a second, never two at once (one that runs into
 * the next ends where the next starts), the words trimmed and kept short.
 * A caption that starts after the end is dropped.
 */
export function normalizeCues(cues: readonly CaptionCue[], duration: number): CaptionCue[] {
  const sorted = cues
    .map((c) => ({ ...c, text: c.text.replace(/\s+/g, " ").trim().slice(0, VIDEO_LIMITS.captionMax), start: ms(Math.max(0, c.start)), end: ms(c.end) }))
    .filter((c) => c.text && c.start < duration)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: CaptionCue[] = [];
  for (let i = 0; i < sorted.length && out.length < VIDEO_LIMITS.captions; i++) {
    const cue = sorted[i]!;
    const next = sorted[i + 1];
    let end = Math.min(Math.max(cue.end, cue.start + 0.5), duration);
    if (next && end > next.start) end = next.start;
    if (end - cue.start < 0.1) continue;
    out.push({ ...cue, end: ms(end) });
  }
  return out;
}

/** Move every caption by the same amount (positive: later), then clean them. */
export function shiftCues(cues: readonly CaptionCue[], delta: number, duration: number): CaptionCue[] {
  return normalizeCues(
    cues.map((c) => ({ ...c, start: c.start + delta, end: c.end + delta })).filter((c) => c.end > 0),
    duration,
  );
}

/** The captions as an SRT file (to keep, or to upload to a network as its own caption track). */
export function cuesToSrt(cues: readonly CaptionCue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n");
}

/** The caption on screen at a moment of the body, if any. */
export function cueAt(cues: readonly CaptionCue[], bodyTime: number): CaptionCue | null {
  return cues.find((c) => bodyTime >= c.start && bodyTime < c.end) ?? null;
}

// ── Export settings ─────────────────────────────────────────────────────

/** What the export writes: H.264 video and AAC sound in an MP4, at the shape's size, 30 frames a second. */
export interface ExportSettings {
  width: number;
  height: number;
  fps: 30;
  videoCodec: "libx264";
  /** x264's speed: veryfast keeps a phone-length video to a few minutes in a browser tab. */
  preset: "veryfast" | "ultrafast";
  /** Quality (lower is better): 21 for full, 26 for a quick draft. */
  crf: number;
  pixelFormat: "yuv420p";
  profile: "high" | "main";
  audioCodec: "aac";
  audioBitrate: "128k";
  sampleRate: 48000;
  container: "mp4";
}

export function exportSettings(aspect: Aspect, quality: Quality = "full"): ExportSettings {
  const size = frameSize(aspect, quality);
  return {
    ...size,
    fps: 30,
    videoCodec: "libx264",
    preset: quality === "full" ? "veryfast" : "ultrafast",
    crf: quality === "full" ? 21 : 26,
    pixelFormat: "yuv420p",
    profile: quality === "full" ? "high" : "main",
    audioCodec: "aac",
    audioBitrate: "128k",
    sampleRate: 48000,
    container: "mp4",
  };
}

// ── A new edit ──────────────────────────────────────────────────────────

export function newEdit(aspect: Aspect, lang: "en" | "es" = "en"): VideoEdit {
  return {
    version: 1,
    aspect,
    background: "navy",
    clips: [],
    overlays: [],
    captions: [],
    captionPosition: "bottom",
    logo: { enabled: true, corner: "tr", version: "auto" },
    intro: { enabled: false, title: "", seconds: 2 },
    outro: {
      enabled: true,
      line: lang === "es" ? "Tu crédito, explicado paso a paso. Los resultados varían." : "Your credit, explained step by step. Results vary.",
      seconds: 3,
    },
    music: { trackId: null, volume: 0.35, duck: true, duckTo: 0.12, fadeOut: true },
    alti: { enabled: false, pose: "wave", corner: "br", start: 0, end: 3 },
  };
}

/** Everything a stored edit could carry, cleaned to what the editor accepts (an old or hand-made JSON never breaks the screen). */
export function cleanEdit(value: unknown, fallbackAspect: Aspect = "9:16"): VideoEdit {
  const base = newEdit(fallbackAspect);
  if (!value || typeof value !== "object") return base;
  const v = value as Partial<VideoEdit>;
  const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === "number" && Number.isFinite(x) ? clamp(x, lo, hi) : d);
  const str = (x: unknown, max: number) => (typeof x === "string" ? x.replace(/\u0000/g, "").slice(0, max) : "");
  const aspect = (["9:16", "1:1", "4:5", "16:9"] as const).includes(v.aspect as Aspect) ? (v.aspect as Aspect) : fallbackAspect;
  const clips = (Array.isArray(v.clips) ? v.clips : []).slice(0, VIDEO_LIMITS.clipsOnTimeline).flatMap((c): TimelineClip[] => {
    if (!c || typeof c !== "object" || typeof c.id !== "string" || typeof c.mediaId !== "string") return [];
    const start = num(c.in, 0, 24 * 3600, 0);
    const end = num(c.out, 0, 24 * 3600, start + 1);
    if (end - start < VIDEO_LIMITS.minClipSeconds - 0.0005) return [];
    return [{ id: c.id.slice(0, 48), mediaId: c.mediaId.slice(0, 48), in: ms(start), out: ms(end), fit: c.fit === "contain" ? "contain" : "cover", focusX: num(c.focusX, 0, 1, 0.5), focusY: num(c.focusY, 0, 1, 0.5), volume: num(c.volume, 0, 1, 1), muted: Boolean(c.muted) }];
  });
  const overlays = (Array.isArray(v.overlays) ? v.overlays : []).slice(0, VIDEO_LIMITS.overlays).flatMap((o) => {
    if (!o || typeof o !== "object" || typeof o.id !== "string") return [];
    const start = ms(num(o.start, 0, VIDEO_LIMITS.maxSeconds, 0));
    return [
      {
        id: o.id.slice(0, 48),
        kind: o.kind === "lowerThird" ? ("lowerThird" as const) : ("title" as const),
        text: str(o.text, VIDEO_LIMITS.textMax),
        sub: str(o.sub, VIDEO_LIMITS.textMax),
        start,
        end: ms(Math.max(start + 0.5, num(o.end, 0, VIDEO_LIMITS.maxSeconds, start + 3))),
        position: o.position === "top" || o.position === "bottom" ? o.position : ("center" as const),
        style: o.style === "navy" || o.style === "gold" ? o.style : ("white" as const),
      },
    ];
  });
  const captions = (Array.isArray(v.captions) ? v.captions : []).slice(0, VIDEO_LIMITS.captions).flatMap((c) =>
    c && typeof c === "object" && typeof c.id === "string" ? [{ id: c.id.slice(0, 48), start: num(c.start, 0, VIDEO_LIMITS.maxSeconds, 0), end: num(c.end, 0, VIDEO_LIMITS.maxSeconds, 0), text: str(c.text, VIDEO_LIMITS.captionMax) }] : [],
  );
  const corner = (x: unknown, d: VideoEdit["logo"]["corner"]) => (["tl", "tr", "bl", "br"].includes(x as string) ? (x as VideoEdit["logo"]["corner"]) : d);
  const poses = ["wave", "phone", "thumbsUp", "thinking", "envelope", "celebrate"] as const;
  return {
    version: 1,
    aspect,
    background: v.background === "black" ? "black" : "navy",
    clips,
    overlays,
    captions: normalizeCues(captions, VIDEO_LIMITS.maxSeconds),
    captionPosition: v.captionPosition === "middle" ? "middle" : "bottom",
    logo: { enabled: v.logo?.enabled !== false, corner: corner(v.logo?.corner, "tr"), version: v.logo?.version === "navy" || v.logo?.version === "white" ? v.logo.version : "auto" },
    intro: { enabled: Boolean(v.intro?.enabled), title: str(v.intro?.title, VIDEO_LIMITS.textMax), seconds: num(v.intro?.seconds, 1, 5, 2) },
    outro: { enabled: v.outro?.enabled !== false, line: typeof v.outro?.line === "string" ? str(v.outro.line, VIDEO_LIMITS.textMax) : base.outro.line, seconds: num(v.outro?.seconds, 1, 6, 3) },
    music: {
      trackId: typeof v.music?.trackId === "string" ? v.music.trackId.slice(0, 48) : null,
      volume: num(v.music?.volume, 0, 1, 0.35),
      duck: v.music?.duck !== false,
      duckTo: num(v.music?.duckTo, 0, 1, 0.12),
      fadeOut: v.music?.fadeOut !== false,
    },
    alti: {
      enabled: Boolean(v.alti?.enabled),
      pose: poses.includes(v.alti?.pose as (typeof poses)[number]) ? (v.alti!.pose as (typeof poses)[number]) : "wave",
      corner: v.alti?.corner === "bl" ? "bl" : "br",
      start: num(v.alti?.start, 0, VIDEO_LIMITS.maxSeconds, 0),
      end: num(v.alti?.end, 0, VIDEO_LIMITS.maxSeconds, 3),
    },
  };
}

/** The sound of the clips under the music: the body's moments when a clip with sound plays (for ducking). */
export function soundSpans(edit: Pick<VideoEdit, "clips">, hasAudio: (mediaId: string) => boolean): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  for (const p of placeClips(edit.clips)) {
    if (p.clip.muted || p.clip.volume <= 0 || !hasAudio(p.clip.mediaId)) continue;
    const last = spans[spans.length - 1];
    if (last && Math.abs(last.end - p.start) < 0.001) last.end = p.end;
    else spans.push({ start: p.start, end: p.end });
  }
  return spans;
}
