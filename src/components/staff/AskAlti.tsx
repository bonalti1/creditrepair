"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { aiByline } from "@/lib/brand";
import { ALTI_HELP_TEXT, altiJobs, searchPlaybook } from "@/lib/staff/altiHelp";
import type { NavGroupKey } from "@/lib/staff/nav";
import type { Capability } from "@/lib/staff/permissions";
import { helpForPath, playbookFor } from "@/lib/staff/playbook";
import { useStaffLocale, useText } from "@/lib/staff/i18n/StaffLocale";
import { CharacterAvatar, CharacterFigure } from "@/components/Character";
import Icon from "@/components/Icon";
import { PlaybookCard } from "@/components/staff/PlaybookCard";

// «Ask Alti» (ALTO Control's TabBot, Credalti's way): a button in the top bar
// of every section opens Alti's panel for that section, on the right on a
// laptop and as a sheet from the bottom on a phone. Alti is AI and the panel
// says so in words ("Alti · AI assistant"). It has three tabs (the rules are
// in src/lib/staff/altiHelp.ts): the screen's help (what «What do I do here?»
// opened before), what Alti already does here, and a search of the team's
// playbook. Nothing in it writes or sends a message.

type Tab = "screen" | "jobs" | "search";

/** The button in the top bar. */
export function AskAltiButton({ label, aria, onOpen, open }: { label: string; aria: string; onOpen: () => void; open: boolean }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={aria}
      title={aria}
      className="pressable flex h-11 shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white pl-1 pr-1 text-[13.5px] font-semibold text-blue-900 hover:border-amber-500 md:h-10 md:pr-3.5"
      data-testid="ask-alti-open"
    >
      <CharacterAvatar character="assistant" size={32} tone="navy" decorative />
      <span className="hidden whitespace-nowrap md:inline">{label}</span>
    </button>
  );
}

function ScreenTab({ pathname, onClose }: { pathname: string; onClose: () => void }) {
  const { locale } = useStaffLocale();
  const tx = useText(ALTI_HELP_TEXT);
  const help = helpForPath(pathname, locale);
  return (
    <div data-testid="help-panel">
      <p className="console-label">{locale === "es" ? "¿Qué hago aquí?" : "What do I do here?"}</p>
      <h3 id="alti-screen-title" className="mt-1 font-display text-[19px] font-semibold leading-tight text-slate-900">
        {help.title}
      </h3>
      <p className="mt-2 text-[15px] leading-snug text-slate-700">{help.what}</p>
      <ol className="mt-3 space-y-1.5">
        {help.steps.map((step, i) => (
          <li key={i} className="flex gap-2.5 text-[14px] leading-snug text-slate-700">
            <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[12px] font-semibold text-blue-700 tabular-nums">{i + 1}</span>
            <span className="min-w-0">{step}</span>
          </li>
        ))}
      </ol>
      {help.playbooks.length > 0 && (
        <div className="mt-5">
          <p className="console-label">{locale === "es" ? "Cómo se resuelve cada aviso" : "How to handle each notice"}</p>
          <div className="mt-2 space-y-2">
            {help.playbooks.length <= 5
              ? help.playbooks.map((kind) => <PlaybookCard key={kind} kind={kind} />)
              : help.playbooks.map((kind) => (
                  <details key={kind} className="group rounded-[14px] border border-slate-200 bg-white">
                    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-[14.5px] font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
                      {playbookFor(kind, locale).title}
                      <Icon name="chevron" size={16} className="shrink-0 rotate-90 text-slate-400 group-open:-rotate-90" />
                    </summary>
                    <div className="px-1 pb-1">
                      <PlaybookCard kind={kind} title={false} />
                    </div>
                  </details>
                ))}
          </div>
        </div>
      )}
      <Link href="/equipo/bienvenida" onClick={onClose} className="mt-5 flex min-h-11 items-center gap-2 text-[14px] font-medium text-blue-700">
        <Icon name="book" size={16} />
        {tx.welcome}
      </Link>
    </div>
  );
}

function JobsTab({ group, can, onClose }: { group: NavGroupKey; can: (c: Capability) => boolean; onClose: () => void }) {
  const tx = useText(ALTI_HELP_TEXT);
  const jobs = altiJobs(group, can);
  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center px-2 py-6 text-center" data-testid="alti-no-jobs">
        <CharacterFigure character="assistant" pose="thinking" height={150} decorative />
        <p className="mt-3 max-w-xs text-[14.5px] leading-snug text-slate-600">{tx.noJobs}</p>
      </div>
    );
  }
  return (
    <div className="space-y-2.5" data-testid="alti-jobs">
      <p className="text-[13.5px] leading-snug text-slate-600">{tx.jobsIntro}</p>
      {jobs.map((job) => {
        const text = tx.jobs[job.id as keyof typeof tx.jobs];
        return (
          <div key={job.id} className="flex flex-wrap items-start gap-3 rounded-[14px] border border-slate-200 bg-white px-3.5 py-3" data-testid="alti-job" data-job={job.id}>
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-blue-50 text-blue-700">
              <Icon name={job.icon} size={18} />
            </span>
            <div className="min-w-0 flex-1 basis-[calc(100%-3.5rem)] sm:basis-0">
              <p className="text-[14.5px] font-semibold leading-snug text-slate-900">{text.title}</p>
              <p className="mt-0.5 text-[13px] leading-snug text-slate-600">{text.desc}</p>
              <span className="mt-1.5 inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-[11.5px] font-semibold text-slate-700">{tx.gates[job.gate]}</span>
            </div>
            <Link
              href={job.href}
              onClick={onClose}
              className="pressable ml-12 inline-flex h-11 shrink-0 items-center gap-1 self-center rounded-full border sm:ml-0 border-slate-300 bg-white px-3.5 text-[13.5px] font-semibold text-blue-900 hover:border-amber-500 md:h-9"
            >
              {tx.open}
              <Icon name="chevron" size={14} />
            </Link>
          </div>
        );
      })}
    </div>
  );
}

