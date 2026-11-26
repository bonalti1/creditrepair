"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReviewItem } from "@/lib/live/review";
import { clock, RECORDING } from "@/lib/live/review";
import { LIVE_TEXT } from "@/lib/live/text";
import { useText, useTx } from "@/lib/staff/i18n/StaffLocale";
import { CharacterAvatar } from "@/components/Character";
import Icon from "@/components/Icon";
import { PRIMARY_BUTTON, QUIET_BUTTON, SECONDARY_BUTTON } from "@/components/staff/ui";
import ReviewOverview from "./ReviewOverview";

// The screen-and-camera recorder (docs/LIVE-FUNNEL.md, step 4). It opens a
// recording view that covers the whole console and shows ONLY this person's
// overview (no menu, no other lead), so sharing "this tab" can never show
// anyone else's data. Then:
//
//   1. the browser asks which screen to share (this tab is offered first);
//      the camera bubble and the microphone are optional;
//   2. a 3-second countdown, then recording, up to 5 minutes (it stops by
//      itself), aiming for 2 to 5;
//   3. watch it back; retake, or trim the start and the end: the kept part is
//      recorded again from the first take, so what was cut is really gone
//      from the file that is uploaded;
//   4. upload to the private bucket (live-videos).
//
// The screen, the camera and the microphone are mixed on a canvas in this
// browser; nothing leaves it until «Upload».

type Phase = "setup" | "countdown" | "recording" | "review" | "trimming" | "uploading" | "done";

const MIME_TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
const pickMime = () => (typeof MediaRecorder === "undefined" ? null : (MIME_TYPES.find((m) => MediaRecorder.isTypeSupported(m)) ?? ""));
const canRecord = () => typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia) && typeof MediaRecorder !== "undefined";

interface Take {
  blob: Blob;
  url: string;
  seconds: number;
}

