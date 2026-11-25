"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useBooks } from "@/lib/accounting/data";
import { workQueue } from "@/lib/autopilot/queue";
import { useAutopilot } from "@/lib/autopilot/useAutopilot";
import { booksDue, booksSnapshot } from "@/lib/control/books";
import { getControlData, type Extras } from "@/lib/control/data";
import { departmentTiles } from "@/lib/control/departments";
import { moneySummary, overviewCards } from "@/lib/control/overview";
import { todayList, todayMinutes, type TodayItem } from "@/lib/control/today";
import { getLeadData } from "@/lib/leads/data";
import type { Lead } from "@/lib/leads/types";
import { useMail } from "@/lib/mail/useMail";
import { count } from "@/lib/staff/format";
import { dateLocale } from "@/lib/staff/i18n/locale";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import { useStaff } from "@/lib/staff/useStaff";
import Icon from "@/components/Icon";
import DepartmentStrip from "@/components/staff/control/DepartmentStrip";
import OverviewCards from "@/components/staff/control/OverviewCards";
import SafeBoundary from "@/components/staff/control/SafeBoundary";
import TodayList from "@/components/staff/control/TodayList";
import { PRIMARY_BUTTON } from "@/components/staff/ui";

// Credalti Control (docs/CONTROL.md): the business at a glance. A tab of its
// own beside «Home», because Home is the specialist's day (the work queue,
// «Next», the new-hire checklist, the morning summary's link) and stays as it
// is. Two views: Overview (one card per department, real numbers, "Needs you")
// and Today (everything that needs a person, ranked, with the steps for each
// and «Escalate to the owner»). What each member sees follows their role; a
// salesperson never sees Money. On top, the departments strip: every
// department the member may open, one tap away. Content (content.view) has
// its card and its Today items; the owner (accounting) also sees this month
// in the books on the Money card and what the books ask of them in Today.

type View = "overview" | "today";
const ESCALATED_KEY = "credalti.control.escalated";

