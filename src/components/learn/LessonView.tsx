"use client";

import Link from "next/link";
import { CharacterAvatar } from "@/components/Character";
import Icon from "@/components/Icon";
import SpeakButton from "@/components/SpeakButton";
import { ASSISTANT_NAME } from "@/lib/brand";
import { useLocale } from "@/lib/i18n";
import { checkedOnLabel, getLesson, LESSONS, lessonReadAloud } from "@/lib/learn/lessons";

// One lesson: the character, the text, "Escuchar", the sources with the day
// they were checked, and the next lesson. Alti's lessons say he is AI. The
// team's own lessons (protecting yourself) show a plain team icon: Alti is the
// AI assistant now (docs/BRAND.md), so he never stands for the people.

export default function LessonView({ slug }: { slug: string }) {
  const { locale } = useLocale();
  const es = locale === "es";
  const lesson = getLesson(slug);
  if (!lesson) return null;
  const index = LESSONS.indexOf(lesson);
  const next = LESSONS[index + 1];

  return (
    <main className="animate-rise space-y-5" data-testid="lesson">
      <Link href="/aprende" className="inline-flex h-11 items-center gap-1 px-1 text-[15px] font-medium text-blue-700">
        <Icon name="chevron" size={16} className="rotate-180" />
        {es ? "Aprende" : "Learn"}
      </Link>

      <article className="card overflow-hidden">
        <div className={`flex items-end gap-4 px-5 pt-5 ${lesson.character === "team" ? "bg-amber-50" : "bg-blue-50"}`}>
          {lesson.character === "team" ? (
            <span className="mb-4 flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-blue-700 text-white">
              <Icon name="team" size={34} />
            </span>
          ) : (
            <CharacterAvatar character="assistant" size={72} className="mb-4" />
          )}
          <p className="mb-4 min-w-0 text-[14px] font-medium leading-snug text-slate-700">
            {lesson.character === "assistant"
              ? es
                ? `Te lo explica ${ASSISTANT_NAME}, tu asistente con IA.`
                : `${ASSISTANT_NAME}, your AI assistant, explains.`
              : es
                ? "Lo que tu equipo quiere que sepas."
                : "What your team wants you to know."}
          </p>
        </div>
        <div className="px-5 pb-5 pt-4">
          <h1 className="font-display text-[26px] font-bold leading-tight text-blue-700">{lesson.title[locale]}</h1>
          <SpeakButton
            text={lessonReadAloud(lesson, locale)}
            speaker={lesson.character === "assistant" ? "assistant" : "neutral"}
            label={lesson.title[locale]}
            className="mt-3"
          />
          <div className="mt-4 space-y-3 text-[17px] leading-relaxed text-slate-800">
            {lesson.body[locale].map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
          {lesson.tool && (
            <Link
              href={`/aprende/herramientas/${lesson.tool}`}
              className="pressable mt-5 flex h-12 items-center justify-center gap-2 rounded-full bg-amber-400 px-5 text-[16px] font-semibold text-blue-900 hover:bg-amber-500"
            >
              <Icon name={lesson.tool === "utilizacion" ? "calc" : "clock"} size={18} />
              {lesson.tool === "utilizacion" ? (es ? "Usar la calculadora" : "Use the calculator") : es ? "Calcular una fecha" : "Work out a date"}
            </Link>
          )}
        </div>
      </article>

      <section className="card px-5 py-5" aria-labelledby="sources" data-testid="lesson-sources">
        <h2 id="sources" className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">
          {es ? "Fuentes" : "Sources"}
        </h2>
        <ul className="mt-3 space-y-3">
          {lesson.sources.map((s) => (
            <li key={s.url} className="text-[14px] leading-snug text-slate-700">
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-block py-2.5 font-medium text-blue-700 underline underline-offset-2">
                {s.publisher}: {s.title}
              </a>
              <span className="mt-0.5 block text-[13px] text-slate-600">
                {s.status === "verified"
                  ? es
                    ? `Revisado el ${checkedOnLabel(s.checkedOn, "es")}`
                    : `Checked on ${checkedOnLabel(s.checkedOn, "en")}`
                  : es
                    ? "Pendiente de revisión: no lo pudimos confirmar en línea"
                    : "Pending review: we could not confirm it online"}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[13px] leading-relaxed text-slate-600">
          {es ? "Esto es información general, no consejo legal." : "This is general information, not legal advice."}
        </p>
      </section>

      {next && (
        <Link href={`/aprende/${next.slug}`} className="card pressable flex items-center gap-3.5 px-4 py-3.5">
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold uppercase tracking-wide text-slate-500">{es ? "Siguiente lección" : "Next lesson"}</span>
            <span className="block text-[17px] font-medium text-slate-900">{next.title[locale]}</span>
          </span>
          <Icon name="chevron" size={18} className="shrink-0 text-slate-400" />
        </Link>
      )}
    </main>
  );
}
