"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { HOUSE_RULE_TEXT, NEW_HIRE_CHECKLISTS } from "@/lib/staff/playbook";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import type { Viewer } from "@/lib/staff/permissions";
import { usePreferences } from "@/lib/staff/usePreferences";
import Icon from "@/components/Icon";

// The first-day checklist on the home screen: what each screen does, a
// 5-minute tour of an example client, and the rules. It shows until the
// member closes it (staff_preferences.checklist_dismissed_at; the demo keeps
// it in this browser). What they ticked is kept in this browser.

const DONE_KEY = "bonalti.staff.checklist.v1";
export const TOUR_DONE_KEY = "bonalti.staff.tourDone";

function readDone(handle: string): string[] {
  try {
    const all = JSON.parse(window.localStorage.getItem(DONE_KEY) ?? "{}") as Record<string, string[]>;
    const done = all[handle] ?? [];
    if (window.localStorage.getItem(`${TOUR_DONE_KEY}:${handle}`)) done.push("tour");
    return [...new Set(done)];
  } catch {
    return [];
  }
}

function writeDone(handle: string, done: string[]): void {
  try {
    const all = JSON.parse(window.localStorage.getItem(DONE_KEY) ?? "{}") as Record<string, string[]>;
    window.localStorage.setItem(DONE_KEY, JSON.stringify({ ...all, [handle]: done }));
  } catch {
    // This visit only.
  }
}

export default function NewHireChecklist({ viewer }: { viewer: Viewer | null }) {
  const { prefs, ready, update } = usePreferences(viewer);
  const { locale } = useStaffLocale();
  const t = useTx();
  const NEW_HIRE_CHECKLIST = NEW_HIRE_CHECKLISTS[locale];
  const HOUSE_RULES = HOUSE_RULE_TEXT[locale];
  const [done, setDone] = useState<string[]>([]);
  const handle = viewer?.handle ?? "";

  useEffect(() => {
    if (handle) setDone(readDone(handle));
  }, [handle]);

  if (!viewer || !ready || prefs.checklistDismissedAt) return null;
  const isDone = (id: string) => done.includes(id) || (id === "summary" && prefs.digestEnabled);
  const toggle = (id: string) => {
    const next = done.includes(id) ? done.filter((d) => d !== id) : [...done, id];
    setDone(next);
    writeDone(handle, next);
  };
  const finished = NEW_HIRE_CHECKLIST.filter((item) => isDone(item.id)).length;

  return (
    <section className="card mt-5 overflow-hidden" aria-labelledby="primer-dia" data-testid="new-hire-checklist">
      <div className="flex flex-col gap-3 bg-blue-50/60 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-blue-700">
            {t(`Tu primer día · ${finished} de ${NEW_HIRE_CHECKLIST.length}`, `Your first day · ${finished} of ${NEW_HIRE_CHECKLIST.length}`)}
          </p>
          <h2 id="primer-dia" className="mt-0.5 text-[19px] font-semibold leading-snug text-slate-900">
            {t(`Bienvenida, ${viewer.name.split(" ")[0]}. Empieza por aquí.`, `Welcome, ${viewer.name.split(" ")[0]}. Start here.`)}
          </h2>
          <p className="mt-1 text-[14px] leading-snug text-slate-600">
            {t("Unos 15 minutos. Cuando termines, ciérrala; la bienvenida sigue en «Más».", "About 15 minutes. When you're done, close it; the welcome page stays under “More”.")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void update({ checklistDismissed: true })}
          className="pressable inline-flex h-11 shrink-0 items-center justify-center self-start rounded-full bg-white px-4 text-[14px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
          data-testid="checklist-dismiss"
        >
          {finished === NEW_HIRE_CHECKLIST.length ? t("Listo, cerrar", "Done, close") : t("Cerrar la lista", "Close the list")}
        </button>
      </div>
      <ul className="grid md:grid-cols-2 md:[&>li:nth-child(odd)]:border-r">
        {NEW_HIRE_CHECKLIST.map((item) => (
          <li key={item.id} className="flex items-center gap-3 border-t hairline px-4 py-1.5">
            <button
              type="button"
              onClick={() => toggle(item.id)}
              aria-pressed={isDone(item.id)}
              aria-label={`${isDone(item.id) ? t("Hecho", "Done") : t("Marcar como hecho", "Mark as done")}: ${item.title}`}
              className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
            >
              <span className={`flex h-6 w-6 items-center justify-center rounded-full ${isDone(item.id) ? "bg-green-600 text-white" : "ring-2 ring-slate-300"}`}>
                {isDone(item.id) && <Icon name="check" size={14} strokeWidth={2.5} />}
              </span>
            </button>
            <Link href={item.href} className="flex min-h-11 min-w-0 flex-1 flex-col justify-center">
              <span className={`text-[15px] font-medium ${isDone(item.id) ? "text-slate-500 line-through decoration-slate-300" : "text-slate-900"}`}>{item.title}</span>
              <span className="text-[13px] leading-snug text-slate-500">{item.detail}</span>
            </Link>
            <Icon name="chevron" size={16} className="shrink-0 text-slate-400" />
          </li>
        ))}
      </ul>
      <div className="border-t hairline bg-slate-50 px-5 py-3">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{t("Las reglas", "The rules")}</p>
        <ul className="mt-1 space-y-0.5">
          {HOUSE_RULES.slice(0, 3).map((rule) => (
            <li key={rule} className="flex gap-2 text-[13.5px] leading-snug text-slate-700">
              <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-blue-700" />
              {rule}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
