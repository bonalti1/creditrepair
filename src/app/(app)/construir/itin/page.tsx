"use client";

import Link from "next/link";
import Icon from "@/components/Icon";
import { GeneralInfoNote, OffersSection, SourceList } from "@/components/aftercare/AftercareViews";
import { ID_TYPE_QUESTION, itinSections } from "@/lib/aftercare/itin";
import { useAftercare } from "@/lib/aftercare/useAftercare";
import { useLocale } from "@/lib/i18n";
import { humanHelpHref } from "@/lib/ux/humanHelp";

// The ITIN guide (/construir/itin): the right path for clients with an ITIN
// instead of a Social Security number. Monitoring (ask our team: not yet
// confirmed), how to get reports by mail, how our letters handle the number
// (never printed), building credit and buying a home with an ITIN. The words
// and what was verified are in src/lib/aftercare/itin.ts.

export default function ItinPage() {
  const { locale } = useLocale();
  const es = locale === "es";
  const { state, setIdType } = useAftercare();
  const team = humanHelpHref(locale);
  if (!state) return null;
  const q = ID_TYPE_QUESTION[locale];

  return (
    <main className="animate-rise space-y-5" data-testid="itin-guide">
      <Link href="/construir" className="inline-flex h-11 items-center gap-1 px-1 text-[15px] font-medium text-blue-700">
        <Icon name="chevron" size={16} className="rotate-180" />
        {es ? "Construye tu crédito" : "Build your credit"}
      </Link>
      <header className="px-1">
        <h1 className="font-display text-[30px] font-bold leading-tight text-blue-700">{es ? "Guía para personas con ITIN" : "Guide for people with an ITIN"}</h1>
        <p className="mt-2 text-[16px] leading-relaxed text-slate-600">
          {es ? "Lo que cambia si tienes ITIN en lugar de número de Seguro Social, paso a paso." : "What changes if you have an ITIN instead of a Social Security number, step by step."}
        </p>
      </header>

      {state.idType !== "itin" && (
        <section className="card p-4" data-testid="itin-set">
          <p className="text-[15px] leading-relaxed text-slate-700">{es ? "¿Tienes ITIN? Dínoslo y te mostramos este camino en toda la app." : "Do you have an ITIN? Tell us and we will show this path across the app."}</p>
          <button type="button" onClick={() => setIdType("itin")} className="pressable mt-3 flex h-12 w-full items-center justify-center rounded-full bg-amber-400 text-[16px] font-semibold text-blue-900 hover:bg-amber-500">
            {es ? "Tengo ITIN" : "I have an ITIN"}
          </button>
          <p className="mt-2 text-[13px] leading-snug text-slate-500">{q.note}</p>
        </section>
      )}

      <ol className="space-y-3">
        {itinSections().map((s) => (
          <li key={s.key} className="card p-5" data-testid={`itin-${s.key}`}>
            <h2 className="text-[18px] font-semibold leading-snug text-slate-900">{s.title[locale]}</h2>
            <div className="mt-2 space-y-2 text-[16px] leading-relaxed text-slate-800">
              {s.body[locale].map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
            {s.askTeam && (
              <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-snug text-blue-900" role="note" data-testid="itin-ask-team">
                <p className="font-semibold">{es ? "Pregúntale a nuestro equipo" : "Ask our team"}</p>
                {team ? (
                  <a href={team} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex h-10 items-center font-semibold text-blue-700 underline underline-offset-2">
                    {es ? "Escribir por WhatsApp" : "Write on WhatsApp"}
                  </a>
                ) : (
                  <p className="mt-1">{es ? "Escríbenos desde Más → Hablar con una persona." : "Write to us from More → Talk to a person."}</p>
                )}
              </div>
            )}
            {s.key === "home" && (
              <Link href="/construir/casa" className="mt-3 inline-flex h-11 items-center gap-1 text-[15px] font-semibold text-blue-700">
                {es ? "Ver el camino para comprar casa" : "See the path to buying a home"}
                <Icon name="chevron" size={16} />
              </Link>
            )}
            <SourceList keys={s.sources} locale={locale} />
          </li>
        ))}
      </ol>

      <OffersSection offers={state.offers} locale={locale} itinOnly />

      <GeneralInfoNote locale={locale} className="px-1" />
    </main>
  );
}
