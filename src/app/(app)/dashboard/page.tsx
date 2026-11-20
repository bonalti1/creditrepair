"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DEMO_REPORT, DEMO_SCORE_HISTORY, firstScoresForTrend } from "@/lib/demo";
import { useFlags } from "@/lib/ux/flagsStore";
import { nextAction, sessionJourneyState } from "@/lib/ux/journey";
import { useLocale } from "@/lib/i18n";
import Icon, { type IconName } from "@/components/Icon";

// Home. One glance tells you where you stand; one button tells you what to do.
// Everything else is a quiet tap away. (Modeled on the best car and device
// apps: status first, a single primary action, then shortcuts.)

const BUREAUS = [
  ["equifax", "Equifax"],
  ["experian", "Experian"],
  ["transunion", "TransUnion"],
] as const;

const SCORE_MIN = 300;
const SCORE_MAX = 850;

function ScoreRing({ score, caption }: { score: number; caption: string }) {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const size = 204;
  const stroke = 13;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const track = circumference * 0.75; // 270° gauge, open at the bottom
  const pct = Math.min(1, Math.max(0, (score - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)));
  const center = size / 2;

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`${score}`}>
        <defs>
          <linearGradient id="ring" x1="0" y1="0" x2={size} y2={size} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--color-amber-600)" />
            <stop offset="1" stopColor="var(--color-amber-300)" />
          </linearGradient>
        </defs>
        <g transform={`rotate(135 ${center} ${center})`} fill="none" strokeWidth={stroke} strokeLinecap="round">
          <circle cx={center} cy={center} r={r} stroke="var(--color-slate-200)" strokeDasharray={`${track} ${circumference}`} />
          <circle
            cx={center}
            cy={center}
            r={r}
            stroke="url(#ring)"
            strokeDasharray={`${drawn ? track * pct : 0} ${circumference}`}
            style={{ transition: "stroke-dasharray 1.3s cubic-bezier(0.2, 0.8, 0.2, 1)" }}
          />
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[56px] font-semibold leading-none tracking-tight tabular-nums text-slate-900">
          {score}
        </span>
        <span className="mt-2 text-[13px] text-slate-500">{caption}</span>
      </div>
    </div>
  );
}

function average(scores: Partial<Record<string, number>>): number | null {
  const values = Object.values(scores).filter((v): v is number => typeof v === "number");
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

export default function Home() {
  const { flags, roundApproved, hydrated } = useFlags();
  const { locale, d } = useLocale();
  const es = locale === "es";
  const items = DEMO_REPORT.items;
  const negatives = items.filter((i) => i.negative);

  if (!hydrated) return null;

  // Built by the shared helper so Home, Review, Audit and Rounds agree on the next step.
  const step = nextAction(sessionJourneyState(items, flags, roundApproved), locale);

  const score = average(DEMO_REPORT.scores);
  // A change is shown only between two real pulls. With one pull (the demo, or
  // a customer's first day) today's score is the starting point and nothing more.
  const firstScores = firstScoresForTrend(DEMO_SCORE_HISTORY);
  const firstScore = firstScores ? average(firstScores) : null;
  const delta = score !== null && firstScore !== null ? score - firstScore : null;

  const shortcuts: Array<{ href: string; icon: IconName; label: string }> = [
    { href: "/items", icon: "search", label: es ? "Revisar" : "Review" },
    { href: "/attack", icon: "doc", label: es ? "Cartas" : "Letters" },
    { href: "/rounds", icon: "clock", label: es ? "Rondas" : "Rounds" },
    { href: "/audit", icon: "clipboard", label: es ? "Auditoría" : "Audit" },
  ];

  return (
    <main className="animate-rise space-y-5">
      <section className="card px-6 pb-5 pt-6 text-center">
        {score !== null && (
          <ScoreRing score={score} caption={es ? "Promedio de tus 3 burós" : "Average of your 3 bureaus"} />
        )}

        {delta !== null && (
          <p
            className={`mx-auto -mt-6 inline-flex items-center rounded-full px-3 py-1 text-[13px] font-semibold ${
              delta >= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}
          >
            {d.scores.trend(delta)}
          </p>
        )}

        <h1 className="mt-4 text-[22px] font-semibold leading-snug text-slate-900">{step.title}</h1>
        <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-slate-500">{step.description}</p>

        <Link
          href={step.href}
          className="pressable mt-5 flex h-14 items-center justify-center rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500"
        >
          {step.cta}
        </Link>

        <div className="mt-4 flex justify-center gap-1.5" aria-hidden="true">
          {Array.from({ length: step.totalSteps }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full ${i < step.step ? "w-6 bg-blue-700" : "w-1.5 bg-slate-300"}`}
            />
          ))}
        </div>
      </section>

      <section className="grid grid-cols-4 gap-3">
        {shortcuts.map((s) => (
          <Link key={s.href} href={s.href} className="card pressable flex flex-col items-center gap-2 px-2 py-4">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-900">
              <Icon name={s.icon} size={22} />
            </span>
            <span className="text-xs font-medium text-slate-700">{s.label}</span>
          </Link>
        ))}
      </section>

      <section>
        <h2 className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
          {es ? "Tus burós" : "Your bureaus"}
        </h2>
        <div className="card overflow-hidden">
          {BUREAUS.map(([key, label], index) => {
            const bureauScore = DEMO_REPORT.scores[key];
            const first = firstScores?.[key];
            const bureauDelta = bureauScore && first ? bureauScore - first : null;
            const neg = negatives.filter((i) => i.bureau === key).length;
            return (
              <Link
                key={key}
                href="/audit"
                className={`pressable flex items-center gap-3 px-5 py-4 hover:bg-slate-50 ${
                  index > 0 ? "border-t hairline" : ""
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-medium text-slate-900">{label}</span>
                  <span className="block text-[13px] text-slate-500">{d.dashboard.negatives(neg)}</span>
                </span>
                {bureauScore && (
                  <span className="text-right">
                    <span className="block text-[20px] font-semibold tabular-nums text-slate-900">{bureauScore}</span>
                    {bureauDelta !== null && (
                      <span className={`block text-xs font-medium ${bureauDelta >= 0 ? "text-green-700" : "text-red-700"}`}>
                        {bureauDelta >= 0 ? `+${bureauDelta}` : bureauDelta}
                      </span>
                    )}
                  </span>
                )}
                <Icon name="chevron" size={18} className="text-slate-300" />
              </Link>
            );
          })}
        </div>
        <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">{d.audit.scoreNote}</p>
      </section>
    </main>
  );
}
