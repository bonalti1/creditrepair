"use client";

import Link from "next/link";
import { useState } from "react";
import Icon, { type IconName } from "@/components/Icon";
import { teaserFeatures, type TeaserFeature, type TeaserGoal, type TeaserId } from "@/lib/site/interactive";
import { LIVE_COPY } from "@/lib/site/live";

// The home-ready teaser: two taps (the goal; SSN or ITIN, optional), then the
// after-care features in the app that fit (docs/AFTERCARE.md), in that order.
// Every client gets all of them; nothing here predicts a loan or a result, and
// the answers stay in this page (nothing is saved or sent).

const ICON: Record<TeaserFeature, IconName> = { build: "chart", home: "home", itin: "doc", check: "clipboard" };

export default function HomeReadyTeaser({ locale, startHref }: { locale: "es" | "en"; startHref: string }) {
  const c = LIVE_COPY[locale].teaser;
  const cta = LIVE_COPY[locale].quiz.cta;
  const [goal, setGoal] = useState<TeaserGoal | null>(null);
  const [id, setId] = useState<TeaserId | null>(null);
  const done = goal !== null && id !== null;

  const option = (on: boolean, label: string, pick: () => void) => (
    <button
      key={label}
      type="button"
      aria-pressed={on}
      onClick={pick}
      className={`pressable min-h-11 rounded-full px-4 py-2 text-[15px] font-semibold ring-1 ring-inset ${on ? "bg-amber-400 text-blue-900 ring-amber-400" : "bg-white/10 text-white ring-white/20 hover:bg-white/15"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="relative overflow-hidden rounded-3xl bg-blue-900 p-7 text-white sm:p-10" data-testid="home-teaser">
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-blue-800" />
      <div className="relative">
        <span data-on-navy className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-amber-400">
          <Icon name="home" size={22} />
        </span>
        <h3 className="mt-4 font-display text-[26px] font-bold leading-tight sm:text-[30px]">{c.title}</h3>
        <p className="mt-2 max-w-xl text-[16px] leading-relaxed text-blue-100">{c.lead}</p>

        {!done ? (
          <div className="mt-6 space-y-5">
            <fieldset>
              <legend className="text-[15px] font-semibold text-white">{c.q1}</legend>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {(Object.keys(c.goals) as TeaserGoal[]).map((g) => option(goal === g, c.goals[g], () => setGoal(g)))}
              </div>
            </fieldset>
            {goal && (
              <fieldset className="msg-in">
                <legend className="text-[15px] font-semibold text-white">{c.q2}</legend>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {(Object.keys(c.ids) as TeaserId[]).map((k) => option(id === k, c.ids[k], () => setId(k)))}
                </div>
              </fieldset>
            )}
          </div>
        ) : (
          <div className="mt-6" aria-live="polite" data-testid="home-teaser-result">
            <p data-on-navy className="text-[13px] font-semibold uppercase tracking-[0.08em] text-amber-300">{c.resultTitle}</p>
            <ul className="mt-3 space-y-2.5">
              {teaserFeatures(goal, id).map((f, i) => (
                <li key={f} className="msg-in flex gap-3 rounded-2xl bg-white/10 px-4 py-3 text-[15px] leading-snug text-blue-50" style={{ animationDelay: `${i * 90}ms` }}>
                  <span data-on-navy className="mt-0.5 shrink-0 text-amber-400"><Icon name={ICON[f]} size={20} /></span>
                  {c.results[f]}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[13px] leading-relaxed text-blue-200">{c.note}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href={startHref} className="pressable inline-flex h-12 items-center gap-2 rounded-full bg-amber-400 px-6 text-[16px] font-semibold text-blue-900 hover:bg-amber-500">
                {cta}
                <Icon name="chevron" size={18} strokeWidth={2.25} />
              </Link>
              <button
                type="button"
                onClick={() => {
                  setGoal(null);
                  setId(null);
                }}
                className="pressable h-12 rounded-full px-5 text-[15px] font-semibold text-white ring-1 ring-inset ring-white/25 hover:bg-white/10"
              >
                {c.again}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
