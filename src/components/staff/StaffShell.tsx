"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { getStaffData, resetDemo } from "@/lib/staff/data";
import { can, ROLE_LABELS, STAFF_ROLES, type Capability, type Viewer } from "@/lib/staff/permissions";
import { StaffLocaleProvider, useStaffLocale, useText } from "@/lib/staff/i18n/StaffLocale";
import { LANGUAGE_SELF_NAME, STAFF_LOCALES, type StaffLocale } from "@/lib/staff/i18n/locale";
import { SHELL_TEXT } from "@/lib/staff/i18n/ui/shell";
import { demoViewAs } from "@/lib/staff/teamData";
import { resetDemoAnswers } from "@/lib/staff/useSavedAnswers";
import { resetDemoPreferences } from "@/lib/staff/usePreferences";
import { StaffViewerContext, useViewer, VIEWER_CHANGED } from "@/lib/staff/useStaff";
import Icon, { type IconName } from "@/components/Icon";
import Logo from "@/components/Logo";
import HelpPanel from "@/components/staff/HelpPanel";
import TourBar from "@/components/staff/TourBar";

// The frame around every staff screen.
//
// Navigation is built for one person who works from a laptop or a phone:
//   - From 768 pixels: one compact top bar. The everyday destinations as tabs
//     (Home, Clients, Answers), everything else under "More", then
//     "What do I do here?" and the member's initial. It stays on one line from
//     768 to any desktop width, whatever the role, because only three tabs
//     are ever on it.
//   - On a phone: the logo, help and the initial on top, and a bottom tab bar
//     like the client app's (Inicio, Clientes, Respuestas, Más). «Más» opens
//     a sheet with the rest.
// Each destination shows only if the member's role may open it.
//
// "What do I do here?" opens the help for the screen you are on, with the
// "How to handle it" cards that matter there (src/lib/staff/playbook.ts).
//
// The console speaks the member's language (src/lib/staff/i18n): English
// unless they choose Spanish, from the menu under their initial or on their
// profile.
//
// In the demo nobody is signed in, so a bar under the header lets the owner
// look at the console as each role sees it ("Ver como"). It exists only in the
// demo: with a database the role comes from the signed-in member's own row.

type NavKey = keyof (typeof SHELL_TEXT)["en"]["nav"];

interface NavItem {
  href: string;
  label: NavKey;
  icon: IconName;
  needs?: Capability;
}

/** The everyday destinations: tabs on the top bar and on the phone's bottom bar. */
const PRIMARY: NavItem[] = [
  { href: "/equipo", label: "home", icon: "home" },
  { href: "/equipo/clientes", label: "clients", icon: "person" },
  { href: "/equipo/respuestas", label: "answers", icon: "chat", needs: "clients.reply" },
];

/** Everything else, under "More". */
const MORE: NavItem[] = [
  { href: "/equipo/invitar", label: "invite", icon: "mail", needs: "clients.invite" },
  { href: "/equipo/acreedores", label: "creditors", icon: "doc", needs: "rounds.send" },
  { href: "/equipo/actividad", label: "activity", icon: "clock" },
  { href: "/equipo/piloto", label: "autopilot", icon: "sparkle", needs: "rounds.send" },
  { href: "/equipo/negocio", label: "business", icon: "chart", needs: "business.view" },
  { href: "/equipo/socios", label: "partners", icon: "link", needs: "partners.view" },
  { href: "/equipo/equipo", label: "team", icon: "team", needs: "team.manage" },
  { href: "/equipo/cartas", label: "letters", icon: "clipboard", needs: "letters.edit" },
  { href: "/equipo/planes", label: "plans", icon: "calc", needs: "billing.plans" },
  { href: "/equipo/cobros", label: "invoices", icon: "doc", needs: "billing.plans" },
  { href: "/equipo/perfil", label: "profile", icon: "person" },
  { href: "/equipo/bienvenida", label: "welcome", icon: "book" },
];

