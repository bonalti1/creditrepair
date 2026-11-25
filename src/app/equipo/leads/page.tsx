"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getLeadData, type LeadList } from "@/lib/leads/data";
import { countByStage, filterLeads, LEAD_FILTERS_ORDER, sortLeads, waitingSince, type LeadFilter } from "@/lib/leads/inbox";
import { deniedReason } from "@/lib/staff/permissions";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import { useStaff } from "@/lib/staff/useStaff";
import Icon from "@/components/Icon";
import LeadAutopilotPanel from "@/components/staff/control/LeadAutopilotPanel";
import LeadConversation from "@/components/staff/control/LeadConversation";
import { FilterBar, LeadRow } from "@/components/staff/control/LeadList";
import LeadNumbers, { QualityStrip } from "@/components/staff/control/LeadNumbers";
import LeadPipeline from "@/components/staff/control/LeadPipeline";
import SafeBoundary from "@/components/staff/control/SafeBoundary";
import { NoAccess } from "@/components/staff/ui";

// Credalti Control's lead inbox (docs/CONTROL.md): one inbox for every
// prospect conversation, whatever the way in (WhatsApp, HighLevel, a partner,
// the chat signup, by hand). Four views: the inbox (list and conversation),
// the pipeline, the lead quality numbers and the lead autopilot's switch.
// Who sees what: an administrator every lead; sales theirs and the ones
// nobody has yet (the database's read policy says the same).

type Tab = "inbox" | "pipeline" | "numbers" | "autopilot";
const TABS: readonly Tab[] = ["inbox", "pipeline", "numbers", "autopilot"];

