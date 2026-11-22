"use client";

import Link from "next/link";
import { caseDay, caseReadAloud, type CaseEvent, type CaseNext, type CaseTimeline, type CaseTone } from "@/lib/case/timeline";
import type { CaseView } from "@/lib/case/useCase";
import { useLocale } from "@/lib/i18n";
import Icon from "@/components/Icon";
import SpeakButton from "@/components/SpeakButton";

// The pieces of "Mi caso": the one status sentence, the compact card on Home,
// and the full timeline. The words come from src/lib/case/timeline.ts.

/** "Ejemplo": shown wherever the demo's example case is on screen. */
export function ExampleBadge({ className = "" }: { className?: string }) {
  const { locale } = useLocale();
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-[12px] font-semibold text-blue-900 ${className}`}>
      {locale === "es" ? "Ejemplo" : "Example"}
    </span>
  );
}

/** "¿Qué está pasando?": the status sentence, with "Escuchar". */
export function CaseStatus({ view, showLink = true }: { view: CaseView; showLink?: boolean }) {
  const { locale } = useLocale();
  const es = locale === "es";
  return (
    <section data-testid="case-status" aria-labelledby="case-status-title" className="rounded-3xl bg-blue-700 px-5 pb-5 pt-4 text-white">
      <div className="flex items-center justify-between gap-3">
        <h2 id="case-status-title" data-on-navy className="text-[13px] font-semibold uppercase tracking-wide text-amber-300">
          {es ? "¿Qué está pasando?" : "What's happening?"}
        </h2>
        {view.example && <ExampleBadge />}
      </div>
      <p className="mt-2 text-[18px] font-medium leading-snug" data-testid="case-sentence">
        {view.timeline.sentence}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <SpeakButton text={view.timeline.sentence} label={es ? "qué está pasando" : "what's happening"} tone="dark" />
        {showLink && (
          <Link href="/caso" className="pressable inline-flex h-11 items-center gap-1 rounded-full px-3 text-[15px] font-semibold text-white underline-offset-4 hover:underline">
            {es ? "Ver mi caso" : "See my case"}
            <Icon name="chevron" size={16} />
          </Link>
        )}
      </div>
    </section>
  );
}

const TONE: Record<CaseTone, string> = {
  done: "bg-blue-50 text-blue-700",
  info: "bg-slate-100 text-slate-700",
  attention: "bg-amber-100 text-amber-700",
};

function EventRow({ event, last }: { event: CaseEvent; last: boolean }) {
  return (
    <li className="relative flex gap-3.5 pb-5">
      {!last && <span aria-hidden="true" className="absolute left-[19px] top-11 bottom-0 w-px bg-slate-200" />}
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${TONE[event.tone]}`}>
        <Icon name={event.icon} size={19} />
      </span>
      <span className="min-w-0 flex-1 pt-0.5">
        <span className="block text-[13px] font-medium tabular-nums text-slate-500">{event.day}</span>
        <span className="block text-[16px] font-semibold leading-snug text-slate-900">{event.title}</span>
        {event.detail && <span className="mt-0.5 block text-[15px] leading-snug text-slate-600">{event.detail}</span>}
      </span>
    </li>
  );
}

function NextRow({ next, locale }: { next: CaseNext; locale: "es" | "en" }) {
  const dated = next.at && !next.title.includes(caseDay(next.at, locale));
  const body = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <Icon name="clock" size={19} />
      </span>
      <span className="min-w-0 flex-1 pt-0.5">
        {dated && <span className="block text-[13px] font-medium tabular-nums text-amber-700">{locale === "es" ? `Alrededor del ${caseDay(next.at!, locale)}` : `Around ${caseDay(next.at!, locale)}`}</span>}
        <span className="block text-[16px] font-semibold leading-snug text-slate-900">{next.title}</span>
        {next.detail && <span className="mt-0.5 block text-[15px] leading-snug text-slate-600">{next.detail}</span>}
      </span>
      {next.href && <Icon name="chevron" size={18} className="mt-2.5 shrink-0 text-slate-400" />}
    </>
  );
  return next.href ? (
    <li>
      <Link href={next.href} className="pressable -mx-2 flex gap-3.5 rounded-2xl px-2 py-1.5 hover:bg-slate-50">
        {body}
      </Link>
    </li>
  ) : (
    <li className="flex gap-3.5 py-1.5">{body}</li>
  );
}

/** Home's compact card: what comes next, and the latest two things that happened. */
export function CaseCard({ view }: { view: CaseView }) {
  const { locale } = useLocale();
  const es = locale === "es";
  const { timeline } = view;
  const recent = timeline.events.slice(0, 2);
  return (
    <section className="card px-5 pb-4 pt-5" data-testid="case-card" aria-labelledby="case-card-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="case-card-title" className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">
          {es ? "Mi caso" : "My case"}
        </h2>
        {view.example && <ExampleBadge />}
      </div>
      {timeline.next[0] && (
        <ul className="mt-3">
          <NextRow next={{ ...timeline.next[timeline.next.length - 1]!, href: undefined }} locale={locale} />
        </ul>
      )}
      {recent.length > 0 && (
        <ol className="mt-3 border-t hairline pt-4">
          {recent.map((event, i) => (
            <EventRow key={`${event.kind}-${event.at}-${i}`} event={event} last={i === recent.length - 1} />
          ))}
        </ol>
      )}
      <Link
        href="/caso"
        className="pressable mt-1 flex h-12 items-center justify-center rounded-full bg-slate-100 text-[16px] font-semibold text-slate-900 hover:bg-slate-200"
      >
        {es ? "Ver todo mi caso" : "See my whole case"}
      </Link>
    </section>
  );
}

/** The full timeline: what comes next, then everything that happened, newest first. */
export function CaseTimelineList({ timeline }: { timeline: CaseTimeline }) {
  const { locale } = useLocale();
  const es = locale === "es";
  return (
    <>
      {timeline.next.length > 0 && (
        <section aria-labelledby="case-next" className="card px-5 pb-3 pt-5" data-testid="case-next">
          <h2 id="case-next" className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">
            {es ? "Lo que sigue" : "What comes next"}
          </h2>
          <ul className="mt-3 space-y-2">
            {timeline.next.map((n) => (
              <NextRow key={n.key} next={n} locale={locale} />
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="case-past" className="card px-5 pb-1 pt-5" data-testid="case-events">
        <div className="flex items-center justify-between gap-3">
          <h2 id="case-past" className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">
            {es ? "Lo que ya pasó" : "What already happened"}
          </h2>
          <SpeakButton compact text={caseReadAloud(timeline, locale)} label={es ? "todo mi caso" : "my whole case"} />
        </div>
        {timeline.events.length === 0 ? (
          <p className="pb-5 pt-3 text-[15px] leading-relaxed text-slate-600">
            {es ? "Todavía no hay nada aquí. Cuando firmes tu acuerdo, lo verás en esta lista." : "Nothing here yet. Once you sign your agreement, you will see it in this list."}
          </p>
        ) : (
          <ol className="mt-4">
            {timeline.events.map((event, i) => (
              <EventRow key={`${event.kind}-${event.at}-${i}`} event={event} last={i === timeline.events.length - 1} />
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