export default function Recorder({
  review,
  plans,
  onClose,
  onUpload,
}: {
  review: ReviewItem;
  plans: string[];
  onClose: () => void;
  onUpload: (blob: Blob, seconds: number, onProgress: (f: number) => void) => Promise<{ ok: boolean; code?: string }>;
}) {
  const t = useTx();
  const x = useText(LIVE_TEXT);
  const [phase, setPhase] = useState<Phase>("setup");
  const [camera, setCamera] = useState(true);
  const [mic, setMic] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [take, setTake] = useState<Take | null>(null);
  const [trim, setTrim] = useState<[number, number]>([0, 0]);
  const [progress, setProgress] = useState(0);
  const [showScript, setShowScript] = useState(true);
  const streams = useRef<MediaStream[]>([]);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const stopDraw = useRef<() => void>(() => undefined);
  const cameraPreview = useRef<HTMLVideoElement | null>(null);
  const supported = canRecord();

  const stopAll = useCallback(() => {
    stopDraw.current();
    for (const s of streams.current) for (const track of s.getTracks()) track.stop();
    streams.current = [];
  }, []);

  useEffect(() => () => stopAll(), [stopAll]);
  useEffect(() => () => {
    if (take) URL.revokeObjectURL(take.url);
  }, [take]);

  // Escape closes the view (and stops anything running), unless an upload is under way.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "uploading" && phase !== "trimming" && phase !== "recording") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onClose]);

  const finish = useCallback(() => {
    const r = recorder.current;
    if (r && r.state !== "inactive") r.stop();
  }, []);

  // The timer while recording, and the 5-minute stop.
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(() => {
      const s = (performance.now() - started.current) / 1000;
      setElapsed(s);
      if (s >= RECORDING.maxSeconds) finish();
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase, finish]);

  const start = async () => {
    setError(null);
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
        // Chrome and Edge offer this tab first, and hide switching to another surface mid-recording.
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        surfaceSwitching: "exclude",
      } as DisplayMediaStreamOptions);
      streams.current.push(display);
      let cam: MediaStream | null = null;
      let audio: MediaStream | null = null;
      if (camera) {
        cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 480 }, height: { ideal: 480 }, facingMode: "user" } }).catch(() => null);
        if (cam) streams.current.push(cam);
      }
      if (mic) {
        audio = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).catch(() => null);
        if (audio) streams.current.push(audio);
      }
      if (cam && cameraPreview.current) {
        cameraPreview.current.srcObject = cam;
        void cameraPreview.current.play().catch(() => undefined);
      }
      const mixed = await mixStreams(display, cam, audio, stopDraw);
      const mime = pickMime();
      const rec = new MediaRecorder(mixed, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 64_000 });
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      rec.onstop = () => {
        const seconds = Math.min(RECORDING.maxSeconds, (performance.now() - started.current) / 1000);
        stopAll();
        const blob = new Blob(chunks.current, { type: (rec.mimeType || mime || "video/webm").split(";")[0] });
        setTake({ blob, url: URL.createObjectURL(blob), seconds });
        setTrim([0, seconds]);
        setPhase("review");
      };
      // Stopping the share from the browser's own bar ends the take.
      display.getVideoTracks()[0]?.addEventListener("ended", () => finish());
      recorder.current = rec;
      setPhase("countdown");
      for (let n = 3; n > 0; n -= 1) {
        setCountdown(n);
        await new Promise((r) => setTimeout(r, 1000));
      }
      rec.start(1000);
      started.current = performance.now();
      setElapsed(0);
      setPhase("recording");
    } catch (e) {
      stopAll();
      setPhase("setup");
      setError(e instanceof DOMException && e.name === "NotAllowedError" ? t("No diste permiso para compartir la pantalla. Inténtalo de nuevo y elige esta pestaña.", "Screen sharing wasn't allowed. Try again and pick this tab.") : t("No se pudo empezar a grabar en este navegador.", "Recording couldn't start in this browser."));
    }
  };

  const retake = () => {
    if (take) URL.revokeObjectURL(take.url);
    setTake(null);
    setElapsed(0);
    setPhase("setup");
  };

  const trimmed = take ? trim[0] > 0.4 || trim[1] < take.seconds - 0.4 : false;
  const keptSeconds = take ? Math.max(0, trim[1] - trim[0]) : 0;

  const upload = async () => {
    if (!take) return;
    setError(null);
    let final = take;
    if (trimmed) {
      setPhase("trimming");
      setProgress(0);
      try {
        const blob = await recaptureRange(take, trim[0], trim[1], setProgress);
        final = { blob, url: URL.createObjectURL(blob), seconds: keptSeconds };
      } catch {
        setPhase("review");
        setError(t("No se pudo recortar en este navegador. Graba de nuevo, o súbelo sin recortar.", "Trimming didn't work in this browser. Record again, or upload it untrimmed."));
        return;
      }
    }
    setPhase("uploading");
    setProgress(0);
    const result = await onUpload(final.blob, final.seconds, setProgress);
    if (result.ok) setPhase("done");
    else {
      setPhase("review");
      setError(t("No se pudo subir el video. Revisa tu conexión e intenta de nuevo.", "The video couldn't be uploaded. Check your connection and try again."));
    }
  };

  const recording = phase === "recording";
  const name = review.firstName ?? t("esta persona", "this person");
  return createPortal(
    <div className="console fixed inset-0 z-[200] overflow-y-auto bg-slate-50" role="dialog" aria-modal="true" aria-label={t("Grabar el video", "Record the video")} data-testid="recorder">
      {/* The control bar: it is recorded too, so it carries nothing about anyone but this person. */}
      <div className="sticky top-0 z-10 border-b hairline bg-white/95 px-4 py-3 backdrop-blur md:px-7">
        <div className="flex flex-wrap items-center gap-3">
          <CharacterAvatar character="assistant" size={36} tone="navy" decorative />
          <div className="min-w-0 flex-1">
            <p className="font-display text-[17px] font-semibold text-blue-900">{t(`Video para ${name}`, `Video for ${name}`)}</p>
            <p className="text-[12.5px] text-slate-500">{t("Esta vista solo muestra el resumen de esta persona. Comparte esta pestaña.", "This view shows only this person's overview. Share this tab.")}</p>
          </div>
          {recording && (
            <span className="inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1.5 text-[14px] font-semibold text-red-700 tabular-nums" role="status" aria-live="polite" data-testid="recorder-timer">
              <span aria-hidden="true" className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />
              {clock(elapsed)} / {clock(RECORDING.maxSeconds)}
            </span>
          )}
          {recording ? (
            <button type="button" onClick={finish} className={PRIMARY_BUTTON} data-testid="recorder-stop">
              {t("Terminar", "Stop")}
            </button>
          ) : (
            phase !== "uploading" &&
            phase !== "trimming" && (
              <button type="button" onClick={() => { stopAll(); onClose(); }} className={QUIET_BUTTON} data-testid="recorder-close">
                <Icon name="close" size={16} />
                {t("Cerrar", "Close")}
              </button>
            )
          )}
        </div>
      </div>

      <div className="grid gap-4 px-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] md:px-7">
        <div className="min-w-0">{review.overview && <ReviewOverview overview={review.overview} plans={plans} compact />}</div>

        <aside className="order-first min-w-0 space-y-4 md:sticky md:top-20 md:order-none md:self-start">
          <section className="card px-4 py-4" data-testid="recorder-panel">
            {!supported && (
              <p className="text-[14px] leading-snug text-slate-700">
                {t("Grabar la pantalla necesita una computadora con Chrome, Edge, Firefox o Safari. En el teléfono, abre esta revisión en la computadora.", "Screen recording needs a computer with Chrome, Edge, Firefox or Safari. On a phone, open this review on a computer.")}
              </p>
            )}
            {supported && phase === "setup" && (
              <>
                <p className="console-label">{t("Antes de grabar", "Before you record")}</p>
                <ul className="mt-2 space-y-1.5 text-[13.5px] leading-snug text-slate-700">
                  <li>{t("Cierra otras pestañas con datos de clientes.", "Close other tabs with clients' data.")}</li>
                  <li>{t("Cuando el navegador pregunte, elige «Esta pestaña».", "When the browser asks, pick “This tab”.")}</li>
                  <li>{t(`Apunta a 2–5 minutos; se detiene sola a los ${RECORDING.maxSeconds / 60}.`, `Aim for 2–5 minutes; it stops by itself at ${RECORDING.maxSeconds / 60}.`)}</li>
                </ul>
                <div className="mt-3 space-y-2">
                  <label className="flex min-h-11 items-center gap-3 text-[14px] font-medium text-slate-800">
                    <input type="checkbox" checked={camera} onChange={(e) => setCamera(e.target.checked)} className="h-5 w-5 accent-blue-900" />
                    {t("Cámara (una burbuja en la esquina)", "Camera (a bubble in the corner)")}
                  </label>
                  <label className="flex min-h-11 items-center gap-3 text-[14px] font-medium text-slate-800">
                    <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} className="h-5 w-5 accent-blue-900" />
                    {t("Micrófono", "Microphone")}
                  </label>
                </div>
                <button type="button" onClick={start} className={`${PRIMARY_BUTTON} mt-3 w-full`} data-testid="recorder-start">
                  <Icon name="video" size={18} className="mr-2" />
                  {t("Empezar a grabar", "Start recording")}
                </button>
              </>
            )}
            {phase === "countdown" && (
              <p className="py-6 text-center font-display text-[48px] font-semibold text-blue-900 tabular-nums" aria-live="assertive">
                {countdown}
              </p>
            )}
            {recording && (
              <p className="text-[14px] leading-snug text-slate-700">
                {elapsed < RECORDING.aimMinSeconds
                  ? t("Grabando. Sigue el guion; toca «Terminar» cuando acabes.", "Recording. Follow the script; tap “Stop” when you're done.")
                  : t("Ya pasaste los 2 minutos: termina cuando quieras.", "You're past 2 minutes: stop whenever you like.")}
              </p>
            )}
            {take && (phase === "review" || phase === "trimming" || phase === "uploading") && (
              <>
                <p className="console-label">{t("Revisa tu video", "Watch it back")}</p>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video src={take.url} controls playsInline className="mt-2 aspect-video w-full rounded-[10px] bg-blue-900" data-testid="recorder-player" />
                <p className="mt-1 text-[12.5px] text-slate-500 tabular-nums">
                  {t(`Duración: ${clock(take.seconds)}`, `Length: ${clock(take.seconds)}`)}
                  {take.seconds < RECORDING.aimMinSeconds && t(" · menos de 2 minutos: está bien si dijiste todo.", " · under 2 minutes: fine if you covered everything.")}
                </p>
                <fieldset className="mt-3" disabled={phase !== "review"}>
                  <legend className="text-[13px] font-semibold text-slate-800">{t("Recortar", "Trim")}</legend>
                  <label className="mt-1 block text-[12.5px] text-slate-600">
                    {t(`Empieza en ${clock(trim[0])}`, `Starts at ${clock(trim[0])}`)}
                    <input type="range" min={0} max={take.seconds} step={0.5} value={trim[0]} onChange={(e) => setTrim(([, end]) => [Math.min(Number(e.target.value), end - RECORDING.minSeconds), end])} className="block h-11 w-full accent-blue-900" data-testid="trim-start" />
                  </label>
                  <label className="block text-[12.5px] text-slate-600">
                    {t(`Termina en ${clock(trim[1])}`, `Ends at ${clock(trim[1])}`)}
                    <input type="range" min={0} max={take.seconds} step={0.5} value={trim[1]} onChange={(e) => setTrim(([begin]) => [begin, Math.max(Number(e.target.value), begin + RECORDING.minSeconds)])} className="block h-11 w-full accent-blue-900" data-testid="trim-end" />
                  </label>
                  {trimmed && <p className="text-[12.5px] text-slate-600 tabular-nums">{t(`Se queda: ${clock(keptSeconds)}. Lo recortado no se sube.`, `Kept: ${clock(keptSeconds)}. What you cut is not uploaded.`)}</p>}
                </fieldset>
                {(phase === "trimming" || phase === "uploading") && (
                  <div className="mt-3" role="status" aria-live="polite">
                    <p className="text-[13px] font-semibold text-slate-800">{phase === "trimming" ? t("Guardando la parte recortada…", "Saving the trimmed part…") : t("Subiendo…", "Uploading…")}</p>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full bg-amber-400 transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
                    </div>
                  </div>
                )}
                {phase === "review" && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" onClick={retake} className={SECONDARY_BUTTON} data-testid="recorder-retake">
                      {t("Grabar otra vez", "Retake")}
                    </button>
                    <button type="button" onClick={upload} className={PRIMARY_BUTTON} data-testid="recorder-upload" disabled={keptSeconds < RECORDING.minSeconds}>
                      {t("Subir", "Upload")}
                    </button>
                  </div>
                )}
              </>
            )}
            {phase === "done" && (
              <div className="text-center" data-testid="recorder-done">
                <Icon name="check" size={28} className="mx-auto text-green-700" />
                <p className="mt-2 font-display text-[16px] font-semibold text-blue-900">{t("Video guardado", "Video saved")}</p>
                <p className="mt-1 text-[13.5px] text-slate-600">{t("Ahora mándaselo desde la revisión.", "Now send it from the review.")}</p>
                <button type="button" onClick={onClose} className={`${PRIMARY_BUTTON} mt-3 w-full`}>
                  {t("Volver a la revisión", "Back to the review")}
                </button>
              </div>
            )}
            {error && (
              <p className="mt-3 text-[13.5px] font-medium text-red-700" role="alert">
                {error}
              </p>
            )}
            {/* The camera preview while recording (the recording has its own bubble). */}
            <video ref={cameraPreview} muted playsInline className={`mt-3 aspect-square w-24 rounded-full object-cover ring-4 ring-amber-400 ${recording && camera ? "" : "hidden"}`} aria-hidden="true" />
          </section>

          <section className="card px-4 py-4">
            <button type="button" onClick={() => setShowScript((v) => !v)} aria-expanded={showScript} className="flex min-h-11 w-full items-center justify-between text-left">
              <span className="console-label">{x.script.title}</span>
              <Icon name="chevron" size={16} className={showScript ? "-rotate-90" : "rotate-90"} />
            </button>
            {showScript && (
              <>
                <ol className="mt-1 list-decimal space-y-1.5 pl-5 text-[13.5px] leading-snug text-slate-700">
                  {x.script.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <p className="mt-2 text-[12.5px] font-semibold leading-snug text-red-700">{x.script.never}</p>
              </>
            )}
          </section>
        </aside>
      </div>
    </div>,
    // On the body, above everything: the console's menu, top bar and other leads are not on screen while sharing this tab.
    document.body,
  );
}

