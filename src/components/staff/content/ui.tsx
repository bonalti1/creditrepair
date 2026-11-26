"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Capability } from "@/lib/staff/permissions";
import { can, deniedReason } from "@/lib/staff/permissions";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { useViewer } from "@/lib/staff/useStaff";
import { CHANNEL_LABEL, LANGUAGE_TAG, STATUS_LABEL, STATUS_TONE, TYPE_LABEL } from "@/lib/content/labels";
import { blockingIssues, checkPiece } from "@/lib/content/check";
import type { Bilingual, ContentPiece, ContentStatus } from "@/lib/content/types";
import Icon from "@/components/Icon";
import { DemoNote as SharedDemoNote, NoAccess, pillTab } from "@/components/staff/ui";

// The content hub's shared pieces: the tabs under the title, the status chip,
// the piece card (board and calendar), the fields' look, and the access gate.

export const FIELD =
  "w-full min-w-0 rounded-xl bg-white px-3 text-[15px] text-slate-900 outline-none ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300 disabled:bg-slate-50 disabled:text-slate-500";
export const LABEL = "block text-[13px] font-medium text-slate-700";

/** A pair of words in the member's language. */
export function useBi(): (text: Bilingual) => string {
  const { locale } = useStaffLocale();
  return (text: Bilingual) => text[locale];
}

interface Tab {
  href: string;
  label: [string, string];
  needs: Capability;
  icon: Parameters<typeof Icon>[0]["name"];
}

const TABS: Tab[] = [
  { href: "/equipo/contenido", label: ["Tablero", "Board"], needs: "content.view", icon: "grid" },
  { href: "/equipo/contenido/calendario", label: ["Calendario", "Calendar"], needs: "content.view", icon: "clock" },
  { href: "/equipo/contenido/plantillas", label: ["Plantillas", "Templates"], needs: "content.view", icon: "clipboard" },
  { href: "/equipo/contenido/resultados", label: ["Resultados", "Results"], needs: "content.view", icon: "chart" },
  { href: "/equipo/contenido/marca", label: ["Kit de marca", "Brand kit"], needs: "content.share", icon: "book" },
  { href: "/equipo/contenido/socios", label: ["Material para socios", "Partner kit"], needs: "content.share", icon: "link" },
  { href: "/equipo/contenido/publicar", label: ["Publicar", "Publishing"], needs: "content.publish", icon: "sparkle" },
];

/** The title, a line under it, and the content tabs the viewer may open. */
export function ContentHeader({ title, lead, aside }: { title: string; lead?: React.ReactNode; aside?: React.ReactNode }) {
  const t = useTx();
  const path = usePathname();
  const { viewer } = useViewer();
  const tabs = TABS.filter((tab) => can(viewer?.role, tab.needs));
  const current = (href: string) => (href === "/equipo/contenido" ? path === href || path.startsWith("/equipo/contenido/pieza") || path === "/equipo/contenido/nueva" : path.startsWith(href));
  return (
    <header>
      <nav aria-label={t("Contenido", "Content")} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1.5">
          {tabs.map((tab) => (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={current(tab.href) ? "page" : undefined}
                className={pillTab(current(tab.href))}
              >
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

/** The screen, or the reason the viewer's role may not open it. */
export function ContentGate({ needs, title, children }: { needs: Capability; title: string; children: React.ReactNode }) {
  const { viewer, ready } = useViewer();
  const { locale } = useStaffLocale();
  if (!ready) return <div className="h-40" aria-busy="true" />;
  if (!can(viewer?.role, needs)) return <NoAccess title={title} reason={deniedReason(needs, locale)} />;
  return <>{children}</>;
}

export function StatusChip({ status }: { status: ContentStatus }) {
  const { locale } = useStaffLocale();
  return <span className={`inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold ${STATUS_TONE[status]}`}>{STATUS_LABEL[locale][status]}</span>;
}

/** A small tag: EN+ES, a channel. */
export function Tag({ children, tone = "bg-slate-100 text-slate-700" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`inline-flex h-6 items-center whitespace-nowrap rounded-full px-2 text-[12px] font-medium ${tone}`}>{children}</span>;
}

/** The card on the board and the calendar: title, type, language, channels, owner, date, and the check's count. */
export function PieceCard({ piece, compact = false, showStatus = false }: { piece: ContentPiece; compact?: boolean; showStatus?: boolean }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const blocking = blockingIssues(checkPiece(piece)).length;
  return (
    <Link
      href={`/equipo/contenido/pieza/${piece.id}`}
      className="pressable block rounded-2xl bg-white px-3.5 py-3 ring-1 ring-slate-200 hover:ring-blue-300 focus-visible:ring-2"
      data-testid="piece-card"
    >
      <p className={`font-semibold leading-snug text-slate-900 ${compact ? "text-[13.5px]" : "text-[14.5px]"}`}>{piece.title}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {showStatus ? <StatusChip status={piece.status} /> : null}
        <Tag>{TYPE_LABEL[locale][piece.type]}</Tag>
        <Tag tone="bg-blue-50 text-blue-700">{LANGUAGE_TAG[piece.language]}</Tag>
        {compact ? null : piece.channels.slice(0, 3).map((c) => <Tag key={c}>{CHANNEL_LABEL[locale][c]}</Tag>)}
        {!compact && piece.channels.length > 3 ? <Tag>+{piece.channels.length - 3}</Tag> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-500">
        {piece.owner ? (
          <span className="inline-flex items-center gap-1">
            <Icon name="person" size={13} />
            {piece.owner}
          </span>
        ) : (
          <span>{t("Sin responsable", "No owner")}</span>
        )}
        {piece.dueDate ? (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Icon name="clock" size={13} />
            {new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${piece.dueDate}T12:00:00Z`))}
          </span>
        ) : null}
        {blocking > 0 ? (
          <span className="inline-flex items-center gap-1 font-semibold text-red-700" data-testid="card-blocking">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-red-600" />
            {t(`${blocking} por corregir`, `${blocking} to fix`)}
          </span>
        ) : null}
        {piece.aiDraft ? <span className="font-medium text-amber-700">{t("Borrador de Alti (IA)", "Alti's draft (AI)")}</span> : null}
      </div>
    </Link>
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

/** "Demo: nothing here is posted." */
export function DemoNote({ live }: { live: boolean }) {
  const t = useTx();
  if (live) return null;
  return (
    <SharedDemoNote>{t("Demostración: piezas inventadas. Nada se publica ni se envía; los cambios se guardan solo en este navegador.", "Demo: made-up pieces. Nothing is posted or sent; changes are kept only in this browser.")}</SharedDemoNote>
  );
}
