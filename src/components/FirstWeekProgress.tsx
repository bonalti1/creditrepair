"use client";

import { useLocale } from "@/lib/i18n";
import { FIRST_WEEK, firstWeekLabel, type FirstWeekStep } from "@/lib/ux/firstWeek";

// "Paso 2 de 4 · Tu acuerdo · unos 5 minutos": where the client is in their
// first week, the same four steps on onboarding and on the agreement.

export default function FirstWeekProgress({ step, className = "" }: { step: FirstWeekStep; className?: string }) {
  const { locale } = useLocale();
  const { index, text } = firstWeekLabel(step, locale);
  return (
    <div className={className} data-testid="first-week-progress">
      <div className="flex gap-1.5" aria-hidden="true">
        {FIRST_WEEK.map((s, i) => (
          <span key={s.key} className={`h-1.5 flex-1 rounded-full ${i < index ? "bg-blue-700" : "bg-slate-300"}`} />
        ))}
      </div>
      <p className="mt-2 text-[14px] font-medium text-slate-600">{text}</p>
    </div>
  );
}
