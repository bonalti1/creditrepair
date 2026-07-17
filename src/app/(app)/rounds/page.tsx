"use client";

import { RESPONSE_WINDOW_DAYS, NEXT_ROUND_DAYS } from "@/lib/ux/journey";
import { useLocale } from "@/lib/i18n";

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
    <main>
      <h1 className="text-2xl font-bold">{d.rounds.title}</h1>
      <p className="mt-1 text-slate-600">{d.rounds.subtitle(RESPONSE_WINDOW_DAYS, NEXT_ROUND_DAYS)}</p>

      <div className="mt-6 space-y-4">
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
            <div key={r.round} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <p className="font-bold">
                  {locale === "es" ? "Ataque" : "Attack"} #{r.round}
                </p>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    inProgress ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-700"
                  }`}
                >
                  {inProgress ? d.rounds.inProgress : d.rounds.completed}
                </span>
              </div>

              {inProgress && (
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>{d.rounds.mailed(fmt(new Date(r.mailedAt)))}</span>
                    <span>{d.rounds.responseBy(fmt(responseDue))}</span>
                    <span>{d.rounds.nextRound(r.round + 1, fmt(nextRoundAt))}</span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-slate-200">
                    <div
                      className="h-2 rounded-full bg-amber-500 transition-all"
                      style={{ width: `${Math.max(4, clockPct)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-sm text-amber-800">
                    {daysToResponse > 0 ? d.rounds.waitDays(daysToResponse) : d.rounds.windowClosed}
                  </p>
                </div>
              )}

              {r.outcome && <p className="mt-2 text-sm text-green-700">{r.outcome[locale]}</p>}

              <ul className="mt-3 space-y-1 text-sm text-slate-700">
                {r.letters.map((l, i) => (
                  <li key={i}>
                    📄 {l.target} — {STAGE_LABEL[l.stageKey]?.[locale] ?? l.stageKey}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </main>
  );
}