/**
 * The screen, the camera bubble (bottom right, a gold ring) and the
 * microphone, as one stream: drawn on a canvas at up to 30 frames a second.
 * `stop` is set to a function that ends the drawing.
 */
async function mixStreams(display: MediaStream, cam: MediaStream | null, audio: MediaStream | null, stop: { current: () => void }): Promise<MediaStream> {
  const screen = document.createElement("video");
  screen.muted = true;
  screen.playsInline = true;
  screen.srcObject = display;
  await screen.play();
  const settings = display.getVideoTracks()[0]?.getSettings() ?? {};
  const sw = settings.width ?? screen.videoWidth ?? 1280;
  const sh = settings.height ?? screen.videoHeight ?? 720;
  const scale = Math.min(1, 1280 / sw);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((sw * scale) / 2) * 2;
  canvas.height = Math.round((sh * scale) / 2) * 2;
  const ctx = canvas.getContext("2d")!;
  let face: HTMLVideoElement | null = null;
  if (cam) {
    face = document.createElement("video");
    face.muted = true;
    face.playsInline = true;
    face.srcObject = cam;
    await face.play().catch(() => undefined);
  }
  let running = true;
  const draw = () => {
    if (!running) return;
    ctx.drawImage(screen, 0, 0, canvas.width, canvas.height);
    if (face && face.videoWidth > 0) {
      const d = Math.round(canvas.height * 0.24);
      const x = canvas.width - d - Math.round(canvas.height * 0.04);
      const y = canvas.height - d - Math.round(canvas.height * 0.04);
      const side = Math.min(face.videoWidth, face.videoHeight);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      // Mirror-free, centred square crop of the camera.
      ctx.drawImage(face, (face.videoWidth - side) / 2, (face.videoHeight - side) / 2, side, side, x, y, d, d);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(3, Math.round(d * 0.04));
      ctx.strokeStyle = "#EFB537";
      ctx.stroke();
    }
  };
  // A timer, not animation frames: it keeps drawing even if the tab is briefly hidden.
  const timer = window.setInterval(draw, 1000 / 30);
  stop.current = () => {
    running = false;
    window.clearInterval(timer);
  };
  draw();
  const out = canvas.captureStream(30);
  for (const track of audio?.getAudioTracks() ?? []) out.addTrack(track);
  return out;
}

