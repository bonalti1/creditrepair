import { bodyDuration, clipDuration, fitRect, introSeconds, ms, outroSeconds, placeClips, soundSpans, totalDuration, type ExportSettings } from "./timeline";
import type { VideoEdit } from "./types";

// The export, as the exact ffmpeg arguments (pure, so it is tested without a
// browser). The editor runs them in ffmpeg.wasm inside the team member's own
// browser (public/video-studio/ffmpeg-worker.js): the clips never leave it to
// be edited.
//
// How a video is put together:
//   1. Each piece of the timeline is read from its own file from its in point
//      for its length (a picture is shown for its length), cropped or fitted
//      to the frame with the same numbers the preview uses (fitRect), at 30
//      frames a second.
//   2. Its sound is kept (at its volume), or silence when it has none or is
//      muted, so every piece has both and they join cleanly.
//   3. The intro card and the end card (pictures drawn by the editor with the
//      locked logo file) go before and after.
//   4. Everything on screen (the logo, words, captions, Alti's overlay) was
//      drawn by the editor into transparent pictures, the same drawing the
//      preview shows; each is laid over the video for its time.
//   5. The music (from the team's library) plays under it all, lower while a
//      clip's own sound plays (ducking), and fades out at the end.
//   6. H.264 video and AAC sound in an MP4, at the shape's size.

export interface RenderMedia {
  /** The file's name in ffmpeg's memory. */
  file: string;
  kind: "video" | "image";
  width: number;
  height: number;
  hasAudio: boolean;
}

/** A transparent picture laid over the video, with its time on the body (seconds after the intro card). */
export interface RenderLayer {
  file: string;
  start: number;
  end: number;
}

export interface RenderInput {
  edit: VideoEdit;
  settings: ExportSettings;
  media: Record<string, RenderMedia>;
  layers: RenderLayer[];
  introFile: string | null;
  outroFile: string | null;
  musicFile: string | null;
  output: string;
}

export interface RenderPlan {
  args: string[];
  /** Seconds of the finished video (for the progress bar). */
  duration: number;
}

export type RenderProblem = "no_clips" | "missing_media" | "missing_card";

const f3 = (n: number) => String(ms(n));
const BG = { black: "0x000000", navy: "0x12213A" } as const;

/** One thing drawn over the video for a while: the logo, Alti's overlay, a title or lower third, a caption. */
export interface LayerSpec {
  key: string;
  kind: "logo" | "alti" | "overlay" | "caption";
  /** The overlay's or caption's id. */
  id: string | null;
  start: number;
  end: number;
}

/**
 * What is drawn over the body and when, in drawing order (the logo first,
 * the captions last, on top). The preview draws the ones active at a moment;
 * the export draws each into its own transparent picture: the same list, so
 * the two always agree.
 */
export function layerSpecs(edit: VideoEdit): LayerSpec[] {
  const body = bodyDuration(edit);
  const out: LayerSpec[] = [];
  if (edit.logo.enabled) {
    // Auto: one logo per clip, so each clip gets the shade that suits its footage.
    if (edit.logo.version === "auto") for (const p of placeClips(edit.clips)) out.push({ key: `logo-${p.clip.id}`, kind: "logo", id: p.clip.id, start: p.start, end: p.end });
    else out.push({ key: "logo", kind: "logo", id: null, start: 0, end: body });
  }
  if (edit.alti.enabled) out.push({ key: "alti", kind: "alti", id: null, start: edit.alti.start, end: edit.alti.end });
  for (const o of edit.overlays) if (o.text.trim() || o.sub.trim()) out.push({ key: `overlay-${o.id}`, kind: "overlay", id: o.id, start: o.start, end: o.end });
  for (const c of edit.captions) out.push({ key: `caption-${c.id}`, kind: "caption", id: c.id, start: c.start, end: c.end });
  return out.map((l) => ({ ...l, start: ms(Math.max(0, l.start)), end: ms(Math.min(body, l.end)) })).filter((l) => l.end - l.start >= 0.05);
}

/** The layers on screen at a moment of the body, in drawing order. */
export function layersAt(edit: VideoEdit, bodyTime: number): LayerSpec[] {
  return layerSpecs(edit).filter((l) => bodyTime >= l.start && bodyTime < l.end);
}

/** Layers whose time is inside the body, clipped to it. */
export function visibleLayers(layers: readonly RenderLayer[], body: number): RenderLayer[] {
  return layers
    .map((l) => ({ ...l, start: ms(Math.max(0, l.start)), end: ms(Math.min(body, l.end)) }))
    .filter((l) => l.end - l.start >= 0.05);
}

