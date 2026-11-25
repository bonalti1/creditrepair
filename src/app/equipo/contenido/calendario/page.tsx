"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { addDays, dayIn, dayLabel, monthGrid, piecesByDay, weekDays, weekStart } from "@/lib/content/calendar";
import { LANGUAGE_TAG } from "@/lib/content/labels";
import { filterPieces, type ContentFilters } from "@/lib/content/rules";
import { useContent } from "@/lib/content/store";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";
import { Filters } from "@/components/staff/content/Filters";
import { ContentGate, ContentHeader, DemoNote, PieceCard } from "@/components/staff/content/ui";

// The content calendar: a month (wide screens) or a week (phones by default),
// each piece on the day it was posted, else when it is scheduled, else its
// due date, in Central time. The same filters as the board.

export default function ContentCalendarPage() {
  const t = useTx();
  return (
    <ContentGate needs="content.view" title={t("Calendario", "Calendar")}>
      <Calendar />
    </ContentGate>
  );
}

function Calendar() {
  const t = useTx();
  const { locale } = useStaffLocale();
  const content = useContent();
  const today = dayIn(new Date().toISOString());
  const [view, setView] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState(today);
  const [filters, setFilters] = useState<ContentFilters>({});

  // Phones start on the week: a month of tiny cells is unreadable at 390 px.
  useEffect(() => {
    if (window.matchMedia?.("(max-width: 767px)").matches) setView("week");
  }, []);

  const scheduled = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of content.schedules) {
      if (!["scheduled", "retry", "publishing"].includes(s.status)) continue;
      const prev = map.get(s.pieceId);
      if (!prev || s.scheduledAt < prev) map.set(s.pieceId, s.scheduledAt);
    }
    return map;
  }, [content.schedules]);
  const byDay = useMemo(() => piecesByDay(filterPieces(content.pieces, filters), scheduled), [content.pieces, filters, scheduled]);

  const [y, m] = anchor.split("-").map(Number) as [number, number];
  const weeks = view === "month" ? monthGrid(y, m) : [weekDays(anchor)];
  const move = (dir: 1 | -1) => {
    if (view === "week") setAnchor(addDays(anchor, 7 * dir));
    else setAnchor(`${m + dir === 13 ? y + 1 : m + dir === 0 ? y - 1 : y}-${String(m + dir === 13 ? 1 : m + dir === 0 ? 12 : m + dir).padStart(2, "0")}-01`);
  };
  const title =
    view === "month"
      ? new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 15)))
      : `${dayLabel(weekStart(anchor), locale, { month: "short", day: "numeric" })} – ${dayLabel(addDays(weekStart(anchor), 6), locale, { month: "short", day: "numeric", year: "numeric" })}`;
  const weekdayNames = weekDays("2026-11-29").map((d) => dayLabel(d, locale, { weekday: "short" }));

  if (!content.ready) return <div className="h-40" aria-busy="true" />;

  return (
    <main className="animate-rise">
      <ContentHeader title={t("Calendario", "Calendar")} lead={t("Cada pieza en su día: publicada, programada o con fecha de entrega. Hora central (Texas).", "Each piece on its day: posted, scheduled or due. Central time (Texas).")} />
      <DemoNote live={content.live} />
      <Filters value={filters} onChange={setFilters} pieces={content.pieces} />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => move(-1)} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-slate-100" aria-label={view === "month" ? t("Mes anterior", "Previous month") : t("Semana anterior", "Previous week")}>
            <Icon name="chevron" size={18} className="rotate-180" />
          </button>
          <h2 className="min-w-0 px-1 text-[17px] font-semibold capitalize text-slate-900" aria-live="polite">
            {title}
          </h2>
          <button type="button" onClick={() => move(1)} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-slate-100" aria-label={view === "month" ? t("Mes siguiente", "Next month") : t("Semana siguiente", "Next week")}>
            <Icon name="chevron" size={18} />
          </button>
          <button type="button" onClick={() => setAnchor(today)} className="h-11 rounded-full px-3 text-[14px] font-medium text-blue-700 hover:bg-blue-50">
            {t("Hoy", "Today")}
          </button>
        </div>
        <div className="inline-flex rounded-full bg-slate-100 p-1" role="group" aria-label={t("Vista", "View")}>
          {(["month", "week"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`h-11 md:h-9 rounded-full px-4 text-[14px] font-medium ${view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>
              {v === "month" ? t("Mes", "Month") : t("Semana", "Week")}
            </button>
          ))}
        </div>
      </div>

      {view === "month" ? (
        <div className="card mt-3 overflow-hidden" data-testid="calendar-month">
          <div className="grid grid-cols-7 border-b hairline bg-slate-50 text-center text-[12px] font-semibold uppercase tracking-wide text-slate-500">
            {weekdayNames.map((name) => (
              <div key={name} className="py-2">
                {name}
              </div>
            ))}
          </div>
          {weeks.map((week) => (
            <div key={week[0]} className="grid grid-cols-7 border-b hairline last:border-b-0">
              {week.map((day) => {
                const list = byDay.get(day) ?? [];
                const inMonth = Number(day.slice(5, 7)) === m;
                return (
                  <div key={day} className={`min-h-28 border-r hairline p-1.5 last:border-r-0 ${inMonth ? "" : "bg-slate-50/60"}`}>
                    <p className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-[12.5px] tabular-nums ${day === today ? "bg-blue-700 font-semibold text-white" : inMonth ? "text-slate-700" : "text-slate-400"}`}>
                      {Number(day.slice(8))}
                    </p>
                    <ul className="space-y-1">
                      {list.slice(0, 3).map((piece) => (
                        <li key={piece.id}>
                          <Link href={`/equipo/contenido/pieza/${piece.id}`} className="block rounded-lg bg-blue-50 px-1.5 py-1 text-[12px] font-medium leading-snug text-blue-900 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden hover:bg-blue-100" title={piece.title}>
                            <span className="tabular-nums text-blue-700">{LANGUAGE_TAG[piece.language]}</span> {piece.title}
                          </Link>
                        </li>
                      ))}
                      {list.length > 3 ? <li className="px-1.5 text-[12px] text-slate-500">{t(`y ${list.length - 3} más`, `${list.length - 3} more`)}</li> : null}
                    </ul>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <ol className="mt-3 space-y-3" data-testid="calendar-week">
          {weeks[0]!.map((day) => {
            const list = byDay.get(day) ?? [];
            return (
              <li key={day} className="card px-4 py-3">
                <h3 className={`text-[14px] font-semibold capitalize ${day === today ? "text-blue-700" : "text-slate-900"}`}>
                  {dayLabel(day, locale)}
                  {day === today ? <span className="ml-2 text-[12px] font-medium normal-case text-blue-700">{t("hoy", "today")}</span> : null}
                </h3>
                {list.length === 0 ? (
                  <p className="mt-1 text-[13px] text-slate-500">{t("Nada este día.", "Nothing this day.")}</p>
                ) : (
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                    {list.map((piece) => (
                      <li key={piece.id}>
                        <PieceCard piece={piece} compact showStatus />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
