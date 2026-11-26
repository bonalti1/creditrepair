"use client";

import { aiByline, BRAND, LOGO_CLEAR_SPACE, type AssistantPose } from "../brand";
import { layersAt, type LayerSpec } from "./render";
import { fitRect, safeRect } from "./timeline";
import type { Aspect, CaptionCue, Fit, MediaItem, TextOverlay, VideoEdit, VideoLang } from "./types";

export type LogoShade = "white" | "navy";

// Everything the Video Studio draws, on a canvas of any size: the preview in
// the editor and the transparent pictures the export lays over the video
// (render.ts) call the same functions, so what the team sees is what the
// file holds. Brand rules (docs/BRAND.md, content/brand/lock.json):
//
//   - The logo is the kit's file, drawn unchanged: scaled evenly (never
//     stretched or recoloured), the white one on dark footage and the navy
//     one on light, with clear space of about half its height around it.
//   - Words in the brand fonts (Poppins for titles and captions, Inter for
//     small text) and colours: white with a navy edge, navy on white, navy on
//     gold (never white on gold, never gold text on white).
//   - Captions: Poppins 700, 76 px on a 1080 px frame, white with a 14 px navy
//     edge (the brand lock), inside every network's safe zone.
//   - Alti's art only as an overlay, always with "Alti · AI assistant" under him.

export const NAVY = "#12213A";
export const GOLD = "#EFB537";
export const WHITE = "#FFFFFF";

