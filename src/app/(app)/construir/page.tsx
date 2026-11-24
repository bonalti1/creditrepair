"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CharacterAvatar } from "@/components/Character";
import Icon from "@/components/Icon";
import { GeneralInfoNote, OffersSection, PlanItemCard } from "@/components/aftercare/AftercareViews";
import { personalPlan } from "@/lib/aftercare/plan";
import { useAftercare } from "@/lib/aftercare/useAftercare";
import { ASSISTANT_NAME } from "@/lib/brand";
import { useLocale } from "@/lib/i18n";
import { useClientReport } from "@/lib/ux/reportStore";

// "Build your credit" (/construir): a short personal checklist for every
// client, from day one. The habits that matter, why in plain words, what to
// do, and "Mark as done". Personal notes come from the client's own report
// (src/lib/aftercare/plan.ts): facts that are on it, never a prediction. The
// partner offers below are optional, off unless the owner turned them on,
// and ranked by what they cost the client.

export default function ConstruirPage() {
  const { locale } = useLocale();
  const es = locale === "es";
  const report = useClientReport();
  const { state, mark } = useAftercare();
  const [open, setOpen] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  const plan = useMemo(
    () => personalPlan({ items: report.items, goal: state?.goal ?? null, idType: state?.idType ?? null, now }, locale),
    [report.items, state?.goal, state?.idType, now, locale],
  );

  if (!state || !report.ready) return null;
  const done = plan.items.filter((e) => state.marks[e.item.key]?.done).length;

  return (
    <main className="animate-rise space-y-5" data-testid="construir">
      <header className="px-1">
        <h1 className="font-display text-[30px] font-bold leading-tight text-blue-700">{es ? "Construye tu crédito" : "Build your credit"}</h1>
        <p className="mt-2 text-[16px] leading-relaxed text-slate-600">
          {es
            ? "Hábitos que cuentan en tu historial, en orden según tu reporte y tu meta. Es gratis, y lo puedes empezar hoy."
            : "Habits that count in your history, in order for your report and your goal. It is free, and you can start today."}
        </p>
      </header>

      <section className="card flex items-center gap-4 px-5 py-4" aria-live="polite">
        <CharacterAvatar character="assistant" size={48} />
        <div className="min-w-0">
          <p className="text-[17px] font-semibold text-slate-900">{es ? `${done} de ${plan.items.length} hechos` : `${done} of ${plan.items.length} done`}</p>
          <p className="text-[13px] leading-snug text-slate-600">
            {es ? `Las notas en azul vienen de tu reporte. ${ASSISTANT_NAME}, tu asistente con IA, te explica cualquier paso.` : `Notes in blue come from your report. ${ASSISTANT_NAME}, your AI assistant, can explain any step.`}
          </p>
        </div>
      </section>

      {state.goal === "mortgage" && (
        <Link href="/construir/casa" className="card pressable flex items-center gap-3.5 px-4 py-4" data-testid="home-ready-link">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-900 text-white">
            <Icon name="home" size={22} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-semibold text-slate-900">{es ? "Tu camino para comprar casa" : "Your path to buying a home"}</span>
            <span className="block text-[14px] leading-snug text-slate-600">{es ? "Pasos, lo que miran los prestamistas y hablar con un oficial de préstamos." : "Milestones, what lenders look at, and talking to a loan officer."}</span>
          </span>
          <Icon name="chevron" size={18} className="shrink-0 text-slate-400" />
        </Link>
      )}

      {state.idType === "itin" && (
        <Link href="/construir/itin" className="card pressable flex items-center gap-3.5 px-4 py-4" data-testid="itin-link">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-blue-900">
            <Icon name="doc" size={22} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-semibold text-slate-900">{es ? "Guía para personas con ITIN" : "Guide for people with an ITIN"}</span>
            <span className="block text-[14px] leading-snug text-slate-600">{es ? "Monitoreo, cómo pedir tus reportes y tus cartas." : "Monitoring, how to get your reports, and your letters."}</span>
          </span>
          <Icon name="chevron" size={18} className="shrink-0 text-slate-400" />
        </Link>
      )}

      <section aria-labelledby="plan">
        <h2 id="plan" className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{es ? "Tu plan" : "Your plan"}</h2>
        <ol className="space-y-3">
          {plan.items.map((entry) => (
            <PlanItemCard
              key={entry.item.key}
              entry={entry}
              locale={locale}
              done={state.marks[entry.item.key]?.done === true}
              onToggle={() => mark(entry.item.key, !(state.marks[entry.item.key]?.done === true))}
              open={open === entry.item.key}
              onOpen={() => setOpen(open === entry.item.key ? null : entry.item.key)}
            />
          ))}
        </ol>
        <GeneralInfoNote locale={locale} className="px-1 pt-3" />
      </section>

      <OffersSection offers={state.offers} locale={locale} />

      {state.idType !== "itin" && (
        <p className="px-1 text-[14px] leading-relaxed text-slate-600">
          {es ? "¿Tienes ITIN en lugar de Seguro Social? " : "Do you have an ITIN instead of a Social Security number? "}
          <Link href="/construir/itin" className="font-medium text-blue-700 underline underline-offset-2">
            {es ? "Mira la guía para ITIN" : "See the ITIN guide"}
          </Link>
        </p>
      )}
    </main>
  );
}
