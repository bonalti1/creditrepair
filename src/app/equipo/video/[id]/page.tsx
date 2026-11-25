"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { can } from "@/lib/staff/permissions";
import { useStaffLocale, useText, useTx } from "@/lib/staff/i18n/StaffLocale";
import { blockingVideoIssues, checkVideo } from "@/lib/video/check";
import { VIDEO_TEXT } from "@/lib/video/labels";
import { useVideoStudio } from "@/lib/video/store";
import { totalDuration } from "@/lib/video/timeline";
import type { VideoStatus } from "@/lib/video/types";
import Icon from "@/components/Icon";
import { QUIET_BUTTON, SECONDARY_BUTTON_COMPACT, pillTab } from "@/components/staff/ui";
import { CheckPanel } from "@/components/staff/video/CheckPanel";
import { Editor } from "@/components/staff/video/Editor";
import { HandOffPanel } from "@/components/staff/video/HandOffPanel";
import { PlanPanel } from "@/components/staff/video/PlanPanel";
import { clock, DemoNote, Notice, Tag, VideoGate, VideoStatusChip } from "@/components/staff/video/ui";

// One video: Plan (brief, script, shots, Alti's draft), Edit (the editor and
// the export), Check (the words, the checklist, consent, approval) and
// Hand-off (to a Content piece). `?pestana=` opens a tab.

type Tab = "plan" | "edit" | "check" | "handoff";
const TABS: readonly Tab[] = ["plan", "edit", "check", "handoff"];

export default function VideoProjectPage() {
  const t = useTx();
  return (
    <VideoGate title={t("Video", "Video")}>
      <ProjectScreen />
    </VideoGate>
  );
}

function ProjectScreen() {
  const t = useTx();
  const { locale } = useStaffLocale();
  const text = useText(VIDEO_TEXT);
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const studio = useVideoStudio(params.id);
  const project = studio.project;
  const [tab, setTab] = useState<Tab>("plan");
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(null);

  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("pestana");
    if ((TABS as readonly string[]).includes(asked ?? "")) setTab(asked as Tab);
  }, []);
  // A video with clips opens on the editor; one approved, on the hand-off.
  useEffect(() => {
    if (!project || new URLSearchParams(window.location.search).get("pestana")) return;
    if (project.status === "approved") setTab("handoff");
    else if (project.status === "ready") setTab("check");
    else if (project.edit.clips.length > 0) setTab("edit");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  const pick = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("pestana", next);
    window.history.replaceState(null, "", url.toString());
  };

  if (!studio.ready) return <div className="h-40" aria-busy="true" />;
  if (!project) {
    return (
      <main className="animate-rise">
        <h1 className="page-title">{t("No se encontró el video", "Video not found")}</h1>
        <Link href="/equipo/video" className="mt-4 inline-flex h-11 items-center text-[15px] font-medium text-blue-700">
          {t("Volver al tablero", "Back to the board")}
        </Link>
      </main>
    );
  }

  const editable = can(studio.role, "content.edit") && !["published", "archived"].includes(project.status);
  const blocking = blockingVideoIssues(checkVideo(project, studio.tracks)).length;
  const move = async (to: VideoStatus, ok: string) => {
    const r = await studio.act({ action: "move", id: project.id, to });
    setMessage(r.ok ? { text: ok, tone: "info" } : { text: r.message[locale], tone: "error" });
  };
  const duplicate = async () => {
    const r = await studio.act({ action: "duplicate", id: project.id });
    if (r.ok && r.project) router.push(`/equipo/video/${r.project.id}`);
    else if (!r.ok) setMessage({ text: r.message[locale], tone: "error" });
  };
  const tabLabel: Record<Tab, string> = {
    plan: t("Plan", "Plan"),
    edit: t("Editor", "Editor"),
    check: t("Revisión y aprobación", "Check & approve"),
    handoff: t("Pasar a Contenido", "Hand to Content"),
  };

  return (
    <main className="animate-rise">
      <Link href="/equipo/video" className="inline-flex h-11 items-center gap-1 text-[14px] font-medium text-blue-700">
        <Icon name="chevron" size={16} className="rotate-180" />
        {t("Estudio de video", "Video Studio")}
      </Link>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title break-words">{project.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <VideoStatusChip status={project.status} />
            <Tag>{text.format[project.brief.format]}</Tag>
            <Tag tone="bg-blue-50 text-blue-700">{project.language.toUpperCase()}</Tag>
            {project.edit.clips.length > 0 ? <Tag>{clock(totalDuration(project.edit))}</Tag> : null}
            {project.brief.source === "ads" ? <Tag tone="bg-amber-100 text-blue-900">{t("Del Administrador de anuncios", "From Ads Manager")}</Tag> : null}
          </div>
          <p className="mt-2 max-w-3xl text-[14px] text-slate-500">{text.statusHint[project.status]}</p>
        </div>
        {can(studio.role, "content.edit") ? (
          <div className="flex flex-wrap gap-2">
            {project.status === "planned" ? (
              <button type="button" onClick={() => move("editing", t("A editar.", "Editing."))} className={SECONDARY_BUTTON_COMPACT}>
                {t("Empezar a editar", "Start editing")}
              </button>
            ) : null}
            <button type="button" onClick={duplicate} className={QUIET_BUTTON}>
              {t("Duplicar", "Duplicate")}
            </button>
            {project.status === "archived" ? (
              <button type="button" onClick={() => move("planned", t("Restaurado.", "Restored."))} className={QUIET_BUTTON}>
                {t("Restaurar", "Restore")}
              </button>
            ) : (
              <button type="button" onClick={() => move("archived", t("Archivado.", "Archived."))} className={QUIET_BUTTON}>
                {t("Archivar", "Archive")}
              </button>
            )}
          </div>
        ) : null}
      </div>
      <DemoNote live={studio.live} />
      <div className="mt-3">
        <Notice message={message?.text ?? null} tone={message?.tone} />
      </div>

      <nav className="-mx-4 mt-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label={t("Partes del video", "Parts of the video")}>
        <ul className="flex min-w-max gap-1.5" role="tablist">
          {TABS.map((k) => (
            <li key={k}>
              <button type="button" role="tab" aria-selected={tab === k} onClick={() => pick(k)} className={pillTab(tab === k)} data-testid={`tab-${k}`}>
                {tabLabel[k]}
                {k === "check" && blocking > 0 && project.status !== "planned" ? (
                  <span className={`inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full px-1 text-[11.5px] tabular-nums ${tab === k ? "bg-white text-red-700" : "bg-red-600 text-white"}`}>{blocking}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-4">
        {tab === "plan" ? <PlanPanel project={project} studio={studio} editable={editable} /> : null}
        {tab === "edit" ? <Editor key={project.id} project={project} studio={studio} editable={editable} /> : null}
        {tab === "check" ? <CheckPanel project={project} studio={studio} /> : null}
        {tab === "handoff" ? <HandOffPanel project={project} studio={studio} /> : null}
      </div>

      {studio.events.length > 0 ? (
        <details className="mt-8">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-[14px] font-medium text-slate-600">{t("Historial", "History")}</summary>
          <ol className="mt-2 space-y-1 text-[13px] text-slate-600">
            {[...studio.events].reverse().slice(0, 40).map((e) => (
              <li key={e.id} className="tabular-nums">
                {new Date(e.at).toLocaleString(locale === "es" ? "es-US" : "en-US", { dateStyle: "medium", timeStyle: "short" })} · {e.by} · {text.event[e.kind]}
                {e.note ? ` · ${e.note.slice(0, 80)}` : ""}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </main>
  );
}