/** The two languages, side by side: the quick switch in the member's menu and on the profile. */
export function LanguageSwitch({ className = "" }: { className?: string }) {
  const { locale, setLocale } = useStaffLocale();
  const t = useText(SHELL_TEXT);
  return (
    <div className={`flex gap-1 rounded-xl bg-slate-100 p-1 ${className}`} role="group" aria-label={t.language} data-testid="language-switch">
      {STAFF_LOCALES.map((option: StaffLocale) => (
        <button
          key={option}
          type="button"
          lang={option}
          onClick={() => setLocale(option)}
          aria-pressed={locale === option}
          data-locale={option}
          className={`pressable h-9 flex-1 rounded-lg px-3 text-[13px] font-semibold ${locale === option ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
        >
          {LANGUAGE_SELF_NAME[option]}
        </button>
      ))}
    </div>
  );
}

/** "Carmen Ruiz" → "CR"; one name → its first letter. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

/** Closes a popover on a click outside it or on Escape. */
function useDismiss(open: boolean, setOpen: (open: boolean) => void) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open, setOpen]);
  return box;
}

function MemberMenu({ viewer, demo }: { viewer: Viewer; demo: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useDismiss(open, setOpen);
  const t = useText(SHELL_TEXT);
  const { locale } = useStaffLocale();
  const roleLabel = ROLE_LABELS[locale][viewer.role];

  const signOut = async () => {
    await getBrowserSupabase()?.auth.signOut();
    window.location.assign("/login");
  };

  const label = `${viewer.name.split(" ")[0]} · ${roleLabel}`;
  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        data-testid="viewer"
        className="pressable flex h-11 w-11 items-center justify-center rounded-full"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-900 text-[13px] font-semibold text-white">{initials(viewer.name)}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 z-40 w-64 rounded-2xl border hairline bg-white p-2 shadow-lg">
          <p className="px-3 pb-2 pt-1.5">
            <span className="block text-[15px] font-semibold text-slate-900">{viewer.name}</span>
            <span className="block text-[13px] text-slate-500">{roleLabel}</span>
          </p>
          <div className="px-3 pb-2">
            <span className="mb-1 block text-[12px] font-semibold uppercase tracking-wide text-slate-400">{t.language}</span>
            <LanguageSwitch />
          </div>
          <Link href="/equipo/perfil" role="menuitem" onClick={() => setOpen(false)} className="flex h-11 items-center rounded-xl px-3 text-[14px] font-medium text-slate-800 hover:bg-slate-50">
            {t.profileLink}
          </Link>
          {demo ? (
            <p className="border-t hairline px-3 pb-1 pt-2 text-[12px] leading-snug text-slate-500">{t.demoNoSignIn}</p>
          ) : (
            <button type="button" role="menuitem" onClick={signOut} className="flex h-11 w-full items-center rounded-xl px-3 text-left text-[14px] font-medium text-blue-700 hover:bg-slate-50">
              {t.signOut}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** "More" on the top bar: a menu of the other destinations. */
function MoreMenu({ items, active, isActive }: { items: NavItem[]; active: boolean; isActive: (href: string) => boolean }) {
  const [open, setOpen] = useState(false);
  const box = useDismiss(open, setOpen);
  const t = useText(SHELL_TEXT);
  const current = items.find((n) => isActive(n.href));
  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="more-menu"
        className={`pressable flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-medium ${active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
      >
        <Icon name="grid" size={16} />
        {current ? t.nav[current.label] : t.more}
        <Icon name="chevron" size={14} className={open ? "-rotate-90" : "rotate-90"} />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-12 z-40 w-60 rounded-2xl border hairline bg-white p-2 shadow-lg">
          {items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              aria-current={isActive(n.href) ? "page" : undefined}
              className={`flex h-11 items-center gap-2.5 rounded-xl px-3 text-[14px] font-medium ${isActive(n.href) ? "bg-slate-100 text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}
            >
              <Icon name={n.icon} size={18} />
              {t.nav[n.label]}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** The phone's "More": a sheet over the bottom bar. */
function MoreSheet({ items, isActive, onClose }: { items: NavItem[]; isActive: (href: string) => boolean; onClose: () => void }) {
  const t = useText(SHELL_TEXT);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 bg-slate-900/40 md:hidden" onClick={onClose} role="dialog" aria-modal="true" aria-label={t.more}>
      <div
        className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white px-3 pb-3 pt-2 shadow-lg"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 76px)" }}
        onClick={(e) => e.stopPropagation()}
        data-testid="more-sheet"
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-200" />
        <ul className="grid grid-cols-2 gap-1">
          {items.map((n) => (
            <li key={n.href}>
              <Link
                href={n.href}
                onClick={onClose}
                aria-current={isActive(n.href) ? "page" : undefined}
                className={`flex h-12 items-center gap-2.5 rounded-2xl px-3 text-[15px] font-medium ${isActive(n.href) ? "bg-slate-100 text-slate-900" : "text-slate-700"}`}
              >
                <Icon name={n.icon} size={20} />
                {t.nav[n.label]}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const demo = getStaffData().demo;
  const { viewer, ready } = useViewer();
  const t = useText(SHELL_TEXT);
  const { locale } = useStaffLocale();
  const [help, setHelp] = useState(false);
  const [sheet, setSheet] = useState(false);
  const isActive = (href: string) => (href === "/equipo" ? pathname === "/equipo" : pathname === href || pathname.startsWith(`${href}/`));
  const allowed = (n: NavItem) => !n.needs || can(viewer?.role, n.needs);
  const primary = PRIMARY.filter(allowed);
  const more = MORE.filter(allowed);
  const moreActive = more.some((n) => isActive(n.href));

  // A new page closes the sheet and the help.
  useEffect(() => {
    setSheet(false);
    setHelp(false);
  }, [pathname]);

  const viewAs = (role: (typeof STAFF_ROLES)[number]) => {
    if (demoViewAs(role)) window.dispatchEvent(new Event(VIEWER_CHANGED));
  };

  return (
    // On paper there is no frame: the header and the footer are screen-only,
    // so a printed page (see /equipo/imprimir) carries nothing but its content.
    <div className="min-h-dvh print:min-h-0">
      <header className="sticky top-0 z-30 border-b hairline bg-white/80 backdrop-blur-xl print:hidden">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:px-6 md:gap-4" data-testid="staff-topbar">
          <Link href="/equipo" aria-label={t.homeAria} className="flex h-11 shrink-0 items-center gap-2.5">
            <Logo size={24} priority />
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{t.teamPill}</span>
          </Link>

          <nav className="hidden min-w-0 items-center gap-1 md:flex" aria-label={t.navAria}>
            {ready &&
              primary.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={isActive(n.href) ? "page" : undefined}
                  className={`pressable flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-medium ${
                    isActive(n.href) ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Icon name={n.icon} size={16} />
                  {t.nav[n.label]}
                </Link>
              ))}
            {ready && more.length > 0 && <MoreMenu items={more} active={moreActive} isActive={isActive} />}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            {demo && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-blue-900" title={t.demoPillTitle}>
                {t.demoPill}
              </span>
            )}
            <button
              type="button"
              onClick={() => setHelp(true)}
              className="pressable flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-2 text-sm font-medium text-blue-700 hover:bg-slate-100 lg:px-3"
              aria-label={t.help}
              data-testid="help-button"
            >
              <Icon name="info" size={20} />
              <span className="hidden whitespace-nowrap lg:inline">{t.help}</span>
            </button>
            {/* Who is signed in, as a round initial that opens a small menu: the name, the role, the profile, the way out. */}
            {viewer && <MemberMenu viewer={viewer} demo={demo} />}
          </div>
        </div>

        <Suspense fallback={null}>
          <TourBar />
        </Suspense>
      </header>

      {/* The demo's role switcher scrolls away with the page, so on a phone the sticky bar stays one line. */}
      {demo && viewer && (
        <div className="border-b border-amber-200/70 bg-amber-50 print:hidden" data-testid="view-as">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-1.5 sm:px-6">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-blue-900">{t.viewAsLabel}</span>
            <div className="flex gap-1" role="group" aria-label={t.viewAsAria}>
              {STAFF_ROLES.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => viewAs(role)}
                  aria-pressed={viewer.role === role}
                  className={`pressable h-11 rounded-full px-3 text-[13px] font-semibold md:h-8 ${
                    viewer.role === role ? "bg-blue-900 text-white" : "bg-white text-blue-900 hover:bg-amber-100"
                  }`}
                >
                  {ROLE_LABELS[locale][role]}
                </button>
              ))}
            </div>
            <span className="hidden text-[12px] text-blue-900/80 lg:inline">{t.viewAsNote(viewer.name)}</span>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 sm:pt-8 md:pb-10 print:m-0 print:max-w-none print:p-0">{children}</div>

      {demo && (
        <footer className="mx-auto max-w-6xl px-4 pb-28 sm:px-6 md:pb-10 print:hidden">
          <p className="border-t hairline pt-4 text-xs leading-relaxed text-slate-500">
            {t.demoFooter}{" "}
            <button
              type="button"
              onClick={() => {
                resetDemo();
                resetDemoAnswers();
                resetDemoPreferences();
                window.location.reload();
              }}
              className="inline-flex min-h-11 items-center font-medium text-blue-700 underline-offset-2 hover:underline md:min-h-0"
            >
              {t.resetDemo}
            </button>
          </p>
        </footer>
      )}

      {/* The phone's bottom tab bar, like the client app's. */}
      {ready && (
        <nav
          className="fixed inset-x-0 bottom-0 z-30 border-t hairline bg-white/90 backdrop-blur-xl md:hidden print:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          aria-label={t.navAria}
          data-testid="bottom-bar"
        >
          <div className="mx-auto flex max-w-md">
            {primary.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={isActive(n.href) ? "page" : undefined}
                className={`pressable flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 pb-1.5 pt-2 text-[11px] font-medium ${
                  isActive(n.href) ? "text-blue-700" : "text-slate-500"
                }`}
              >
                <Icon name={n.icon} size={24} strokeWidth={isActive(n.href) ? 2 : 1.6} />
                {t.nav[n.label]}
              </Link>
            ))}
            {more.length > 0 && (
              <button
                type="button"
                onClick={() => setSheet(!sheet)}
                aria-expanded={sheet}
                className={`pressable flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 pb-1.5 pt-2 text-[11px] font-medium ${
                  moreActive || sheet ? "text-blue-700" : "text-slate-500"
                }`}
              >
                <Icon name="grid" size={24} strokeWidth={moreActive ? 2 : 1.6} />
                {t.more}
              </button>
            )}
          </div>
        </nav>
      )}
      {sheet && <MoreSheet items={more} isActive={isActive} onClose={() => setSheet(false)} />}
      {help && <HelpPanel pathname={pathname} onClose={() => setHelp(false)} />}
    </div>
  );
}

export default function StaffShell({
  viewer,
  locale = "en",
  localeSaved = false,
  children,
}: {
  viewer?: Viewer | null;
  /** The console's language for the first paint (the layout works it out on the server). */
  locale?: StaffLocale;
  /** True when that is the member's saved choice, not a guess from the browser. */
  localeSaved?: boolean;
  children: React.ReactNode;
}) {
  return (
    <StaffViewerContext.Provider value={viewer ?? null}>
      <StaffLocaleProvider initial={locale} saved={localeSaved}>
        <Frame>{children}</Frame>
      </StaffLocaleProvider>
    </StaffViewerContext.Provider>
  );
}
