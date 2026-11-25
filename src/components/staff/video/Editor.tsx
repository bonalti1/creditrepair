"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BRAND, type AssistantPose } from "@/lib/brand";
import { POSE_LABEL } from "@/lib/content/brandKit";
import { checkText } from "@/lib/content/check";
import { useStaffLocale, useText, useTx } from "@/lib/staff/i18n/StaffLocale";
import { ASPECT_ORDER, VIDEO_TEXT } from "@/lib/video/labels";
import type { VideoStudio } from "@/lib/video/store";
import {
  addClip,
  bodyDuration,
  clipDuration,
  clipFromMedia,
  cuesToSrt,
  formatTime,
  introSeconds,
  momentAt,
  moveClip,
  newVideoId,
  normalizeCues,
  parseCaptions,
  parseTime,
  placeClips,
  removeClip,
  SAFE_ZONES,
  shiftCues,
  splitAt,
  totalDuration,
  trimClip,
  type EditResult,
} from "@/lib/video/timeline";
import { VIDEO_LIMITS, type Aspect, type CaptionCue, type Corner, type MediaItem, type TextOverlay, type VideoEdit, type VideoProject } from "@/lib/video/types";
import { ExportError, VideoExporter } from "@/lib/video/exporter";
import Icon from "@/components/Icon";
import { PRIMARY_BUTTON_COMPACT, QUIET_BUTTON, SECONDARY_BUTTON_COMPACT, pillTab } from "@/components/staff/ui";
import { ExportPanel } from "./ExportPanel";
import { Preview } from "./Preview";
import { FIELD, LABEL, Notice } from "./ui";

// The editor (docs/VIDEO.md): the preview, the transport (play, scrub,
// split, undo), the timeline, and the panels: Clips (files, trim, crop,
// order), Words (titles and lower thirds), Captions, Brand (shape, safe
// zones, logo, cards, Alti), Music, Export. Every change is saved by itself
// a moment later as the project's edit decisions (JSON); a change to an
// approved video sends it back to Editing (the rules say so; the screen
// warns first). On a phone the editor keeps to trimming, captions and export.

type Panel = "clips" | "words" | "captions" | "brand" | "music" | "export";
type SaveState = "saved" | "saving" | "unsaved" | "error";

const PHONE_PANELS: readonly Panel[] = ["clips", "captions", "export"];