export function buildRenderPlan(input: RenderInput): { ok: true; plan: RenderPlan } | { ok: false; problem: RenderProblem } {
  const { edit, settings } = input;
  if (edit.clips.length === 0) return { ok: false, problem: "no_clips" };
  if (edit.clips.some((c) => !input.media[c.mediaId])) return { ok: false, problem: "missing_media" };
  const intro = introSeconds(edit);
  const outro = outroSeconds(edit);
  if ((intro > 0 && !input.introFile) || (outro > 0 && !input.outroFile)) return { ok: false, problem: "missing_card" };
  const { width: W, height: H, fps } = settings;
  const body = bodyDuration(edit);
  const total = totalDuration(edit);
  const args: string[] = ["-hide_banner", "-nostdin", "-y"];
  const filters: string[] = [];
  let index = 0;
  const segments: string[] = [];
  const silence = (label: string, seconds: number) => filters.push(`aevalsrc=0:channel_layout=stereo:sample_rate=${settings.sampleRate}:duration=${f3(seconds)},aformat=sample_fmts=fltp[${label}]`);

  const card = (file: string, seconds: number, name: string) => {
    args.push("-loop", "1", "-framerate", String(fps), "-t", f3(seconds), "-i", file);
    filters.push(`[${index}:v]scale=${W}:${H},setsar=1,fps=${fps},format=yuv420p,trim=duration=${f3(seconds)},setpts=PTS-STARTPTS[v${name}]`);
    silence(`a${name}`, seconds);
    segments.push(`[v${name}][a${name}]`);
    index += 1;
  };

  if (intro > 0) card(input.introFile!, intro, "intro");

  placeClips(edit.clips).forEach((placed, j) => {
    const clip = placed.clip;
    const media = input.media[clip.mediaId]!;
    const seconds = clipDuration(clip);
    if (media.kind === "image") {
      args.push("-loop", "1", "-framerate", String(fps), "-t", f3(seconds), "-i", media.file);
    } else {
      // Seek in the input (fast, and exact when re-encoding), and read only this piece.
      args.push("-ss", f3(clip.in), "-t", f3(seconds), "-i", media.file);
    }
    const fit = fitRect(media.width, media.height, W, H, clip.fit, clip.focusX, clip.focusY);
    const chain = [
      "setpts=PTS-STARTPTS",
      // A file a little shorter than it says holds its last frame, so the piece keeps its length.
      "tpad=stop=-1:stop_mode=clone",
      `trim=duration=${f3(seconds)}`,
      `fps=${fps}`,
      `crop=${fit.sw}:${fit.sh}:${fit.sx}:${fit.sy}`,
      `scale=${fit.dw}:${fit.dh}:flags=bicubic`,
      "setsar=1",
      `pad=${W}:${H}:${fit.dx}:${fit.dy}:color=${BG[edit.background]}`,
      "format=yuv420p",
    ];
    filters.push(`[${index}:v]${chain.join(",")}[v${j}]`);
    if (media.kind === "video" && media.hasAudio && !clip.muted && clip.volume > 0) {
      filters.push(
        `[${index}:a]asetpts=PTS-STARTPTS,aresample=${settings.sampleRate},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${clip.volume.toFixed(3)},apad=whole_dur=${f3(seconds)},atrim=duration=${f3(seconds)}[a${j}]`,
      );
    } else {
      silence(`a${j}`, seconds);
    }
    segments.push(`[v${j}][a${j}]`);
    index += 1;
  });

  if (outro > 0) card(input.outroFile!, outro, "outro");

  filters.push(`${segments.join("")}concat=n=${segments.length}:v=1:a=1[vcat][acat]`);

  // What is on screen: each picture over the video for its time (after the intro card).
  let last = "vcat";
  visibleLayers(input.layers, body).forEach((layer, k) => {
    args.push("-i", layer.file);
    const next = `x${k}`;
    filters.push(`[${last}][${index}:v]overlay=0:0:eof_action=repeat:enable='between(t,${f3(intro + layer.start)},${f3(intro + layer.end)})'[${next}]`);
    last = next;
    index += 1;
  });
  filters.push(`[${last}]format=yuv420p[vout]`);

  // The music under everything, looped to the length, lower while a clip's own sound plays.
  if (input.musicFile && edit.music.trackId) {
    args.push("-stream_loop", "-1", "-i", input.musicFile);
    const volume = edit.music.volume;
    const hasAudio = (mediaId: string) => {
      const m = input.media[mediaId];
      return Boolean(m && m.kind === "video" && m.hasAudio);
    };
    const spans = edit.music.duck ? soundSpans(edit, hasAudio) : [];
    const level =
      spans.length === 0
        ? `volume=${volume.toFixed(3)}`
        : `volume='if(gt(${spans.map((s) => `between(t,${f3(intro + s.start)},${f3(intro + s.end)})`).join("+")},0),${Math.min(volume, edit.music.duckTo).toFixed(3)},${volume.toFixed(3)})':eval=frame`;
    const fade = edit.music.fadeOut && total > 2 ? `,afade=t=out:st=${f3(total - 1.5)}:d=1.5` : "";
    filters.push(`[${index}:a]aresample=${settings.sampleRate},aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${f3(total)},asetpts=PTS-STARTPTS,${level}${fade}[mus]`);
    // Two stereo tracks added together (amerge + pan: the same in every ffmpeg version, no level change).
    filters.push(`[acat][mus]amerge=inputs=2,pan=stereo|c0=c0+c2|c1=c1+c3[aout]`);
    index += 1;
  } else {
    filters.push(`[acat]anull[aout]`);
  }

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    settings.videoCodec,
    "-preset",
    settings.preset,
    "-crf",
    String(settings.crf),
    "-profile:v",
    settings.profile,
    "-pix_fmt",
    settings.pixelFormat,
    "-r",
    String(fps),
    "-c:a",
    settings.audioCodec,
    "-b:a",
    settings.audioBitrate,
    "-ar",
    String(settings.sampleRate),
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    "-t",
    f3(total),
    input.output,
  );
  return { ok: true, plan: { args, duration: total } };
}

