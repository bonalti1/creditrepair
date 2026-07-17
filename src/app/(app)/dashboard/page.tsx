"use client";

import { DEMO_REPORT } from "@/lib/demo";
import { countByState, useFlags } from "@/lib/ux/flagsStore";
import { nextAction } from "@/lib/ux/journey";
import { useLocale } from "@/lib/i18n";
import JourneyHero from "@/components/JourneyHero";

// Dashboard = the journey hero ("what's next?") + a glanceable state of the
// user's report and goal. One primary action, zero guessing.

const BUREAU_LABEL: Record<string, string> = {
  equifax: "Equifax",
  experian: "Experian",
  transunion: "TransUnion",
};

export default function Dashboard() {
  const { flags, roundApproved, hydrated } = useFlags();
  const { locale, d } = useLocale();
  const items = DEMO_REPORT.items;
  const negatives = items.filter((i) => i.negative);
  const counts = countByState(flags);

  if (!hydrated) return null;

  const step = nextAction(
    {
      reportImported: true,
      totalItems: items.length,
      reviewedCount: counts.reviewed,
      attestedCount: counts.attested,
      roundApproved,
      mailedAt: roundApproved ? new Date().toISOString() : null,
    },
    locale,
  );

  const goalPct = Math.min(
    100,
    Math.round(
      ((counts.reviewed * 0.4 + (roundApproved ? counts.attested : 0) * 0.6) /
        Math.max(1, items.length * 0.4 + negatives.length * 0.6)) *
        100,
    ),
  );

  return (
    <main>
      <h1 className="text-2xl font-bold">{d.dashboard.greeting}</h1>
      <p className="mt-1 text-slate-600">
        {d.dashboard.imported(
          new Date(DEMO_REPORT.pulledAt).toLocaleDateString(locale === "es" ? "es-MX" : "en-US"),
        )}
      </p>

      <div className="mt-6">
        <JourneyHero step={step} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Object.entries(BUREAU_LABEL).map(([key, label]) => {
          const count = items.filter((i) => i.bureau === key).length;
          const neg = negatives.filter((i) => i.bureau === key).length;
          return (
            <div key={key} className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="font-semibold">{label}</p>
              <p className="mt-1 text-sm text-slate-600">{d.dashboard.items(count)}</p>
              <p className={`text-sm ${neg > 0 ? "text-red-600" : "text-green-600"}`}>
                {d.dashboard.negatives(neg)}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <p className="font-semibold">{d.dashboard.goalTitle}</p>
          <span className="text-sm font-semibold text-blue-700">{goalPct}%</span>
        </div>
        <div className="mt-2 h-2.5 rounded-full bg-slate-200">
          <div
            className="h-2.5 rounded-full bg-gradient-to-r from-blue-500 to-blue-700 transition-all"
            style={{ width: `${goalPct}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-slate-500">{d.dashboard.goalNote}</p>
      </div>
    </main>
  );
}
