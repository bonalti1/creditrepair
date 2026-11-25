"use client";

import { drawIntroCard, drawLayer, drawOutroCard, loadAlti, loadDrawAssets, measureShades } from "./draw";
import { FfmpegEngine } from "./ffmpegClient";
import { extensionFor } from "./files";
import { projectHash } from "./hash";
import { buildRenderPlan, buildSpeechArgs, layerSpecs, probeFromLog, progressFromLog, type RenderMedia } from "./render";
import { bodyDuration, exportSettings, introSeconds, outroSeconds, type Quality } from "./timeline";
import type { MediaItem, MusicTrack, VideoProject } from "./types";

// Renders a video in this browser (render.ts has the recipe): the files are
// read into ffmpeg.wasm's memory, the words, logo and cards are drawn with
// the editor's own drawing (draw.ts) into transparent pictures, ffmpeg puts it
// all together, and the MP4 comes back as a Blob. Nothing leaves the browser.
// Each export runs in a fresh worker that is stopped afterwards, so memory is
// handed back and a cancel is immediate.

export type ExportPhase = "loading" | "reading" | "drawing" | "rendering" | "finishing";

export interface ExportProgress {
  phase: ExportPhase;
  /** 0 to 1 over the whole export. */
  fraction: number;
}

export interface ExportOutcome {
  blob: Blob;
  hash: string;
  width: number;
  height: number;
  duration: number;
  /** What ffmpeg found out about the clips (sound or not, size), for the project to remember. */
  probes: Record<string, { hasAudio: boolean; width: number | null; height: number | null; duration: number | null }>;
}

export class ExportError extends Error {
  constructor(
    readonly code: "cancelled" | "no_clips" | "file_missing" | "engine" | "render_failed",
    readonly detail: string = "",
  ) {
    super(code);
  }
}

export interface ExportJob {
  project: VideoProject;
  tracks: readonly MusicTrack[];
  quality: Quality;
  /** The file behind a media item or a track (a sample path, a storage link, this browser's store). */
  getFile: (ref: string) => Promise<Blob | null>;
  /** A link the browser can read a file from (for the logo's shade per clip, like the preview). */
  urlFor: (ref: string) => Promise<string | null>;
  onProgress: (progress: ExportProgress) => void;
}

function canvas(W: number, H: number): { el: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const el = document.createElement("canvas");
  el.width = W;
  el.height = H;
  const ctx = el.getContext("2d");
  if (!ctx) throw new ExportError("engine", "canvas");
  return { el, ctx };
}

async function png(el: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => el.toBlob(resolve, "image/png"));
  if (!blob) throw new ExportError("engine", "png");
  return new Uint8Array(await blob.arrayBuffer());
}

/** Ask ffmpeg about a file ("-i" alone): its sound, size and length. */
async function probe(engine: FfmpegEngine, file: string) {
  const lines: string[] = [];
  const stop = engine.onLog((line) => lines.push(line));
  try {
    await engine.exec(["-hide_banner", "-i", file]);
  } finally {
    stop();
  }
  return probeFromLog(lines);
}

export class VideoExporter {
  private engine: FfmpegEngine | null = null;
  private cancelled = false;

  cancel(): void {
    this.cancelled = true;
    this.engine?.terminate();
    this.engine = null;
  }

  private check() {
    if (this.cancelled) throw new ExportError("cancelled");
  }

