"use client";

import { useEffect, useRef, useState } from "react";
import { can } from "@/lib/staff/permissions";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { useVideoStudio } from "@/lib/video/store";
import type { MusicTrack } from "@/lib/video/types";
import Icon from "@/components/Icon";
import { EmptyState, PRIMARY_BUTTON, QUIET_BUTTON, SectionTitle } from "@/components/staff/ui";
import { DemoNote, FIELD, LABEL, Notice, Tag, VideoGate, VideoHeader } from "@/components/staff/video/ui";

// The music library (docs/VIDEO.md): the only music a video may use. A
// track goes in only with the person's confirmation that the team has the
// rights to use it in ads and posts; the app records who confirmed it, when,
// and their note (licence, where it came from). Removing a track keeps its
// record.

export default function MusicLibraryPage() {
  const t = useTx();
  return (
    <VideoGate title={t("Biblioteca de música", "Music library")}>
      <Library />
    </VideoGate>
  );
}

function Library() {
  const t = useTx();
  const { locale } = useStaffLocale();
  const studio = useVideoStudio();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const mayAdd = can(studio.role, "content.edit");
  const tracks = studio.tracks.filter((x) => !x.removedAt);

  const add = async () => {
    if (!file) return;
    setBusy(true);
    const r = await studio.addTrack(file, { name, rightsConfirmed: rights, rightsNote: note });
    setBusy(false);
    if (!r.ok) return setMessage({ text: r.message[locale], tone: "error" });
    setMessage({ text: t("Pista agregada, con los derechos registrados.", "Track added, with the rights recorded."), tone: "info" });
    setFile(null);
    setName("");
    setNote("");
    setRights(false);
    if (input.current) input.current.value = "";
  };

  if (!studio.ready) return <div className="h-40" aria-busy="true" />;

  return (
    <main className="animate-rise">
      <VideoHeader
        title={t("Biblioteca de música", "Music library")}
        lead={t(
          "Solo música que el equipo tiene derecho a usar en anuncios y publicaciones. Cada pista guarda quién confirmó los derechos, cuándo y en qué se basa.",
          "Only music the team has the rights to use in ads and posts. Each track keeps who confirmed the rights, when, and on what basis.",
        )}
      />
      <DemoNote live={studio.live} />
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <section aria-labelledby="tracks-h" className="min-w-0">
          <SectionTitle>
            <span id="tracks-h">{t("Pistas", "Tracks")}</span>
          </SectionTitle>
          {tracks.length === 0 ? (
            <div className="card">
              <EmptyState pose="thinking" title={t("La biblioteca está vacía", "The library is empty")}>
                {t("Sube la primera pista con sus derechos confirmados.", "Upload the first track with its rights confirmed.")}
              </EmptyState>
            </div>
          ) : (
            <ul className="space-y-2" data-testid="track-list">
              {tracks.map((track) => (
                <TrackRow key={track.id} track={track} studio={studio} mayRemove={mayAdd} onRemoved={(text) => setMessage({ text, tone: "info" })} />
              ))}
            </ul>
          )}
        </section>

        {mayAdd ? (
          <section aria-labelledby="add-track-h" className="min-w-0">
            <SectionTitle>
              <span id="add-track-h">{t("Agregar una pista", "Add a track")}</span>
            </SectionTitle>
            <div className="card space-y-3 px-4 py-4">
              <label className="block">
                <span className={LABEL}>{t("Archivo (MP3, M4A, WAV u OGG, hasta 30 MB)", "File (MP3, M4A, WAV or OGG, up to 30 MB)")}</span>
                <input ref={input} type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,audio/ogg,audio/webm" className="mt-1 block w-full text-[14px] file:mr-3 file:h-11 file:rounded-[10px] file:border file:border-slate-300 file:bg-white file:px-4 file:font-semibold" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="track-file" />
              </label>
              <label className="block">
                <span className={LABEL}>{t("Nombre", "Name")}</span>
                <input className={`${FIELD} mt-1 h-11`} value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="block">
                <span className={LABEL}>{t("En qué se basan los derechos (licencia, de dónde viene)", "What the rights rest on (licence, where it came from)")}</span>
                <input className={`${FIELD} mt-1 h-11`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={t("p. ej. licencia comercial de la biblioteca X, n.º 123", "e.g. commercial licence from library X, no. 123")} />
              </label>
              <label className="flex items-start gap-3 rounded-[10px] bg-slate-50 px-3 py-3 text-[14px] leading-snug text-slate-800">
                <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-blue-900" checked={rights} onChange={(e) => setRights(e.target.checked)} data-testid="track-rights" />
                <span>{t("Confirmo que el equipo tiene los derechos para usar esta música en anuncios y publicaciones. Queda registrado con mi nombre y la fecha.", "I confirm the team has the rights to use this music in ads and posts. It's recorded with my name and the date.")}</span>
              </label>
              <button type="button" disabled={!file || !rights || busy} onClick={add} className={`${PRIMARY_BUTTON} w-full`} data-testid="track-add">
                {busy ? t("Subiendo…", "Uploading…") : t("Agregar a la biblioteca", "Add to the library")}
              </button>
              <Notice message={message?.text ?? null} tone={message?.tone} />
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function TrackRow({ track, studio, mayRemove, onRemoved }: { track: MusicTrack; studio: ReturnType<typeof useVideoStudio>; mayRemove: boolean; onRemoved: (text: string) => void }) {
  const t = useTx();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void studio.urlFor(track.ref).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [track.ref, studio]);
  return (
    <li className="card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 break-words text-[14.5px] font-semibold text-slate-900">{track.name}</p>
        {track.source === "sample" ? <Tag tone="bg-amber-100 text-blue-900">{t("Muestra", "Sample")}</Tag> : null}
      </div>
      <p className="mt-1 text-[13px] text-slate-600">
        <Icon name="check" size={14} className="mr-1 inline text-green-700" />
        {t(`Derechos confirmados por ${track.rights.confirmedBy} el ${track.rights.confirmedAt.slice(0, 10)}`, `Rights confirmed by ${track.rights.confirmedBy} on ${track.rights.confirmedAt.slice(0, 10)}`)}
        {track.rights.note ? ` · ${track.rights.note}` : ""}
      </p>
      {url ? <audio src={url} controls preload="none" className="mt-2 w-full" aria-label={track.name} /> : null}
      {mayRemove && track.source !== "sample" ? (
        <button
          type="button"
          className={`${QUIET_BUTTON} mt-1 text-red-700`}
          onClick={async () => {
            const r = await studio.removeTrack(track.id);
            if (r.ok) onRemoved(t("Pista quitada. Su registro queda.", "Track removed. Its record stays."));
          }}
        >
          {t("Quitar de la biblioteca", "Remove from the library")}
        </button>
      ) : null}
    </li>
  );
}