function SearchTab({ pathname }: { pathname: string }) {
  const { locale } = useStaffLocale();
  const tx = useText(ALTI_HELP_TEXT);
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchPlaybook(query, locale), [query, locale]);
  const here = helpForPath(pathname, locale).playbooks.slice(0, 3);
  return (
    <div data-testid="alti-search">
      <label className="block">
        <span className="sr-only">{tx.searchLabel}</span>
        <span className="flex h-12 items-center gap-2 rounded-[12px] border border-slate-300 bg-white px-3 focus-within:border-amber-500 focus-within:ring-3 focus-within:ring-amber-400/30">
          <Icon name="search" size={18} className="shrink-0 text-slate-500" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tx.searchPlaceholder}
            className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-slate-900 outline-none placeholder:text-slate-400 md:text-[15px]"
            data-testid="alti-search-input"
          />
        </span>
      </label>
      <p className="mt-2 text-[12.5px] leading-snug text-slate-500">{tx.searchNote}</p>
      {query.trim() === "" ? (
        here.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="console-label">{tx.suggested}</p>
            {here.map((kind) => (
              <PlaybookCard key={kind} kind={kind} />
            ))}
          </div>
        )
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center px-2 py-5 text-center">
          <CharacterFigure character="assistant" pose="thinking" height={120} decorative />
          <p className="mt-3 max-w-xs text-[14px] leading-snug text-slate-600" role="status">
            {tx.noResults}
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2" aria-live="polite">
          {results.map((hit) => (
            <li key={hit.id} className="rounded-[14px] border border-slate-200 bg-white px-4 py-3" data-testid="alti-search-hit">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500">{hit.kind === "card" ? tx.fromPlaybook : hit.kind === "screen" ? tx.fromScreen : tx.fromRules}</p>
              <p className="mt-0.5 text-[14.5px] font-semibold leading-snug text-slate-900">{hit.title}</p>
              {hit.lines.length > 0 && (
                <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[13.5px] leading-snug text-slate-700">
                  {hit.lines.slice(0, 5).map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ol>
              )}
              {hit.doneWhen && (
                <p className="mt-1.5 text-[13px] leading-snug text-slate-600">
                  <span className="font-semibold text-slate-800">{tx.doneWhen}</span> {hit.doneWhen}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Alti's panel for the section the member is in. */
export function AskAltiPanel({
  pathname,
  group,
  sectionName,
  can,
  onClose,
}: {
  pathname: string;
  group: NavGroupKey;
  sectionName: string;
  can: (c: Capability) => boolean;
  onClose: () => void;
}) {
  const { locale } = useStaffLocale();
  const tx = useText(ALTI_HELP_TEXT);
  const [tab, setTab] = useState<Tab>("screen");
  const panel = useRef<HTMLDivElement>(null);
  const jobsCount = altiJobs(group, can).length;

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

  const tabs: Array<[Tab, string]> = [
    ["screen", tx.tabs.screen],
    ["jobs", jobsCount > 0 ? `${tx.tabs.jobs} · ${jobsCount}` : tx.tabs.jobs],
    ["search", tx.tabs.search],
  ];

  return createPortal(
    <div className="fixed inset-0 z-50 bg-blue-900/25 print:hidden" onClick={onClose} role="presentation">
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-alti-title"
        onClick={(e) => e.stopPropagation()}
        className="console-drawer absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-[20px] bg-slate-50 outline-none md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[30rem] md:rounded-none"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        data-testid="ask-alti"
        data-group={group}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-slate-300 md:hidden" />
        <div className="flex items-start gap-3 border-b border-slate-200 bg-white px-4 pb-3 pt-3 md:px-5 md:pt-5">
          <CharacterAvatar character="assistant" size={48} tone="navy" ring decorative />
          <div className="min-w-0 flex-1">
            <p id="ask-alti-title" className="text-[16px] font-semibold leading-tight text-slate-900" data-testid="ask-alti-byline">
              {aiByline(locale)}
            </p>
            <p className="mt-0.5 text-[13px] leading-snug text-slate-500">{tx.sectionHelp(sectionName)}</p>
          </div>
          <button type="button" onClick={onClose} className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100" aria-label={locale === "es" ? "Cerrar" : "Close"}>
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="border-b border-slate-200 bg-white px-4 md:px-5">
          <p className="pb-3 text-[13.5px] leading-snug text-slate-600">{tx.intro}</p>
          <div className="-mb-px grid grid-cols-3 gap-1" role="tablist" aria-label={aiByline(locale)}>
            {tabs.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`alti-tab-${key}`}
                aria-selected={tab === key}
                aria-controls="alti-tabpanel"
                onClick={() => setTab(key)}
                className={`flex min-h-11 items-center justify-center border-b-[3px] px-1.5 py-1 text-center text-[13px] font-semibold leading-tight ${
                  tab === key ? "border-amber-400 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
                data-testid={`alti-tab-${key}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div id="alti-tabpanel" role="tabpanel" aria-labelledby={`alti-tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5">
          {tab === "screen" && <ScreenTab pathname={pathname} onClose={onClose} />}
          {tab === "jobs" && <JobsTab group={group} can={can} onClose={onClose} />}
          {tab === "search" && <SearchTab pathname={pathname} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}
