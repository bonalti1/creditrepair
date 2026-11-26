"use client";

import { useEffect, useRef, useState } from "react";
import { useStaffLocale, useText, useTx } from "@/lib/staff/i18n/StaffLocale";
import { ExportError, VideoExporter, type ExportProgress } from "@/lib/video/exporter";
import { currentExport } from "@/lib/video/hash";
import { VIDEO_TEXT } from "@/lib/video/labels";
import type { VideoStudio } from "@/lib/video/store";
import { frameSize, type Quality } from "@/lib/video/timeline";
import type { VideoProject } from "@/lib/video/types";
import Icon from "@/components/Icon";
import { PRIMARY_BUTTON, SECONDARY_BUTTON_COMPACT } from "@/components/staff/ui";
import { Notice } from "./ui";

// Export: the MP4 (H.264 video, AAC sound) at the shape's size, rendered in
// this browser with a progress bar and a cancel button. The file is kept with
// the video (storage, or this browser in the demo) with the hash of the
// version it was made from: approval needs an export of the version as it is.

export function ExportPanel({ project, studio, editable, beforeExport }: { project: VideoProject; studio: VideoStudio; editable: boolean; beforeExport: () => Promise<VideoProject | null> }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const text = useText(VIDEO_TEXT);
  const [quality, setQuality] = useState<Quality>("full");
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [result, setResult] = useState<{ url: string; bytes: number; name: string } | null>(null);
  const [latestUrl, setLatestUrl] = useState<string | null>(null);
  const exporter = useRef<VideoExporter | null>(null);
  const current = currentExport(project);
  const newest = project.exports[0] ?? null;

  useEffect(() => () => exporter.current?.cancel(), []);
  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  // The newest kept export, to watch and download.
  useEffect(() => {
    let live = true;
    setLatestUrl(null);
    if (!newest) return;
    void studio.urlFor(newest.ref).then((url) => live && setLatestUrl(url));
    return () => {
      live = false;
    };
  }, [newest?.id, studio]);

  const start = async () => {
    setMessage(null);
    setResult(null);
    const saved = await beforeExport();
    if (!saved) return setMessage({ text: t("Primero tiene que guardarse el último cambio. Inténtalo otra vez.", "The last change has to be saved first. Try again."), tone: "error" });
    const run = new VideoExporter();
    exporter.current = run;
    setProgress({ phase: "loading", fraction: 0 });
    try {
      const outcome = await run.run({ project: saved, tracks: studio.tracks, quality, getFile: studio.getFile, urlFor: studio.urlFor, onProgress: setProgress });
      setProgress({ phase: "finishing", fraction: 1 });
      const name = `${saved.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "video"}-${outcome.width}x${outcome.height}.mp4`;
      const url = URL.createObjectURL(outcome.blob);
      setResult({ url, bytes: outcome.blob.size, name });
      const kept = await studio.saveExport(saved, outcome);
      setMessage(
        kept.ok
          ? { text: studio.live ? t("Exportado y guardado con el video.", "Exported and kept with the video.") : t("Exportado y guardado en este navegador (demostración).", "Exported and kept in this browser (demo)."), tone: "info" }
          : { text: kept.message[locale], tone: "error" },
      );
    } catch (error) {
      const code = error instanceof ExportError ? error.code : "engine";
      setMessage({ text: text.exportError[code], tone: code === "cancelled" ? "info" : "error" });
      if (error instanceof ExportError && error.detail && code !== "cancelled") console.warn("video export:", error.detail);
    } finally {
      exporter.current = null;
      setProgress(null);
    }
  };

  const size = frameSize(project.edit.aspect, quality);
  const busy = progress !== null;

  return (
    <div className="space-y-3" data-testid="export-panel">
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium text-slate-700">{t("Calidad", "Quality")}</legend>
        <div className="flex flex-wrap gap-2">
          {(["full", "quick"] as const).map((q) => (
            <label key={q} className={`pressable inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-[14px] font-semibold ${quality === q ? "border-blue-900 bg-blue-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
              <input type="radio" name="quality" value={q} checked={quality === q} onChange={() => setQuality(q)} className="sr-only" disabled={busy} data-testid={`quality-${q}`} />
              {q === "full" ? t("Completa", "Full") : t("Rápida (borrador)", "Quick (draft)")}
              <span className="font-normal tabular-nums opacity-80">{`${frameSize(project.edit.aspect, q).width}×${frameSize(project.edit.aspect, q).height}`}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-[13px] leading-snug text-slate-500">
        {t(
          `MP4 (H.264 y AAC), ${size.width}×${size.height}, 30 cuadros por segundo. Se crea aquí, en este navegador: nada se envía a otro servicio. Un video de 30 segundos tarda unos minutos.`,
          `MP4 (H.264 and AAC), ${size.width}×${size.height}, 30 frames a second. It's made here, in this browser: nothing is sent to another service. A 30-second video takes a few minutes.`,
        )}
      </p>
      {editable ? (
        busy ? (
          <div className="space-y-2" aria-live="polite">
            <div className="flex items-center justify-between text-[13.5px] text-slate-700">
              <span>{text.phase[progress.phase]}</span>
              <span className="tabular-nums" data-testid="export-percent">{Math.round(progress.fraction * 100)}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.fraction * 100)} aria-label={t("Progreso de la exportación", "Export progress")}>
              <div className="h-full rounded-full bg-blue-900 transition-[width]" style={{ width: `${Math.max(2, progress.fraction * 100)}%` }} />
            </div>
            <button type="button" onClick={() => exporter.current?.cancel()} className={SECONDARY_BUTTON_COMPACT} data-testid="export-cancel">
              {t("Cancelar", "Cancel")}
            </button>
          </div>
        ) : (
          <button type="button" onClick={start} disabled={project.edit.clips.length === 0} className={`${PRIMARY_BUTTON} w-full gap-2`} data-testid="export-start">
            <Icon name="download" size={18} />
            {t("Exportar MP4", "Export MP4")}
          </button>
        )
      ) : null}
      <Notice message={message?.text ?? null} tone={message?.tone} />
      {result ? (
        <a href={result.url} download={result.name} className={`${SECONDARY_BUTTON_COMPACT} w-full gap-1.5`} data-testid="export-download">
          <Icon name="download" size={16} />
          {t(`Descargar (${(result.bytes / 1_048_576).toFixed(1)} MB)`, `Download (${(result.bytes / 1_048_576).toFixed(1)} MB)`)}
        </a>
      ) : null}
      {newest ? (
        <div className="rounded-[12px] bg-slate-50 p-3" data-testid="export-latest">
          <p className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-slate-600">
            <span className="font-semibold text-slate-800">{t("Última exportación", "Latest export")}</span>
            <span className={`font-semibold ${current && current.id === newest.id ? "text-green-700" : "text-amber-700"}`} data-testid="export-current">
              {current && current.id === newest.id ? t("De esta versión", "This version") : t("De una versión anterior", "An earlier version")}
            </span>
          </p>
          <p className="mt-0.5 text-[12.5px] tabular-nums text-slate-500">
            {newest.width}×{newest.height} · {newest.duration.toFixed(1)} s · {(newest.bytes / 1_048_576).toFixed(1)} MB · {newest.by}
          </p>
          {latestUrl ? <video src={latestUrl} controls playsInline className="mt-2 max-h-80 w-full rounded-[10px] bg-black" aria-label={t("La última exportación", "The latest export")} /> : null}
          {!latestUrl && !studio.live ? <p className="mt-1 text-[12.5px] text-slate-500">{t("El archivo no está en este navegador.", "The file isn't in this browser.")}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
