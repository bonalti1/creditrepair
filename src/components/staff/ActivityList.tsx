"use client";

import { ACTIVITY_LABELS, type ActivityEntry } from "@/lib/staff/activity";
import { relativeDay, shortDateTime } from "@/lib/staff/format";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";

// A list of who did what, newest first: the client's own (on the client page)
// or everyone's (/equipo/actividad). Read-only.

const DOT: Record<string, string> = {
  client: "bg-amber-500",
  system: "bg-green-600",
};

export default function ActivityList({ entries, now, showClient = true }: { entries: ActivityEntry[]; now: Date; showClient?: boolean }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  if (entries.length === 0) return <p className="px-5 py-5 text-[14px] text-slate-500">{t("Nada en el registro con estos filtros.", "Nothing on record with these filters.")}</p>;
  return (
    <ol>
      {entries.map((entry, index) => (
        <li key={entry.id} className={`flex gap-3 px-5 py-3 ${index > 0 ? "border-t hairline" : ""}`} data-testid="activity-entry">
          <span className={`mt-[6px] h-2.5 w-2.5 shrink-0 rounded-full ${DOT[entry.actor] ?? "bg-blue-700"}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="break-words text-[14px] leading-snug text-slate-800">{entry.text}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {ACTIVITY_LABELS[locale][entry.type]} · {shortDateTime(entry.at, locale)} · {relativeDay(entry.at, now, locale)}
              {showClient && entry.clientId === null ? t(" · equipo", " · team") : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
