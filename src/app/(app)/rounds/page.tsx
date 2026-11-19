"use client";

import { useEffect, useState } from "react";
import { DEMO_REPORT } from "@/lib/demo";
import { RESPONSE_WINDOW_DAYS, NEXT_ROUND_DAYS } from "@/lib/ux/journey";
import { useLocale } from "@/lib/i18n";
import Icon from "@/components/Icon";

// Round history with a real timeline: when letters mailed, when the FCRA
// ~30-day response window closes, when the next round unlocks (~day 40).
// The waiting period is where Dispute Beast users feel abandoned — here the
// clock is always visible and explained.

const DEMO_ROUNDS = [
  {
    round: 1,
    mailedAt: "2026-06-05",
    letters: [
      { target: "Equifax", stageKey: "personal_info_cleanup" },
      { target: "Experian", stageKey: "personal_info_cleanup" },
      { target: "TransUnion", stageKey: "personal_info_cleanup" },
    ],
    outcome: { es: "✅ 2 datos personales corregidos", en: "✅ 2 personal-info entries corrected" },
  },
  {
    round: 2,
    mailedAt: "2026-07-15",
    letters: [
      { target: "Equifax", stageKey: "dispute" },
      { target: "Experian", stageKey: "dispute" },
      { target: "TransUnion", stageKey: "dispute" },
      { target: "LexisNexis", stageKey: "secondary_bureau_request" },
      { target: "Innovis", stageKey: "secondary_bureau_request" },
    ],
    outcome: null,
  },
];

const STAGE_LABEL: Record<string, { es: string; en: string }> = {
  personal_info_cleanup: { es: "Limpieza de datos personales", en: "Personal info cleanup" },
  dispute: { es: "Disputa FCRA §611", en: "FCRA §611 dispute" },
  secondary_bureau_request: { es: "Solicitud de expediente §609", en: "§609 file request" },
};

function addDays(iso: string, days: number): Date {
  return new Date(new Date(iso).getTime() + days * 24 * 60 * 60 * 1000);
}

export default function Rounds() {
  const { locale, d } = useLocale();
  const now = new Date();
  const fmt = (date: Date) =>
    date.toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { day: "numeric", month: "long" });

  return (
    <main className="animate-rise space-y-5">
      <header className="px-1">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-slate-900">{d.rounds.title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-500">
          {d.rounds.subtitle(RESPONSE_WINDOW_DAYS, NEXT_ROUND_DAYS)}
        </p>
      </header>

      {[...DEMO_ROUNDS].reverse().map((r) => {
        const responseDue = addDays(r.mailedAt, RESPONSE_WINDOW_DAYS);
        const nextRoundAt = addDays(r.mailedAt, NEXT_ROUND_DAYS);
        const daysToResponse = Math.ceil((responseDue.getTime() - now.getTime()) / 86400000);
        const inProgress = !r.outcome;
        const clockPct = Math.min(
          100,
          Math.round(
            ((now.getTime() - new Date(r.mailedAt).getTime()) /
              (nextRoundAt.getTime() - new Date(r.mailedAt).getTime())) *
              100,
          ),
        );

        return (
          <section key={r.round} className="card overflow-hidden">
            <div className="px-5 pb-4 pt-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[20px] font-semibold tabular-nums text-slate-900">
                  {locale === "es" ? "Ataque" : "Attack"} #{r.round}
                </h2>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    inProgress ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"
                  }`}
                >
                  {inProgress ? d.rounds.inProgress : d.rounds.completed}
                </span>
              </div>

              {inProgress && (
                <div className="mt-4">
                  <div className="h-1.5 rounded-full bg-slate-200">
                    <div
                      className="h-1.5 rounded-full bg-amber-400 transition-all"
                      style={{ width: `${Math.max(4, clockPct)}%` }}
                    />
                  </div>
                  <div className="mt-3 space-y-1 text-[13px] tabular-nums text-slate-500">
                    <p>{d.rounds.mailed(fmt(new Date(r.mailedAt)))}</p>
                    <p>{d.rounds.responseBy(fmt(responseDue))}</p>
                    <p>{d.rounds.nextRound(r.round + 1, fmt(nextRoundAt))}</p>
                  </div>
                  <p className="mt-3 text-[15px] leading-relaxed text-slate-700">
                    {daysToResponse > 0 ? d.rounds.waitDays(daysToResponse) : d.rounds.windowClosed}
                  </p>
                </div>
              )}

              {r.outcome && (
                <p className="mt-2 text-[15px] font-medium leading-snug text-green-700">{r.outcome[locale]}</p>
              )}
            </div>

            <ul>
              {r.letters.map((l, i) => (
                <li key={i} className="flex items-start gap-3 border-t hairline px-5 py-3.5 text-[15px] leading-snug text-slate-500">
                  <Icon name="doc" size={18} className="mt-px shrink-0 text-slate-400" />
                  <span className="min-w-0">
                    <span className="font-medium text-slate-900">{l.target}</span> —{" "}
                    {STAGE_LABEL[l.stageKey]?.[locale] ?? l.stageKey}
                  </span>
                </li>
              ))}
            </ul>

            {inProgress && <ResponseLogger />}
          </section>
        );
      })}
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
function ResponseLogger() {
  const { d } = useLocale();
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const items = DEMO_REPORT.items.filter((i) => i.negative && i.category !== "personal_info");

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

  const anyVerified = Object.values(outcomes).includes("verified");

  return (
    <div className="border-t hairline px-5 pb-5 pt-5">
      <p className="text-[17px] font-semibold leading-snug text-slate-900">{d.responses.title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{d.responses.note}</p>
      <div className="mt-4 space-y-5">
        {items.map((item) => (
          <div key={item.fingerprint}>
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 break-words text-[15px] font-medium text-slate-900">{item.name}</p>
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
