"use client";

import { FfmpegEngine } from "./ffmpegClient";
import { extensionFor } from "./files";
import { probeFromLog } from "./render";

// What a clip or picture is (length, size) before it goes on the timeline:
// the browser's own reading first; for a clip the browser can't play (an
// iPhone HEVC .mov in Chrome, say), ffmpeg's reading, which also exports it.

export interface MediaInfo {
  duration: number | null;
  width: number;
  height: number;
  hasAudio: boolean | null;
  /** False when this browser can't show it in the preview (it still exports). */
  previewable: boolean;
}

function browserVideo(url: string): Promise<{ duration: number; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const done = (value: { duration: number; width: number; height: number } | null) => {
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };
    const timer = window.setTimeout(() => done(null), 8000);
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const duration = Number.isFinite(video.duration) ? video.duration : NaN;
      done(video.videoWidth > 0 && duration > 0 ? { duration, width: video.videoWidth, height: video.videoHeight } : null);
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      done(null);
    };
    video.src = url;
  });
}

function browserImage(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function browserAudioDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    const timer = window.setTimeout(() => resolve(null), 8000);
    audio.onloadedmetadata = () => {
      window.clearTimeout(timer);
      resolve(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    };
    audio.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    audio.src = url;
  });
}

export async function readMediaInfo(file: Blob, kind: "video" | "image", mediaType: string): Promise<MediaInfo | null> {
  const url = URL.createObjectURL(file);
  try {
    if (kind === "image") {
      const img = await browserImage(url);
      return img ? { duration: null, width: img.width, height: img.height, hasAudio: false, previewable: true } : null;
    }
    const seen = await browserVideo(url);
    if (seen) return { ...seen, hasAudio: null, previewable: true };
    // The browser can't read it: ask ffmpeg (loaded only for this).
    const engine = new FfmpegEngine();
    try {
      await engine.load();
      const name = `probe.${extensionFor(mediaType)}`;
      await engine.write(name, new Uint8Array(await file.arrayBuffer()));
      const lines: string[] = [];
      const stop = engine.onLog((line) => lines.push(line));
      await engine.exec(["-hide_banner", "-i", name]);
      stop();
      const found = probeFromLog(lines);
      if (!found.hasVideo || !found.width || !found.height || !found.duration) return null;
      return { duration: found.duration, width: found.width, height: found.height, hasAudio: found.hasAudio, previewable: false };
    } catch {
      return null;
    } finally {
      engine.terminate();
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}