  async run(job: ExportJob): Promise<ExportOutcome> {
    const { project, quality } = job;
    const edit = project.edit;
    if (edit.clips.length === 0) throw new ExportError("no_clips");
    const hash = projectHash(project);
    const settings = exportSettings(edit.aspect, quality);
    const { width: W, height: H } = settings;
    const engine = new FfmpegEngine();
    this.engine = engine;
    try {
      job.onProgress({ phase: "loading", fraction: 0.02 });
      try {
        await engine.load();
      } catch (error) {
        this.check();
        throw new ExportError("engine", error instanceof Error ? error.message : String(error));
      }
      this.check();

      // The files on the timeline, into ffmpeg's memory.
      job.onProgress({ phase: "reading", fraction: 0.06 });
      const used = [...new Set(edit.clips.map((c) => c.mediaId))].map((id) => project.media.find((m) => m.id === id)).filter((m): m is MediaItem => Boolean(m));
      const media: Record<string, RenderMedia> = {};
      const probes: ExportOutcome["probes"] = {};
      for (const [i, item] of used.entries()) {
        const blob = await job.getFile(item.ref);
        this.check();
        if (!blob) throw new ExportError("file_missing", item.name);
        const file = `m${i}.${extensionFor(item.mediaType)}`;
        await engine.write(file, new Uint8Array(await blob.arrayBuffer()));
        let width = item.width;
        let height = item.height;
        let hasAudio = item.kind === "video" ? item.hasAudio : false;
        if (item.kind === "video") {
          const found = await probe(engine, file);
          this.check();
          hasAudio = found.hasAudio;
          if (found.width && found.height) {
            width = found.width;
            height = found.height;
          }
          probes[item.id] = { hasAudio: found.hasAudio, width: found.width, height: found.height, duration: found.duration };
        }
        media[item.id] = { file, kind: item.kind, width, height, hasAudio: Boolean(hasAudio) };
        job.onProgress({ phase: "reading", fraction: 0.06 + 0.1 * ((i + 1) / used.length) });
      }

      // Words, logo, Alti and the cards: drawn like the preview, as pictures.
      job.onProgress({ phase: "drawing", fraction: 0.17 });
      const assets = await loadDrawAssets();
      if (edit.alti.enabled) await loadAlti(assets, edit.alti.pose);
      const shades = await measureShades(edit, project.media, job.urlFor);
      const specs = layerSpecs(edit);
      const layers: Array<{ file: string; start: number; end: number }> = [];
      for (const [k, spec] of specs.entries()) {
        const { el, ctx } = canvas(W, H);
        drawLayer(ctx, spec, edit, project.language, W, H, assets, shades);
        const file = `l${k}.png`;
        await engine.write(file, await png(el));
        layers.push({ file, start: spec.start, end: spec.end });
        this.check();
      }
      let introFile: string | null = null;
      let outroFile: string | null = null;
      if (introSeconds(edit) > 0) {
        const { el, ctx } = canvas(W, H);
        drawIntroCard(ctx, edit, W, H, assets);
        introFile = "intro.png";
        await engine.write(introFile, await png(el));
      }
      if (outroSeconds(edit) > 0) {
        const { el, ctx } = canvas(W, H);
        drawOutroCard(ctx, edit, project.plan.cta, W, H, assets);
        outroFile = "outro.png";
        await engine.write(outroFile, await png(el));
      }
      let musicFile: string | null = null;
      const track = edit.music.trackId ? job.tracks.find((t) => t.id === edit.music.trackId && !t.removedAt) : undefined;
      if (track) {
        const blob = await job.getFile(track.ref);
        if (!blob) throw new ExportError("file_missing", track.name);
        musicFile = `music.${extensionFor(track.mediaType)}`;
        await engine.write(musicFile, new Uint8Array(await blob.arrayBuffer()));
      }
      this.check();

      const built = buildRenderPlan({ edit: track ? edit : { ...edit, music: { ...edit.music, trackId: null } }, settings, media, layers, introFile, outroFile, musicFile, output: "out.mp4" });
      if (!built.ok) throw new ExportError("render_failed", built.problem);
      const total = built.plan.duration;
      job.onProgress({ phase: "rendering", fraction: 0.2 });
      const stop = engine.onLog((line) => {
        const at = progressFromLog(line);
        if (at !== null) job.onProgress({ phase: "rendering", fraction: 0.2 + 0.77 * Math.min(1, at / total) });
      });
      let code: number;
      try {
        code = await engine.exec(built.plan.args);
      } catch (error) {
        this.check();
        throw new ExportError("engine", error instanceof Error ? error.message : String(error));
      } finally {
        stop();
      }
      this.check();
      if (code !== 0) throw new ExportError("render_failed", engine.tail.slice(-6).join("\n"));
      job.onProgress({ phase: "finishing", fraction: 0.98 });
      const bytes = await engine.read("out.mp4");
      if (bytes.byteLength < 1000) throw new ExportError("render_failed", "empty output");
      job.onProgress({ phase: "finishing", fraction: 1 });
      return { blob: new Blob([bytes as BlobPart], { type: "video/mp4" }), hash, width: W, height: H, duration: total, probes };
    } finally {
      engine.terminate();
      if (this.engine === engine) this.engine = null;
    }
  }

  /** The clips' own sound as 16 kHz mono WAV, for automatic captions (only when the server has a transcription key). */
  async speech(project: VideoProject, getFile: (ref: string) => Promise<Blob | null>): Promise<{ wav: Blob; duration: number } | null> {
    const engine = new FfmpegEngine();
    this.engine = engine;
    try {
      await engine.load();
      const media: Record<string, RenderMedia> = {};
      const used = [...new Set(project.edit.clips.map((c) => c.mediaId))].map((id) => project.media.find((m) => m.id === id)).filter((m): m is MediaItem => Boolean(m));
      for (const [i, item] of used.entries()) {
        const blob = await getFile(item.ref);
        if (!blob) throw new ExportError("file_missing", item.name);
        const file = `m${i}.${extensionFor(item.mediaType)}`;
        await engine.write(file, new Uint8Array(await blob.arrayBuffer()));
        const found = item.kind === "video" ? await probe(engine, file) : { hasAudio: false };
        media[item.id] = { file, kind: item.kind, width: item.width, height: item.height, hasAudio: found.hasAudio };
      }
      const args = buildSpeechArgs(project.edit, media, "speech.wav");
      if (!args) return null;
      const code = await engine.exec(args);
      this.check();
      if (code !== 0) throw new ExportError("render_failed", engine.tail.slice(-4).join("\n"));
      const bytes = await engine.read("speech.wav");
      return { wav: new Blob([bytes as BlobPart], { type: "audio/wav" }), duration: bodyDuration(project.edit) };
    } finally {
      engine.terminate();
      if (this.engine === engine) this.engine = null;
    }
  }
}
