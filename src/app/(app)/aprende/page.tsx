"use client";

import Link from "next/link";
import { CharacterAvatar } from "@/components/Character";
import Icon from "@/components/Icon";
import { useLocale } from "@/lib/i18n";
import { LESSONS } from "@/lib/learn/lessons";
import { ASSISTANT_NAME } from "@/lib/brand";

// "Aprende": short lessons about how credit works, and two simple tools. The
// lessons and their sources are in src/lib/learn/lessons.ts.

export default function AprendePage() {
  const { locale } = useLocale();
  const es = locale === "es";
  return (
    <main className="animate-rise space-y-6" data-testid="aprende">
      <header className="px-1">
        <h1 className="font-display text-[30px] font-bold leading-tight text-blue-700">{es ? "Aprende" : "Learn"}</h1>
        <p className="mt-2 text-[16px] leading-relaxed text-slate-600">
          {es
            ? "Lecciones cortas sobre el crédito, en palabras simples. Cada una se lee en 1 minuto, o la puedes escuchar."
            : "Short lessons about credit, in plain words. Each one takes 1 minute to read, or you can listen to it."}
        </p>
      </header>

      <section aria-labelledby="lessons">
        <h2 id="lessons" className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
          {es ? "Lecciones" : "Lessons"}
        </h2>
        <ol className="card overflow-hidden">
          {LESSONS.map((lesson, i) => (
            <li key={lesson.slug} className={i > 0 ? "border-t hairline" : ""}>
              <Link href={`/aprende/${lesson.slug}`} className="pressable flex items-center gap-3.5 px-4 py-3.5 hover:bg-slate-50">
                {lesson.character === "assistant" ? (
                  <CharacterAvatar character="assistant" size={40} decorative />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-700 text-white">
                    <Icon name="team" size={20} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-medium leading-snug text-slate-900">{lesson.title[locale]}</span>
                  <span className="block text-[14px] leading-snug text-slate-600">{lesson.summary[locale]}</span>
                </span>
                <Icon name="chevron" size={18} className="shrink-0 text-slate-400" />
              </Link>
            </li>
          ))}
        </ol>
        <p className="px-1 pt-2 text-[13px] leading-relaxed text-slate-600">
          {es
            ? `La mayoría de las lecciones las presenta ${ASSISTANT_NAME}, nuestro asistente con IA; las de cuidarte son palabras del equipo. Las escribió el equipo de Credalti, con fuentes del gobierno.`
            : `${ASSISTANT_NAME}, our AI assistant, presents most lessons; the ones on protecting yourself are the team's own words. The Credalti team wrote them, with government sources.`}
        </p>
      </section>

      <section aria-labelledby="tools">
        <h2 id="tools" className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
          {es ? "Herramientas" : "Tools"}
        </h2>
        <div className="card overflow-hidden">
          <Link href="/aprende/herramientas/utilizacion" className="pressable flex items-center gap-3.5 px-4 py-3.5 hover:bg-slate-50">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-700 text-white">
              <Icon name="calc" size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[17px] font-medium text-slate-900">{es ? "Calculadora de utilización" : "Utilization calculator"}</span>
              <span className="block text-[14px] leading-snug text-slate-600">{es ? "Cuánto usas de tus tarjetas." : "How much of your cards you use."}</span>
            </span>
            <Icon name="chevron" size={18} className="shrink-0 text-slate-400" />
          </Link>
          <Link href="/aprende/herramientas/cuanto-tiempo" className="pressable flex items-center gap-3.5 border-t hairline px-4 py-3.5 hover:bg-slate-50">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-700 text-white">
              <Icon name="clock" size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[17px] font-medium text-slate-900">{es ? "¿Hasta cuándo se puede reportar?" : "How long can it be reported?"}</span>
              <span className="block text-[14px] leading-snug text-slate-600">{es ? "Según la ley de reportes de crédito." : "Under the credit reporting law."}</span>
            </span>
            <Icon name="chevron" size={18} className="shrink-0 text-slate-400" />
          </Link>
        </div>
      </section>
    </main>
  );
}
