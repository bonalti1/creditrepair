"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { can, deniedReason, type Capability } from "@/lib/staff/permissions";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { useViewer } from "@/lib/staff/useStaff";
import { SEO_TEXT } from "@/lib/seo/text";
import type { Bilingual, GuideStatus } from "@/lib/seo/types";
import Icon from "@/components/Icon";
import { Chip, DemoNote as SharedDemoNote, NoAccess, pillTab } from "@/components/staff/ui";

// The SEO department's shared pieces: the tabs under the title, the status
// chip, the sample note, the fields' look and the access gate.

export const FIELD =
  "w-full min-w-0 rounded-xl bg-white px-3 text-[15px] text-slate-900 outline-none ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300 disabled:bg-slate-50 disabled:text-slate-500";
export const LABEL = "block text-[13px] font-medium text-slate-700";

export function useBi(): (text: Bilingual) => string {
  const { locale } = useStaffLocale();
  return (text: Bilingual) => text[locale];
}

interface Tab {
  href: string;
  label: [string, string];
  icon: Parameters<typeof Icon>[0]["name"];
}

const TABS: Tab[] = [
  { href: "/equipo/seo", label: ["Salud del sitio", "Site health"], icon: "check" },
  { href: "/equipo/seo/guias", label: ["Guías", "Guides"], icon: "book" },
  { href: "/equipo/seo/busqueda", label: ["Search Console", "Search Console"], icon: "chart" },
  { href: "/equipo/seo/palabras", label: ["Palabras e ideas", "Keywords & ideas"], icon: "search" },
  { href: "/equipo/seo/local", label: ["SEO local", "Local SEO"], icon: "globe" },
];

export function SeoHeader({ title, lead, aside }: { title: string; lead?: React.ReactNode; aside?: React.ReactNode }) {
  const t = useTx();
  const path = usePathname();
  const current = (href: string) => (href === "/equipo/seo" ? path === href : path === href || path.startsWith(`${href}/`));
  return (
    <header>
      <nav aria-label="SEO" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
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

/** The demo's line: what is sample and what is real. */
export function SampleNote({ live, children }: { live: boolean; children?: React.ReactNode }) {
  const t = useTx();
  if (live) return null;
  return (
    <SharedDemoNote testId="seo-sample-note">
      {children ?? t("Datos de muestra. Lo que cambies se guarda solo en este navegador y nada se publica en el sitio.", "Sample data. What you change is kept only in this browser, and nothing is published on the site.")}
    </SharedDemoNote>
  );
}

const STATUS_TONE: Record<GuideStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  review: "bg-amber-100 text-blue-900",
  changes: "bg-red-50 text-red-700",
  approved: "bg-blue-50 text-blue-700",
  published: "bg-green-50 text-green-700",
  archived: "bg-slate-100 text-slate-500",
};

export function StatusChip({ status }: { status: GuideStatus }) {
  const { locale } = useStaffLocale();
  return <Chip tone={STATUS_TONE[status]}>{SEO_TEXT[locale].status[status]}</Chip>;
}

export function PassChip({ pass, label }: { pass: boolean; label?: string }) {
  const { locale } = useStaffLocale();
  return <Chip tone={pass ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}>{label ?? SEO_TEXT[locale].state[pass ? "pass" : "fix"]}</Chip>;
}

/** The whole department is for seo.view: others see why. */
export function SeoGate({ children, needs = "seo.view" }: { children: React.ReactNode; needs?: Capability }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const { viewer, ready } = useViewer();
  if (!ready) return <div className="h-40" aria-busy="true" />;
  if (!can(viewer?.role, needs)) return <NoAccess title="SEO" reason={deniedReason(needs, locale)} />;
  return <>{children}</>;
}

/** A short message after an action: what happened or why not. */
export function Notice({ text, tone = "info" }: { text: string | null; tone?: "info" | "error" }) {
  if (!text) return null;
  return (
    <p role="status" className={`rounded-xl px-3 py-2 text-[14px] ${tone === "error" ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}>
      {text}
    </p>
  );
}

export function when(iso: string | null | undefined, locale: "en" | "es"): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString(locale === "es" ? "es-US" : "en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" }) : "";
}
