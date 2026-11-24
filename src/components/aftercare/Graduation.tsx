"use client";

import Link from "next/link";
import { useState } from "react";
import { CharacterFigure } from "@/components/Character";
import Icon from "@/components/Icon";
import { GRADUATION_COPY, graduationStatus, graduationSummary, type GraduationStatus } from "@/lib/aftercare/graduation";
import { useAftercare } from "@/lib/aftercare/useAftercare";
import { caseDay } from "@/lib/case/timeline";
import type { CaseView } from "@/lib/case/useCase";
import { useFlags } from "@/lib/ux/flagsStore";
import { useClientReport } from "@/lib/ux/reportStore";

// Graduation in Mi caso (src/lib/aftercare/graduation.ts): when nothing the
// client marked is still waiting, or whenever they choose to finish after the
// work started. What was done, as facts; the plan going forward; free tips;
// sharing with their loan officer; and how billing stops.

type L = "es" | "en";

export function useGraduation(caseView: CaseView, state: ReturnType<typeof useAftercare>["state"]): { status: GraduationStatus | null; markedStillReported: number } {
  const report = useClientReport();
  const { flags } = useFlags();
  const [now] = useState(() => new Date());
  if (!state || !caseView.ready) return { status: null, markedStillReported: 0 };
  const markedStillReported = report.items.filter((i) => flags[i.fingerprint]?.state === "attested").length;
  return { status: graduationStatus({ facts: caseView.facts, markedStillReported, graduation: state.graduation, now }), markedStillReported };
}

/**
 * `where`: "top" shows the graduation and the "disputes look done" moment;
 * "bottom" shows the quiet "Finish your program" choice while work goes on.
 */
