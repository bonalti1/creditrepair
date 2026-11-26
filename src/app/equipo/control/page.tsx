"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useBooks } from "@/lib/accounting/data";
import { workQueue } from "@/lib/autopilot/queue";
import { useAutopilot } from "@/lib/autopilot/useAutopilot";
import { booksDue, booksSnapshot } from "@/lib/control/books";
import { contentNeeds } from "@/lib/control/content";
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
import { pillTab, PRIMARY_BUTTON_COMPACT } from "@/components/staff/ui";
import { AltiWaveLoop, CharacterAvatar } from "@/components/Character";
import { aiByline } from "@/lib/brand";
import { publishBadges } from "@/lib/staff/navBadges";
import { getLaunchData } from "@/lib/launch/data";
import type { LaunchReport } from "@/lib/launch/status";
import { LaunchOverviewCard } from "@/components/staff/launch/parts";
import NextWebinarCard from "@/components/staff/webinars/NextWebinarCard";

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

  // Launch readiness (docs/LAUNCH.md): a compact card for an administrator while the business is not live.
  const [launch, setLaunch] = useState<LaunchReport | null>(null);
  const seesLaunch = can("launch");
  useEffect(() => {
    if (!viewer || !seesLaunch) return;
    let alive = true;
    getLaunchData(viewer)
      .load()
      .then((v) => alive && setLaunch(v.report))
      .catch(() => alive && setLaunch(null));
    return () => {
      alive = false;
    };
  }, [viewer, seesLaunch]);

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
            video: can("content.view") && extras?.video ? { summary: extras.video, viewer: contentViewer } : null,
            books: books?.due ?? null,
            now,
            locale,
          })
        : [],
    [ready, queue, worksLeads, leads, extras, contentViewer, books, now, locale, viewer],
  );
  const tiles = useMemo(() => (ready ? departmentTiles({ can, cards, today: items, locale }) : []), [ready, cards, items, locale, viewer]);

  // The red circles on the menu (lib/staff/navBadges.ts): the same «Needs you» counts as the cards.
  useEffect(() => {
    if (!ready) return;
    const needs = (key: string) => cards.find((c) => c.key === key)?.needsYou.count ?? null;
    const books = tiles.find((x) => x.key === "accounting")?.count ?? null;
    const money = needs("money");
    // Marketing's circle: the Content board's own count. The Video Studio and SEO add theirs from their own
    // sources (lib/video/badge.ts, BadgeProbe's SeoBadge), so the card's combined figure is not used here.
    const contentOnly = can("content.view") && extras?.content ? contentNeeds(extras.content, contentViewer).count : needs("content") === null ? null : 0;
    publishBadges("overview", {
      day: needs("clients"),
      leads: needs("leads"),
      clients: needs("support"),
      money: money === null && books === null ? null : (money ?? 0) + (books ?? 0),
      content: contentOnly,
      partners: needs("partners"),
    });
  }, [ready, cards, tiles, extras, contentViewer]);

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

  const firstName = viewer?.name.split(" ")[0] ?? "";
  const hour = Number(now.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Chicago" }));
  const hello =
    hour < 12 ? t(`Buenos días, ${firstName}.`, `Good morning, ${firstName}.`) : hour < 18 ? t(`Buenas tardes, ${firstName}.`, `Good afternoon, ${firstName}.`) : t(`Buenas noches, ${firstName}.`, `Good evening, ${firstName}.`);
  const needsOf = (key: string) => cards.find((c) => c.key === key)?.needsYou.count;
  const kpis = [
    can("leads.work") ? { key: "leads", label: t("Prospectos esperando", "Leads waiting"), value: needsOf("leads"), href: "/equipo/leads?filtro=waiting" } : null,
    { key: "support", label: t("Preguntas de clientes", "Client questions"), value: needsOf("support"), href: "/equipo/clientes?aviso=question_waiting" },
    can("billing.view") ? { key: "money", label: t("Avisos de pago", "Payment notices"), value: needsOf("money"), href: "/equipo/clientes?aviso=payment_past_due" } : null,
    can("content.view") ? { key: "content", label: t("Contenido", "Content"), value: needsOf("content"), href: "/equipo/contenido" } : null,
  ].filter((k): k is { key: string; label: string; value: number | null | undefined; href: string } => k !== null);

  return (
    <main className="animate-rise">
      {/* ALTO's navy band, with Alti greeting the member (the AI assistant, labelled as AI) and today's numbers. */}
      <section className="relative overflow-hidden rounded-[14px] bg-blue-900 text-white shadow-[0_6px_20px_rgba(18,33,58,0.12)]" data-testid="overview-hero">
        <div className="flex items-stretch gap-4 px-5 pt-5 md:gap-6 md:px-6">
          <AltiWaveLoop height={176} decorative className="-mb-px hidden shrink-0 self-end sm:block" />
          <div className="min-w-0 flex-1 pb-5">
            <h1 className="page-title text-white">{weekday.charAt(0).toUpperCase() + weekday.slice(1)}</h1>
            <p className="mt-1 text-[14.5px] leading-snug text-blue-100">{t("Todo el negocio en una pantalla, con números reales.", "The whole business on one screen, with real numbers.")}</p>
            <div className="mt-3 flex items-start gap-2.5" data-testid="alti-greeting">
              <CharacterAvatar character="assistant" size={36} tone="ivory" decorative className="sm:hidden" />
              <div className="min-w-0 rounded-[14px] rounded-tl-[4px] bg-white/10 px-3.5 py-2.5">
                <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-amber-300" data-on-navy>{aiByline(locale)}</p>
                <p className="mt-0.5 text-[15px] leading-snug text-white">
                  {hello} {items.length === 0 ? t("Nada necesita a una persona ahora.", "Nothing needs a person right now.") : t("Lo que no puede esperar va primero en Hoy.", "What can't wait is first in Today.")}
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className={`grid grid-cols-2 gap-px border-t border-white/10 bg-white/10 ${["lg:grid-cols-1", "lg:grid-cols-1", "lg:grid-cols-2", "lg:grid-cols-3", "lg:grid-cols-4"][kpis.length]}`}>
          <div className="col-span-2 flex flex-col gap-3 bg-blue-900 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6 lg:col-span-full" data-testid="today-summary">
            <div>
              <h2 className="font-display text-[22px] font-semibold leading-tight text-amber-400 tabular-nums" data-on-navy>
                {t(`Hoy: ${count(items.length, "cosa", "cosas")} · ~${minutes} minutos`, `Today: ${count(items.length, "thing", "things")} · ~${minutes} minutes`)}
              </h2>
              <p className="mt-1 text-[13px] leading-snug text-blue-100">
                {items.length === 0
                  ? t("Nada necesita una persona ahora.", "Nothing needs a person right now.")
                  : t("En orden: lo que no puede esperar primero. Cada cosa trae sus pasos.", "In order: what can't wait comes first. Each item carries its steps.")}
              </p>
            </div>
            {items.length > 0 && (
              <button type="button" onClick={() => setView("today")} className={`${PRIMARY_BUTTON_COMPACT} shrink-0 gap-1.5 px-4`} data-testid="open-today">
                {t("Abrir Hoy", "Open Today")}
                <Icon name="chevron" size={16} />
              </button>
            )}
          </div>
          {kpis.map((k) => (
            <Link key={k.key} href={k.href} className="group bg-blue-900 px-5 py-4 hover:bg-blue-800 md:px-6" data-testid={`kpi-${k.key}`}>
              <p className="text-[12px] font-semibold uppercase leading-tight tracking-[0.08em] text-blue-200">{k.label}</p>
              {k.value === null || k.value === undefined ? (
                <p className="mt-1.5 text-[13px] font-semibold text-blue-100">{t("Todavía sin datos", "No data yet")}</p>
              ) : (
                <p className="mt-0.5 font-display text-[28px] font-semibold leading-tight tabular-nums text-white">{k.value}</p>
              )}
              <p className="mt-0.5 text-[12px] text-blue-200 group-hover:text-white">{t("te necesitan", "need you")} ›</p>
            </Link>
          ))}
          {kpis.length % 2 === 1 && <div className="bg-blue-900 lg:hidden" aria-hidden="true" />}
        </div>
      </section>

      <SafeBoundary>
        <DepartmentStrip tiles={tiles} />
      </SafeBoundary>
      {launch && !launch.summary.live && (
        <SafeBoundary>
          <LaunchOverviewCard report={launch} />
        </SafeBoundary>
      )}
      <SafeBoundary>
        <NextWebinarCard viewer={viewer} />
      </SafeBoundary>
      <div className="mt-5 flex flex-wrap gap-1.5" role="tablist" aria-label={t("Vista", "View")}>
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
            className={pillTab(view === v)}
            data-testid={`view-${v}`}
          >
            {v === "overview" ? t("Resumen", "Overview") : `${t("Hoy", "Today")} · ${items.length}`}
          </button>
        ))}
      </div>


      {view === "overview" ? (
        <>
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