/**
 * The clips' own sound only (no music, no cards), as 16 kHz mono WAV: what
 * the automatic captions provider listens to, timed like the captions (the
 * body). Only used when a transcription key is set on the server.
 */
export function buildSpeechArgs(edit: VideoEdit, media: Record<string, RenderMedia>, output: string): string[] | null {
  if (edit.clips.length === 0 || edit.clips.some((c) => !media[c.mediaId])) return null;
  const args: string[] = ["-hide_banner", "-nostdin", "-y"];
  const filters: string[] = [];
  const parts: string[] = [];
  let index = 0;
  placeClips(edit.clips).forEach((placed, j) => {
    const clip = placed.clip;
    const m = media[clip.mediaId]!;
    const seconds = clipDuration(clip);
    if (m.kind === "video" && m.hasAudio && !clip.muted) {
      args.push("-ss", f3(clip.in), "-t", f3(seconds), "-i", m.file);
      filters.push(`[${index}:a]asetpts=PTS-STARTPTS,aresample=16000,aformat=sample_fmts=s16:channel_layouts=mono,apad=whole_dur=${f3(seconds)},atrim=duration=${f3(seconds)}[s${j}]`);
      index += 1;
    } else {
      filters.push(`aevalsrc=0:channel_layout=mono:sample_rate=16000:duration=${f3(seconds)},aformat=sample_fmts=s16[s${j}]`);
    }
    parts.push(`[s${j}]`);
  });
  if (!args.includes("-i")) return null;
  filters.push(`${parts.join("")}concat=n=${parts.length}:v=0:a=1[speech]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[speech]", "-c:a", "pcm_s16le", "-ar", "16000", "-ac", "1", output);
  return args;
}

/** "time=00:00:03.20" in ffmpeg's log, as seconds (for the progress bar). */
export function progressFromLog(line: string): number | null {
  const m = line.match(/time=\s*(-?\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!m) return null;
  const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/** What ffmpeg says about a file when asked with "-i" alone: its length, size and whether it has sound. */
export function probeFromLog(lines: readonly string[]): { duration: number | null; width: number | null; height: number | null; hasAudio: boolean; hasVideo: boolean } {
  const text = lines.join("\n");
  const d = text.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  const duration = d ? ms(Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3])) : null;
  const video = text.match(/Stream #\d+:\d+[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/);
  // A phone video's rotation: ffmpeg turns it upright, so the frame is the other way round.
  const rotated = /rotate\s*:\s*-?(90|270)|rotation of -?(90|270)/.test(text);
  const w = video ? Number(video[1]) : null;
  const h = video ? Number(video[2]) : null;
  return {
    duration,
    width: rotated ? h : w,
    height: rotated ? w : h,
    hasAudio: /Stream #\d+:\d+[^\n]*Audio:/.test(text),
    hasVideo: Boolean(video),
  };
}
