"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { helpForPath, playbookFor } from "@/lib/staff/playbook";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";
import { PlaybookCard } from "@/components/staff/PlaybookCard";

// «¿Qué hago aquí?»: the help for the screen you are on, from one place
// (src/lib/staff/playbook.ts: SCREEN_HELP), with the «Cómo se resuelve»
// cards that matter there. A panel on the right on a laptop, a sheet from
// the bottom on a phone.

export default function HelpPanel({ pathname, onClose }: { pathname: string; onClose: () => void }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const help = helpForPath(pathname, locale);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 bg-slate-900/40" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="help-title">
      <div
        ref={panel}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-slate-50 px-4 pb-8 pt-3 outline-none md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[26rem] md:rounded-none md:px-6 md:pt-5"
        data-testid="help-panel"
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-300 md:hidden" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{t("¿Qué hago aquí?", "What do I do here?")}</p>
            <h2 id="help-title" className="mt-0.5 text-[20px] font-semibold leading-tight text-slate-900">
              {help.title}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-200" aria-label={t("Cerrar", "Close")}>
            <Icon name="close" size={20} />
          </button>
        </div>
        <p className="mt-2 text-[15px] leading-snug text-slate-700">{help.what}</p>
        <ol className="mt-3 space-y-1.5">
          {help.steps.map((step, i) => (
            <li key={i} className="flex gap-2.5 text-[14px] leading-snug text-slate-700">
              <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[12px] font-semibold text-slate-700 tabular-nums">{i + 1}</span>
              <span className="min-w-0">{step}</span>
            </li>
          ))}
        </ol>

        {help.playbooks.length > 0 && (
          <div className="mt-5">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{t("Cómo se resuelve cada aviso", "How to handle each notice")}</p>
            <div className="mt-2 space-y-2">
              {help.playbooks.length <= 5
                ? help.playbooks.map((kind) => <PlaybookCard key={kind} kind={kind} />)
                : help.playbooks.map((kind) => (
                    <details key={kind} className="group rounded-2xl border border-blue-100 bg-white">
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
          {t("Bienvenida: las pantallas, las reglas y el recorrido de 5 minutos", "Welcome: the screens, the rules and the 5-minute tour")}
        </Link>
      </div>
    </div>,
    document.body,
  );
}
