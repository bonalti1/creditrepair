"use client";

import { useEffect, useRef, useState } from "react";
import Icon, { type IconName } from "@/components/Icon";
import { CharacterAvatar } from "@/components/Character";
import { BRAND } from "@/lib/brand";
import type { SiteCopy } from "@/lib/site/copy";
import type { DemoCase, DemoChoice } from "@/lib/site/demo";

// The home page's one interactive island: AltiBot explains a sample
// collection, the visitor taps an answer, AltiBot says what happens next, and
// "Mi caso" shows the letters going out, with dates. Scripted, no network, no
// AI call: the words are the site's copy (copy.ts) and the case is built on
// the server by the app's own timeline rules (src/lib/site/demo.ts), so this
// file only moves between three screens. Always labelled "Example".
//
// Accessible: the conversation is a live region, the answers are real
// buttons, focus moves to the new screen, and motion is skipped for people
// who ask for less of it.

type Demo = SiteCopy["home"]["demo"];
type Stage = "ask" | "typing" | "answered" | "case";

const CHOICES: DemoChoice[] = ["notMine", "wrongBalance", "looksRight"];

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function BotBubble({ children, ai }: { children: React.ReactNode; ai: string }) {
  return (
    <div className="flex items-end gap-2">
      <CharacterAvatar character="assistant" size={30} decorative />
      <div className="max-w-[85%] rounded-[20px] rounded-bl-md bg-white px-3.5 py-2.5 text-[14.5px] leading-snug text-slate-800 shadow-sm ring-1 ring-black/5">
        <span className="sr-only">{BRAND.assistant} ({ai}): </span>
        {children}
      </div>
    </div>
  );
}