export function Editor({ project, studio, editable }: { project: VideoProject; studio: VideoStudio; editable: boolean }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const [edit, setEdit] = useState<VideoEdit>(project.edit);
  const [past, setPast] = useState<VideoEdit[]>([]);
  const [future, setFuture] = useState<VideoEdit[]>([]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | null>(project.edit.clips[0]?.id ?? null);
  const [panel, setPanel] = useState<Panel>("clips");
  // A tool hidden on a phone is never the one open there.
  useEffect(() => {
    const phone = window.matchMedia("(max-width: 767px)");
    const fix = () => phone.matches && setPanel((p) => (PHONE_PANELS.includes(p) ? p : "clips"));
    fix();
    phone.addEventListener("change", fix);
    return () => phone.removeEventListener("change", fix);
  }, []);
  const [guides, setGuides] = useState(true);
  const [save, setSave] = useState<SaveState>("saved");
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const timer = useRef<number | null>(null);
  const pending = useRef<VideoEdit | null>(null);
  const latest = useRef(project);
  latest.current = project;

  // A change saved elsewhere (or this editor's own save coming back) is taken in when nothing is waiting here.
  useEffect(() => {
    if (!pending.current && save !== "saving") setEdit(project.edit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.updatedAt]);

  const total = totalDuration(edit);
  const body = bodyDuration(edit);
  const mediaKind = useCallback((id: string) => project.media.find((m) => m.id === id)?.kind, [project.media]);

  const flush = useCallback(async (): Promise<VideoProject | null> => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    if (!next) return latest.current;
    pending.current = null;
    setSave("saving");
    const result = await studio.act({ action: "update", id: project.id, patch: { edit: next } });
    if (!result.ok) {
      setSave("error");
      setMessage({ text: result.message[locale], tone: "error" });
      return null;
    }
    setSave(pending.current ? "unsaved" : "saved");
    return result.project ?? latest.current;
  }, [locale, project.id, studio]);

  const apply = useCallback(
    (next: VideoEdit) => {
      if (!editable) return;
      setPast((p) => [...p.slice(-49), edit]);
      setFuture([]);
      setEdit(next);
      pending.current = next;
      setSave("unsaved");
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 900);
    },
    [edit, editable, flush],
  );

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
      if (pending.current) void studio.act({ action: "update", id: project.id, patch: { edit: pending.current } });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const result = (r: EditResult, ok?: string) => {
    if (r.ok) {
      apply(r.edit);
      if (ok) setMessage({ text: ok, tone: "info" });
      return true;
    }
    const why: Record<typeof r.code, string> = {
      not_found: t("No hay un clip en ese punto.", "There's no clip at that point."),
      too_short: t("Cada parte debe durar al menos 0,2 segundos.", "Each part must last at least 0.2 seconds."),
      too_long: t("El video puede durar hasta 3 minutos (sin las tarjetas).", "A video can last up to 3 minutes (without the cards)."),
      too_many: t("Hay demasiados clips en la línea de tiempo.", "There are too many clips on the timeline."),
    };
    setMessage({ text: why[r.code], tone: "error" });
    return false;
  };

  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setPast(past.slice(0, -1));
    setFuture([edit, ...future]);
    setEdit(prev);
    pending.current = prev;
    setSave("unsaved");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 900);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture(future.slice(1));
    setPast([...past, edit]);
    setEdit(next);
    pending.current = next;
    setSave("unsaved");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 900);
  };

  const bodyTime = Math.max(0, Math.min(body, time - introSeconds(edit)));
  const split = () => {
    const moment = momentAt(edit, time);
    if (moment.part !== "body") return setMessage({ text: t("Pon el cabezal sobre un clip para cortarlo.", "Put the playhead over a clip to split it."), tone: "error" });
    const id = newVideoId("cl");
    if (result(splitAt(edit, moment.t, mediaKind, id), t("Clip cortado en dos.", "Clip split in two."))) setSelected(id);
  };

  const track = edit.music.trackId ? studio.tracks.find((x) => x.id === edit.music.trackId && !x.removedAt) ?? null : null;
  const approvedOrReady = ["ready", "approved"].includes(project.status);

  return (
    <div className="space-y-4" data-testid="video-editor">
      {approvedOrReady && editable ? (
        <p className="rounded-[10px] bg-amber-50 px-3 py-2 text-[13.5px] text-blue-900">
          {project.status === "approved"
            ? t("Este video está aprobado. Si cambias algo, vuelve a edición y necesita otra exportación y otra aprobación.", "This video is approved. If you change anything it goes back to editing and needs a new export and approval.")
            : t("Este video espera aprobación. Si cambias algo, vuelve a edición y necesita otra exportación.", "This video is waiting for approval. If you change anything it goes back to editing and needs a new export.")}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          <div className={`mx-auto ${edit.aspect === "16:9" ? "max-w-full" : edit.aspect === "9:16" ? "max-w-[300px] lg:max-w-[340px]" : "max-w-[360px]"}`}>
            <Preview
              edit={edit}
              media={project.media}
              lang={project.language}
              cta={project.plan.cta}
              track={track}
              time={time}
              playing={playing}
              guides={guides}
              urlFor={studio.urlFor}
              onTime={setTime}
              onEnded={() => setPlaying(false)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setPlaying((p) => !p)} disabled={edit.clips.length === 0} className={`${PRIMARY_BUTTON_COMPACT} min-w-28 gap-1.5 px-4`} aria-pressed={playing} data-testid="play">
              <Icon name={playing ? "stop" : "play"} size={18} />
              {playing ? t("Pausa", "Pause") : t("Reproducir", "Play")}
            </button>
            <span className="text-[13.5px] tabular-nums text-slate-600" data-testid="time">
              {formatTime(time)} / {formatTime(total)}
            </span>
            <label className="ml-auto inline-flex min-h-11 cursor-pointer items-center gap-2 text-[13px] text-slate-600">
              <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} className="h-5 w-5 accent-blue-900" />
              {t("Zonas seguras", "Safe zones")}
            </label>
          </div>
          <label className="block">
            <span className="sr-only">{t("Posición en el video", "Position in the video")}</span>
            <input
              type="range"
              min={0}
              max={Math.max(0.1, total)}
              step={0.01}
              value={Math.min(time, total)}
              onChange={(e) => {
                setPlaying(false);
                setTime(Number(e.target.value));
              }}
              className="h-11 w-full accent-blue-900"
              data-testid="scrub"
            />
          </label>
          {editable ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={split} className={`${SECONDARY_BUTTON_COMPACT} gap-1.5`} data-testid="split">
                <Icon name="cut" size={16} />
                {t("Cortar aquí", "Split here")}
              </button>
              <button type="button" onClick={undo} disabled={past.length === 0} className={QUIET_BUTTON} data-testid="undo">
                {t("Deshacer", "Undo")}
              </button>
              <button type="button" onClick={redo} disabled={future.length === 0} className={QUIET_BUTTON}>
                {t("Rehacer", "Redo")}
              </button>
              <span className={`ml-auto inline-flex min-h-11 items-center text-[12.5px] font-medium ${save === "error" ? "text-red-700" : "text-slate-500"}`} aria-live="polite" data-testid="save-state">
                {save === "saving" ? t("Guardando…", "Saving…") : save === "unsaved" ? t("Cambios sin guardar", "Unsaved changes") : save === "error" ? t("No se guardó", "Not saved") : t("Guardado", "Saved")}
              </span>
            </div>
          ) : null}
          <Notice message={message?.text ?? null} tone={message?.tone} />
        </div>

        <div className="min-w-0">
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist" aria-label={t("Herramientas", "Tools")}>
            <div className="flex min-w-max gap-1.5">
              {(["clips", "words", "captions", "brand", "music", "export"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={panel === p}
                  onClick={() => setPanel(p)}
                  className={PHONE_PANELS.includes(p) ? pillTab(panel === p) : pillTab(panel === p).replace("inline-flex", "hidden md:inline-flex")}
                  data-testid={`panel-${p}`}
                >
                  {
                    {
                      clips: t("Clips", "Clips"),
                      words: t("Textos", "Words"),
                      captions: t("Subtítulos", "Captions"),
                      brand: t("Marca y formato", "Brand & shape"),
                      music: t("Música", "Music"),
                      export: t("Exportar", "Export"),
                    }[p]
                  }
                </button>
              ))}
            </div>
          </div>
          <p className="mt-2 text-[12.5px] text-slate-500 md:hidden">{t("En el teléfono: recortar, subtítulos y exportar. Textos, marca y música, en una pantalla más grande.", "On a phone: trim, captions and export. Words, brand and music on a larger screen.")}</p>
          <div className="card mt-3 px-4 py-4" role="tabpanel">
            {panel === "clips" ? <ClipsPanel project={project} studio={studio} edit={edit} editable={editable} selected={selected} setSelected={setSelected} time={time} bodyTime={bodyTime} apply={apply} result={result} setMessage={setMessage} flush={flush} /> : null}
            {panel === "words" ? <WordsPanel edit={edit} editable={editable} bodyTime={bodyTime} apply={apply} lang={project.language} /> : null}
            {panel === "captions" ? <CaptionsPanel project={project} studio={studio} edit={edit} editable={editable} bodyTime={bodyTime} apply={apply} setMessage={setMessage} /> : null}
            {panel === "brand" ? <BrandPanel edit={edit} editable={editable} bodyTime={bodyTime} apply={apply} /> : null}
            {panel === "music" ? <MusicPanel studio={studio} edit={edit} editable={editable} apply={apply} /> : null}
            {panel === "export" ? <ExportPanel project={project} studio={studio} editable={editable} beforeExport={flush} /> : null}
          </div>
        </div>
      </div>

      <Timeline edit={edit} media={project.media} time={time} selected={selected} onSeek={(at) => { setPlaying(false); setTime(at); }} onSelect={setSelected} />
    </div>
  );
}

// ── The timeline ────────────────────────────────────────────────────────

