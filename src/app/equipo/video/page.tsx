"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { can } from "@/lib/staff/permissions";
import { useStaffLocale, useText, useTx } from "@/lib/staff/i18n/StaffLocale";
import { parseBriefParam, type IncomingBrief } from "@/lib/video/brief";
import { VIDEO_TEXT } from "@/lib/video/labels";
import { videoColumns } from "@/lib/video/rules";
import { useVideoStudio } from "@/lib/video/store";
import { VIDEO_BOARD, VIDEO_FORMATS, type VideoFormat, type VideoStatus } from "@/lib/video/types";
import Icon from "@/components/Icon";
import { EmptyState, PRIMARY_BUTTON, PRIMARY_BUTTON_COMPACT, QUIET_BUTTON, SECONDARY_BUTTON } from "@/components/staff/ui";
import { DemoNote, FIELD, LABEL, Notice, VideoCard, VideoGate, VideoHeader } from "@/components/staff/video/ui";

// The Video Studio's board (docs/VIDEO.md): Planned → Editing → Ready for
// approval → Approved → Handed to Content. A brief from the Ads Manager
// arrives as /equipo/video?brief=… (src/lib/video/brief.ts): it is shown here
// and a person turns it into a video (or opens the one already made from it).
// `?columna=<status>` opens on a column (the menu's red circle). On a phone
// the columns become a row of chips and one list.

export default function VideoBoardPage() {
  const t = useTx();
  return (
    <VideoGate title={t("Estudio de video", "Video Studio")}>
      <Board />
    </VideoGate>
  );
}

