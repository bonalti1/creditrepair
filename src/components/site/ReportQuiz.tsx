"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import Icon from "@/components/Icon";
import { quizResult, toggleQuizChoice, type QuizChoice } from "@/lib/site/interactive";
import { LIVE_COPY, QUIZ_ITEM_IDS } from "@/lib/site/live";

// "What's on your report?": a 30-second check with no personal data. The
// visitor taps what they see; each one gets a plain, sourced explanation (what
// it is, what the law says, what we do), then "Start my review". No score, no
// prediction, no promise: explanations only (src/lib/site/interactive.ts).
//
// Accessible: the chips are toggle buttons (aria-pressed), the result is
// announced by moving focus to its heading, and "Start over" brings focus back.

export default function ReportQuiz({ locale, startHref }: { locale: "es" | "en"; startHref: string }) {
  const copy = LIVE_COPY[locale].quiz;
  const [selected, setSelected] = useState<QuizChoice[]>([]);
  const [done, setDone] = useState(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const firstChip = useRef<HTMLButtonElement>(null);
  const result = quizResult(selected);

  const show = () => {
    setDone(true);
    window.setTimeout(() => resultHeading.current?.focus(), 0);
  };
  const restart = () => {
    setSelected([]);
    setDone(false);
    window.setTimeout(() => firstChip.current?.focus(), 0);
  };

  const chip = (id: QuizChoice, label: string, first = false) => {
    const on = selected.includes(id);
    return (
      <li key={id}>
        <button
          ref={first ? firstChip : undefined}
          type="button"
          aria-pressed={on}
          onClick={() => setSelected((s) => toggleQuizChoice(s, id))}
          className={`pressable flex min-h-12 items-center gap-2 rounded-full px-4 py-2 text-left text-[15px] font-semibold ring-1 ring-inset transition-colors ${
            on ? "bg-blue-900 text-white ring-blue-900" : "bg-white text-blue-900 ring-blue-200 hover:-translate-y-0.5 hover:bg-blue-50"
          }`}
          data-testid={`quiz-chip-${id}`}
        >
          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${on ? "bg-amber-400 text-blue-900" : "bg-blue-50 text-blue-300 ring-1 ring-inset ring-blue-200"}`}>
            {on && <Icon name="check" size={13} strokeWidth={3} />}
          </span>
          {label}
        </button>
      </li>
    );
  };

  return (
    <div className="card overflow-hidden" data-testid="report-quiz">
      {!done ? (
        <div className="p-6 sm:p-9">
          <h3 className="font-display text-[22px] font-semibold leading-snug text-blue-900 sm:text-[26px]">{copy.question}</h3>
          <p className="mt-1.5 text-[15px] text-slate-600">{copy.hint}</p>
          <ul className="mt-6 flex flex-wrap gap-2.5">
            {QUIZ_ITEM_IDS.map((id, i) => chip(id, copy.items[id].label, i === 0))}
            {chip("none", copy.none)}
          </ul>
          <div className="mt-7 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={show}
              disabled={selected.length === 0}
              className="pressable inline-flex h-12 items-center gap-2 rounded-full bg-amber-400 px-6 text-[16px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500"
              data-testid="quiz-show"
            >
              {copy.show}
              <Icon name="chevron" size={18} strokeWidth={2.25} />
            </button>
            <p className="text-[14px] text-slate-500" aria-live="polite">
              {selected.length > 0 && !selected.includes("none") ? copy.selected(selected.length) : ""}
            </p>
          </div>
        </div>
      ) : (
        <div className="p-6 sm:p-9" data-testid="quiz-result">
          <h3 ref={resultHeading} tabIndex={-1} className="font-display text-[22px] font-semibold leading-snug text-blue-900 outline-none sm:text-[26px]">
            {result.none ? copy.noneTitle : copy.resultTitle}
          </h3>
          <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">{result.none ? copy.noneBody : copy.resultLead}</p>
          {result.items.length > 0 && (
            <ul className="mt-6 grid gap-4 lg:grid-cols-2">
              {result.items.map((id, i) => {
                const item = copy.items[id];
                return (
                  <li key={id} className="msg-in rounded-3xl bg-slate-50 p-5 ring-1 ring-slate-200" style={{ animationDelay: `${i * 90}ms` }}>
                    <h4 className="text-[18px] font-semibold text-blue-900">{item.title}</h4>
                    <dl className="mt-3 space-y-2.5 text-[15px] leading-relaxed">
                      <div>
                        <dt className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{copy.whatLabel}</dt>
                        <dd className="text-slate-700">{item.what}</dd>
                      </div>
                      <div>
                        <dt className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{copy.rightLabel}</dt>
                        <dd className="text-slate-700">{item.right}</dd>
                      </div>
                      <div className="rounded-2xl bg-blue-900 px-3.5 py-3 text-white">
                        <dt data-on-navy className="text-[12px] font-semibold uppercase tracking-wide text-amber-300">{copy.weLabel}</dt>
                        <dd>{item.we}</dd>
                      </div>
                    </dl>
                    <a href={item.source.url} rel="noopener" target="_blank" className="mt-3 inline-flex text-[13px] font-semibold text-blue-700 underline underline-offset-2">
                      {copy.sourceLabel}: {item.source.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
          {!result.none && (
            <div className="mt-6 rounded-3xl bg-amber-50 p-5 ring-1 ring-amber-200">
              <p className="text-[16px] font-semibold text-blue-900">{copy.stepsTitle}</p>
              <ol className="mt-3 space-y-2">
                {copy.steps.map((step, i) => (
                  <li key={step} className="flex gap-3 text-[15px] leading-snug text-slate-700">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-900 text-[13px] font-semibold text-white">{i + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <p className="mt-4 text-[13px] leading-relaxed text-slate-500">{copy.note}</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href={startHref} className="pressable inline-flex h-12 items-center gap-2 rounded-full bg-amber-400 px-6 text-[16px] font-semibold text-blue-900 hover:bg-amber-500">
              {copy.cta}
              <Icon name="chevron" size={18} strokeWidth={2.25} />
            </Link>
            <button type="button" onClick={restart} className="pressable h-12 rounded-full px-5 text-[15px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-200 hover:bg-blue-50">
              {copy.restart}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
