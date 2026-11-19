"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DEMO_REPORT } from "@/lib/demo";
import type { ReportItem } from "@/lib/domain/types";
import { getStageExplainers } from "@/lib/ux/explainers";
import { useFlags } from "@/lib/ux/flagsStore";
import { itemLabel } from "@/lib/ux/itemDisplay";
import { RESPONSE_WINDOW_DAYS, NEXT_ROUND_DAYS, nextAction, sessionJourneyState } from "@/lib/ux/journey";
import { sessionPlan } from "@/lib/ux/sessionPlan";
import { useLocale } from "@/lib/i18n";
import Icon from "@/components/Icon";

// Rounds, with a real timeline: when letters mailed, when the FCRA ~30-day
// response window closes, when the next round unlocks (~day 40). The waiting
// period is where Dispute Beast users feel abandoned — here the clock is always
// visible and explained.
//
// Demo: the page shows what the customer did in this session and nothing else.
// If they approved their letters, there is one round in progress, made of those
// same letters and counted from today (the demo keeps no mailing date). If they
// have not approved anything yet, the page says so and points to the next step.

const DAY_MS = 24 * 60 * 60 * 1000;

const BUREAU_LABEL: Record<string, string> = {
  equifax: "Equifax",
  experian: "Experian",
  transunion: "TransUnion",
};

export default function Rounds() {
  const { locale, d } = useLocale();
  const { flags, roundApproved, hydrated } = useFlags();
  const items = DEMO_REPORT.items;
  const { plan, roundNumber } = useMemo(() => sessionPlan(items, flags), [items, flags]);

  if (!hydrated) return null;

  const fmt = (date: Date) =>
    date.toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { day: "numeric", month: "long" });
  const stages = getStageExplainers(locale);
  const sent = roundApproved && plan.letters.length > 0;

  const mailedAt = new Date();
  const responseDue = new Date(mailedAt.getTime() + RESPONSE_WINDOW_DAYS * DAY_MS);
  const nextRoundAt = new Date(mailedAt.getTime() + NEXT_ROUND_DAYS * DAY_MS);

  // The items in this round's letters: the ones a bureau response will be about.
  const inRound = new Set(plan.letters.flatMap((l) => l.itemFingerprints));
  const roundItems = items.filter((i) => inRound.has(i.fingerprint));

  // Nothing mailed: the one next step, the same one Home shows.
  const step = nextAction(sessionJourneyState(items, flags, sent), locale);

  return (
    <main className="animate-rise space-y-5">
      <header className="px-1">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-slate-900">{d.rounds.title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-500">
          {d.rounds.subtitle(RESPONSE_WINDOW_DAYS, NEXT_ROUND_DAYS)}
        </p>
      </header>

      {sent ? (
        <section className="card overflow-hidden">
          <div className="px-5 pb-4 pt-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[20px] font-semibold tabular-nums text-slate-900">
                {locale === "es" ? "Ataque" : "Attack"} #{roundNumber}
              </h2>
              <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                {d.rounds.inProgress}
              </span>
            </div>

            <div className="mt-4">
              <div className="h-1.5 rounded-full bg-slate-200">
                {/* Day 0 of the cycle: the clock has only just started. */}
                <div className="h-1.5 w-[4%] rounded-full bg-amber-400" />
              </div>
              <div className="mt-3 space-y-1 text-[13px] tabular-nums text-slate-500">
                <p>{d.rounds.mailed(fmt(mailedAt))}</p>
                <p>{d.rounds.responseBy(fmt(responseDue))}</p>
                <p>{d.rounds.nextRound(roundNumber + 1, fmt(nextRoundAt))}</p>
              </div>
              <p className="mt-3 text-[15px] leading-relaxed text-slate-700">{d.rounds.waitDays(RESPONSE_WINDOW_DAYS)}</p>
            </div>
          </div>

          <p className="border-t hairline px-5 pb-1 pt-4 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
            {d.rounds.lettersSent(plan.letters.length)}
          </p>
          <ul>
            {plan.letters.map((l, i) => (
              <li
                key={i}
                className={`flex items-start gap-3 px-5 py-3.5 text-[15px] leading-snug text-slate-500 ${i > 0 ? "border-t hairline" : ""}`}
              >
                <Icon name="doc" size={18} className="mt-px shrink-0 text-slate-400" />
                <span className="min-w-0 break-words">
                  <span className="font-medium text-slate-900">{l.target.name}</span> —{" "}
                  {(stages[l.templateKey] ?? stages[l.stage])?.name ?? l.stage}
                </span>
              </li>
            ))}
          </ul>

          {roundItems.length > 0 && <ResponseLogger items={roundItems} />}
        </section>
      ) : (
        <section className="card px-6 pb-6 pt-8 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-900">
            <Icon name="clock" size={26} />
          </span>
          <h2 className="mt-4 text-[22px] font-semibold leading-snug text-slate-900">{d.rounds.emptyTitle}</h2>
          <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-slate-500">{d.rounds.emptyBody}</p>
          <p className="mx-auto mt-4 max-w-sm text-[15px] font-medium leading-snug text-slate-900">{step.title}</p>
          <Link
            href={step.href}
            className="pressable mt-4 flex h-14 items-center justify-center rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500"
          >
            {step.cta}
          </Link>
        </section>
      )}
    </main>
  );
}