function Board() {
  const t = useTx();
  const { locale } = useStaffLocale();
  const text = useText(VIDEO_TEXT);
  const router = useRouter();
  const studio = useVideoStudio();
  const [incoming, setIncoming] = useState<IncomingBrief | null>(null);
  const [briefBroken, setBriefBroken] = useState(false);
  const [creating, setCreating] = useState(false);
  const [phoneColumn, setPhoneColumn] = useState<VideoStatus>("editing");
  const [showArchived, setShowArchived] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [form, setForm] = useState({ title: "", format: "reel" as VideoFormat, language: locale as "en" | "es", goal: "", hook: "", script: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("brief");
    if (raw) {
      const parsed = parseBriefParam(raw);
      setIncoming(parsed);
      setBriefBroken(!parsed);
    }
    const column = params.get("columna");
    if ((VIDEO_BOARD as readonly string[]).includes(column ?? "")) setPhoneColumn(column as VideoStatus);
  }, []);

  const columns = useMemo(() => videoColumns(studio.projects), [studio.projects]);
  const mayCreate = can(studio.role, "content.edit");
  const existingFromBrief = incoming?.brief.ref ? studio.projects.find((p) => p.brief.ref === incoming.brief.ref && p.status !== "archived") : undefined;

  const create = async (input: { title: string; language: "en" | "es"; brief: IncomingBrief["brief"] | { title: string; goal: string; hook: string; script: string; format: VideoFormat; source: "studio"; ref: null } }) => {
    setBusy(true);
    const result = await studio.act({ action: "create", title: input.title, language: input.language, brief: input.brief });
    setBusy(false);
    if (!result.ok || !result.project) return setMessage({ text: result.ok ? t("No se pudo crear.", "It could not be created.") : result.message[locale], tone: "error" });
    router.push(`/equipo/video/${result.project.id}`);
  };

  if (!studio.ready) return <div className="h-40" aria-busy="true" />;

  return (
    <main className="animate-rise">
      <VideoHeader
        title={t("Estudio de video", "Video Studio")}
        lead={t(
          "Reels, TikTok, Shorts y anuncios: se planean, se editan aquí en el navegador, se revisan con las reglas y se aprueban. Lo aprobado pasa a Contenido para publicarse.",
          "Reels, TikTok, Shorts and ads: planned, edited right here in the browser, checked against the rules and approved. Approved videos go to Content to be posted.",
        )}
        aside={
          mayCreate ? (
            <button type="button" onClick={() => setCreating((v) => !v)} className={`${PRIMARY_BUTTON_COMPACT} gap-1.5 px-5`} aria-expanded={creating} data-testid="new-video">
              <Icon name="plus" size={18} />
              {t("Nuevo video", "New video")}
            </button>
          ) : null
        }
      />
      <DemoNote live={studio.live} />
      {studio.loadError ? <div className="mt-3"><Notice tone="error" message={t("No se pudo leer el tablero ahora. Recarga en un momento.", "The board couldn't be read right now. Reload in a moment.")} /></div> : null}
      <div className="mt-3">
        <Notice message={message?.text ?? null} tone={message?.tone} />
      </div>

      {briefBroken ? (
        <div className="mt-4">
          <Notice tone="error" message={t("El enlace trae un brief que no se puede leer. Pide que lo envíen otra vez.", "The link carries a brief that can't be read. Ask for it to be sent again.")} />
        </div>
      ) : null}

      {incoming ? (
        <section className="card mt-4 px-4 py-4 md:px-5" aria-labelledby="brief-title" data-testid="incoming-brief">
          <p className="console-label">{t("Brief del Administrador de anuncios", "Brief from the Ads Manager")}</p>
          <h2 id="brief-title" className="mt-1 font-display text-[18px] font-semibold text-blue-900">{incoming.brief.title}</h2>
          <dl className="mt-2 grid gap-2 text-[14px] md:grid-cols-2">
            {incoming.brief.goal ? <BriefRow label={t("Objetivo", "Goal")} value={incoming.brief.goal} /> : null}
            {incoming.brief.hook ? <BriefRow label={t("Gancho", "Hook")} value={incoming.brief.hook} /> : null}
            <BriefRow label={t("Formato", "Format")} value={text.format[incoming.brief.format]} />
            <BriefRow label={t("Idioma", "Language")} value={incoming.language === "es" ? "Español" : "English"} />
            {incoming.brief.script ? <BriefRow label={t("Guion o notas", "Script or notes")} value={incoming.brief.script} wide /> : null}
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            {existingFromBrief ? (
              <button type="button" onClick={() => router.push(`/equipo/video/${existingFromBrief.id}`)} className={`${PRIMARY_BUTTON_COMPACT} px-5`}>
                {t("Abrir el video de este brief", "Open the video made from this brief")}
              </button>
            ) : mayCreate ? (
              <button type="button" disabled={busy} onClick={() => create({ title: incoming.brief.title, language: incoming.language, brief: incoming.brief })} className={`${PRIMARY_BUTTON_COMPACT} px-5`} data-testid="create-from-brief">
                {t("Crear el video de este brief", "Create the video from this brief")}
              </button>
            ) : null}
            <button type="button" onClick={() => { setIncoming(null); router.replace("/equipo/video"); }} className={QUIET_BUTTON}>
              {t("Cerrar", "Close")}
            </button>
          </div>
        </section>
      ) : null}

      {creating && mayCreate ? (
        <form
          className="card mt-4 grid gap-3 px-4 py-4 md:grid-cols-2 md:px-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (form.title.trim().length < 2) return setMessage({ text: t("Escribe un título.", "Write a title."), tone: "error" });
            void create({ title: form.title.trim(), language: form.language, brief: { title: form.title.trim(), goal: form.goal, hook: form.hook, script: form.script, format: form.format, source: "studio", ref: null } });
          }}
          data-testid="new-video-form"
        >
          <label className="md:col-span-2">
            <span className={LABEL}>{t("Título", "Title")}</span>
            <input className={`${FIELD} mt-1 h-11`} value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} required data-testid="new-video-title" />
          </label>
          <label>
            <span className={LABEL}>{t("Formato", "Format")}</span>
            <select className={`${FIELD} mt-1 h-11`} value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value as VideoFormat })}>
              {VIDEO_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {text.format[f]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={LABEL}>{t("Idioma del video", "Video's language")}</span>
            <select className={`${FIELD} mt-1 h-11`} value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as "en" | "es" })}>
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
          </label>
          <label className="md:col-span-2">
            <span className={LABEL}>{t("Objetivo (para qué y para quién)", "Goal (what for, and for whom)")}</span>
            <input className={`${FIELD} mt-1 h-11`} value={form.goal} maxLength={300} onChange={(e) => setForm({ ...form, goal: e.target.value })} />
          </label>
          <label className="md:col-span-2">
            <span className={LABEL}>{t("Gancho (los primeros 3 segundos)", "Hook (the first 3 seconds)")}</span>
            <input className={`${FIELD} mt-1 h-11`} value={form.hook} maxLength={200} onChange={(e) => setForm({ ...form, hook: e.target.value })} />
          </label>
          <label className="md:col-span-2">
            <span className={LABEL}>{t("Guion o notas (opcional)", "Script or notes (optional)")}</span>
            <textarea className={`${FIELD} mt-1 min-h-24 py-2`} value={form.script} maxLength={4000} onChange={(e) => setForm({ ...form, script: e.target.value })} />
          </label>
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <button type="submit" disabled={busy} className={`${PRIMARY_BUTTON} px-6`} data-testid="create-video">
              {t("Crear video", "Create video")}
            </button>
            <button type="button" onClick={() => setCreating(false)} className={SECONDARY_BUTTON}>
              {t("Cancelar", "Cancel")}
            </button>
          </div>
        </form>
      ) : null}

      {studio.projects.filter((p) => p.status !== "archived").length === 0 ? (
        <div className="card mt-5">
          <EmptyState pose="envelope" title={t("Todavía no hay videos", "No videos yet")}>
            {t("Crea el primero con «Nuevo video», o envíalo desde el Administrador de anuncios.", "Make the first one with «New video», or send a brief from the Ads Manager.")}
          </EmptyState>
        </div>
      ) : (
        <>
          {/* Phone: one column at a time, picked from a row of chips. */}
          <div className="mt-4 md:hidden">
            <div className="-mx-4 overflow-x-auto px-4" role="tablist" aria-label={t("Columnas", "Columns")}>
              <div className="flex min-w-max gap-1.5">
                {VIDEO_BOARD.map((status) => (
                  <button
                    key={status}
                    type="button"
                    role="tab"
                    aria-selected={phoneColumn === status}
                    onClick={() => setPhoneColumn(status)}
                    className={`pressable inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[14px] font-semibold ${phoneColumn === status ? "border-blue-900 bg-blue-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                  >
                    {text.status[status]}
                    <span className="tabular-nums opacity-80">{columns[status]?.length ?? 0}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-3 px-1 text-[13px] text-slate-500">{text.statusHint[phoneColumn]}</p>
            <ul className="mt-2 space-y-2" role="tabpanel">
              {(columns[phoneColumn] ?? []).map((p) => (
                <li key={p.id}>
                  <VideoCard project={p} tracks={studio.tracks} />
                </li>
              ))}
              {(columns[phoneColumn] ?? []).length === 0 ? <li className="card px-4 py-5 text-[14px] text-slate-500">{t("Nada aquí.", "Nothing here.")}</li> : null}
            </ul>
          </div>

          {/* Wider screens: the columns side by side, scrolling sideways inside the board only. */}
          <div className="mt-5 hidden overflow-x-auto pb-3 md:block" data-testid="video-board">
            <div className="flex min-w-max gap-3">
              {VIDEO_BOARD.map((status) => {
                const list = columns[status] ?? [];
                return (
                  <section key={status} aria-labelledby={`vcol-${status}`} className="w-[256px] shrink-0 rounded-[14px] bg-slate-100/80 p-2.5">
                    <div className="flex items-baseline justify-between px-1.5 pb-1">
                      <h2 id={`vcol-${status}`} className="console-label">
                        {text.status[status]}
                      </h2>
                      <span className="text-[13px] tabular-nums text-slate-500">{list.length}</span>
                    </div>
                    <p className="px-1.5 pb-2 text-[12px] leading-snug text-slate-500">{text.statusHint[status]}</p>
                    <ul className="space-y-2">
                      {list.map((p) => (
                        <li key={p.id}>
                          <VideoCard project={p} tracks={studio.tracks} />
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          </div>
        </>
      )}

      {(columns.archived ?? []).length > 0 ? (
        <section className="mt-6">
          <button type="button" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)} className={QUIET_BUTTON}>
            <Icon name="chevron" size={16} className={showArchived ? "rotate-90" : ""} />
            {t(`Archivados (${columns.archived!.length})`, `Archived (${columns.archived!.length})`)}
          </button>
          {showArchived ? (
            <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {columns.archived!.map((p) => (
                <li key={p.id}>
                  <VideoCard project={p} tracks={studio.tracks} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

function BriefRow({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`min-w-0 rounded-[10px] bg-slate-50 px-3 py-2 ${wide ? "md:col-span-2" : ""}`}>
      <dt className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line break-words text-slate-800">{value}</dd>
    </div>
  );
}