function Timeline({ edit, media, time, selected, onSeek, onSelect }: { edit: VideoEdit; media: readonly MediaItem[]; time: number; selected: string | null; onSeek: (t: number) => void; onSelect: (id: string) => void }) {
  const t = useTx();
  const PPS = 48;
  const intro = introSeconds(edit);
  const total = totalDuration(edit);
  const width = Math.max(total * PPS, 200);
  const placed = placeClips(edit.clips);
  const seekFrom = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(total, (e.clientX - box.left) / PPS)));
  };
  return (
    <section aria-label={t("Línea de tiempo", "Timeline")} className="card px-3 py-3" data-testid="timeline">
      <div className="overflow-x-auto pb-1">
        <div className="relative" style={{ width }}>
          <div className="relative h-14 cursor-pointer" onClick={seekFrom}>
            {intro > 0 ? (
              <div className="absolute top-0 flex h-14 items-center justify-center rounded-[8px] bg-blue-900 text-[11px] font-semibold text-white" style={{ left: 0, width: intro * PPS - 2 }}>
                {t("Inicio", "Intro")}
              </div>
            ) : null}
            {placed.map((p, i) => {
              const item = media.find((m) => m.id === p.clip.mediaId);
              const on = selected === p.clip.id;
              return (
                <button
                  key={p.clip.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(p.clip.id);
                    onSeek(intro + p.start + 0.001);
                  }}
                  className={`absolute top-0 flex h-14 flex-col justify-center overflow-hidden rounded-[8px] px-1.5 text-left text-[11px] leading-tight ${on ? "bg-amber-400 text-blue-900 ring-2 ring-blue-900" : "bg-slate-200 text-slate-800 hover:bg-slate-300"}`}
                  style={{ left: (intro + p.start) * PPS, width: Math.max(18, clipDuration(p.clip) * PPS - 2) }}
                  aria-pressed={on}
                  aria-label={`${i + 1} · ${item?.name ?? ""} · ${clipDuration(p.clip).toFixed(1)} s`}
                  data-testid="timeline-clip"
                >
                  <span className="truncate font-semibold">{i + 1}</span>
                  <span className="truncate tabular-nums">{clipDuration(p.clip).toFixed(1)}s</span>
                </button>
              );
            })}
            {edit.outro.enabled ? (
              <div className="absolute top-0 flex h-14 items-center justify-center rounded-[8px] bg-blue-900 text-[11px] font-semibold text-white" style={{ left: (intro + bodyDuration(edit)) * PPS, width: Math.max(18, (total - intro - bodyDuration(edit)) * PPS - 2) }}>
                {t("Final", "End")}
              </div>
            ) : null}
          </div>
          {/* Words on screen and captions, on the body's time. */}
          <div className="relative mt-1 h-3" aria-hidden="true">
            {edit.overlays.map((o) => (
              <span key={o.id} className="absolute top-0 h-1.5 rounded-full bg-amber-500" style={{ left: (intro + o.start) * PPS, width: Math.max(4, (o.end - o.start) * PPS) }} />
            ))}
            {edit.captions.map((c) => (
              <span key={c.id} className="absolute top-1.5 h-1.5 rounded-full bg-blue-700" style={{ left: (intro + c.start) * PPS, width: Math.max(4, (c.end - c.start) * PPS - 1) }} />
            ))}
          </div>
          <div className="pointer-events-none absolute top-0 h-[72px] w-0.5 bg-red-600" style={{ left: Math.min(width - 2, time * PPS) }} aria-hidden="true" />
        </div>
      </div>
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-500">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-1.5 w-4 rounded-full bg-amber-500" />{t("Textos", "Words")}</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-1.5 w-4 rounded-full bg-blue-700" />{t("Subtítulos", "Captions")}</span>
      </p>
    </section>
  );
}

// ── Clips ───────────────────────────────────────────────────────────────

interface ClipsProps {
  project: VideoProject;
  studio: VideoStudio;
  edit: VideoEdit;
  editable: boolean;
  selected: string | null;
  setSelected: (id: string | null) => void;
  time: number;
  bodyTime: number;
  apply: (e: VideoEdit) => void;
  result: (r: EditResult, ok?: string) => boolean;
  setMessage: (m: { text: string; tone: "info" | "error" } | null) => void;
  flush: () => Promise<VideoProject | null>;
}

