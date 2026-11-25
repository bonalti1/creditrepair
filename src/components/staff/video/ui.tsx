"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { can, deniedReason, type Capability } from "@/lib/staff/permissions";
import { useStaffLocale, useText, useTx } from "@/lib/staff/i18n/StaffLocale";
import { useViewer } from "@/lib/staff/useStaff";
import { blockingVideoIssues, checkVideo } from "@/lib/video/check";
import { VIDEO_STATUS_TONE, VIDEO_TEXT } from "@/lib/video/labels";
import { totalDuration } from "@/lib/video/timeline";
import type { MusicTrack, VideoProject, VideoStatus } from "@/lib/video/types";
import Icon from "@/components/Icon";
import { Chip, DemoNote as SharedDemoNote, NoAccess, pillTab } from "@/components/staff/ui";

// The Video Studio's shared pieces: the tabs under the title, the status
// chip, the card on the board, the access gate and the demo note. The look is
// the console's (docs/STAFF.md, «The console's design system»).

export const FIELD =
  "w-full min-w-0 rounded-[10px] bg-white px-3 text-[15px] text-slate-900 outline-none ring-1 ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-700 disabled:bg-slate-50 disabled:text-slate-500";
export const LABEL = "block text-[13px] font-medium text-slate-700";

const TABS: Array<{ href: string; label: [string, string]; icon: Parameters<typeof Icon>[0]["name"] }> = [
  { href: "/equipo/video", label: ["Tablero", "Board"], icon: "grid" },
  { href: "/equipo/video/musica", label: ["Biblioteca de música", "Music library"], icon: "speaker" },
];

export function VideoHeader({ title, lead, aside }: { title: string; lead?: React.ReactNode; aside?: React.ReactNode }) {
  const t = useTx();
  const path = usePathname();
  const current = (href: string) => (href === "/equipo/video" ? path === href || /^\/equipo\/video\/vp_/.test(path) : path.startsWith(href));
  return (
    <header>
      <nav aria-label={t("Estudio de video", "Video Studio")} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1.5">
          {TABS.map((tab) => (
            <li key={tab.href}>
              <Link href={tab.href} aria-current={current(tab.href) ? "page" : undefined} className={pillTab(current(tab.href))}>
                <Icon name={tab.icon} size={16} />
                {t(tab.label[0], tab.label[1])}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title">{title}</h1>
          {lead ? <p className="mt-1 max-w-3xl text-[15px] leading-relaxed text-slate-500">{lead}</p> : null}
        </div>
        {aside}
      </div>
    </header>
  );
}

/** The screen, or the reason the viewer's role may not open it (sales: the Video Studio is the content team's). */
export function VideoGate({ needs = "content.view", title, children }: { needs?: Capability; title: string; children: React.ReactNode }) {
  const { viewer, ready } = useViewer();
  const { locale } = useStaffLocale();
  if (!ready) return <div className="h-40" aria-busy="true" />;
  if (!can(viewer?.role, needs)) return <NoAccess title={title} reason={deniedReason(needs, locale)} />;
  return <>{children}</>;
}

export function VideoStatusChip({ status }: { status: VideoStatus }) {
  const text = useText(VIDEO_TEXT);
  return <Chip tone={VIDEO_STATUS_TONE[status]}>{text.status[status]}</Chip>;
}

export function Tag({ children, tone = "bg-slate-100 text-slate-700" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`inline-flex h-6 items-center whitespace-nowrap rounded-full px-2 text-[12px] font-medium ${tone}`}>{children}</span>;
}

/** "0:42": a length as people read it. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function VideoCard({ project, tracks }: { project: VideoProject; tracks: readonly MusicTrack[] }) {
  const t = useTx();
  const text = useText(VIDEO_TEXT);
  const blocking = blockingVideoIssues(checkVideo(project, tracks)).length;
  const length = totalDuration(project.edit);
  return (
    <Link href={`/equipo/video/${project.id}`} className="pressable block rounded-2xl bg-white px-3.5 py-3 ring-1 ring-slate-200 hover:ring-amber-500 focus-visible:ring-2" data-testid="video-card">
      <p className="text-[14.5px] font-semibold leading-snug text-slate-900">{project.title}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <Tag>{text.format[project.brief.format]}</Tag>
        <Tag tone="bg-blue-50 text-blue-700">{project.language.toUpperCase()}</Tag>
        {project.brief.source === "ads" ? <Tag tone="bg-amber-100 text-blue-900">{t("Del Administrador de anuncios", "From Ads Manager")}</Tag> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-500">
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Icon name="clock" size={13} />
          {project.edit.clips.length > 0 ? clock(length) : t("Sin clips", "No clips")}
        </span>
        {project.owner ? (
          <span className="inline-flex items-center gap-1">
            <Icon name="person" size={13} />
            {project.owner}
          </span>
        ) : null}
        {project.changesNote && project.status === "editing" ? <span className="font-semibold text-amber-700">{t("Cambios pedidos", "Changes asked")}</span> : null}
        {blocking > 0 && project.status !== "planned" ? (
          <span className="inline-flex items-center gap-1 font-semibold text-red-700" data-testid="video-card-blocking">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-red-600" />
            {t(`${blocking} por resolver`, `${blocking} to resolve`)}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

export function DemoNote({ live }: { live: boolean }) {
  const t = useTx();
  if (live) return null;
  return (
    <SharedDemoNote testId="video-demo-note">
      {t(
        "Demostración: videos inventados y clips de muestra. Todo se edita y se exporta en este navegador; nada se sube ni se publica.",
        "Demo: made-up videos and sample clips. Everything is edited and exported in this browser; nothing is uploaded or posted.",
      )}
    </SharedDemoNote>
  );
}

/** A note that says what happened (saved, refused), in a live region. */
export function Notice({ message, tone = "info" }: { message: string | null; tone?: "info" | "error" }) {
  if (!message) return <p aria-live="polite" className="sr-only" />;
  return (
    <p aria-live="polite" role={tone === "error" ? "alert" : undefined} className={`rounded-xl px-3 py-2 text-[13.5px] leading-snug ${tone === "error" ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-900"}`}>
      {message}
    </p>
  );
}
