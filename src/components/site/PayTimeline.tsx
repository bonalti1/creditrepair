"use client";

import { useState } from "react";
import Icon, { type IconName } from "@/components/Icon";
import { LIVE_COPY } from "@/lib/site/live";
import { eventsThrough, TIMELINE_DAYS, TIMELINE_MONTHS, timelineCounts, type PayEvent } from "@/lib/site/payTimelineShared";

// "When would I pay?" on /precios: drag through months 1 to 6 and see the
// rounds mailed and when a charge can happen. The events are built on the
// server from the billing rules (src/lib/site/payTimeline.ts): the rule only
// (no amounts) unless a plan our attorney reviewed is offered, in which case
// its own amounts appear. A real range input (arrow keys work, and it says
// "3 months" to a screen reader); the list below it is the same information
// as text.

export interface PayTimelineSet {
  id: string;
  name: string;
  events: PayEvent[];
}

const ICON: Record<PayEvent["kind"], IconName> = { signed: "doc", cancelEnds: "clock", mailed: "mail", charge: "calc", quiet: "info" };

export default function PayTimeline({ locale, sets }: { locale: "es" | "en"; sets: PayTimelineSet[] }) {
  const c = LIVE_COPY[locale].timeline;
  const [months, setMonths] = useState(2);
  const [setId, setSetId] = useState(sets[0]!.id);
  const current = sets.find((s) => s.id === setId) ?? sets[0]!;
  const shown = eventsThrough(current.events, months);
  const counts = timelineCounts(current.events, months);
  const horizon = months * 30;

  const label = (e: PayEvent) =>
    e.kind === "signed"
      ? c.signed
      : e.kind === "cancelEnds"
        ? c.cancelEnds
        : e.kind === "mailed"
          ? c.mailed(e.round ?? 1)
          : e.kind === "quiet"
            ? c.noChargePeriod
            : e.amount
              ? `${e.amount} · ${c.mailed(e.round ?? 1).toLowerCase()}`
              : c.chargeMay;

  return (
    <div className="card p-6 sm:p-9" data-testid="pay-timeline">
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="max-w-xl">
          <h2 id="when-pay" className="font-display text-[26px] font-bold leading-tight text-blue-900 sm:text-[32px]">
            {c.title}
          </h2>
          <p className="mt-2 text-[16px] leading-relaxed text-slate-600">{c.lead}</p>
        </div>
        {sets.length > 1 && (
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-slate-600">
            {c.planLabel}
            <select value={setId} onChange={(e) => setSetId(e.target.value)} className="h-11 rounded-full bg-slate-100 px-4 text-[15px] font-semibold text-blue-900">
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* The slider */}
      <div className="mt-8">
        <label htmlFor="pay-months" className="flex items-baseline justify-between text-[14px] font-semibold text-slate-700">
          {c.slider}
          <span className="font-display text-[22px] font-bold tabular-nums text-blue-900" aria-hidden>
            {c.month(months)}
          </span>
        </label>
        <input
          id="pay-months"
          type="range"
          // 0 to 6, like the track below, so the thumb sits over the same day; never below one month.
          min={0}
          max={TIMELINE_MONTHS}
          step={1}
          value={months}
          onChange={(e) => setMonths(Math.max(1, Number(e.target.value)))}
          aria-valuetext={c.month(months)}
          className="mt-3 w-full accent-[var(--color-blue-900)]"
          data-testid="pay-slider"
        />
        <div className="mt-1 flex justify-between text-[12px] font-medium tabular-nums text-slate-500" aria-hidden>
          {Array.from({ length: TIMELINE_MONTHS + 1 }, (_, i) => (
            <span key={i}>{i}</span>
          ))}
        </div>
      </div>

      {/* The track: every event of the six months, those past the slider dimmed. */}
      <div className="relative mt-8 h-20" aria-hidden>
        <div className="absolute inset-x-0 top-9 h-1.5 rounded-full bg-slate-200" />
        <div
          className="absolute left-0 top-9 h-1.5 origin-left rounded-full bg-blue-900 transition-transform duration-300 motion-reduce:transition-none"
          style={{ width: "100%", transform: `scaleX(${horizon / TIMELINE_DAYS})` }}
        />
        {current.events.map((e, i) => {
          const on = e.day <= horizon;
          const charge = e.kind === "charge";
          return (
            <span
              key={`${e.kind}-${e.day}-${i}`}
              className={`absolute flex -translate-x-1/2 items-center justify-center rounded-full transition-[opacity,transform] duration-300 motion-reduce:transition-none ${
                charge ? "top-0 h-7 w-7 bg-amber-400 text-blue-900" : e.kind === "mailed" ? "top-[26px] h-7 w-7 bg-blue-900 text-white ring-4 ring-white" : "top-[30px] h-5 w-5 bg-white text-slate-500 ring-2 ring-slate-300"
              } ${on ? "scale-100 opacity-100" : "scale-75 opacity-25"} ${e.kind === "quiet" ? "top-[58px]" : ""}`}
              style={{ left: `${(e.day / TIMELINE_DAYS) * 100}%` }}
            >
              <Icon name={ICON[e.kind]} size={charge || e.kind === "mailed" ? 14 : 11} />
            </span>
          );
        })}
      </div>
      <div className="mt-1 flex flex-wrap gap-4 text-[13px] text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-blue-900" /> {c.legendMailed}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-amber-400" /> {c.legendCharge}
        </span>
      </div>

      <p className="mt-6 rounded-2xl bg-blue-900 px-5 py-4 text-[16px] font-semibold text-white" aria-live="polite" data-testid="pay-summary">
        {c.summary(counts.rounds, counts.charges, months)}
      </p>

      <ol className="mt-5 grid gap-2 sm:grid-cols-2">
        {shown.map((e, i) => (
          <li key={`${e.kind}-${e.day}-${i}`} className={`msg-in flex items-start gap-3 rounded-2xl px-4 py-3 ${e.kind === "charge" ? "bg-amber-50 ring-1 ring-amber-200" : "bg-slate-50"}`}>
            <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${e.kind === "charge" ? "bg-amber-400 text-blue-900" : e.kind === "mailed" ? "bg-blue-900 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200"}`}>
              <Icon name={ICON[e.kind]} size={15} />
            </span>
            <span className="min-w-0">
              <span className="block text-[12px] font-semibold tabular-nums text-slate-500">{c.day(e.day)}</span>
              <span className="block text-[15px] font-semibold leading-snug text-slate-900">{label(e)}</span>
            </span>
          </li>
        ))}
      </ol>

      <ul className="mt-6 space-y-2">
        {c.rules.map((r) => (
          <li key={r} className="flex gap-2.5 text-[15px] leading-snug text-slate-700">
            <Icon name="check" size={18} strokeWidth={2.5} className="mt-0.5 shrink-0 text-amber-600" />
            {r}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[13px] leading-relaxed text-slate-500">{c.note}</p>
    </div>
  );
}
