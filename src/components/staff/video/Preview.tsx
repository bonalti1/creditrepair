"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import { drawIntroCard, drawOnScreen, drawOutroCard, drawSafeGuides, drawSource, loadAlti, loadDrawAssets, measureShades, NAVY, type DrawAssets, type LogoShade } from "@/lib/video/draw";
import { introSeconds, momentAt, soundSpans, totalDuration } from "@/lib/video/timeline";
import type { MediaItem, MusicTrack, VideoEdit, VideoLang } from "@/lib/video/types";

// The editor's player: a canvas that draws the video as the export will
// (draw.ts), from the clips' own <video> elements, with the words, logo,
// cards and Alti on top, and the music under it. The safe-zone guides are
// drawn only here, never in the file.

interface Props {
  edit: VideoEdit;
  media: readonly MediaItem[];
  lang: VideoLang;
  cta: string;
  track: MusicTrack | null;
  time: number;
  playing: boolean;
  guides: boolean;
  urlFor: (ref: string) => Promise<string | null>;
  onTime: (t: number) => void;
  onEnded: () => void;
}

/** The preview's own size: 540 px on the short side, enough to read every word. */
function previewSize(aspect: VideoEdit["aspect"]): { W: number; H: number } {
  const [a, b] = aspect.split(":").map(Number) as [number, number];
  return a >= b ? { W: Math.round((540 * a) / b), H: 540 } : { W: 540, H: Math.round((540 * b) / a) };
}

