"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { aiByline } from "@/lib/brand";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { getStaffData, resetDemo } from "@/lib/staff/data";
import { can, ROLE_LABELS, STAFF_ROLES, type Capability, type Viewer } from "@/lib/staff/permissions";
import { groupOfPath, MORE_NAV, NAV_BY_HREF, NAV_GROUPS, navMatches, phoneMainGroups, PRIMARY_NAV, type NavGroup, type NavGroupKey, type NavItem } from "@/lib/staff/nav";
import { useNavBadges, resetBadges } from "@/lib/staff/navBadges";
import { StaffLocaleProvider, useStaffLocale, useText } from "@/lib/staff/i18n/StaffLocale";
import { LANGUAGE_SELF_NAME, STAFF_LOCALES, type StaffLocale } from "@/lib/staff/i18n/locale";
import { SHELL_TEXT } from "@/lib/staff/i18n/ui/shell";
import { demoViewAs } from "@/lib/staff/teamData";
import { resetDemoAnswers } from "@/lib/staff/useSavedAnswers";
import { resetDemoPreferences } from "@/lib/staff/usePreferences";
import { resetDemoLeads } from "@/lib/leads/data";
import { resetDemoControl } from "@/lib/control/data";
import { resetDemoVideos } from "@/lib/video/store";
import { StaffViewerContext, useViewer, VIEWER_CHANGED } from "@/lib/staff/useStaff";
import { CharacterAvatar } from "@/components/Character";
import Icon from "@/components/Icon";
import Logo from "@/components/Logo";
import { AskAltiButton, AskAltiPanel } from "@/components/staff/AskAlti";
import BadgeProbe from "@/components/staff/BadgeProbe";
import TourBar from "@/components/staff/TourBar";
import { isSearchShortcut, SEARCH_TEXT, SearchButton, SearchDialog } from "@/components/staff/GlobalSearch";

// The frame around every staff screen, laid out like ALTO Control (the owner's
// control center at his other company), in Credalti's brand. docs/STAFF.md,
// «The console's design system», has the whole system; in short:
//
//   - From 768 pixels: a navy side menu with the white logo, "Control", and
//     the destinations in ten numbered groups (lib/staff/nav.ts NAV_GROUPS:
//     0 Overview … 9 Team & Settings), each with a red circle when something
//     there needs the member (lib/staff/navBadges.ts). It folds to icons
//     (folded by default below 1280 px and on Lead Manager; the member's
//     choice is remembered in this browser). At its foot, Alti (the AI assistant, labelled as AI) and
//     the member's menu: language, profile, sign out.
//   - The top bar of every section: its name, «✓ Clear» when it has a red
//     circle, search (Ctrl/Cmd+K), the demo pill and «Ask Alti», Alti's panel
//     for that section (components/staff/AskAlti.tsx, ALTO's TabBot): the
//     screen's help, what Alti already does there, and the team's playbook.
//     A group with two or more pages shows them as sub-tabs under it.
//   - On a phone: the check, the section's name, search and Alti on top; a
//     navy bottom bar with four sections and «More»; «More» opens a navy
//     sheet with every section, its one-line purpose or what needs the member
//     there, search, «Clear all» and the member's menu.
// Each destination shows only if the member's role may open it.
//
// The console speaks the member's language (src/lib/staff/i18n): English
// unless they choose Spanish, from the member's menu or on their profile.
//
// In the demo nobody is signed in, so a bar under the header lets the owner
// look at the console as each role sees it ("Ver como"). It exists only in the
// demo: with a database the role comes from the signed-in member's own row.

const FOLD_KEY = "credalti.console.menu";

