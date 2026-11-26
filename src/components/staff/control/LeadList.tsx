"use client";

import { effectiveStage, firstTouchLine, HANDOFF_LABELS, LEAD_FILTERS_ORDER, leadLanguage, leadName, shortWait, STAGE_LABELS, waitingMinutes, whatsappWindow, type LeadFilter } from "@/lib/leads/inbox";
import type { Lead } from "@/lib/leads/types";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { LANGUAGE_NAME } from "@/lib/staff/i18n/locale";
import Icon from "@/components/Icon";
import { stageTone } from "./LeadBits";
import { FUNNEL_STAGE_LABELS, funnelLine, type FunnelStage } from "@/lib/live/stages";

const FUNNEL_TONE: Record<FunnelStage, string> = {
  new: "bg-amber-100 text-blue-900",
  reviewing: "bg-blue-50 text-blue-800",
  video_sent: "bg-blue-100 text-blue-900",
  watched: "bg-blue-100 text-blue-900",
  started: "bg-green-50 text-green-700",
  signed: "bg-green-50 text-green-700",
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

// The lead inbox's list: every prospect conversation, newest first. On each
// row: name (or number), where they came from, their language, the stage,
// who works it, the last message and how long they have waited. Waiting,
// hand-offs, STOP and WhatsApp's window are tags on the row, never a hidden
// ranking (the Today list is where urgency orders things).

export function LeadRow({ lead, now, selected, onOpen, members }: { lead: Lead; now: Date; selected: boolean; onOpen: () => void; members: Map<string, string> }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const stage = effectiveStage(lead);
  const waited = waitingMinutes(lead, now);
  const wa = whatsappWindow(lead.lastInboundAt, now);
  const language = leadLanguage(lead);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={selected ? "true" : undefined}
        className={`pressable flex w-full gap-3 border-t hairline px-4 py-3 text-left first:border-t-0 ${selected ? "bg-blue-50 shadow-[inset_3px_0_0_var(--color-amber-400)]" : "hover:bg-slate-50"}`}
        data-testid="lead-row"
        data-lead={lead.id}
      >
        {/* ALTO's chat list: the person's initials in a grey circle (a number alone: a person icon). */}
        <span aria-hidden="true" className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[14px] font-semibold text-slate-600">
          {/[a-zA-ZÀ-ÿ]/.test(leadName(lead)) ? initialsOf(leadName(lead)) : <Icon name="person" size={20} />}
        </span>
        <span className="block min-w-0 flex-1">
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold text-slate-900">{leadName(lead)}</span>
            <span className="block truncate text-[12.5px] font-medium text-blue-700">{firstTouchLine(lead, locale)}</span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${stageTone(stage)}`}>{STAGE_LABELS[locale][stage]}</span>
            {waited !== null && (
              <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold tabular-nums ${waited >= 60 ? "bg-red-50 text-red-700" : "bg-amber-100 text-blue-900"}`} data-testid="lead-waiting">
                {t("Espera", "Waiting")} {shortWait(waited)}
              </span>
            )}
          </span>
        </span>
        {lead.lastMessage && (
          <span className="mt-1 block truncate text-[13.5px] leading-snug text-slate-600">
            {lead.lastMessage.role === "user" ? "" : lead.lastMessage.source === "human" ? `${t("Equipo", "Team")}: ` : "Alti: "}
            {lead.lastMessage.excerpt}
          </span>
        )}
        <span className="mt-1.5 flex flex-wrap gap-1.5 text-[11.5px]">
          {lead.handoff && <span className="rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-700">{HANDOFF_LABELS[locale][lead.handoff.reason]}</span>}
          {/* The live funnel's stage (facts, never chosen): New → Reviewing report → Video sent → Watched → Started signup → Signed. */}
          {lead.funnel && (
            <span className={`rounded-full px-2 py-0.5 font-semibold ${FUNNEL_TONE[lead.funnel.stage]}`} title={funnelLine(lead.funnel, locale)} data-testid="lead-funnel" data-stage={lead.funnel.stage}>
              {t("En vivo", "Live")} · {FUNNEL_STAGE_LABELS[locale][lead.funnel.stage]}
            </span>
          )}
          {lead.signup?.wantsPerson && !lead.lastHumanAt && lead.handoff?.reason !== "wants_person" && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-blue-900">{t("Pidió una persona", "Asked for a person")}</span>}
          {lead.optedOutAt && <span className="rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-700">{t("Pidió BAJA", "Said STOP")}</span>}
          {wa.state === "open" && wa.closing && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-blue-900">{t(`WhatsApp cierra en ${wa.hoursLeft} h`, `WhatsApp closes in ${wa.hoursLeft} h`)}</span>}
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">{LANGUAGE_NAME[locale][language]}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">{lead.salesperson ? (members.get(lead.salesperson) ?? lead.salesperson) : t("Sin asignar", "Unassigned")}</span>
        </span>
        </span>
      </button>
    </li>
  );
}

export function FilterBar({ filter, onFilter, counts }: { filter: LeadFilter; onFilter: (f: LeadFilter) => void; counts: Partial<Record<LeadFilter, number>> }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const label = (f: LeadFilter) =>
    f === "all" ? t("Todos", "All") : f === "waiting" ? t("Esperando", "Waiting") : f === "mine" ? t("Míos", "Mine") : f === "unassigned" ? t("Sin asignar", "Unassigned") : STAGE_LABELS[locale][f];
  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label={t("Filtrar", "Filter")}>
      {LEAD_FILTERS_ORDER.map((f) => (
        <button
          key={f}
          type="button"
          aria-pressed={filter === f}
          onClick={() => onFilter(f)}
          className={`pressable h-11 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold md:h-9 ${filter === f ? "border-blue-900 bg-blue-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-amber-500"}`}
          data-testid={`filter-${f}`}
        >
          {label(f)}
          {counts[f] !== undefined && <span className="ml-1 tabular-nums opacity-70">{counts[f]}</span>}
        </button>
      ))}
    </div>
  );
}