export interface DrawAssets {
  display: string;
  body: string;
  logoWhite: HTMLImageElement;
  logoNavy: HTMLImageElement;
  alti: Partial<Record<AssistantPose, HTMLImageElement>>;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image ${src}`));
    img.src = src;
  });
}

let cached: Promise<DrawAssets> | null = null;

/** The fonts and the locked brand files, loaded once. */
export function loadDrawAssets(): Promise<DrawAssets> {
  if (cached) return cached;
  cached = (async () => {
    const root = getComputedStyle(document.documentElement);
    const display = root.getPropertyValue("--font-poppins").trim() || "Poppins, system-ui, sans-serif";
    const body = root.getPropertyValue("--font-inter").trim() || "Inter, system-ui, sans-serif";
    await Promise.all(
      [`700 40px ${display}`, `600 40px ${display}`, `600 40px ${body}`, `500 40px ${body}`].map((f) => document.fonts?.load(f).catch(() => undefined)),
    );
    const [logoWhite, logoNavy] = await Promise.all([loadImage(BRAND.logo.onDark.src), loadImage(BRAND.logo.onLight.src)]);
    return { display, body, logoWhite, logoNavy, alti: {} };
  })();
  cached.catch(() => {
    cached = null;
  });
  return cached;
}

/** Alti's pose, loaded when first used (his art is locked: drawn as it is). */
export async function loadAlti(assets: DrawAssets, pose: AssistantPose): Promise<HTMLImageElement | null> {
  if (assets.alti[pose]) return assets.alti[pose]!;
  try {
    const img = await loadImage(BRAND.assistantPoses[pose].src2x);
    assets.alti[pose] = img;
    return img;
  } catch {
    return null;
  }
}

/** The size words are measured against: the frame's short side, as a 1080 px frame. */
export function unit(W: number, H: number): number {
  return Math.min(W, H) / 1080;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Words broken into lines that fit; the size shrinks (to 60%) until they fit in maxLines. */
export function fitLines(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, size: number, maxWidth: number, maxLines: number): { lines: string[]; size: number } {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  for (let px = size; px >= size * 0.6; px *= 0.92) {
    ctx.font = font(px);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxWidth)) return { lines, size: px };
  }
  ctx.font = font(size * 0.6);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return { lines: lines.slice(0, maxLines), size: size * 0.6 };
}

/** Words with a navy edge (captions and white titles): the edge first, then the white over it. */
function outlinedLines(ctx: CanvasRenderingContext2D, lines: string[], cx: number, top: number, lineHeight: number, stroke: number) {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  lines.forEach((line, i) => {
    const y = top + lineHeight * (i + 0.5);
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = stroke;
    ctx.strokeText(line, cx, y);
    ctx.fillStyle = WHITE;
    ctx.fillText(line, cx, y);
  });
}

// ── The video frame ─────────────────────────────────────────────────────

/** A clip's frame (or a picture), cropped or fitted like the export, on the bars' colour. */
export function drawSource(ctx: CanvasRenderingContext2D, source: CanvasImageSource, srcW: number, srcH: number, W: number, H: number, fit: Fit, focusX: number, focusY: number, background: VideoEdit["background"]) {
  ctx.fillStyle = background === "black" ? "#000000" : NAVY;
  ctx.fillRect(0, 0, W, H);
  const f = fitRect(srcW, srcH, W, H, fit, focusX, focusY);
  try {
    ctx.drawImage(source, f.sx, f.sy, f.sw, f.sh, f.dx, f.dy, f.dw, f.dh);
  } catch {
    // A frame not decoded yet: the bars' colour shows for that instant.
  }
}

// ── The logo ────────────────────────────────────────────────────────────

/** Where the logo goes: its corner, inside the safe zone, with its clear space. Scaled evenly from the file's own shape. */
export function logoBox(aspect: Aspect, corner: VideoEdit["logo"]["corner"], W: number, H: number): { x: number; y: number; w: number; h: number } {
  const ratio = BRAND.logo.onDark.height / BRAND.logo.onDark.width;
  const w = Math.round((aspect === "16:9" ? 0.16 : aspect === "9:16" ? 0.26 : 0.22) * W);
  const h = Math.round(w * ratio);
  const clear = Math.round(h * LOGO_CLEAR_SPACE);
  const safe = safeRect(aspect, W, H);
  const x = corner === "tl" || corner === "bl" ? safe.x + clear : safe.x + safe.w - clear - w;
  const y = corner === "tl" || corner === "tr" ? safe.y + clear : safe.y + safe.h - clear - h;
  return { x, y, w, h };
}

/** Which logo file: the one chosen, or (auto) the white one on dark footage and the navy one on light, per clip. */
export function logoShade(edit: VideoEdit, clipId: string | null, shades: Readonly<Record<string, LogoShade>>): LogoShade {
  if (edit.logo.version !== "auto") return edit.logo.version;
  return (clipId && shades[clipId]) || "white";
}

export function drawLogo(ctx: CanvasRenderingContext2D, edit: VideoEdit, W: number, H: number, assets: DrawAssets, shade: LogoShade) {
  const box = logoBox(edit.aspect, edit.logo.corner, W, H);
  ctx.drawImage(shade === "navy" ? assets.logoNavy : assets.logoWhite, box.x, box.y, box.w, box.h);
}

/** Light footage gets the navy logo; dark footage the white one (relative luminance of the logo's corner, 0 to 1). */
export function shadeForLuminance(luminance: number): LogoShade {
  return luminance > 0.5 ? "navy" : "white";
}

/** The average relative luminance of a box of a canvas (sampled every few pixels). */
export function boxLuminance(ctx: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }): number {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const w = Math.max(1, Math.floor(box.w));
  const h = Math.max(1, Math.floor(box.h));
  const data = ctx.getImageData(x, y, w, h).data;
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4 * 7) {
    sum += 0.2126 * lin(data[i]!) + 0.7152 * lin(data[i + 1]!) + 0.0722 * lin(data[i + 2]!);
    n += 1;
  }
  return n ? sum / n : 0;
}

/**
 * The words keep clear of the logo: where a top-corner logo ends (titles start
 * below it) and where a bottom-corner logo begins (captions end above it).
 */
export function wordsArea(edit: VideoEdit, W: number, H: number) {
  const safe = safeRect(edit.aspect, W, H);
  let top = safe.y;
  let bottom = safe.y + safe.h;
  if (edit.logo.enabled) {
    const box = logoBox(edit.aspect, edit.logo.corner, W, H);
    const clear = Math.round(box.h * LOGO_CLEAR_SPACE);
    if (edit.logo.corner === "tl" || edit.logo.corner === "tr") top = box.y + box.h + clear;
    else bottom = box.y - clear;
  }
  return { x: safe.x, w: safe.w, y: top, h: bottom - top, bottom, captionsTop: bottom - Math.round(H * (edit.aspect === "9:16" ? 0.16 : 0.2)) };
}

// ── Words on screen ─────────────────────────────────────────────────────

export function drawTitle(ctx: CanvasRenderingContext2D, overlay: TextOverlay, edit: VideoEdit, W: number, H: number, assets: DrawAssets) {
  const u = unit(W, H);
  const area = wordsArea(edit, W, H);
  const maxWidth = area.w * (overlay.style === "white" ? 1 : 0.86);
  const { lines, size } = fitLines(ctx, overlay.text, (px) => `700 ${px}px ${assets.display}`, 84 * u, maxWidth, 3);
  const lineHeight = size * 1.18;
  const blockH = lineHeight * lines.length;
  const padX = 34 * u;
  const padY = 22 * u;
  const boxed = overlay.style !== "white";
  const fullH = blockH + (boxed ? padY * 2 : 0);
  const top =
    overlay.position === "top"
      ? area.y + 24 * u
      : overlay.position === "bottom"
        ? area.captionsTop - fullH - 24 * u
        : area.y + (area.h - fullH) / 2;
  const cx = area.x + area.w / 2;
  ctx.font = `700 ${size}px ${assets.display}`;
  if (boxed) {
    const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2;
    ctx.fillStyle = overlay.style === "gold" ? GOLD : WHITE;
    roundRect(ctx, cx - width / 2, top, width, fullH, 18 * u);
    ctx.fill();
    ctx.fillStyle = NAVY;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    lines.forEach((line, i) => ctx.fillText(line, cx, top + padY + lineHeight * (i + 0.5)));
  } else {
    outlinedLines(ctx, lines, cx, top, lineHeight, 14 * u);
  }
}

export function drawLowerThird(ctx: CanvasRenderingContext2D, overlay: TextOverlay, edit: VideoEdit, W: number, H: number, assets: DrawAssets) {
  const u = unit(W, H);
  const area = wordsArea(edit, W, H);
  // Beside Alti while he is on screen, never over him.
  const alti = overlay.position !== "top" ? altiColumn(edit, W, H, overlay.start, overlay.end) : null;
  const right = area.x + area.w;
  if (alti && edit.alti.corner === "bl") area.x = alti.to + 12 * u;
  const room = (alti && edit.alti.corner === "br" ? alti.from - 12 * u : right) - area.x;
  const maxWidth = Math.min(room - 40 * u, area.w * 0.86, 820 * u);
  const main = fitLines(ctx, overlay.text, (px) => `600 ${px}px ${assets.display}`, 54 * u, maxWidth, 2);
  const sub = overlay.sub.trim() ? fitLines(ctx, overlay.sub, (px) => `500 ${px}px ${assets.body}`, 36 * u, maxWidth, 2) : { lines: [], size: 0 };
  const padX = 30 * u;
  const padY = 22 * u;
  const bar = 10 * u;
  const mainH = main.size * 1.2 * main.lines.length;
  const subH = sub.lines.length ? sub.size * 1.3 * sub.lines.length + 6 * u : 0;
  const boxH = padY * 2 + mainH + subH;
  ctx.font = `600 ${main.size}px ${assets.display}`;
  const widths = main.lines.map((l) => ctx.measureText(l).width);
  ctx.font = `500 ${sub.size || 1}px ${assets.body}`;
  widths.push(...sub.lines.map((l) => ctx.measureText(l).width));
  const boxW = Math.max(...widths, 10) + padX * 2 + bar;
  const x = area.x;
  const top = overlay.position === "top" ? area.y + 24 * u : overlay.position === "center" ? area.y + (area.h - boxH) / 2 : area.captionsTop - boxH - 24 * u;
  const fill = overlay.style === "gold" ? GOLD : overlay.style === "navy" ? WHITE : NAVY;
  const ink = overlay.style === "white" ? WHITE : NAVY;
  ctx.fillStyle = fill;
  roundRect(ctx, x, top, boxW, boxH, 14 * u);
  ctx.fill();
  // The gold bar at the left (navy on the gold box, so it still shows).
  ctx.fillStyle = overlay.style === "gold" ? NAVY : GOLD;
  roundRect(ctx, x, top, bar, boxH, 4 * u);
  ctx.fill();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = ink;
  ctx.font = `600 ${main.size}px ${assets.display}`;
  main.lines.forEach((line, i) => ctx.fillText(line, x + bar + padX, top + padY + main.size * 1.2 * (i + 0.5)));
  if (sub.lines.length) {
    ctx.font = `500 ${sub.size}px ${assets.body}`;
    sub.lines.forEach((line, i) => ctx.fillText(line, x + bar + padX, top + padY + mainH + 6 * u + sub.size * 1.3 * (i + 0.5)));
  }
}

/** Alti's column (x from, x to) while he shares the screen with something shown from start to end; null when he doesn't. */
export function altiColumn(edit: VideoEdit, W: number, H: number, start: number, end: number): { from: number; to: number } | null {
  if (!edit.alti.enabled || end <= edit.alti.start || start >= edit.alti.end) return null;
  const safe = safeRect(edit.aspect, W, H);
  const figureH = (edit.aspect === "16:9" ? 0.5 : 0.3) * H;
  const img = BRAND.assistantPoses[edit.alti.pose];
  const blockW = Math.max(figureH * (img.width / img.height), 300 * unit(W, H));
  return edit.alti.corner === "bl" ? { from: safe.x, to: safe.x + blockW } : { from: safe.x + safe.w - blockW, to: safe.x + safe.w };
}

export function drawCaption(ctx: CanvasRenderingContext2D, cue: CaptionCue, edit: VideoEdit, W: number, H: number, assets: DrawAssets) {
  const u = unit(W, H);
  const full = safeRect(edit.aspect, W, H);
  const area = wordsArea(edit, W, H);
  // Beside Alti, never over him: the captions take the rest of the width.
  const alti = edit.captionPosition === "bottom" ? altiColumn(edit, W, H, cue.start, cue.end) : null;
  const safe = alti ? (edit.alti.corner === "bl" ? { ...full, x: alti.to + 12 * u, w: full.x + full.w - alti.to - 12 * u } : { ...full, w: alti.from - full.x - 12 * u }) : full;
  const { lines, size } = fitLines(ctx, cue.text, (px) => `700 ${px}px ${assets.display}`, 76 * u, safe.w * 0.94, alti ? 4 : 3);
  const lineHeight = size * 1.2;
  const blockH = lineHeight * lines.length;
  const top = edit.captionPosition === "middle" ? safe.y + safe.h * 0.58 - blockH / 2 : area.bottom - blockH - 12 * u;
  ctx.font = `700 ${size}px ${assets.display}`;
  outlinedLines(ctx, lines, safe.x + safe.w / 2, top, lineHeight, 14 * u);
}

// ── Alti, with his label ────────────────────────────────────────────────

export function drawAlti(ctx: CanvasRenderingContext2D, edit: VideoEdit, lang: VideoLang, W: number, H: number, assets: DrawAssets) {
  const img = assets.alti[edit.alti.pose];
  if (!img) return;
  const u = unit(W, H);
  const safe = safeRect(edit.aspect, W, H);
  const label = aiByline(lang);
  ctx.font = `600 ${30 * u}px ${assets.body}`;
  const labelW = ctx.measureText(label).width + 36 * u;
  const labelH = 52 * u;
  const figureH = (edit.aspect === "16:9" ? 0.5 : 0.3) * H;
  const figureW = figureH * (img.naturalWidth / Math.max(1, img.naturalHeight));
  const blockW = Math.max(figureW, labelW);
  const left = edit.alti.corner === "bl" ? safe.x : safe.x + safe.w - blockW;
  // Above a logo in the same bottom corner, never over it.
  const sameCorner = edit.logo.enabled && edit.logo.corner === edit.alti.corner;
  const labelTop = (sameCorner ? wordsArea(edit, W, H).bottom : safe.y + safe.h) - labelH;
  const figureTop = labelTop - 8 * u - figureH;
  ctx.drawImage(img, left + (blockW - figureW) / 2, figureTop, figureW, figureH);
  ctx.fillStyle = NAVY;
  roundRect(ctx, left + (blockW - labelW) / 2, labelTop, labelW, labelH, labelH / 2);
  ctx.fill();
  ctx.fillStyle = WHITE;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, left + blockW / 2, labelTop + labelH / 2);
}

// ── One layer, and all at a moment ──────────────────────────────────────

export function drawLayer(ctx: CanvasRenderingContext2D, layer: LayerSpec, edit: VideoEdit, lang: VideoLang, W: number, H: number, assets: DrawAssets, shades: Readonly<Record<string, LogoShade>> = {}) {
  ctx.save();
  if (layer.kind === "logo") drawLogo(ctx, edit, W, H, assets, logoShade(edit, layer.id, shades));
  else if (layer.kind === "alti") drawAlti(ctx, edit, lang, W, H, assets);
  else if (layer.kind === "overlay") {
    const overlay = edit.overlays.find((o) => o.id === layer.id);
    if (overlay) (overlay.kind === "lowerThird" ? drawLowerThird : drawTitle)(ctx, overlay, edit, W, H, assets);
  } else {
    const cue = edit.captions.find((c) => c.id === layer.id);
    if (cue) drawCaption(ctx, cue, edit, W, H, assets);
  }
  ctx.restore();
}

export function drawOnScreen(ctx: CanvasRenderingContext2D, edit: VideoEdit, lang: VideoLang, bodyTime: number, W: number, H: number, assets: DrawAssets, shades: Readonly<Record<string, LogoShade>> = {}) {
  for (const layer of layersAt(edit, bodyTime)) drawLayer(ctx, layer, edit, lang, W, H, assets, shades);
}

/**
 * The logo's shade for each clip (auto): a frame from the middle of the clip,
 * drawn like the video, and the brightness under the logo. A clip this
 * browser can't decode keeps the white logo. Used by the preview and the
 * export alike.
 */
export async function measureShades(edit: VideoEdit, media: readonly MediaItem[], urlFor: (ref: string) => Promise<string | null>): Promise<Record<string, LogoShade>> {
  const out: Record<string, LogoShade> = {};
  if (!edit.logo.enabled || edit.logo.version !== "auto") return out;
  const W = 270;
  const H = Math.round((W * FRAME_RATIO[edit.aspect][1]) / FRAME_RATIO[edit.aspect][0]);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return out;
  const box = logoBox(edit.aspect, edit.logo.corner, W, H);
  for (const clip of edit.clips) {
    const item = media.find((m) => m.id === clip.mediaId);
    if (!item) continue;
    try {
      const url = await urlFor(item.ref);
      if (!url) continue;
      const frame = item.kind === "image" ? await loadImage(url) : await videoFrame(url, clip.in + (clip.out - clip.in) / 2);
      if (!frame) continue;
      const w = frame instanceof HTMLVideoElement ? frame.videoWidth : frame.naturalWidth;
      const h = frame instanceof HTMLVideoElement ? frame.videoHeight : frame.naturalHeight;
      drawSource(ctx, frame, w, h, W, H, clip.fit, clip.focusX, clip.focusY, edit.background);
      out[clip.id] = shadeForLuminance(boxLuminance(ctx, box));
      if (frame instanceof HTMLVideoElement) {
        frame.removeAttribute("src");
        frame.load();
      }
    } catch {
      // Unreadable here: the white logo.
    }
  }
  return out;
}

const FRAME_RATIO: Record<Aspect, [number, number]> = { "9:16": [9, 16], "1:1": [1, 1], "4:5": [4, 5], "16:9": [16, 9] };

/** One decoded frame of a clip at a moment (null when this browser can't decode it). */
function videoFrame(url: string, at: number): Promise<HTMLVideoElement | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    const timer = window.setTimeout(() => resolve(null), 6000);
    video.onloadeddata = () => {
      video.currentTime = Math.max(0, at);
    };
    video.onseeked = () => {
      window.clearTimeout(timer);
      resolve(video);
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    video.src = url;
  });
}

// ── The brand cards ─────────────────────────────────────────────────────

/** The intro card: navy, the white logo (its file, centred, with clear space), the title. */
export function drawIntroCard(ctx: CanvasRenderingContext2D, edit: VideoEdit, W: number, H: number, assets: DrawAssets) {
  const u = unit(W, H);
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, W, H);
  const ratio = BRAND.logo.onDark.height / BRAND.logo.onDark.width;
  const logoW = Math.round(Math.min(W * 0.56, 620 * u * (W > H ? 1.2 : 1)));
  const logoH = Math.round(logoW * ratio);
  const title = edit.intro.title.trim();
  const fit = title ? fitLines(ctx, title, (px) => `700 ${px}px ${assets.display}`, 72 * u, W * 0.8, 3) : { lines: [], size: 0 };
  const gap = logoH * LOGO_CLEAR_SPACE * 1.6;
  const blockH = logoH + (fit.lines.length ? gap + fit.size * 1.2 * fit.lines.length : 0);
  const top = (H - blockH) / 2;
  ctx.drawImage(assets.logoWhite, (W - logoW) / 2, top, logoW, logoH);
  if (fit.lines.length) {
    ctx.font = `700 ${fit.size}px ${assets.display}`;
    ctx.fillStyle = WHITE;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    fit.lines.forEach((line, i) => ctx.fillText(line, W / 2, top + logoH + gap + fit.size * 1.2 * (i + 0.5)));
  }
}

/** The end card: navy, the white logo, the line, the call to action on gold (navy words). */
export function drawOutroCard(ctx: CanvasRenderingContext2D, edit: VideoEdit, cta: string, W: number, H: number, assets: DrawAssets) {
  const u = unit(W, H);
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, W, H);
  const ratio = BRAND.logo.onDark.height / BRAND.logo.onDark.width;
  const logoW = Math.round(Math.min(W * 0.56, 620 * u * (W > H ? 1.2 : 1)));
  const logoH = Math.round(logoW * ratio);
  const line = fitLines(ctx, edit.outro.line.trim(), (px) => `600 ${px}px ${assets.body}`, 46 * u, W * 0.8, 4);
  const button = cta.trim() ? fitLines(ctx, cta.trim(), (px) => `700 ${px}px ${assets.display}`, 52 * u, W * 0.7, 1) : { lines: [], size: 0 };
  const gap = logoH * LOGO_CLEAR_SPACE * 1.6;
  const lineH = line.lines.length ? line.size * 1.35 * line.lines.length : 0;
  const buttonH = button.lines.length ? button.size * 2 : 0;
  const blockH = logoH + (lineH ? gap + lineH : 0) + (buttonH ? gap + buttonH : 0);
  let y = (H - blockH) / 2;
  ctx.drawImage(assets.logoWhite, (W - logoW) / 2, y, logoW, logoH);
  y += logoH;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (lineH) {
    y += gap;
    ctx.font = `600 ${line.size}px ${assets.body}`;
    ctx.fillStyle = WHITE;
    line.lines.forEach((l, i) => ctx.fillText(l, W / 2, y + line.size * 1.35 * (i + 0.5)));
    y += lineH;
  }
  if (buttonH) {
    y += gap;
    ctx.font = `700 ${button.size}px ${assets.display}`;
    const bw = ctx.measureText(button.lines[0]!).width + button.size * 1.6;
    ctx.fillStyle = GOLD;
    roundRect(ctx, (W - bw) / 2, y, bw, buttonH, buttonH / 2);
    ctx.fill();
    ctx.fillStyle = NAVY;
    ctx.fillText(button.lines[0]!, W / 2, y + buttonH / 2);
  }
}

/** The safe zone drawn over the preview (dashed, not in the export). */
export function drawSafeGuides(ctx: CanvasRenderingContext2D, aspect: Aspect, W: number, H: number) {
  const safe = safeRect(aspect, W, H);
  ctx.save();
  ctx.strokeStyle = "rgba(239,181,55,0.95)";
  ctx.lineWidth = Math.max(1, W / 360);
  ctx.setLineDash([W / 60, W / 90]);
  ctx.strokeRect(safe.x + 0.5, safe.y + 0.5, safe.w - 1, safe.h - 1);
  ctx.restore();
}