export default function AltiBotDemo({ copy, cases, ai }: { copy: Demo; cases: Record<DemoChoice, DemoCase>; ai: string }) {
  const [stage, setStage] = useState<Stage>("ask");
  const [choice, setChoice] = useState<DemoChoice | null>(null);
  const screen = useRef<HTMLDivElement>(null);
  const caseHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (stage !== "typing") return;
    const t = window.setTimeout(() => setStage("answered"), reducedMotion() ? 0 : 900);
    return () => window.clearTimeout(t);
  }, [stage]);

  useEffect(() => {
    if (stage === "case") caseHeading.current?.focus();
    if (stage === "answered" || stage === "typing") screen.current?.scrollTo({ top: screen.current.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
  }, [stage]);

  const pick = (c: DemoChoice) => {
    setChoice(c);
    setStage("typing");
  };
  const restart = () => {
    setChoice(null);
    setStage("ask");
  };

  const s = copy.sample;
  const kase = choice ? cases[choice] : null;

  return (
    <div className="relative mx-auto w-full max-w-[360px]" data-testid="altibot-demo">
      {/* The phone. Pure CSS, sized so nothing moves while the visitor taps. */}
      <div className="relative rounded-[48px] bg-blue-900 p-[10px] shadow-[0_40px_80px_-30px_rgba(0,0,0,0.6)] ring-1 ring-white/25">
        <div className="relative flex h-[640px] flex-col overflow-hidden rounded-[38px] bg-slate-50">
          <div aria-hidden className="absolute left-1/2 top-2.5 z-20 h-[26px] w-[96px] -translate-x-1/2 rounded-full bg-blue-900" />
          {/* App bar */}
          <div className="relative z-10 flex items-center gap-2.5 border-b border-slate-200 bg-white px-4 pb-3 pt-11">
            {stage === "case" ? (
              <>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-700">
                  <Icon name="clipboard" size={18} />
                </span>
                <p className="flex-1 text-[15px] font-semibold text-blue-900">{copy.caseTitle}</p>
              </>
            ) : (
              <>
                <CharacterAvatar character="assistant" size={36} />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold leading-tight text-blue-900">{BRAND.assistant}</p>
                  <p className="text-[12px] leading-tight text-slate-500">{ai}</p>
                </div>
              </>
            )}
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-900">{copy.label.split(" · ")[0]}</span>
          </div>

          {stage !== "case" ? (
            <div ref={screen} className="flex-1 space-y-3 overflow-y-auto px-3.5 py-4" aria-live="polite">
              {/* The sample item */}
              <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{copy.itemHeader}</p>
                <div className="mt-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[16px] font-semibold leading-tight text-blue-900">{s.company}</p>
                    <p className="mt-0.5 text-[12.5px] text-slate-500">{s.original}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-[12px] font-semibold text-blue-700">{copy.itemKind}</span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-3 text-[13px]">
                  <div>
                    <dt className="text-slate-500">{s.balanceLabel}</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">{s.balance}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">{s.openedLabel}</dt>
                    <dd className="font-semibold text-slate-900">{s.opened}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-slate-500">{s.bureausLabel}</dt>
                    <dd className="font-semibold text-slate-900">{s.bureaus}</dd>
                  </div>
                </dl>
              </div>

              <BotBubble ai={ai}>{copy.intro}</BotBubble>
              <BotBubble ai={ai}>
                <strong className="font-semibold text-blue-900">{copy.question}</strong>
              </BotBubble>

              {stage === "ask" && (
                <div className="flex flex-wrap justify-end gap-2 pl-10 pt-1" role="group" aria-label={copy.question}>
                  {CHOICES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => pick(c)}
                      className="pressable h-11 rounded-full bg-white px-4 text-[14.5px] font-semibold text-blue-900 shadow-sm ring-1 ring-inset ring-blue-200 hover:bg-blue-50 hover:ring-blue-300"
                    >
                      {copy.choices[c]}
                    </button>
                  ))}
                </div>
              )}

              {choice && (
                <div className="flex justify-end">
                  <p className="max-w-[80%] rounded-[20px] rounded-br-md bg-blue-900 px-3.5 py-2.5 text-[14.5px] font-medium text-white">{copy.choices[choice]}</p>
                </div>
              )}

              {stage === "typing" && (
                <div className="flex items-end gap-2" aria-label={copy.typing}>
                  <CharacterAvatar character="assistant" size={30} decorative />
                  <div className="flex gap-1 rounded-[20px] rounded-bl-md bg-white px-4 py-3.5 shadow-sm ring-1 ring-black/5">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-blue-300 motion-reduce:animate-none" style={{ animationDelay: `${i * 140}ms` }} />
                    ))}
                  </div>
                </div>
              )}

              {stage === "answered" && choice && (
                <>
                  <BotBubble ai={ai}>{copy.replies[choice]}</BotBubble>
                  <div className="pl-10 pt-1">
                    <button
                      type="button"
                      onClick={() => setStage("case")}
                      className="pressable flex h-12 w-full items-center justify-center gap-2 rounded-full bg-amber-400 text-[15px] font-semibold text-blue-900 hover:bg-amber-500"
                    >
                      {copy.seeCase}
                      <Icon name="chevron" size={18} strokeWidth={2.25} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            kase && (
              <div className="flex-1 overflow-y-auto px-3.5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">{copy.caseLater}</p>
                <h3 ref={caseHeading} tabIndex={-1} className="mt-1.5 text-[16px] font-semibold leading-snug text-blue-900 outline-none">
                  {kase.sentence}
                </h3>

                {kase.next.length > 0 && (
                  <section className="mt-4">
                    <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{copy.next}</p>
                    <ul className="mt-2 space-y-2">
                      {kase.next.map((n) => (
                        <li key={n.title} className="rounded-2xl bg-blue-900 px-3.5 py-3 text-white">
                          {n.day && <p data-on-navy className="text-[12px] font-semibold text-amber-300">{n.day}</p>}
                          <p className="text-[14px] font-semibold leading-snug">{n.title}</p>
                          {n.detail && <p className="mt-0.5 text-[12.5px] leading-snug text-blue-100">{n.detail}</p>}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section className="mt-4">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{copy.happened}</p>
                  <ol className="relative mt-2 space-y-0">
                    {kase.happened.map((e, i) => (
                      <li key={`${e.title}-${i}`} className="relative flex gap-3 pb-3.5">
                        {i < kase.happened.length - 1 && <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-24px)] w-px bg-slate-200" />}
                        <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                          <Icon name={e.icon as IconName} size={16} />
                        </span>
                        <div className="min-w-0 pt-0.5">
                          <p className="text-[12px] font-medium text-slate-500">{e.day}</p>
                          <p className="text-[14px] font-semibold leading-snug text-slate-900">{e.title}</p>
                          {e.detail && <p className="mt-0.5 text-[12.5px] leading-snug text-slate-600">{e.detail}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              </div>
            )
          )}

          {/* Bottom bar: start over */}
          <div className="border-t border-slate-200 bg-white px-4 py-3">
            {stage === "ask" ? (
              <p className="text-center text-[12px] leading-snug text-slate-500">{copy.label}</p>
            ) : (
              <button
                type="button"
                onClick={restart}
                className="pressable flex h-10 w-full items-center justify-center gap-1.5 rounded-full bg-slate-100 text-[14px] font-semibold text-slate-700 hover:bg-slate-200"
              >
                {copy.restart}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
