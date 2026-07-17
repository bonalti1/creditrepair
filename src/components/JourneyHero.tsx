"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { stepLabel, type JourneyStep } from "@/lib/ux/journey";

// The "what's next?" hero: one next step, one button. Shown at the top of the
// dashboard so the user never has to figure out what to do.

export default function JourneyHero({ step }: { step: JourneyStep }) {
  const { locale } = useLocale();
  const stepWord = locale === "es" ? "Paso" : "Step";
  const ofWord = locale === "es" ? "de" : "of";

  return (
    <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-6">
      <div className="mb-3 flex items-center gap-2">
        {Array.from({ length: step.totalSteps }, (_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full ${i < step.step ? "bg-blue-600" : "bg-slate-200"}`}
          />
        ))}
      </div>
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
        {stepWord} {step.step} {ofWord} {step.totalSteps} · {stepLabel(locale)}
      </p>
      <h2 className="mt-1 text-xl font-bold text-slate-900">{step.title}</h2>
      <p className="mt-2 text-sm text-slate-600">{step.description}</p>
      <Link
        href={step.href}
        className="mt-4 inline-block rounded-lg bg-blue-700 px-5 py-2.5 font-semibold text-white hover:bg-blue-800"
      >
        {step.cta} →
      </Link>
    </div>
  );
}