/**
 * The kept part of a take, recorded again from the first take (in real time):
 * the cut parts are not in the new file at all. Its sound goes through the
 * page's audio, never to the speakers.
 */
async function recaptureRange(take: Take, from: number, to: number, onProgress: (f: number) => void): Promise<Blob> {
  const video = document.createElement("video");
  video.src = take.url;
  video.playsInline = true;
  video.preload = "auto";
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("load"));
  });
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext("2d")!;
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtx();
  const source = audioCtx.createMediaElementSource(video);
  const dest = audioCtx.createMediaStreamDestination();
  source.connect(dest);
  const stream = canvas.captureStream(30);
  for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
  const mime = pickMime();
  const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 1_500_000 });
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size > 0 && parts.push(e.data);
  video.currentTime = from;
  await new Promise<void>((resolve) => {
    video.onseeked = () => resolve();
  });
  const done = new Promise<Blob>((resolve) => {
    rec.onstop = () => resolve(new Blob(parts, { type: (rec.mimeType || mime || "video/webm").split(";")[0] }));
  });
  const timer = window.setInterval(() => {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    onProgress(Math.min(1, (video.currentTime - from) / Math.max(1, to - from)));
    if (video.currentTime >= to || video.ended) {
      window.clearInterval(timer);
      video.pause();
      if (rec.state !== "inactive") rec.stop();
    }
  }, 1000 / 30);
  rec.start(1000);
  await video.play();
  const blob = await done;
  void audioCtx.close();
  return blob;
}