function readEscalated(): Set<string> {
  try {
    return new Set(JSON.parse(window.sessionStorage.getItem(ESCALATED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export default function ControlPage() {
  const staff = useStaff();
  const { data, ready: clientsReady, clients, now, reload, viewer, can, locale } = staff;
  // The accounting module's own books and money rule (accounting/data.ts): nothing is read without `accounting`.
  const acc = useBooks(staff);
  const seesBooks = can("accounting");
  const { furnishers, gaps, ready: bookReady } = useMail();
  const { env, ready: autopilotReady } = useAutopilot();
  const t = useTx();
  const [view, setView] = useState<View>("overview");
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [leadsError, setLeadsError] = useState<string | null>(null);
  const [extras, setExtras] = useState<Extras | null>(null);
  const [escalated, setEscalated] = useState<Set<string>>(new Set());
  const leadData = useMemo(() => getLeadData(viewer, locale), [viewer, locale]);
  const control = useMemo(() => getControlData(viewer, locale), [viewer, locale]);
  const worksLeads = can("leads.work");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("vista") === "hoy") setView("today");
    setEscalated(readEscalated());
  }, []);

  const load = useCallback(async () => {
    let list: Lead[] | null = null;
    if (worksLeads) {
      try {
        list = (await leadData.list()).leads;
        setLeadsError(null);
      } catch {
        setLeadsError(t("No se pudieron leer los prospectos ahora.", "The leads could not be read right now."));
      }
    }
    setLeads(list);
    try {
      setExtras(await control.extras({ clients, leads: list }));
    } catch {
      setExtras(null);
    }
  }, [worksLeads, leadData, control, clients, t]);

  useEffect(() => {
    if (clientsReady && viewer) void load();
  }, [clientsReady, viewer, load]);

  const ready = clientsReady && bookReady && autopilotReady && (!seesBooks || acc.ready);
  const books = useMemo(() => (ready && seesBooks ? { snapshot: booksSnapshot(acc.input, now), due: booksDue(acc.book, acc.input, now) } : null), [ready, seesBooks, acc.input, acc.book, now]);
  const contentViewer = useMemo(() => ({ approve: can("content.approve"), edit: can("content.edit"), handle: viewer?.handle ?? null }), [viewer]);
  const queue = useMemo(() => (ready ? workQueue(clients, now, { furnishers, furnisherGaps: gaps, autopilot: env, locale }, viewer?.role ?? null) : []), [ready, clients, now, furnishers, gaps, env, locale, viewer]);
  const cards = useMemo(
    () =>
      ready
        ? overviewCards({ clients, queue, leads, leadsError, extras, money: can("billing.view") ? moneySummary(clients, now) : null, books: books?.snapshot ?? null, handle: viewer?.handle ?? null, can, now, locale })
        : [],
    [ready, clients, queue, leads, leadsError, extras, books, now, locale, viewer],
  );
  const items = useMemo(
    () =>
      ready
        ? todayList({
            queue,
            leads: worksLeads ? leads : null,
            partnerNotes: extras?.partnerNotes,
            escalations: extras?.escalations ?? undefined,
            content: can("content.view") && extras?.content ? { summary: extras.content, viewer: contentViewer } : null,
            books: books?.due ?? null,
            now,
            locale,
          })
        : [],
    [ready, queue, worksLeads, leads, extras, contentViewer, books, now, locale, viewer],
  );
  const tiles = useMemo(() => (ready ? departmentTiles({ can, cards, today: items, locale }) : []), [ready, cards, items, locale, viewer]);

  if (!ready) return null;

  const weekday = now.toLocaleDateString(dateLocale(locale), { weekday: "long", day: "numeric", month: "long" });
  const minutes = todayMinutes(items);

  const onHandled = async (item: TodayItem) => {
    const q = item.queueItem;
    if (!q) return;
    const who = q.group ? q.group.waiting.map((w) => w.client.id) : [q.client.id];
    for (const id of who) await data.resolveException(id, q.exception.key);
    await reload();
  };
  const onEscalate = async (item: TodayItem, note: string) => {
    const result = await control.escalate({ key: item.key, title: item.title, note });
    if (!result.ok) return false;
    const next = new Set(escalated).add(item.key);
    setEscalated(next);
    try {
      window.sessionStorage.setItem(ESCALATED_KEY, JSON.stringify([...next]));
    } catch {
      // Shown for this visit only.
    }
    await load();
    return true;
  };
  const onResolve = async (item: TodayItem) => {
    await control.resolve(item.key.replace(/^escalation:/, ""));
    await load();
  };

  return (
    <main className="animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight text-slate-900">{t("Resumen", "Overview")}</h1>
          <p className="mt-1 text-[15px] leading-relaxed text-slate-500">
            {weekday.charAt(0).toUpperCase() + weekday.slice(1)}. {t("Todo el negocio en una pantalla, con números reales.", "The whole business on one screen, with real numbers.")}
          </p>
        </div>
        <div className="flex rounded-full bg-slate-100 p-1" role="tablist" aria-label={t("Vista", "View")}>
          {(["overview", "today"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => {
                setView(v);
                window.history.replaceState(null, "", v === "today" ? "/equipo/control?vista=hoy" : "/equipo/control");
              }}
              className={`pressable h-10 rounded-full px-4 text-[14px] font-semibold ${view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
              data-testid={`view-${v}`}
            >
              {v === "overview" ? t("Resumen", "Overview") : `${t("Hoy", "Today")} · ${items.length}`}
            </button>
          ))}
        </div>
      </div>

      <SafeBoundary>
        <DepartmentStrip tiles={tiles} />
      </SafeBoundary>

      {view === "overview" ? (
        <>
          <section className="card mt-5 flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between" data-testid="today-summary">
            <div>
              <h2 className="text-[19px] font-semibold leading-tight text-slate-900 tabular-nums">
                {t(`Hoy: ${count(items.length, "cosa", "cosas")} · ~${minutes} minutos`, `Today: ${count(items.length, "thing", "things")} · ~${minutes} minutes`)}
              </h2>
              <p className="mt-1 text-[14px] leading-snug text-slate-600">
                {items.length === 0
                  ? t("Nada necesita una persona ahora.", "Nothing needs a person right now.")
                  : t("En orden: lo que no puede esperar primero. Cada cosa trae sus pasos.", "In order: what can't wait comes first. Each item carries its steps.")}
              </p>
            </div>
            {items.length > 0 && (
              <button type="button" onClick={() => setView("today")} className={`${PRIMARY_BUTTON} shrink-0 gap-2`} data-testid="open-today">
                {t("Abrir Hoy", "Open Today")}
                <Icon name="chevron" size={18} />
              </button>
            )}
          </section>
          <div className="mt-5">
            <OverviewCards cards={cards} />
          </div>
          <p className="mt-4 px-1 text-xs leading-relaxed text-slate-500">
            {t(
              "Cada número sale de los registros. Cuando algo no se pudo leer o todavía no pasa, dice «Todavía sin datos» y por qué, nunca un cero inventado. «Te necesita» abre la pantalla donde se resuelve.",
              "Every number comes from the records. When something couldn't be read or hasn't happened yet, it says “No data yet” and why, never a made-up zero. “Needs you” opens the screen where it gets done.",
            )}
            {data.demo && t(" En la demo, los clientes y prospectos son inventados.", " In the demo, the clients and leads are made up.")}
          </p>
          <p className="mt-2 px-1 text-[13px]">
            <Link href="/equipo/alertas" className="inline-flex min-h-11 items-center gap-1.5 font-medium text-blue-700 underline-offset-2 hover:underline md:min-h-0">
              <Icon name="bell" size={15} />
              {t("Alertas al teléfono: elige qué te avisa", "Phone alerts: choose what pings you")}
            </Link>
          </p>
        </>
      ) : (
        <section className="mt-5" aria-label={t("Hoy", "Today")}>
          <p className="mb-3 px-1 text-[14px] leading-snug text-slate-600 tabular-nums">
            {t(`${count(items.length, "cosa", "cosas")} · ~${minutes} minutos. De arriba hacia abajo hasta que quede vacía.`, `${count(items.length, "thing", "things")} · ~${minutes} minutes. Top to bottom until it's empty.`)}
          </p>
          <SafeBoundary>
            <TodayList items={items} now={now} actions={{ onHandled, onEscalate, onResolve: viewer?.role === "admin" ? onResolve : undefined, escalated }} />
          </SafeBoundary>
          <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">
            {t(
              "«Pasar al dueño» le avisa al dueño con tu nota y queda registrado. Nada se envía a un cliente desde aquí.",
              "“Escalate to the owner” tells the owner, with your note, and goes on the record. Nothing is sent to a client from here.",
            )}
          </p>
        </section>
      )}
    </main>
  );
}
