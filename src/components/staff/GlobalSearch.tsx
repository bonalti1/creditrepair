"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getPartnerData } from "@/lib/partners/data";
import { getStaffData } from "@/lib/staff/data";
import { can, type Viewer } from "@/lib/staff/permissions";
import { SEARCH_KIND_LABEL, searchStaff, type SearchKind, type SearchSources } from "@/lib/staff/search";
import { useStaffLocale } from "@/lib/staff/i18n/StaffLocale";
import Icon, { type IconName } from "@/components/Icon";

// The console's search: a dialog over the page, opened from the header's box,
// with Ctrl+K (Cmd+K on a Mac), or from «Buscar» in the phone's «Más» sheet.
// Up and down move, Enter goes, Escape closes. What it finds and for whom is
// lib/staff/search.ts; the clients come from the same list (and, with a
// database, the same row level security) as the clients screen.

const TEXT = {
  en: {
    open: "Search",
    placeholder: "Search pages, clients, partners, letters, actions…",
    none: (q: string) => `Nothing found for “${q}”.`,
    hint: "↑ ↓ to move · Enter to go · Esc to close",
    start: "Start here",
    loading: "Loading…",
    close: "Close search",
  },
  es: {
    open: "Buscar",
    placeholder: "Busca páginas, clientes, socios, cartas, acciones…",
    none: (q: string) => `No encontramos nada para «${q}».`,
    hint: "↑ ↓ para moverte · Enter para ir · Esc para cerrar",
    start: "Para empezar",
    loading: "Cargando…",
    close: "Cerrar la búsqueda",
  },
} as const;

const KIND_ICON: Record<SearchKind, IconName> = { action: "sparkle", page: "grid", client: "person", partner: "link", letter: "clipboard" };

/** True for Ctrl+K / Cmd+K. */
export function isSearchShortcut(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K");
}

export function SearchDialog({ viewer, onClose }: { viewer: Viewer | null; onClose: () => void }) {
  const { locale } = useStaffLocale();
  const c = TEXT[locale];
  const router = useRouter();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [sources, setSources] = useState<Omit<SearchSources, "viewer" | "locale"> | null>(null);

  useEffect(() => {
    input.current?.focus();
    let cancelled = false;
    const load = async () => {
      const [clients, partners] = await Promise.all([
        getStaffData()
          .listClients()
          .catch(() => []),
        can(viewer?.role, "partners.view")
          ? getPartnerData()
              .load()
              .then((book) => book.partners)
              .catch(() => [])
          : Promise.resolve([]),
      ]);
      if (!cancelled) setSources({ clients, partners });
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [viewer?.role]);

  const results = useMemo(
    () => searchStaff(query, { viewer, locale, clients: sources?.clients ?? [], partners: sources?.partners ?? [] }),
    [query, viewer, locale, sources],
  );
  useEffect(() => setActive(0), [query]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (results.length ? (a + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      go(results[active].href);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 px-3 pt-[8vh] sm:pt-[12vh] print:hidden" onMouseDown={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={c.open}
        className="mx-auto w-full max-w-xl overflow-hidden rounded-3xl bg-white shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
        data-testid="search-dialog"
      >
        <div className="flex items-center gap-2 border-b hairline px-4">
          <Icon name="search" size={20} className="shrink-0 text-slate-400" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={c.placeholder}
            aria-label={c.open}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={results[active] ? `${id}-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="h-14 min-w-0 flex-1 bg-transparent text-[16px] text-slate-900 outline-none placeholder:text-slate-400"
            data-testid="search-input"
          />
          <button type="button" onClick={onClose} className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" aria-label={c.close}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <ul id={`${id}-list`} role="listbox" className="max-h-[60vh] overflow-y-auto p-2" data-testid="search-results">
          {!query.trim() && <li className="px-3 pb-1 pt-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-400">{c.start}</li>}
          {query.trim() && results.length === 0 && <li className="px-3 py-4 text-[14px] text-slate-500">{sources ? c.none(query.trim()) : c.loading}</li>}
          {results.map((r, i) => (
            <li
              key={r.id}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r.href)}
              className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 ${i === active ? "bg-blue-50" : ""}`}
              data-testid="search-result"
              data-kind={r.kind}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${i === active ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-600"}`}>
                <Icon name={KIND_ICON[r.kind]} size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium text-slate-900">{r.label}</span>
                {r.detail && <span className="block truncate text-[12.5px] text-slate-500">{r.detail}</span>}
              </span>
              <span className="shrink-0 text-[11.5px] font-semibold uppercase tracking-wide text-slate-400">{SEARCH_KIND_LABEL[locale][r.kind]}</span>
            </li>
          ))}
        </ul>
        <p className="hidden border-t hairline px-4 py-2 text-[12px] text-slate-500 md:block">{c.hint}</p>
      </div>
    </div>
  );
}

/** The header's search box (from 768 px): it opens the dialog. */
export function SearchButton({ onOpen }: { onOpen: () => void }) {
  const { locale } = useStaffLocale();
  const c = TEXT[locale];
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="pressable hidden h-10 w-10 items-center justify-center gap-2 rounded-full bg-slate-100 text-left text-[14px] text-slate-500 hover:bg-slate-200 md:flex"
      aria-label={c.open}
      aria-keyshortcuts="Control+K Meta+K"
      data-testid="search-button"
    >
      <Icon name="search" size={16} className="shrink-0" />
      <span className="sr-only">{c.open}</span>
      <kbd className="hidden shrink-0 rounded-md bg-white px-1.5 py-0.5 font-sans text-[11px] font-semibold text-slate-500 shadow-sm">{mac ? "⌘K" : "Ctrl K"}</kbd>
    </button>
  );
}

export const SEARCH_TEXT = TEXT;