export function Preview({ edit, media, lang, cta, track, time, playing, guides, urlFor, onTime, onEnded }: Props) {
  const t = useTx();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const holderRef = useRef<HTMLDivElement | null>(null);
  const elements = useRef(new Map<string, HTMLVideoElement | HTMLImageElement>());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [assets, setAssets] = useState<DrawAssets | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [, setLoadedTick] = useState(0);
  const [shades, setShades] = useState<Record<string, LogoShade>>({});
  const shadesRef = useRef(shades);
  shadesRef.current = shades;
  const state = useRef({ edit, time, playing, lang, cta, guides });
  state.current = { edit, time, playing, lang, cta, guides };
  const clock = useRef<{ start: number; from: number } | null>(null);
  const lastReport = useRef(0);
  const { W, H } = previewSize(edit.aspect);

  useEffect(() => {
    let live = true;
    loadDrawAssets()
      .then((a) => live && setAssets(a))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!assets || !edit.alti.enabled) return;
    void loadAlti(assets, edit.alti.pose).then(() => setLoadedTick((n) => n + 1));
  }, [assets, edit.alti.enabled, edit.alti.pose]);

  // One element per file on the timeline (kept while the editor is open).
  const usedIds = [...new Set(edit.clips.map((c) => c.mediaId))].sort().join(",");
  useEffect(() => {
    let live = true;
    const holder = holderRef.current;
    const wanted = media.filter((m) => usedIds.split(",").includes(m.id));
    const gone: string[] = [];
    (async () => {
      for (const item of wanted) {
        if (elements.current.has(item.id)) continue;
        const url = await urlFor(item.ref);
        if (!live) return;
        if (!url) {
          gone.push(item.name);
          continue;
        }
        if (item.kind === "image") {
          const img = new Image();
          img.onload = () => setLoadedTick((n) => n + 1);
          img.src = url;
          elements.current.set(item.id, img);
        } else {
          const video = document.createElement("video");
          video.preload = "auto";
          video.playsInline = true;
          video.muted = true;
          video.src = url;
          video.onloadeddata = () => setLoadedTick((n) => n + 1);
          video.onseeked = () => setLoadedTick((n) => n + 1);
          video.onerror = () => setMissing((prev) => (prev.includes(item.name) ? prev : [...prev, item.name]));
          holder?.appendChild(video);
          elements.current.set(item.id, video);
        }
      }
      if (live) setMissing(gone);
    })();
    return () => {
      live = false;
    };
  }, [usedIds, media, urlFor]);

  useEffect(
    () => () => {
      for (const el of elements.current.values()) {
        if (el instanceof HTMLVideoElement) {
          el.pause();
          el.removeAttribute("src");
          el.load();
          el.remove();
        }
      }
      elements.current.clear();
    },
    [],
  );

  // The music track, for the preview.
  useEffect(() => {
    let live = true;
    if (!track) {
      audioRef.current?.pause();
      audioRef.current = null;
      return;
    }
    void urlFor(track.ref).then((url) => {
      if (!live || !url) return;
      const audio = new Audio(url);
      audio.loop = true;
      audio.preload = "auto";
      audioRef.current?.pause();
      audioRef.current = audio;
    });
    return () => {
      live = false;
    };
  }, [track, urlFor]);

  // The logo's shade per clip (auto): measured the way the export measures it.
  const shadeKey = JSON.stringify([edit.logo, edit.aspect, edit.background, edit.clips.map((c) => [c.id, c.mediaId, c.in, c.out, c.fit, c.focusX, c.focusY])]);
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      void measureShades(state.current.edit, media, urlFor).then((found) => live && setShades(found));
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shadeKey, media, urlFor]);

  const cards = useRef<{ key: string; intro: HTMLCanvasElement | null; outro: HTMLCanvasElement | null } | null>(null);

  const draw = useCallback(
    (at: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const { edit: e, lang: l, cta: c, guides: g } = state.current;
      ctx.clearRect(0, 0, W, H);
      if (!assets) {
        ctx.fillStyle = NAVY;
        ctx.fillRect(0, 0, W, H);
        return;
      }
      const moment = momentAt(e, at);
      // The cards are drawn once per change of their words.
      const key = JSON.stringify([e.intro, e.outro, c, e.aspect]);
      if (!cards.current || cards.current.key !== key) cards.current = { key, intro: null, outro: null };
      if (moment.part === "intro" || moment.part === "outro") {
        const which = moment.part;
        let card = cards.current[which];
        if (!card) {
          card = document.createElement("canvas");
          card.width = W;
          card.height = H;
          const cctx = card.getContext("2d")!;
          if (which === "intro") drawIntroCard(cctx, e, W, H, assets);
          else drawOutroCard(cctx, e, c, W, H, assets);
          cards.current[which] = card;
        }
        ctx.drawImage(card, 0, 0);
      } else if (moment.placed) {
        const clip = moment.placed.clip;
        const el = elements.current.get(clip.mediaId);
        const item = media.find((m) => m.id === clip.mediaId);
        if (el && item) {
          const ready = el instanceof HTMLVideoElement ? el.readyState >= 2 : el.complete && el.naturalWidth > 0;
          const w = el instanceof HTMLVideoElement ? el.videoWidth || item.width : el.naturalWidth || item.width;
          const h = el instanceof HTMLVideoElement ? el.videoHeight || item.height : el.naturalHeight || item.height;
          if (ready) drawSource(ctx, el, w, h, W, H, clip.fit, clip.focusX, clip.focusY, e.background);
          else {
            ctx.fillStyle = e.background === "black" ? "#000" : NAVY;
            ctx.fillRect(0, 0, W, H);
          }
        } else {
          ctx.fillStyle = e.background === "black" ? "#000" : NAVY;
          ctx.fillRect(0, 0, W, H);
        }
        drawOnScreen(ctx, e, l, moment.t, W, H, assets, shadesRef.current);
      } else {
        ctx.fillStyle = NAVY;
        ctx.fillRect(0, 0, W, H);
      }
      if (g) drawSafeGuides(ctx, e.aspect, W, H);
    },
    [assets, media, W, H],
  );

  /** Keep the clip under the moment showing the right frame (and, while playing, playing with its sound). */
  const syncMedia = useCallback(
    (at: number, isPlaying: boolean) => {
      const e = state.current.edit;
      const moment = momentAt(e, at);
      const activeId = moment.part === "body" && moment.placed ? moment.placed.clip.mediaId : null;
      for (const [id, el] of elements.current) {
        if (!(el instanceof HTMLVideoElement)) continue;
        if (id !== activeId) {
          if (!el.paused) el.pause();
          continue;
        }
        const clip = (moment as Extract<typeof moment, { part: "body" }>).placed!.clip;
        const target = (moment as Extract<typeof moment, { part: "body" }>).sourceTime;
        el.muted = clip.muted || clip.volume <= 0;
        el.volume = Math.min(1, Math.max(0, clip.volume));
        if (isPlaying) {
          if (Math.abs(el.currentTime - target) > 0.3) el.currentTime = target;
          if (el.paused) void el.play().catch(() => undefined);
        } else {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - target) > 0.02) el.currentTime = target;
        }
      }
      const audio = audioRef.current;
      if (audio) {
        if (!isPlaying || !e.music.trackId) {
          if (!audio.paused) audio.pause();
        } else {
          const hasSound = (mediaId: string) => media.find((m) => m.id === mediaId)?.hasAudio !== false && media.find((m) => m.id === mediaId)?.kind === "video";
          const body = at - introSeconds(e);
          const ducked = e.music.duck && soundSpans(e, hasSound).some((s) => body >= s.start && body < s.end);
          audio.volume = Math.min(1, Math.max(0, ducked ? Math.min(e.music.volume, e.music.duckTo) : e.music.volume));
          const length = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null;
          const want = length ? at % length : at;
          if (Math.abs(audio.currentTime - want) > 0.4) audio.currentTime = want;
          if (audio.paused) void audio.play().catch(() => undefined);
        }
      }
    },
    [media],
  );

  // Paused: draw the moment whenever it, the edit or a file changes.
  useEffect(() => {
    if (playing) return;
    syncMedia(time, false);
    draw(time);
  });

  // Playing: a frame loop from the moment play was pressed.
  useEffect(() => {
    if (!playing) {
      clock.current = null;
      syncMedia(state.current.time, false);
      return;
    }
    let frame = 0;
    clock.current = { start: performance.now(), from: state.current.time >= totalDuration(state.current.edit) - 0.05 ? 0 : state.current.time };
    const tick = () => {
      const c = clock.current;
      if (!c) return;
      const total = totalDuration(state.current.edit);
      const at = c.from + (performance.now() - c.start) / 1000;
      if (at >= total) {
        syncMedia(total, false);
        draw(Math.max(0, total - 0.001));
        onTime(total);
        onEnded();
        return;
      }
      syncMedia(at, true);
      draw(at);
      if (performance.now() - lastReport.current > 120) {
        lastReport.current = performance.now();
        onTime(at);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Only start and stop here; the loop reads the latest edit from state.current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="block h-auto w-full rounded-[12px] bg-blue-900 shadow-sm"
        role="img"
        aria-label={t("Vista previa del video", "Video preview")}
        data-testid="video-preview"
      />
      <div ref={holderRef} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 h-px w-px overflow-hidden opacity-0" />
      {missing.length > 0 ? (
        <p className="mt-2 rounded-[10px] bg-amber-50 px-3 py-2 text-[12.5px] leading-snug text-blue-900">
          {t("Este navegador no puede mostrar algunos archivos en la vista previa (se exportan igual): ", "This browser can't show some files in the preview (they still export): ")}
          {missing.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
