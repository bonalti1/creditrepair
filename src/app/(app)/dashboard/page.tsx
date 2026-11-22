"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { demoImportedAt } from "@/lib/demo";
import { useAgreement } from "@/lib/ux/agreementStore";
import { useFlags } from "@/lib/ux/flagsStore";
import { nextAction, sessionJourneyState } from "@/lib/ux/journey";
import { useClientReport, withReport } from "@/lib/ux/reportStore";
import ReportPending from "@/components/ReportPending";
import { useLocale } from "@/lib/i18n";
import Icon, { type IconName } from "@/components/Icon";

// Home. The journey's next step comes first, with its one button; shortcuts
// and the client's own scores follow.
//
// Scores are shown as plain facts from the report: each bureau's current
// number, in neutral colours, with its source and date. No dial or gauge, no
// average in large type, no change since an earlier report, no green or red
// and no arrows: the brand kit forbids credit-score visuals that read as a
// progress claim, and the owner decided on 2026-11-22 that the client app
// keeps only the plain numbers (docs/BRAND.md). A test keeps them out.

const BUREAUS = [
  ["equifax", "Equifax"],
  ["experian", "Experian"],
  ["transunion", "TransUnion"],
] as const;

export default function Home() {
  const { flags, roundApproved, roundMailedAt, hydrated } = useFlags();
  // The agreement comes first in the journey, so Home waits for it too.
  const { agreement, hydrated: agreementReady } = useAgreement();
  const { locale, d } = useLocale();
  const es = locale === "es";
  // The sample report in the demo; the client's own with a database (lib/ux/reportStore.ts).
  const view = useClientReport();
  const { report, items } = view;
  const negatives = items.filter((i) => i.negative);

  // The report's date, as the audit shows it: the demo reads as imported today, the client's own
  // report carries its date. Worked out in the browser after mount, so the server's day never
  // disagrees with the visitor's.
  const [importedAt, setImportedAt] = useState<Date | null>(null);
  const pulledAt = view.live ? view.report.pulledAt : null;
  useEffect(() => setImportedAt(pulledAt === null ? demoImportedAt() : pulledAt ? new Date(pulledAt) : null), [pulledAt]);

  if (!hydrated || !agreementReady || !view.ready) return null;

  // Built by the shared helper so Home, Review, Audit and Rounds agree on the next step.
  const step = nextAction(withReport(sessionJourneyState(items, flags, roundApproved, agreement), view, roundMailedAt), locale);
  const fmtDate = importedAt ? importedAt.toLocaleDateString(es ? "es-MX" : "en-US") : "";

  const shortcuts: Array<{ href: string; icon: IconName; label: string }> = [
    { href: "/items", icon: "search", label: es ? "Revisar" : "Review" },
    { href: "/attack", icon: "doc", label: es ? "Cartas" : "Letters" },
    { href: "/rounds", icon: "clock", label: es ? "Rondas" : "Rounds" },
    { href: "/audit", icon: "clipboard", label: es ? "Auditoría" : "Audit" },
  ];

  return (
    <main className="animate-rise space-y-5">
      <section className="card px-6 pb-6 pt-6" data-testid="next-step">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-blue-700">
          {es ? `Tu siguiente paso · ${step.step} de ${step.totalSteps}` : `Your next step · ${step.step} of ${step.totalSteps}`}
        </p>
        <h1 className="mt-2 font-display text-[26px] font-bold leading-tight text-blue-700">{step.title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{step.description}</p>

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

      {view.waiting && <ReportPending compact showLink={false} />}

      {!view.waiting && (
        <section data-testid="scores">
          <h2 className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{d.scores.title}</h2>
          <div className="card overflow-hidden">
            {BUREAUS.map(([key, label], index) => {
              const bureauScore = report.scores[key];
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
                  <span className="text-[20px] font-semibold tabular-nums text-slate-900">{bureauScore ?? "—"}</span>
                  <Icon name="chevron" size={18} className="text-slate-300" />
                </Link>
              );
            })}
          </div>
          <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">
            {d.audit.scoreNote}
            {/* Holds its place until the date is known, so nothing jumps. */}
            <span className={`block ${fmtDate ? "" : "invisible"}`}>{d.dashboard.imported(fmtDate || "…")}</span>
          </p>
        </section>
      )}
    </main>
  );
}