type Outcome = "deleted" | "corrected" | "verified" | "no_response";
const OUTCOME_KEY = "bonalti.outcomes.v1";

// Bureau-response intake: in CRC an agency employee does this data entry; here
// the consumer logs it in two taps when the response letter arrives. Feeds the
// escalation engine (a logged "verified" is what justifies the MOV letter).
// Demo: localStorage; authed: also POSTs to /api/letters/outcome (TODO once
// letter ids flow to the client).
function ResponseLogger({ items }: { items: ReportItem[] }) {
  const { locale, d } = useLocale();
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(OUTCOME_KEY);
      if (raw) setOutcomes(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  const log = (fp: string, outcome: Outcome) => {
    const next = { ...outcomes, [fp]: outcome };
    setOutcomes(next);
    try {
      window.localStorage.setItem(OUTCOME_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const options: Array<{ key: Outcome; label: string }> = [
    { key: "deleted", label: d.responses.deleted },
    { key: "corrected", label: d.responses.corrected },
    { key: "verified", label: d.responses.verified },
    { key: "no_response", label: d.responses.no_response },
  ];

  const anyVerified = items.some((i) => outcomes[i.fingerprint] === "verified");

  return (
    <div className="border-t hairline px-5 pb-5 pt-5">
      <p className="text-[17px] font-semibold leading-snug text-slate-900">{d.responses.title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{d.responses.note}</p>
      <div className="mt-4 space-y-5">
        {items.map((item) => (
          <div key={item.fingerprint}>
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 break-words text-[15px] font-medium text-slate-900">
                {itemLabel(item, locale)}
                <span className="font-normal text-slate-500"> · {BUREAU_LABEL[item.bureau]}</span>
              </p>
              {outcomes[item.fingerprint] && (
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                  {d.responses.saved}
                </span>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {options.map((o) => (
                <button
                  key={o.key}
                  onClick={() => log(item.fingerprint, o.key)}
                  aria-pressed={outcomes[item.fingerprint] === o.key}
                  className={`pressable min-h-11 rounded-full px-3 py-2 text-[13px] leading-tight ${
                    outcomes[item.fingerprint] === o.key
                      ? o.key === "deleted"
                        ? "bg-green-50 font-semibold text-green-700 ring-1 ring-inset ring-green-600"
                        : "bg-blue-50 font-semibold text-blue-700 ring-1 ring-inset ring-blue-600"
                      : "bg-slate-100 font-medium text-slate-900 hover:bg-slate-200"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {anyVerified && (
        <p className="mt-5 flex gap-2.5 rounded-2xl bg-blue-50 px-4 py-3 text-[13px] leading-relaxed text-blue-900">
          <Icon name="sparkle" size={18} className="mt-px shrink-0 text-blue-700" />
          <span>{d.responses.verifiedHint}</span>
        </p>
      )}
    </div>
  );
}