/** The two languages, side by side: the quick switch in the member's menu and on the profile. */
export function LanguageSwitch({ className = "", tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  const { locale, setLocale } = useStaffLocale();
  const t = useText(SHELL_TEXT);
  const dark = tone === "dark";
  return (
    <div className={`flex gap-1 rounded-xl p-1 ${dark ? "bg-white/10" : "bg-slate-100"} ${className}`} role="group" aria-label={t.language} data-testid="language-switch">
      {STAFF_LOCALES.map((option: StaffLocale) => (
        <button
          key={option}
          type="button"
          lang={option}
          onClick={() => setLocale(option)}
          aria-pressed={locale === option}
          data-locale={option}
          className={`pressable h-9 flex-1 rounded-lg px-3 text-[13px] font-semibold ${
            locale === option ? (dark ? "bg-white text-blue-900" : "bg-white text-slate-900 shadow-sm") : dark ? "text-blue-100 hover:text-white" : "text-slate-600 hover:text-slate-900"
          }`}
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

async function signOut() {
  await getBrowserSupabase()?.auth.signOut();
  window.location.assign("/login");
}

/** The member's menu at the foot of the side menu: who, the language, the profile, the way out. */
function MemberMenu({ viewer, demo, folded }: { viewer: Viewer; demo: boolean; folded: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useDismiss(open, setOpen);
  const t = useText(SHELL_TEXT);
  const { locale } = useStaffLocale();
  const roleLabel = ROLE_LABELS[locale][viewer.role];
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
        className={`pressable flex w-full items-center gap-2.5 rounded-[12px] text-left hover:bg-white/5 ${folded ? "h-12 justify-center" : "min-h-14 px-2 py-2"}`}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[13px] font-semibold text-blue-900">{initials(viewer.name)}</span>
        {!folded && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold text-white">{viewer.name}</span>
            <span className="block truncate text-[12.5px] text-blue-200">{roleLabel}</span>
          </span>
        )}
        {!folded && <Icon name="chevron" size={16} className="-rotate-90 text-blue-300" />}
      </button>
      {open && (
        <div role="menu" className={`absolute bottom-full z-40 mb-2 w-64 rounded-[14px] border border-slate-200 bg-white p-2 text-slate-900 shadow-lg ${folded ? "left-0" : "left-0 right-0 w-auto"}`}>
          <p className="px-3 pb-2 pt-1.5">
            <span className="block text-[15px] font-semibold text-slate-900">{viewer.name}</span>
            <span className="block text-[13px] text-slate-500">{roleLabel}</span>
          </p>
          <div className="px-3 pb-2">
            <span className="mb-1 block text-[12px] font-semibold uppercase tracking-wide text-slate-500">{t.language}</span>
            <LanguageSwitch />
          </div>
          <Link href="/equipo/perfil" role="menuitem" onClick={() => setOpen(false)} className="flex h-11 items-center rounded-[10px] px-3 text-[14px] font-medium text-slate-800 hover:bg-slate-50">
            {t.profileLink}
          </Link>
          {demo ? (
            <p className="border-t hairline px-3 pb-1 pt-2 text-[12px] leading-snug text-slate-500">{t.demoNoSignIn}</p>
          ) : (
            <button type="button" role="menuitem" onClick={signOut} className="flex h-11 w-full items-center rounded-[10px] px-3 text-left text-[14px] font-medium text-blue-700 hover:bg-slate-50">
              {t.signOut}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A red circle: how many things need the member there (ALTO's badge). */
function Badge({ n, why, className = "", ring = "ring-blue-900" }: { n: number; why: string; className?: string; ring?: string }) {
  const t = useText(SHELL_TEXT);
  if (n <= 0) return null;
  return (
    <span
      className={`console-badge inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-red-600 px-1.5 text-[12px] font-semibold leading-none text-white tabular-nums ring-2 ${ring} ${className}`}
      title={why}
      data-testid="nav-badge"
    >
      <span aria-hidden="true">{n > 99 ? "99+" : n}</span>
      <span className="sr-only">{t.needsYouCount(n, why)}</span>
    </span>
  );
}

/** The phone's «More»: every section, in a navy sheet over the bottom bar. */
function MoreSheet({
  groups,
  current,
  hrefOf,
  countOf,
  whyOf,
  viewer,
  demo,
  onClose,
  onSearch,
  onClearAll,
}: {
  groups: NavGroup[];
  current: NavGroupKey;
  hrefOf: (g: NavGroup) => string;
  countOf: (k: NavGroupKey) => number;
  whyOf: (k: NavGroupKey) => string;
  viewer: Viewer | null;
  demo: boolean;
  onClose: () => void;
  onSearch: () => void;
  onClearAll: (() => void) | null;
}) {
  const t = useText(SHELL_TEXT);
  const { locale } = useStaffLocale();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="console-fade fixed inset-0 z-40 bg-blue-900/45 md:hidden print:hidden" onClick={onClose} role="presentation">
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t.sections}
        className="console-sheet absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto overscroll-contain rounded-t-[20px] bg-blue-900 px-3 pt-2 text-white outline-none"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 14px)" }}
        onClick={(e) => e.stopPropagation()}
        data-testid="more-sheet"
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/25" />
        <div className="flex items-center gap-2.5 border-b border-white/10 px-1.5 pb-3">
          <Logo size={26} tone="dark" />
          <span className="console-word text-[12px] text-white">{t.consoleWord}</span>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="pressable flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white" aria-label={t.close}>
            <Icon name="close" size={18} />
          </button>
        </div>
        {/* The console's search, on the phone (Ctrl/Cmd+K and the top bar on a laptop). */}
        <button
          type="button"
          onClick={onSearch}
          className="pressable mt-3 flex h-12 w-full items-center gap-2.5 rounded-[12px] bg-white/10 px-3.5 text-left text-[15px] text-blue-100"
          data-testid="sheet-search"
        >
          <Icon name="search" size={20} />
          {SEARCH_TEXT[locale].placeholder}
        </button>
        {onClearAll && (
          <button
            type="button"
            onClick={onClearAll}
            className="pressable mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-[12px] border border-dashed border-white/30 text-[15px] font-semibold text-white"
            data-testid="sheet-clear-all"
          >
            <Icon name="check" size={18} />
            {t.clearAll}
          </button>
        )}
        <ul className="mt-2 flex flex-col">
          {groups.map((g) => {
            const on = g.key === current;
            const n = countOf(g.key);
            return (
              <li key={g.key}>
                <Link
                  href={hrefOf(g)}
                  onClick={onClose}
                  aria-current={on ? "page" : undefined}
                  className={`flex min-h-[60px] items-center gap-3.5 rounded-[12px] px-2.5 py-2 ${on ? "bg-amber-400/15" : "active:bg-white/5"}`}
                  data-testid={`sheet-${g.key}`}
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] ${on ? "bg-amber-400 text-blue-900" : "bg-white/10 text-blue-100"}`}>
                    <Icon name={g.icon} size={21} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2 text-[15.5px] font-semibold">
                      <span className="font-mono text-[12px] font-normal text-blue-300">{g.number}</span>
                      {t.groups[g.key]}
                    </span>
                    <span className={`block text-[13px] leading-snug ${n > 0 ? "font-semibold text-red-300" : "text-blue-200"}`}>{n > 0 ? whyOf(g.key) : t.groupLines[g.key]}</span>
                  </span>
                  {n > 0 ? <Badge n={n} why={whyOf(g.key)} ring="ring-transparent" /> : <Icon name="chevron" size={18} className="shrink-0 text-blue-300" />}
                </Link>
              </li>
            );
          })}
        </ul>
        {viewer && (
          <div className="mt-2 border-t border-white/10 px-1.5 pt-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[14px] font-semibold text-blue-900">{initials(viewer.name)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{viewer.name}</span>
                <span className="block truncate text-[13px] text-blue-200">{ROLE_LABELS[locale][viewer.role]}</span>
              </span>
              {!demo && (
                <button type="button" onClick={signOut} className="pressable h-11 shrink-0 rounded-[10px] border border-white/25 px-3 text-[14px] font-semibold text-white">
                  {t.signOut}
                </button>
              )}
            </div>
            <LanguageSwitch tone="dark" className="mt-3" />
            <Link href="/equipo/perfil" onClick={onClose} className="mt-1 flex min-h-11 items-center gap-2 text-[14px] font-medium text-blue-100">
              <Icon name="person" size={17} />
              {t.profileLink}
            </Link>
            {demo && <p className="pb-1 text-[12.5px] leading-snug text-blue-200">{t.demoNoSignIn}</p>}
          </div>
        )}
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
  const [alti, setAlti] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [search, setSearch] = useState(false);
  // null: the default (folded below 1280 px); "full" / "min": the member's choice in this browser.
  const [fold, setFold] = useState<"full" | "min" | null>(null);
  const [wide, setWide] = useState(true);
  const badges = useNavBadges(viewer?.handle ?? null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(FOLD_KEY);
      if (saved === "full" || saved === "min") setFold(saved);
    } catch {
      // Private mode: the default.
    }
    const query = window.matchMedia("(min-width: 1280px)");
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  // Like ALTO's, the menu is folded by default on Lead Manager too, so the conversation has room.
  const folded = fold === "min" || (fold === null && (!wide || groupOfPath(pathname).key === "leads"));
  const toggleFold = () => {
    const next = folded ? "full" : "min";
    setFold(next);
    try {
      window.localStorage.setItem(FOLD_KEY, next);
    } catch {
      // Remembered for this visit only.
    }
  };

  // Ctrl+K / Cmd+K opens the search from any screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isSearchShortcut(e)) return;
      e.preventDefault();
      setSheet(false);
      setAlti(false);
      setSearch(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A new page closes the sheet, Alti's panel and the search.
  useEffect(() => {
    setSheet(false);
    setAlti(false);
    setSearch(false);
  }, [pathname]);

  const allowed = (n: NavItem) => !n.needs || can(viewer?.role, n.needs);
  const allowedHrefs = new Set([...PRIMARY_NAV, ...MORE_NAV].filter(allowed).map((n) => n.href));
  const groups = NAV_GROUPS.filter((g) => g.hrefs.some((h) => allowedHrefs.has(h)));
  const current = groupOfPath(pathname);
  const hrefOf = (g: NavGroup) => g.hrefs.find((h) => allowedHrefs.has(h)) ?? g.hrefs[0]!;
  const subs = current.hrefs.filter((h) => allowedHrefs.has(h)).map((h) => NAV_BY_HREF.get(h)!).filter(Boolean);
  const litSub = [...subs].sort((a, b) => b.href.length - a.href.length).find((n) => navMatches(n.href, pathname))?.href ?? null;
  const phoneMain = phoneMainGroups(groups, allowedHrefs);
  const moreActive = !phoneMain.some((g) => g.key === current.key);

  const countOf = (k: NavGroupKey) => (groups.some((g) => g.key === k) ? badges.shown(k) : 0);
  const whyOf = (k: NavGroupKey) => {
    const n = countOf(k);
    const why = t.why as Partial<Record<NavGroupKey, (n: number) => string>>;
    return why[k]?.(n) ?? "";
  };
  const anyBadge = groups.some((g) => countOf(g.key) > 0);
  const moreBadge = groups.some((g) => !phoneMain.includes(g) && countOf(g.key) > 0);
  const sectionName = t.groups[current.key];
  const viewerCan = (c: Capability) => can(viewer?.role, c);

  const viewAs = (role: (typeof STAFF_ROLES)[number]) => {
    if (demoViewAs(role)) {
      resetBadges();
      window.dispatchEvent(new Event(VIEWER_CHANGED));
    }
  };

  const brandWord = (
    <span className="console-word flex items-center gap-2 text-[12.5px] text-white">
      <span aria-hidden="true" className="h-0.5 w-[18px] rounded-full bg-amber-400" />
      {t.consoleWord}
    </span>
  );

  return (
    // On paper there is no frame: the menus, the header and the footer are
    // screen-only, so a printed page (see /equipo/imprimir) carries nothing but its content.
    <div className="console min-h-dvh md:flex print:block print:min-h-0">
      {/* The side menu (768 px and wider): navy, numbered groups, Alti and the member at its foot. */}
      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col overflow-y-auto overscroll-contain bg-blue-900 text-white md:flex print:hidden ${folded ? "w-[76px] items-center px-2 py-3" : "w-[252px] px-3 py-4"}`}
        data-testid="side-menu"
        data-folded={folded ? "yes" : "no"}
      >
        <button
          type="button"
          onClick={toggleFold}
          className={`pressable flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-blue-200 hover:bg-white/10 hover:text-white ${folded ? "" : "self-end"}`}
          aria-label={folded ? t.showMenu : t.foldMenu}
          aria-expanded={!folded}
          title={folded ? t.showMenu : t.foldMenu}
          data-testid="side-toggle"
        >
          <Icon name="chevron" size={18} className={folded ? "" : "rotate-180"} />
        </button>
        <Link href="/equipo" aria-label={t.homeAria} className={`flex flex-col gap-2 border-b border-white/10 ${folded ? "items-center pb-3 pt-1" : "px-2 pb-4 pt-0.5"}`}>
          {folded ? <Logo variant="check" size={30} /> : <Logo size={30} tone="dark" priority />}
          {!folded && brandWord}
          {!folded && <span className="text-[11.5px] leading-snug text-blue-200">{t.consoleLine}</span>}
        </Link>

        <nav className={`mt-3 flex flex-col gap-0.5 ${folded ? "items-center" : ""}`} aria-label={t.navAria} data-testid="side-nav">
          {ready &&
            groups.map((g) => {
              const on = g.key === current.key;
              const n = countOf(g.key);
              return (
                <Link
                  key={g.key}
                  href={hrefOf(g)}
                  aria-current={on ? "page" : undefined}
                  title={folded ? t.groups[g.key] : undefined}
                  aria-label={folded ? (n > 0 ? `${t.groups[g.key]}, ${t.needsYouCount(n, whyOf(g.key))}` : t.groups[g.key]) : undefined}
                  className={`console-nav relative flex items-center rounded-[10px] text-[14.5px] ${
                    folded ? "h-11 w-12 justify-center" : "min-h-11 gap-2.5 px-2.5 py-2"
                  } ${on ? "bg-amber-400/15 font-semibold text-white shadow-[inset_3px_0_0_var(--color-amber-400)]" : "text-blue-100 hover:bg-white/5 hover:text-white"}`}
                  data-testid={`nav-${g.key}`}
                >
                  {!folded && <span className={`w-4 shrink-0 font-mono text-[11px] ${on ? "text-amber-300" : "text-blue-300"}`} data-on-navy>{g.number}</span>}
                  <Icon name={g.icon} size={19} className="shrink-0" />
                  {!folded && <span className="min-w-0 flex-1 leading-snug">{t.groups[g.key]}</span>}
                  {n > 0 && <Badge n={n} why={whyOf(g.key)} className={folded ? "absolute -right-1 -top-1 h-[18px] min-w-[18px] px-1 text-[10.5px]" : ""} />}
                </Link>
              );
            })}
        </nav>
        {anyBadge && (
          <button
            type="button"
            onClick={() => badges.clear("all")}
            className={`pressable mt-2 flex items-center gap-2 rounded-[10px] border border-dashed border-white/25 text-[13px] font-semibold text-blue-100 hover:border-white/50 hover:text-white ${folded ? "h-11 w-12 justify-center" : "min-h-11 px-3"}`}
            title={t.clearAll}
            aria-label={folded ? t.clearAll : undefined}
            data-testid="badge-clear-all"
          >
            <Icon name="check" size={16} />
            {!folded && t.clearAll}
          </button>
        )}
        <div className="min-h-4 flex-1" />

        {/* Alti, the AI assistant, at the foot of the menu: the same panel as «Ask Alti» on the top bar. */}
        {ready && (
          <button
            type="button"
            onClick={() => setAlti(true)}
            className={`pressable mb-2 flex items-center gap-3 rounded-[14px] text-left hover:bg-white/10 ${folded ? "h-14 w-14 justify-center" : "border border-white/10 bg-white/5 px-3 py-2.5"}`}
            aria-label={t.askAltiAria(sectionName)}
            data-testid="side-alti"
          >
            <CharacterAvatar character="assistant" size={folded ? 40 : 44} tone="ivory" decorative />
            {!folded && (
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold leading-tight text-white">{aiByline(locale)}</span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-blue-200">{t.askAlti}</span>
              </span>
            )}
          </button>
        )}
        {viewer && (
          <div className={`border-t border-white/10 pt-2 ${folded ? "" : "w-full"}`}>
            <MemberMenu viewer={viewer} demo={demo} folded={folded} />
          </div>
        )}
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur-xl print:hidden">
          <div className="flex h-16 items-center gap-2 px-4 md:gap-3 md:px-7" data-testid="staff-topbar">
            <Link href="/equipo" aria-label={t.homeAria} className="flex h-11 w-9 shrink-0 items-center md:hidden">
              <Logo variant="check" size={26} />
            </Link>
            <p className="console-title min-w-0 truncate" data-testid="section-title">
              <span className="hidden md:inline">{sectionName}</span>
              <span className="md:hidden">{t.groupShort[current.key]}</span>
            </p>
            <span className="flex-1" />
            {countOf(current.key) > 0 && (
              <button
                type="button"
                onClick={() => badges.clear(current.key)}
                className="pressable flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 text-[13.5px] font-semibold text-slate-700 hover:border-red-600 hover:text-red-700 md:h-10"
                title={t.clearTitle(whyOf(current.key))}
                data-testid="badge-clear"
              >
                <Icon name="check" size={15} />
                {t.clear}
                <span className="hidden tabular-nums lg:inline">{countOf(current.key)}</span>
              </button>
            )}
            {ready && <SearchButton onOpen={() => setSearch(true)} />}
            {ready && (
              <button
                type="button"
                onClick={() => setSearch(true)}
                className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 md:hidden"
                aria-label={SEARCH_TEXT[locale].open}
                data-testid="search-button-phone"
              >
                <Icon name="search" size={21} />
              </button>
            )}
            {demo && (
              <span className="hidden shrink-0 rounded-md bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-blue-900 sm:inline" title={t.demoPillTitle}>
                {t.demoPill}
              </span>
            )}
            {ready && <AskAltiButton label={t.askAlti} aria={t.askAltiAria(sectionName)} open={alti} onOpen={() => setAlti(true)} />}
          </div>

          <Suspense fallback={null}>
            <TourBar />
          </Suspense>
        </header>

        {/* The demo's role switcher scrolls away with the page, so on a phone the sticky bar stays one line. */}
        {demo && viewer && (
          <div className="border-b border-amber-200/70 bg-amber-50 print:hidden" data-testid="view-as">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-1.5 md:px-7">
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

        {/* A section with two or more pages: its sub-tabs (ALTO's), scrolling sideways on a phone. */}
        {ready && subs.length > 1 && (
          <nav className="print:hidden" aria-label={t.subTabsAria} data-testid="subtabs">
            <ul className="flex gap-1.5 overflow-x-auto px-4 pt-3 [scrollbar-width:none] md:flex-wrap md:px-7 md:pt-4 [&::-webkit-scrollbar]:hidden">
              {subs.map((n) => {
                const on = n.href === litSub;
                return (
                  <li key={n.href} className="shrink-0">
                    <Link
                      href={n.href}
                      aria-current={on ? "page" : undefined}
                      className={`pressable flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-[13.5px] font-semibold md:h-9 ${
                        on ? "border-blue-900 bg-blue-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-amber-500 hover:text-slate-900"
                      }`}
                      data-testid={`subtab-${n.label}`}
                    >
                      <Icon name={n.icon} size={15} />
                      {t.nav[n.label]}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        <div className="console-page px-4 pb-28 pt-5 md:px-7 md:pb-12 md:pt-6 print:m-0 print:max-w-none print:p-0">{children}</div>

        {demo && (
          <footer className="px-4 pb-28 md:px-7 md:pb-10 print:hidden">
            <p className="border-t hairline pt-4 text-xs leading-relaxed text-slate-500">
              {t.demoFooter}{" "}
              <button
                type="button"
                onClick={async () => {
                  resetDemo();
                  resetDemoAnswers();
                  resetDemoPreferences();
                  resetDemoLeads();
                  resetDemoControl();
                  // The Video Studio's board and the files kept in this browser.
                  await resetDemoVideos().catch(() => undefined);
                  window.location.reload();
                }}
                className="inline-flex min-h-11 items-center font-medium text-blue-700 underline-offset-2 hover:underline md:min-h-0"
              >
                {t.resetDemo}
              </button>
            </p>
          </footer>
        )}
      </div>

      {/* The phone's bottom bar: navy, four sections and «More» (ALTO's). */}
      {ready && (
        <nav
          className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-blue-900 shadow-[0_-6px_20px_rgba(18,33,58,0.12)] md:hidden print:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          aria-label={t.navAria}
          data-testid="bottom-bar"
        >
          <div className="mx-auto grid max-w-md grid-cols-5 px-1">
            {phoneMain.map((g) => {
              const on = g.key === current.key && !sheet;
              const n = countOf(g.key);
              return (
                <Link
                  key={g.key}
                  href={hrefOf(g)}
                  aria-current={g.key === current.key ? "page" : undefined}
                  className={`relative flex min-h-[60px] min-w-0 flex-col items-center justify-center gap-1 px-0.5 pb-1.5 pt-2 text-[11px] font-semibold ${on ? "text-white" : "text-blue-200"}`}
                  data-testid={`tab-${g.key}`}
                >
                  {on && <span aria-hidden="true" className="absolute inset-x-[26%] top-0 h-[3px] rounded-b-[3px] bg-amber-400" />}
                  <span className="relative">
                    <span className={`block ${on ? "text-amber-400" : ""}`} data-on-navy>
                      <Icon name={g.icon} size={23} strokeWidth={on ? 2 : 1.7} />
                    </span>
                    {n > 0 && <Badge n={n} why={whyOf(g.key)} className="absolute -right-3 -top-2 h-[18px] min-w-[18px] px-1 text-[10.5px]" />}
                  </span>
                  <span className="max-w-full truncate">{t.groupShort[g.key]}</span>
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => setSheet(!sheet)}
              aria-expanded={sheet}
              aria-haspopup="dialog"
              className={`relative flex min-h-[60px] min-w-0 flex-col items-center justify-center gap-1 px-0.5 pb-1.5 pt-2 text-[11px] font-semibold ${moreActive || sheet ? "text-white" : "text-blue-200"}`}
              data-testid="tab-more"
            >
              {(moreActive || sheet) && <span aria-hidden="true" className="absolute inset-x-[26%] top-0 h-[3px] rounded-b-[3px] bg-amber-400" />}
              <span className="relative">
                <span className={`block ${moreActive || sheet ? "text-amber-400" : ""}`} data-on-navy>
                  <Icon name="grid" size={23} strokeWidth={moreActive || sheet ? 2 : 1.7} />
                </span>
                {moreBadge && <span className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-red-600 ring-2 ring-blue-900" title={t.moreNeedsYou} />}
              </span>
              <span>{t.more}</span>
              {moreBadge && <span className="sr-only">{t.moreNeedsYou}</span>}
            </button>
          </div>
        </nav>
      )}
      {sheet && (
        <MoreSheet
          groups={groups}
          current={current.key}
          hrefOf={hrefOf}
          countOf={countOf}
          whyOf={whyOf}
          viewer={viewer}
          demo={demo}
          onClose={() => setSheet(false)}
          onSearch={() => {
            setSheet(false);
            setSearch(true);
          }}
          onClearAll={anyBadge ? () => badges.clear("all") : null}
        />
      )}
      {search && <SearchDialog viewer={viewer} onClose={() => setSearch(false)} />}
      {alti && <AskAltiPanel pathname={pathname} group={current.key} sectionName={sectionName} can={viewerCan} onClose={() => setAlti(false)} />}
      {ready && viewer && <BadgeProbe />}
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