export default function GraduationCard({ caseView, locale, aftercare, where }: { caseView: CaseView; locale: L; aftercare: ReturnType<typeof useAftercare>; where: "top" | "bottom" }) {
  const c = GRADUATION_COPY[locale];
  const es = locale === "es";
  const { state, graduate, setTips } = aftercare;
  const { status, markedStillReported } = useGraduation(caseView, state);
  const [confirming, setConfirming] = useState(false);
  const [keepTips, setKeepTips] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  if (!state || !status || status.kind === "not_available") return null;
  if ((where === "bottom") !== (status.kind === "can_choose")) return null;
  const summary = graduationSummary(caseView.facts, locale);

  if (status.kind === "graduated") {
    const g = status.graduation;
    return (
      <section className="card overflow-hidden" data-testid="graduation" aria-labelledby="graduation-title">
        <div className="flex items-end gap-4 bg-blue-900 px-5 pt-4 text-white">
          <CharacterFigure character="assistant" pose="celebrate" height={110} decorative className="-mb-px" />
          <div className="min-w-0 pb-5">
            <h2 id="graduation-title" className="font-display text-[24px] font-bold leading-tight text-white">{c.doneTitle}</h2>
            <p className="mt-1 text-[15px] leading-snug text-white">{c.doneLead(caseDay(g.completedAt, locale))}</p>
          </div>
        </div>
        <div className="space-y-4 px-5 py-5">
          <Summary title={c.whatWasDone} lines={summary} note={c.resultsNote} />
          <div>
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{c.goingForward}</h3>
            <p className="mt-1 text-[15px] leading-relaxed text-slate-700">{c.goingForwardLead}</p>
            <Link href="/construir" className="pressable mt-3 flex h-12 items-center justify-center rounded-full bg-amber-400 text-[16px] font-semibold text-blue-900 hover:bg-amber-500" data-testid="graduation-plan">
              {c.openPlan}
            </Link>
          </div>
          <label className="flex items-start gap-3 rounded-2xl bg-slate-50 px-4 py-3">
            <input type="checkbox" checked={g.keepTips} onChange={(e) => setTips(e.target.checked)} className="mt-1 h-5 w-5" data-testid="graduation-tips" />
            <span>
              <span className="block text-[15px] font-medium text-slate-900">{c.tipsLabel}</span>
              <span className="block text-[13px] text-slate-500">{c.tipsHelp}</span>
            </span>
          </label>
          <div className="rounded-2xl bg-slate-50 px-4 py-3">
            <p className="text-[15px] font-semibold text-slate-900">{c.shareTitle}</p>
            <p className="mt-1 text-[14px] leading-snug text-slate-600">{c.shareLead}</p>
            <Link href="/construir/casa" className="mt-1 inline-flex h-10 items-center gap-1 text-[15px] font-semibold text-blue-700">
              {c.shareCta}
              <Icon name="chevron" size={16} />
            </Link>
          </div>
          <Billing locale={locale} />
        </div>
      </section>
    );
  }

  const ready = status.kind === "ready";
  return (
    <section className={`card px-5 py-5 ${ready ? "ring-2 ring-amber-400" : ""}`} data-testid={ready ? "graduation-ready" : "graduation-choose"} aria-labelledby="graduation-title">
      <h2 id="graduation-title" className="text-[19px] font-semibold text-slate-900">{ready ? c.readyTitle : c.chooseTitle}</h2>
      <p className="mt-1 text-[15px] leading-relaxed text-slate-700">{ready ? c.readyLead : c.chooseLead}</p>
      {ready && <div className="mt-4"><Summary title={c.whatWasDone} lines={summary} note={c.resultsNote} /></div>}
      {confirming ? (
        <div className="mt-4 space-y-3" data-testid="graduation-confirm">
          <Billing locale={locale} />
          <label className="flex items-start gap-3 rounded-2xl bg-slate-50 px-4 py-3">
            <input type="checkbox" checked={keepTips} onChange={(e) => setKeepTips(e.target.checked)} className="mt-1 h-5 w-5" />
            <span>
              <span className="block text-[15px] font-medium text-slate-900">{c.tipsLabel}</span>
              <span className="block text-[13px] text-slate-500">{c.tipsHelp}</span>
            </span>
          </label>
          <button
            type="button"
            disabled={busy}
            data-testid="graduation-finish"
            onClick={async () => {
              setBusy(true);
              const r = await graduate(keepTips, locale, markedStillReported, ready ? "disputes_done" : "client_chose");
              setBusy(false);
              setError(!r.ok);
              if (r.ok) setConfirming(false);
              // The case (its agreement now records the end of the service) is read again, so every line on the page agrees.
              if (r.ok) window.location.reload();
            }}
            className="pressable flex h-12 w-full items-center justify-center rounded-full bg-amber-400 text-[16px] font-semibold text-blue-900 hover:bg-amber-500"
          >
            {busy ? c.finishing : c.finishConfirm}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="pressable flex h-11 w-full items-center justify-center text-[15px] font-medium text-blue-700">
            {c.cancel}
          </button>
          {error && <p className="text-[14px] text-red-700" role="alert">{c.error}</p>}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          data-testid="graduation-start"
          className={`pressable mt-4 flex h-12 w-full items-center justify-center rounded-full text-[16px] font-semibold ${ready ? "bg-amber-400 text-blue-900 hover:bg-amber-500" : "bg-slate-100 text-slate-900 hover:bg-slate-200"}`}
        >
          {c.finish}
        </button>
      )}
      {!ready && (
        <p className="mt-2 text-[13px] leading-snug text-slate-500">
          {es ? "Si solo quieres una pausa, escríbele a tu equipo antes." : "If you only want a pause, write to your team first."}
        </p>
      )}
    </section>
  );
}

function Summary({ title, lines, note }: { title: string; lines: string[]; note: string }) {
  if (lines.length === 0) return null;
  return (
    <div data-testid="graduation-summary">
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <ul className="mt-1.5 space-y-1.5">
        {lines.map((l) => (
          <li key={l} className="flex gap-2 text-[15px] leading-snug text-slate-800">
            <Icon name="check" size={16} className="mt-0.5 shrink-0 text-blue-700" />
            {l}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px] leading-snug text-slate-500">{note}</p>
    </div>
  );
}

function Billing({ locale }: { locale: L }) {
  const c = GRADUATION_COPY[locale];
  return (
    <div className="rounded-2xl bg-blue-50 px-4 py-3" data-testid="graduation-billing">
      <p className="text-[13px] font-semibold uppercase tracking-wide text-blue-900">{c.billingTitle}</p>
      <ul className="mt-1 space-y-1 text-[14px] leading-snug text-blue-900">
        {c.billing.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
    </div>
  );
}