function ClipsPanel({ project, studio, edit, editable, selected, setSelected, bodyTime, apply, result, setMessage, flush }: ClipsProps) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const clip = edit.clips.find((c) => c.id === selected) ?? null;
  const item = clip ? project.media.find((m) => m.id === clip.mediaId) ?? null : null;
  const index = clip ? edit.clips.findIndex((c) => c.id === clip.id) : -1;
  const sourceAtPlayhead = (() => {
    const p = placeClips(edit.clips).find((x) => x.clip.id === clip?.id);
    return p && bodyTime >= p.start && bodyTime <= p.end ? clip!.in + (bodyTime - p.start) : null;
  })();

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAdding(true);
    await flush();
    let current = project;
    for (const file of Array.from(files)) {
      const r = await studio.addMediaFile(current, file);
      if (!r.ok) {
        setMessage({ text: `${file.name}: ${r.message[locale]}`, tone: "error" });
        break;
      }
      if (r.project) current = r.project;
    }
    setAdding(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const setClip = (patch: Partial<(typeof edit.clips)[number]>) => clip && apply({ ...edit, clips: edit.clips.map((c) => (c.id === clip.id ? { ...c, ...patch } : c)) });

  return (
    <div className="space-y-4" data-testid="clips-panel">
      <div>
        <h3 className="console-label">{t("Archivos de este video", "This video's files")}</h3>
        <ul className="mt-2 space-y-1.5">
          {project.media.map((m) => (
            <li key={m.id} className="flex items-center gap-2 rounded-[10px] bg-slate-50 px-3 py-2">
              <Icon name={m.kind === "image" ? "doc" : "play"} size={16} className="shrink-0 text-slate-500" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-slate-900">{m.name}</span>
                <span className="text-[12px] tabular-nums text-slate-500">
                  {m.kind === "video" ? `${(m.duration ?? 0).toFixed(1)} s · ` : ""}
                  {m.width}×{m.height}
                  {m.source === "sample" ? <span className="ml-1 font-semibold text-amber-700">· {t("Muestra", "Sample")}</span> : null}
                </span>
              </span>
              {editable ? (
                <button type="button" className={`${SECONDARY_BUTTON_COMPACT} h-11 px-3`} onClick={() => { const c = clipFromMedia(m); if (result(addClip(edit, c), t("Agregado a la línea de tiempo.", "Added to the timeline."))) setSelected(c.id); }} data-testid="add-to-timeline">
                  <Icon name="plus" size={16} />
                  <span className="sr-only sm:not-sr-only sm:ml-1">{t("Agregar", "Add")}</span>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {project.media.length === 0 ? <p className="mt-1 text-[13.5px] text-slate-500">{t("Todavía no hay archivos.", "No files yet.")}</p> : null}
        {editable ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <label className={`${SECONDARY_BUTTON_COMPACT} cursor-pointer gap-1.5 px-4`}>
              <Icon name="arrowUp" size={16} />
              {adding ? t("Agregando…", "Adding…") : t("Subir clips o fotos", "Upload clips or pictures")}
              <input ref={fileRef} type="file" multiple accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp" className="sr-only" disabled={adding} onChange={(e) => void upload(e.target.files)} data-testid="upload-media" />
            </label>
            {!project.media.some((m) => m.source === "sample") ? (
              <button type="button" className={QUIET_BUTTON} onClick={async () => { await flush(); const r = await studio.addSamples(project); if (!r.ok) setMessage({ text: r.message[locale], tone: "error" }); }} data-testid="add-samples">
                {t("Usar los clips de muestra", "Use the sample clips")}
              </button>
            ) : null}
          </div>
        ) : null}
        <p className="mt-1.5 text-[12px] leading-snug text-slate-500">
          {studio.live
            ? t("Los archivos van al almacenamiento privado del equipo. Clips hasta 250 MB, fotos hasta 20 MB.", "Files go to the team's private storage. Clips up to 250 MB, pictures up to 20 MB.")
            : t("En la demostración los archivos se quedan en este navegador.", "In the demo, files stay in this browser.")}
        </p>
      </div>

      {clip && item ? (
        <div className="space-y-3 border-t border-slate-200 pt-4" data-testid="clip-settings">
          <h3 className="console-label">{`${index + 1} · ${item.name}`}</h3>
          {item.kind === "video" ? (
            <div className="grid grid-cols-2 gap-2">
              <TimeField label={t("Empieza en (s)", "Starts at (s)")} value={clip.in} disabled={!editable} onCommit={(v) => result(trimClip(edit, clip.id, { in: v }, item))} testId="trim-in" />
              <TimeField label={t("Termina en (s)", "Ends at (s)")} value={clip.out} disabled={!editable} onCommit={(v) => result(trimClip(edit, clip.id, { out: v }, item))} testId="trim-out" />
              {editable ? (
                <>
                  <button type="button" disabled={sourceAtPlayhead === null} onClick={() => sourceAtPlayhead !== null && result(trimClip(edit, clip.id, { in: sourceAtPlayhead }, item))} className={`${SECONDARY_BUTTON_COMPACT} h-11 text-[13px]`}>
                    {t("Inicio en el cabezal", "Start at playhead")}
                  </button>
                  <button type="button" disabled={sourceAtPlayhead === null} onClick={() => sourceAtPlayhead !== null && result(trimClip(edit, clip.id, { out: sourceAtPlayhead }, item))} className={`${SECONDARY_BUTTON_COMPACT} h-11 text-[13px]`}>
                    {t("Final en el cabezal", "End at playhead")}
                  </button>
                </>
              ) : null}
              <p className="col-span-2 text-[12px] text-slate-500">{t(`El archivo dura ${(item.duration ?? 0).toFixed(1)} s. Este clip usa ${clipDuration(clip).toFixed(1)} s.`, `The file lasts ${(item.duration ?? 0).toFixed(1)} s. This clip uses ${clipDuration(clip).toFixed(1)} s.`)}</p>
            </div>
          ) : (
            <TimeField label={t("Duración en pantalla (s)", "Time on screen (s)")} value={clip.out} disabled={!editable} onCommit={(v) => result(trimClip(edit, clip.id, { out: v }, item))} testId="image-seconds" />
          )}
          <fieldset>
            <legend className={LABEL}>{t("Encuadre", "Framing")}</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {(["cover", "contain"] as const).map((fit) => (
                <button key={fit} type="button" disabled={!editable} aria-pressed={clip.fit === fit} onClick={() => setClip({ fit })} className={pillTab(clip.fit === fit)}>
                  {fit === "cover" ? t("Llenar (recortar)", "Fill (crop)") : t("Mostrar todo (barras)", "Show all (bars)")}
                </button>
              ))}
            </div>
          </fieldset>
          {clip.fit === "cover" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Slider label={t("Recorte horizontal", "Crop left–right")} value={clip.focusX} disabled={!editable} onChange={(v) => setClip({ focusX: v })} />
              <Slider label={t("Recorte vertical", "Crop top–bottom")} value={clip.focusY} disabled={!editable} onChange={(v) => setClip({ focusY: v })} />
            </div>
          ) : null}
          {item.kind === "video" ? (
            <div className="grid items-end gap-2 sm:grid-cols-2">
              <Slider label={t("Volumen del clip", "Clip volume")} value={clip.volume} disabled={!editable || clip.muted} onChange={(v) => setClip({ volume: v })} />
              <label className="inline-flex min-h-11 items-center gap-2 text-[14px] text-slate-700">
                <input type="checkbox" className="h-5 w-5 accent-blue-900" checked={clip.muted} disabled={!editable} onChange={(e) => setClip({ muted: e.target.checked })} />
                {t("Sin sonido", "Muted")}
              </label>
            </div>
          ) : null}
          {editable ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={index <= 0} onClick={() => result(moveClip(edit, clip.id, index - 1))} className={QUIET_BUTTON}>
                <Icon name="chevron" size={16} className="rotate-180" />
                {t("Antes", "Earlier")}
              </button>
              <button type="button" disabled={index >= edit.clips.length - 1} onClick={() => result(moveClip(edit, clip.id, index + 1))} className={QUIET_BUTTON}>
                {t("Después", "Later")}
                <Icon name="chevron" size={16} />
              </button>
              <button type="button" onClick={() => { if (result(removeClip(edit, clip.id))) setSelected(null); }} className={`${QUIET_BUTTON} text-red-700`}>
                <Icon name="close" size={16} />
                {t("Quitar de la línea de tiempo", "Remove from the timeline")}
              </button>
            </div>
          ) : null}
        </div>
      ) : edit.clips.length > 0 ? (
        <p className="border-t border-slate-200 pt-4 text-[13.5px] text-slate-500">{t("Elige un clip en la línea de tiempo para recortarlo o encuadrarlo.", "Pick a clip on the timeline to trim or frame it.")}</p>
      ) : null}
    </div>
  );
}

/** A number of seconds, typed; saved when the field is left or Enter is pressed. */
function TimeField({ label, value, disabled, onCommit, testId }: { label: string; value: number; disabled?: boolean; onCommit: (v: number) => void; testId?: string }) {
  const [text, setText] = useState(value.toFixed(2));
  useEffect(() => setText(value.toFixed(2)), [value]);
  const commit = () => {
    const v = parseTime(text);
    if (v === null || Math.abs(v - value) < 0.0005) return setText(value.toFixed(2));
    onCommit(v);
  };
  return (
    <label className="block min-w-0">
      <span className={LABEL}>{label}</span>
      <input inputMode="decimal" className={`${FIELD} mt-1 h-11 tabular-nums`} value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} data-testid={testId} />
    </label>
  );
}

function Slider({ label, value, disabled, onChange }: { label: string; value: number; disabled?: boolean; onChange: (v: number) => void }) {
  return (
    <label className="block min-w-0">
      <span className={LABEL}>
        {label} <span className="tabular-nums text-slate-500">{Math.round(value * 100)}%</span>
      </span>
      <input type="range" min={0} max={1} step={0.01} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 h-11 w-full accent-blue-900" />
    </label>
  );
}

// ── Words on screen ─────────────────────────────────────────────────────

function Issues({ text, lang }: { text: string; lang: "en" | "es" }) {
  const { locale } = useStaffLocale();
  const issues = text.trim() ? checkText(text, "onScreen", lang).filter((i) => i.severity === "block") : [];
  if (issues.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1">
      {issues.map((i) => (
        <li key={i.id} className="rounded-[8px] bg-red-50 px-2.5 py-1.5 text-[12.5px] leading-snug text-red-800">
          {i.match ? <span className="font-semibold">«{i.match}» · </span> : null}
          {i.explain[locale]}
        </li>
      ))}
    </ul>
  );
}

function WordsPanel({ edit, editable, bodyTime, apply, lang }: { edit: VideoEdit; editable: boolean; bodyTime: number; apply: (e: VideoEdit) => void; lang: "en" | "es" }) {
  const t = useTx();
  const body = bodyDuration(edit);
  const add = (kind: TextOverlay["kind"]) => {
    if (edit.overlays.length >= VIDEO_LIMITS.overlays) return;
    const start = Math.min(bodyTime, Math.max(0, body - 0.5));
    apply({ ...edit, overlays: [...edit.overlays, { id: newVideoId("ov"), kind, text: "", sub: "", start, end: Math.min(body, start + 3), position: kind === "title" ? "top" : "bottom", style: kind === "title" ? "white" : "white" }] });
  };
  const set = (id: string, patch: Partial<TextOverlay>) => apply({ ...edit, overlays: edit.overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)) });
  return (
    <div className="space-y-3" data-testid="words-panel">
      <p className="text-[13px] leading-snug text-slate-500">{t("En las fuentes y colores de la marca, dentro de las zonas seguras. Cada palabra pasa las reglas.", "In the brand's fonts and colours, inside the safe zones. Every word passes the rules.")}</p>
      {edit.overlays.map((o) => (
        <div key={o.id} className="space-y-2 rounded-[12px] bg-slate-50 p-3">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{o.kind === "title" ? t("Título", "Title") : t("Tercio inferior", "Lower third")}</p>
          <input className={`${FIELD} h-11`} value={o.text} maxLength={VIDEO_LIMITS.textMax} disabled={!editable} placeholder={t("Texto", "Words")} onChange={(e) => set(o.id, { text: e.target.value })} data-testid="overlay-text" />
          <Issues text={o.text} lang={lang} />
          {o.kind === "lowerThird" ? (
            <>
              <input className={`${FIELD} h-11`} value={o.sub} maxLength={VIDEO_LIMITS.textMax} disabled={!editable} placeholder={t("Segunda línea (opcional)", "Second line (optional)")} onChange={(e) => set(o.id, { sub: e.target.value })} />
              <Issues text={o.sub} lang={lang} />
            </>
          ) : null}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <TimeField label={t("Desde (s)", "From (s)")} value={o.start} disabled={!editable} onCommit={(v) => set(o.id, { start: Math.max(0, Math.min(v, o.end - 0.5)) })} />
            <TimeField label={t("Hasta (s)", "To (s)")} value={o.end} disabled={!editable} onCommit={(v) => set(o.id, { end: Math.max(o.start + 0.5, Math.min(v, VIDEO_LIMITS.maxSeconds)) })} />
            <label className="block">
              <span className={LABEL}>{t("Lugar", "Place")}</span>
              <select className={`${FIELD} mt-1 h-11`} value={o.position} disabled={!editable} onChange={(e) => set(o.id, { position: e.target.value as TextOverlay["position"] })}>
                <option value="top">{t("Arriba", "Top")}</option>
                <option value="center">{t("Centro", "Middle")}</option>
                <option value="bottom">{t("Abajo", "Bottom")}</option>
              </select>
            </label>
            <label className="block">
              <span className={LABEL}>{t("Estilo", "Style")}</span>
              <select className={`${FIELD} mt-1 h-11`} value={o.style} disabled={!editable} onChange={(e) => set(o.id, { style: e.target.value as TextOverlay["style"] })}>
                <option value="white">{o.kind === "title" ? t("Blanco con borde azul", "White, navy edge") : t("Azul con letras blancas", "Navy, white words")}</option>
                <option value="navy">{t("Blanco con letras azules", "White, navy words")}</option>
                <option value="gold">{t("Dorado con letras azules", "Gold, navy words")}</option>
              </select>
            </label>
          </div>
          {editable ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={QUIET_BUTTON} onClick={() => set(o.id, { start: Math.min(bodyTime, Math.max(0, o.end - 0.5)) })}>
                {t("Empezar en el cabezal", "Start at playhead")}
              </button>
              <button type="button" className={`${QUIET_BUTTON} text-red-700`} onClick={() => apply({ ...edit, overlays: edit.overlays.filter((x) => x.id !== o.id) })}>
                {t("Quitar", "Remove")}
              </button>
            </div>
          ) : null}
        </div>
      ))}
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${SECONDARY_BUTTON_COMPACT} gap-1.5 px-4`} onClick={() => add("title")} data-testid="add-title">
            <Icon name="plus" size={16} />
            {t("Título", "Title")}
          </button>
          <button type="button" className={`${SECONDARY_BUTTON_COMPACT} gap-1.5 px-4`} onClick={() => add("lowerThird")} data-testid="add-lower-third">
            <Icon name="plus" size={16} />
            {t("Tercio inferior", "Lower third")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ── Captions ────────────────────────────────────────────────────────────

function CaptionsPanel({ project, studio, edit, editable, bodyTime, apply, setMessage }: { project: VideoProject; studio: VideoStudio; edit: VideoEdit; editable: boolean; bodyTime: number; apply: (e: VideoEdit) => void; setMessage: (m: { text: string; tone: "info" | "error" } | null) => void }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const [paste, setPaste] = useState("");
  const [auto, setAuto] = useState(false);
  const body = bodyDuration(edit);
  const setCue = (id: string, patch: Partial<CaptionCue>) => apply({ ...edit, captions: normalizeCues(edit.captions.map((c) => (c.id === id ? { ...c, ...patch } : c)), body || VIDEO_LIMITS.maxSeconds) });
  const fromText = () => {
    const cues = parseCaptions(paste, body || VIDEO_LIMITS.maxSeconds);
    if (cues.length === 0) return setMessage({ text: t("No encontré subtítulos en ese texto.", "No captions found in that text."), tone: "error" });
    apply({ ...edit, captions: cues });
    setPaste("");
    setMessage({ text: t(`${cues.length} subtítulos listos. Revisa los tiempos.`, `${cues.length} captions ready. Check their times.`), tone: "info" });
  };
  const addAtPlayhead = () => {
    const start = Math.min(bodyTime, Math.max(0, body - 0.5));
    apply({ ...edit, captions: normalizeCues([...edit.captions, { id: newVideoId("cc"), start, end: Math.min(body, start + 2), text: t("Nuevo subtítulo", "New caption") }], body) });
  };
  const runAuto = async () => {
    setAuto(true);
    try {
      const speech = await new VideoExporter().speech(project, studio.getFile);
      if (!speech) return setMessage({ text: t("Ningún clip tiene sonido.", "No clip has sound."), tone: "error" });
      const r = await studio.transcribe(speech.wav, speech.duration, project.language);
      if (!r.ok) return setMessage({ text: r.message[locale], tone: "error" });
      apply({ ...edit, captions: normalizeCues(r.cues, body) });
      setMessage({ text: t("Subtítulos automáticos listos: léelos y corrígelos.", "Automatic captions ready: read and fix them."), tone: "info" });
    } catch (error) {
      setMessage({ text: error instanceof ExportError ? t("No se pudo leer el sonido de los clips.", "The clips' sound couldn't be read.") : t("No se pudo.", "It didn't work."), tone: "error" });
    } finally {
      setAuto(false);
    }
  };
  const download = () => {
    const blob = new Blob([cuesToSrt(edit.captions)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "captions.srt";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-3" data-testid="captions-panel">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={!editable || !studio.transcribeOn || auto || edit.clips.length === 0} onClick={runAuto} className={`${SECONDARY_BUTTON_COMPACT} gap-1.5 px-4`} data-testid="auto-captions">
          <Icon name="sparkle" size={16} />
          {auto ? t("Escuchando…", "Listening…") : t("Subtítulos automáticos", "Auto captions")}
        </button>
        {!studio.transcribeOn ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[12.5px] font-medium text-slate-600" data-testid="auto-captions-off">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-slate-400" />
            {t("No conectado (falta TRANSCRIBE_API_KEY en el servidor)", "Not connected (the server needs TRANSCRIBE_API_KEY)")}
          </span>
        ) : null}
      </div>
      {editable ? (
        <div>
          <label className="block">
            <span className={LABEL}>{t("Escribe o pega los subtítulos", "Type or paste the captions")}</span>
            <textarea
              className={`${FIELD} mt-1 min-h-28 py-2 font-mono text-[13px]`}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={t("Una línea por subtítulo, o con tiempos: 0:01-0:03 Hola. También archivos SRT o VTT.", "One line per caption, or with times: 0:01-0:03 Hello. SRT or VTT files work too.")}
              data-testid="captions-paste"
            />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={!paste.trim()} onClick={fromText} className={`${PRIMARY_BUTTON_COMPACT} px-4`} data-testid="captions-apply">
              {t("Usar este texto", "Use this text")}
            </button>
            <button type="button" onClick={addAtPlayhead} disabled={body <= 0} className={QUIET_BUTTON}>
              <Icon name="plus" size={16} />
              {t("Uno en el cabezal", "One at the playhead")}
            </button>
          </div>
        </div>
      ) : null}
      <fieldset>
        <legend className={LABEL}>{t("Posición", "Position")}</legend>
        <div className="mt-1 flex gap-2">
          {(["bottom", "middle"] as const).map((p) => (
            <button key={p} type="button" disabled={!editable} aria-pressed={edit.captionPosition === p} onClick={() => apply({ ...edit, captionPosition: p })} className={pillTab(edit.captionPosition === p)}>
              {p === "bottom" ? t("Abajo", "Bottom") : t("Centro", "Middle")}
            </button>
          ))}
        </div>
      </fieldset>
      {edit.captions.length > 0 ? (
        <>
          <ol className="space-y-2" data-testid="caption-list">
            {edit.captions.map((c) => (
              <li key={c.id} className="rounded-[12px] bg-slate-50 p-2.5">
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <TimeField label={t("Desde", "From")} value={c.start} disabled={!editable} onCommit={(v) => setCue(c.id, { start: v })} />
                  <TimeField label={t("Hasta", "To")} value={c.end} disabled={!editable} onCommit={(v) => setCue(c.id, { end: v })} />
                  {editable ? (
                    <button type="button" className={`${QUIET_BUTTON} self-end`} aria-label={t("Quitar este subtítulo", "Remove this caption")} onClick={() => apply({ ...edit, captions: edit.captions.filter((x) => x.id !== c.id) })}>
                      <Icon name="close" size={16} />
                    </button>
                  ) : null}
                </div>
                <input className={`${FIELD} mt-2 h-11`} value={c.text} maxLength={VIDEO_LIMITS.captionMax} disabled={!editable} onChange={(e) => apply({ ...edit, captions: edit.captions.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)) })} />
                <Issues text={c.text} lang={project.language} />
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            {editable ? (
              <>
                <button type="button" className={QUIET_BUTTON} onClick={() => apply({ ...edit, captions: shiftCues(edit.captions, -0.25, body) })}>
                  {t("Todo 0,25 s antes", "All 0.25 s earlier")}
                </button>
                <button type="button" className={QUIET_BUTTON} onClick={() => apply({ ...edit, captions: shiftCues(edit.captions, 0.25, body) })}>
                  {t("Todo 0,25 s después", "All 0.25 s later")}
                </button>
              </>
            ) : null}
            <button type="button" className={QUIET_BUTTON} onClick={download}>
              <Icon name="download" size={16} />
              {t("Descargar .srt", "Download .srt")}
            </button>
          </div>
        </>
      ) : (
        <p className="text-[13.5px] text-slate-500">{t("Sin subtítulos todavía. Casi todos ven los videos sin sonido: ponlos.", "No captions yet. Most people watch with the sound off: add them.")}</p>
      )}
    </div>
  );
}

// ── Brand and shape ─────────────────────────────────────────────────────

const POSES: AssistantPose[] = ["wave", "phone", "thumbsUp", "thinking", "envelope", "celebrate"];

function BrandPanel({ edit, editable, bodyTime, apply }: { edit: VideoEdit; editable: boolean; bodyTime: number; apply: (e: VideoEdit) => void }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const text = useText(VIDEO_TEXT);
  const corners: Array<[Corner, string]> = [
    ["tl", t("Arriba a la izquierda", "Top left")],
    ["tr", t("Arriba a la derecha", "Top right")],
    ["bl", t("Abajo a la izquierda", "Bottom left")],
    ["br", t("Abajo a la derecha", "Bottom right")],
  ];
  return (
    <div className="space-y-5" data-testid="brand-panel">
      <fieldset>
        <legend className="console-label">{t("Forma del video", "Shape")}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {ASPECT_ORDER.map((a: Aspect) => (
            <button key={a} type="button" disabled={!editable} aria-pressed={edit.aspect === a} onClick={() => apply({ ...edit, aspect: a })} className={`${pillTab(edit.aspect === a)} justify-start`} data-testid={`aspect-${a}`}>
              {text.aspect[a]}
            </button>
          ))}
        </div>
        {edit.aspect === "9:16" ? (
          <p className="mt-2 text-[12.5px] leading-snug text-slate-500">
            {t(
              `Las líneas doradas de la vista previa son la zona segura de Reels, TikTok y Shorts a la vez (los botones de cada red tapan hasta ${Math.round(Math.max(...Object.values(SAFE_ZONES).map((z) => z.bottom)) * 100)}% abajo). Son aproximadas.`,
              `The gold lines on the preview are the safe zone of Reels, TikTok and Shorts at once (each network's buttons cover up to ${Math.round(Math.max(...Object.values(SAFE_ZONES).map((z) => z.bottom)) * 100)}% at the bottom). They're approximate.`,
            )}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          {(["navy", "black"] as const).map((bg) => (
            <button key={bg} type="button" disabled={!editable} aria-pressed={edit.background === bg} onClick={() => apply({ ...edit, background: bg })} className={pillTab(edit.background === bg)}>
              {bg === "navy" ? t("Barras azul marino", "Navy bars") : t("Barras negras", "Black bars")}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="console-label">{t("Logo", "Logo")}</legend>
        <label className="inline-flex min-h-11 items-center gap-2 text-[14px] text-slate-700">
          <input type="checkbox" className="h-5 w-5 accent-blue-900" checked={edit.logo.enabled} disabled={!editable} onChange={(e) => apply({ ...edit, logo: { ...edit.logo, enabled: e.target.checked } })} data-testid="logo-on" />
          {t("Mostrar el logo en todo el video", "Show the logo through the video")}
        </label>
        {edit.logo.enabled ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className={LABEL}>{t("Esquina", "Corner")}</span>
                <select className={`${FIELD} mt-1 h-11`} value={edit.logo.corner} disabled={!editable} onChange={(e) => apply({ ...edit, logo: { ...edit.logo, corner: e.target.value as Corner } })}>
                  {corners.map(([c, label]) => (
                    <option key={c} value={c}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={LABEL}>{t("Versión del logo", "Logo version")}</span>
                <select className={`${FIELD} mt-1 h-11`} value={edit.logo.version} disabled={!editable} onChange={(e) => apply({ ...edit, logo: { ...edit.logo, version: e.target.value as VideoEdit["logo"]["version"] } })} data-testid="logo-version">
                  <option value="auto">{t("Automática: blanco sobre oscuro, azul sobre claro", "Automatic: white on dark, navy on light")}</option>
                  <option value="white">{t("Blanco, para imagen oscura", "White, for dark footage")}</option>
                  <option value="navy">{t("Azul, para imagen clara", "Navy, for light footage")}</option>
                </select>
              </label>
            </div>
            <p className="text-[12.5px] leading-snug text-slate-500">
              {t("Es el archivo oficial, sin cambios: a escala pareja, con su espacio libre. Nunca se recolorea ni se estira.", "It's the official file, unchanged: scaled evenly, with its clear space. Never recoloured or stretched.")}
            </p>
          </>
        ) : null}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="console-label">{t("Tarjetas de marca", "Brand cards")}</legend>
        <label className="inline-flex min-h-11 items-center gap-2 text-[14px] text-slate-700">
          <input type="checkbox" className="h-5 w-5 accent-blue-900" checked={edit.intro.enabled} disabled={!editable} onChange={(e) => apply({ ...edit, intro: { ...edit.intro, enabled: e.target.checked } })} data-testid="intro-on" />
          {t("Tarjeta inicial (logo y título, fondo azul marino)", "Intro card (logo and title, on navy)")}
        </label>
        {edit.intro.enabled ? (
          <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
            <input className={`${FIELD} h-11`} value={edit.intro.title} maxLength={VIDEO_LIMITS.textMax} disabled={!editable} placeholder={t("Título de la tarjeta", "The card's title")} onChange={(e) => apply({ ...edit, intro: { ...edit.intro, title: e.target.value } })} />
            <TimeField label={t("Segundos", "Seconds")} value={edit.intro.seconds} disabled={!editable} onCommit={(v) => apply({ ...edit, intro: { ...edit.intro, seconds: Math.min(5, Math.max(1, v)) } })} />
          </div>
        ) : null}
        <label className="inline-flex min-h-11 items-center gap-2 text-[14px] text-slate-700">
          <input type="checkbox" className="h-5 w-5 accent-blue-900" checked={edit.outro.enabled} disabled={!editable} onChange={(e) => apply({ ...edit, outro: { ...edit.outro, enabled: e.target.checked } })} data-testid="outro-on" />
          {t("Tarjeta final (logo, una línea y la llamada a la acción)", "End card (logo, a line and the call to action)")}
        </label>
        {edit.outro.enabled ? (
          <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
            <input className={`${FIELD} h-11`} value={edit.outro.line} maxLength={VIDEO_LIMITS.textMax} disabled={!editable} onChange={(e) => apply({ ...edit, outro: { ...edit.outro, line: e.target.value } })} />
            <TimeField label={t("Segundos", "Seconds")} value={edit.outro.seconds} disabled={!editable} onCommit={(v) => apply({ ...edit, outro: { ...edit.outro, seconds: Math.min(6, Math.max(1, v)) } })} />
          </div>
        ) : null}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="console-label">{t("Alti (IA) como imagen", "Alti (AI) as an overlay")}</legend>
        <label className="inline-flex min-h-11 items-center gap-2 text-[14px] text-slate-700">
          <input type="checkbox" className="h-5 w-5 accent-blue-900" checked={edit.alti.enabled} disabled={!editable} onChange={(e) => apply({ ...edit, alti: { ...edit.alti, enabled: e.target.checked, start: e.target.checked ? Math.min(bodyTime, Math.max(0, bodyDuration(edit) - 1)) : edit.alti.start, end: e.target.checked ? Math.min(bodyDuration(edit), bodyTime + 3) : edit.alti.end } })} data-testid="alti-on" />
          {t(`Mostrar a ${BRAND.assistant}, siempre con su etiqueta «${BRAND.assistant} · Asistente con IA»`, `Show ${BRAND.assistant}, always with his label “${BRAND.assistant} · AI assistant”`)}
        </label>
        {edit.alti.enabled ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="block">
              <span className={LABEL}>{t("Pose", "Pose")}</span>
              <select className={`${FIELD} mt-1 h-11`} value={edit.alti.pose} disabled={!editable} onChange={(e) => apply({ ...edit, alti: { ...edit.alti, pose: e.target.value as AssistantPose } })}>
                {POSES.map((p) => (
                  <option key={p} value={p}>
                    {POSE_LABEL[p]?.[locale] ?? p}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={LABEL}>{t("Lado", "Side")}</span>
              <select className={`${FIELD} mt-1 h-11`} value={edit.alti.corner} disabled={!editable} onChange={(e) => apply({ ...edit, alti: { ...edit.alti, corner: e.target.value as "bl" | "br" } })}>
                <option value="bl">{t("Izquierda", "Left")}</option>
                <option value="br">{t("Derecha", "Right")}</option>
              </select>
            </label>
            <TimeField label={t("Desde (s)", "From (s)")} value={edit.alti.start} disabled={!editable} onCommit={(v) => apply({ ...edit, alti: { ...edit.alti, start: Math.max(0, Math.min(v, edit.alti.end - 0.5)) } })} />
            <TimeField label={t("Hasta (s)", "To (s)")} value={edit.alti.end} disabled={!editable} onCommit={(v) => apply({ ...edit, alti: { ...edit.alti, end: Math.max(edit.alti.start + 0.5, v) } })} />
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}

// ── Music ───────────────────────────────────────────────────────────────

function MusicPanel({ studio, edit, editable, apply }: { studio: VideoStudio; edit: VideoEdit; editable: boolean; apply: (e: VideoEdit) => void }) {
  const t = useTx();
  const tracks = useMemo(() => studio.tracks.filter((x) => !x.removedAt), [studio.tracks]);
  const chosen = tracks.find((x) => x.id === edit.music.trackId) ?? null;
  return (
    <div className="space-y-3" data-testid="music-panel">
      <p className="text-[13px] leading-snug text-slate-500">
        {t("Solo música de la biblioteca del equipo: cada pista tiene registrado quién confirmó los derechos y cuándo.", "Only music from the team's library: each track records who confirmed the rights, and when.")}{" "}
        <a href="/equipo/video/musica" className="font-medium text-blue-700 underline">
          {t("Abrir la biblioteca", "Open the library")}
        </a>
      </p>
      <label className="block">
        <span className={LABEL}>{t("Pista", "Track")}</span>
        <select className={`${FIELD} mt-1 h-11`} value={edit.music.trackId ?? ""} disabled={!editable} onChange={(e) => apply({ ...edit, music: { ...edit.music, trackId: e.target.value || null } })} data-testid="music-track">
          <option value="">{t("Sin música", "No music")}</option>
          {tracks.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      {chosen ? (
        <>
          <p className="rounded-[10px] bg-green-50 px-3 py-2 text-[12.5px] text-green-800">
            {t(`Derechos confirmados por ${chosen.rights.confirmedBy}`, `Rights confirmed by ${chosen.rights.confirmedBy}`)} · {chosen.rights.confirmedAt.slice(0, 10)}
            {chosen.rights.note ? ` · ${chosen.rights.note}` : ""}
          </p>
          <Slider label={t("Volumen de la música", "Music volume")} value={edit.music.volume} disabled={!editable} onChange={(v) => apply({ ...edit, music: { ...edit.music, volume: v } })} />
          <label className="inline-flex min-h-11 items-center gap-2 text-[14px] text-slate-700">
            <input type="checkbox" className="h-5 w-5 accent-blue-900" checked={edit.music.duck} disabled={!editable} onChange={(e) => apply({ ...edit, music: { ...edit.music, duck: e.target.checked } })} />
            {t("Bajar la música cuando un clip tiene sonido", "Lower the music while a clip has sound")}
          </label>
          {edit.music.duck ? <Slider label={t("Volumen mientras se habla", "Volume under speech")} value={edit.music.duckTo} disabled={!editable} onChange={(v) => apply({ ...edit, music: { ...edit.music, duckTo: v } })} /> : null}
          <label className="inline-flex min-h-11 items-center gap-2 text-[14px] text-slate-700">
            <input type="checkbox" className="h-5 w-5 accent-blue-900" checked={edit.music.fadeOut} disabled={!editable} onChange={(e) => apply({ ...edit, music: { ...edit.music, fadeOut: e.target.checked } })} />
            {t("Desvanecer al final", "Fade out at the end")}
          </label>
        </>
      ) : null}
    </div>
  );
}