export default function LeadsPage() {
  const { ready, now, viewer, can, locale, members } = useStaff();
  const t = useTx();
  const data = useMemo(() => getLeadData(viewer, locale), [viewer, locale]);
  const [list, setList] = useState<LeadList | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("inbox");
  const [filter, setFilter] = useState<LeadFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [appUrl, setAppUrl] = useState("https://credalti.com");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get("vista");
    if (v && (TABS as readonly string[]).includes(v)) setTab(v as Tab);
    const f = params.get("filtro");
    if (f && (LEAD_FILTERS_ORDER as readonly string[]).includes(f)) setFilter(f as LeadFilter);
    setSelected(params.get("lead"));
    setAppUrl(window.location.origin);
  }, []);

  const works = ready && can("leads.work");
  const load = useCallback(async () => {
    try {
      setList(await data.list());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [data]);
  useEffect(() => {
    if (works) void load();
  }, [works, load]);

  const go = (next: { tab?: Tab; lead?: string | null }) => {
    const nextTab = next.tab ?? tab;
    const lead = next.lead === undefined ? selected : next.lead;
    setTab(nextTab);
    setSelected(lead);
    const params = new URLSearchParams();
    if (nextTab !== "inbox") params.set("vista", nextTab);
    if (lead) params.set("lead", lead);
    window.history.replaceState(null, "", `/equipo/leads${params.size ? `?${params.toString()}` : ""}`);
  };

  if (!ready) return null;
  if (!can("leads.work")) return <NoAccess title={t("Prospectos", "Leads")} reason={deniedReason("leads.work", locale)} />;

  const leads = list?.leads ?? [];
  const sorted = sortLeads(leads);
  const shown = filterLeads(sorted, filter, viewer?.handle ?? null, search);
  const byStage = countByStage(leads);
  const counts: Partial<Record<LeadFilter, number>> = {
    all: leads.filter((l) => l.stage !== "archived" || waitingSince(l)).length,
    waiting: leads.filter((l) => waitingSince(l)).length,
    mine: leads.filter((l) => l.salesperson === viewer?.handle).length,
    unassigned: leads.filter((l) => !l.salesperson).length,
    ...byStage,
  };
  const salesMembers = members.filter((m) => m.active && !m.pending && (m.role === "sales" || m.role === "admin")).map((m) => ({ handle: m.handle, name: m.name }));
  const memberNames = new Map(members.map((m) => [m.handle, m.name.split(" ")[0] ?? m.handle]));
  const tabLabel: Record<Tab, string> = {
    inbox: t("Bandeja", "Inbox"),
    pipeline: t("Etapas", "Pipeline"),
    numbers: t("Números", "Numbers"),
    autopilot: t("Piloto automático", "Autopilot"),
  };

  return (
    <main className="animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight text-slate-900">{t("Prospectos", "Leads")}</h1>
          <p className="mt-1 text-[15px] leading-relaxed text-slate-500">
            {t("Cada conversación con un prospecto, venga de donde venga. Solo una persona mueve un prospecto de etapa.", "Every lead conversation, wherever it came from. Only a person moves a lead's stage.")}
          </p>
        </div>
      </div>

      <div className="-mx-1 mt-4 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label={t("Vista", "View")}>
        {TABS.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={tab === v}
            onClick={() => go({ tab: v })}
            className={`pressable h-11 shrink-0 rounded-full px-4 text-[14px] font-semibold md:h-10 ${tab === v ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            data-testid={`tab-${v}`}
          >
            {tabLabel[v]}
            {v === "inbox" && counts.waiting ? <span className="ml-1.5 rounded-full bg-amber-400 px-1.5 text-[12px] text-blue-900 tabular-nums">{counts.waiting}</span> : null}
          </button>
        ))}
      </div>

      {failed && (
        <p className="card mt-4 px-5 py-4 text-[14px] text-slate-600" role="alert">
          {t("No se pudieron leer los prospectos ahora. Intenta de nuevo en un momento.", "The leads couldn't be read right now. Try again in a moment.")}
        </p>
      )}

      {tab === "inbox" && leads.length > 0 && (
        <div className={`mt-4 ${selected ? "hidden md:block" : ""}`}>
          <SafeBoundary>
            <QualityStrip leads={leads} now={now} onMore={() => go({ tab: "numbers" })} />
          </SafeBoundary>
        </div>
      )}

      {tab === "inbox" && (
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)] items-start gap-4 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <section className={`${selected ? "hidden md:block" : ""} min-w-0`} aria-label={t("Lista de prospectos", "Lead list")}>
            <div className="mb-2">
              <label htmlFor="lead-search" className="sr-only">
                {t("Buscar", "Search")}
              </label>
              <div className="flex h-11 items-center gap-2 rounded-full bg-white px-3.5 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]">
                <Icon name="search" size={17} className="text-slate-400" />
                <input id="lead-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Nombre, número o CR-…", "Name, number or CR-…")} className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none" />
              </div>
            </div>
            <FilterBar filter={filter} onFilter={setFilter} counts={counts} />
            <SafeBoundary>
              <ul className="card mt-2 overflow-hidden" data-testid="lead-list">
                {shown.length === 0 ? (
                  <li className="px-4 py-6 text-[14px] leading-snug text-slate-500">
                    {leads.length === 0
                      ? t("Todavía no hay prospectos. Aparecen aquí en cuanto alguien escribe por WhatsApp, llena un formulario de HighLevel, lo refiere un socio o empieza el registro con Alti.", "No leads yet. They show up here as soon as someone writes on WhatsApp, fills a HighLevel form, is referred by a partner or starts the chat signup.")
                      : t("Nadie con este filtro.", "Nobody with this filter.")}
                  </li>
                ) : (
                  shown.map((lead) => <LeadRow key={lead.id} lead={lead} now={now} selected={lead.id === selected} onOpen={() => go({ lead: lead.id })} members={memberNames} />)
                )}
              </ul>
            </SafeBoundary>
          </section>
          <section className={`${selected ? "" : "hidden md:block"} min-w-0`}>
            {selected ? (
              <SafeBoundary key={selected}>
                <LeadConversation leadId={selected} data={data} viewer={viewer} can={can} now={now} members={salesMembers} templates={list?.templates ?? []} answers={list?.answers ?? []} onChanged={load} onBack={() => go({ lead: null })} />
              </SafeBoundary>
            ) : (
              <div className="card flex min-h-64 flex-col items-center justify-center gap-2 px-6 py-10 text-center text-[14px] text-slate-500">
                <Icon name="inbox" size={28} className="text-slate-400" />
                {t("Elige una conversación de la lista.", "Pick a conversation from the list.")}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "pipeline" && (
        <div className="mt-4">
          <SafeBoundary>
            <LeadPipeline
              leads={leads}
              now={now}
              onOpen={(id) => go({ tab: "inbox", lead: id })}
              onMove={async (id, to) => {
                await data.move(id, to);
                await load();
              }}
            />
          </SafeBoundary>
        </div>
      )}

      {tab === "numbers" && (
        <div className="mt-4">
          <SafeBoundary>
            <LeadNumbers leads={leads} now={now} />
          </SafeBoundary>
        </div>
      )}

      {tab === "autopilot" && (
        <div className="mt-4">
          <SafeBoundary>
            <LeadAutopilotPanel data={data} canManage={can("autopilot.manage")} appUrl={appUrl} />
          </SafeBoundary>
        </div>
      )}

      {data.demo && (
        <p className="mt-4 px-1 text-xs leading-relaxed text-slate-500">
          {t("Demo: los prospectos son inventados y no se envía nada por WhatsApp. Lo que hagas se guarda solo en este navegador.", "Demo: the leads are made up and nothing is sent on WhatsApp. What you do is kept only in this browser.")}
        </p>
      )}
    </main>
  );
}
