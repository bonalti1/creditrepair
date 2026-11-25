"use client";

import { useState } from "react";
import { effectiveStage, firstTouchLine, leadName, shortWait, STAGE_HELP, STAGE_LABELS, waitingMinutes } from "@/lib/leads/inbox";
import { PERSON_STAGES, type Lead, type LeadStage, type PersonStage } from "@/lib/leads/types";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { stageTone } from "./LeadBits";

// The pipeline: New → Contacted → Qualified → Invited → Signed, and the three
// ways out. ONLY PEOPLE MOVE LEADS: each card in a person's stage has a
// "Move to" menu; Invited and Signed have none, because they move by
// themselves (the invitation went out; the agreement was signed). Five columns
// on a laptop, one under the other on a phone.

const MAIN: readonly LeadStage[] = ["new", "contacted", "qualified", "invited", "signed"];
const OUT: readonly LeadStage[] = ["not_interested", "closed_lost", "archived"];

function Card({ lead, now, onOpen, onMove, busy }: { lead: Lead; now: Date; onOpen: () => void; onMove: (to: PersonStage) => void; busy: boolean }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const stage = effectiveStage(lead);
  const waited = waitingMinutes(lead, now);
  const automatic = stage === "invited" || stage === "signed";
  return (
    <li className="rounded-2xl bg-white px-3 py-2.5 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]" data-testid="pipeline-card">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <span className="block truncate text-[14px] font-semibold text-slate-900">{leadName(lead)}</span>
        <span className="block truncate text-[12px] text-blue-700">{firstTouchLine(lead, locale)}</span>
        {waited !== null && <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-blue-900 tabular-nums">{t("Espera", "Waiting")} {shortWait(waited)}</span>}
      </button>
      {!automatic && (
        <select
          aria-label={t(`Mover a ${leadName(lead)}`, `Move ${leadName(lead)}`)}
          value=""
          disabled={busy}
          onChange={(e) => e.target.value && onMove(e.target.value as PersonStage)}
          className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-2 text-[13px] md:h-9"
        >
          <option value="">{t("Mover a…", "Move to…")}</option>
          {PERSON_STAGES.filter((s) => s !== lead.stage).map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[locale][s]}
            </option>
          ))}
        </select>
      )}
    </li>
  );
}

export default function LeadPipeline({ leads, now, onOpen, onMove }: { leads: Lead[]; now: Date; onOpen: (id: string) => void; onMove: (id: string, to: PersonStage) => Promise<void> }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const [busy, setBusy] = useState(false);
  const by = (stage: LeadStage) => leads.filter((l) => effectiveStage(l) === stage);
  const move = async (id: string, to: PersonStage) => {
    setBusy(true);
    await onMove(id, to);
    setBusy(false);
  };
  return (
    <div data-testid="pipeline">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-5">
        {MAIN.map((stage) => {
          const list = by(stage);
          return (
            <section key={stage} className="rounded-3xl bg-slate-100 px-2.5 py-3" aria-labelledby={`col-${stage}`}>
              <h3 id={`col-${stage}`} className="flex items-center justify-between px-1.5">
                <span className={`rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold ${stageTone(stage)}`}>{STAGE_LABELS[locale][stage]}</span>
                <span className="text-[13px] font-semibold text-slate-600 tabular-nums">{list.length}</span>
              </h3>
              <p className="mt-1.5 px-1.5 text-[11.5px] leading-snug text-slate-500">{STAGE_HELP[locale][stage]}</p>
              <ul className="mt-2 space-y-2">
                {list.map((lead) => (
                  <Card key={lead.id} lead={lead} now={now} busy={busy} onOpen={() => onOpen(lead.id)} onMove={(to) => void move(lead.id, to)} />
                ))}
                {list.length === 0 && <li className="px-1.5 py-2 text-[12.5px] text-slate-400">{t("Nadie aquí", "Nobody here")}</li>}
              </ul>
            </section>
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-3">
        {OUT.map((stage) => {
          const list = by(stage);
          return (
            <details key={stage} className="rounded-2xl bg-white px-4 py-3 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between md:min-h-8">
                <span className="text-[13.5px] font-semibold text-slate-700">{STAGE_LABELS[locale][stage]}</span>
                <span className="text-[13px] font-semibold text-slate-500 tabular-nums">{list.length}</span>
              </summary>
              <p className="mt-1 text-[12px] leading-snug text-slate-500">{STAGE_HELP[locale][stage]}</p>
              <ul className="mt-2 space-y-2">
                {list.map((lead) => (
                  <Card key={lead.id} lead={lead} now={now} busy={busy} onOpen={() => onOpen(lead.id)} onMove={(to) => void move(lead.id, to)} />
                ))}
              </ul>
            </details>
          );
        })}
      </div>
      <p className="mt-3 px-1 text-xs leading-relaxed text-slate-500">
        {t(
          "Solo una persona mueve prospectos. «Invitado» y «Firmó» se ponen solos con los hechos: cuando sale la invitación y cuando firma el acuerdo. El piloto automático nunca mueve a nadie.",
          "Only a person moves leads. “Invited” and “Signed” set themselves from the facts: when the invitation goes out and when the agreement is signed. The autopilot never moves anyone.",
        )}
      </p>
    </div>
  );
}

