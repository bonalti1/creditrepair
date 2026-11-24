"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Icon, { type IconName } from "@/components/Icon";
import { CharacterAvatar } from "@/components/Character";
import type { SiteCopy } from "@/lib/site/copy";
import type { DemoCase, DemoChoice } from "@/lib/site/demo";
import { demoTimings, MAIL_STOPS, type MailStop } from "@/lib/site/interactive";
import MailCameo from "./MailCameo";
import { useInView, useReducedMotion } from "./motion";

// The home page's example, inside the hero phone: Alti, the AI assistant,
// explains a sample collection, the visitor taps an answer, Alti says what
// happens next, and "Mi caso" shows the answer going into the case, the
// letters travelling (the robot's small cameo, MailCameo.tsx) to "Delivered
// ✓", and the case's dates. Scripted, no network and no AI call: the words are
// the site's copy and the case is built on the server by the app's own
// timeline rules (src/lib/site/demo.ts). Always labelled "Example".
//
// Every message Alti writes carries "Alti · AI assistant". Accessible: the
// conversation is a live region, the answers are real buttons, focus moves to
// the new screen, and with reduced motion every step shows at once.

type Demo = SiteCopy["home"]["demo"];
type Stage = "intro" | "ask" | "typing" | "answered" | "case";

const CHOICES: DemoChoice[] = ["notMine", "wrongBalance", "looksRight"];

function Typing({ label }: { label: string }) {
  return (
    <div className="msg-in flex items-end gap-2" role="status">
      <CharacterAvatar character="assistant" size={30} decorative />
      <div className="flex gap-1 rounded-[20px] rounded-bl-md bg-white px-4 py-3.5 shadow-sm ring-1 ring-black/5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="typing-dot h-2 w-2 rounded-full bg-blue-300" style={{ animationDelay: `${i * 160}ms` }} />
        ))}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** One of Alti's lines. The first of a run carries the AI byline beside his face. */
function AltiLine({ children, byline, first }: { children: React.ReactNode; byline: string; first: boolean }) {
  return (
    <div className="msg-in">
      {first && <p className="mb-1 ml-10 text-[11.5px] font-semibold text-slate-500" data-testid="demo-ai-byline">{byline}</p>}
      <div className="flex items-end gap-2">
        {first ? <CharacterAvatar character="assistant" size={30} decorative /> : <span aria-hidden className="w-[30px] shrink-0" />}
        <div className="max-w-[85%] rounded-[20px] rounded-bl-md bg-white px-3.5 py-2.5 text-[14.5px] leading-snug text-slate-800 shadow-sm ring-1 ring-black/5">
          <span className="sr-only">{byline}: </span>
          {children}
        </div>
      </div>
    </div>
  );
}

export default function AltiDemo({ copy, cases, byline }: { copy: Demo; cases: Record<DemoChoice, DemoCase>; byline: string }) {
  const reduced = useReducedMotion();
  const t = demoTimings(reduced);
  const [rootRef, inView] = useInView<HTMLDivElement>("0px");
  const [stage, setStage] = useState<Stage>("intro");
  const [lines, setLines] = useState(0); // Alti's opening lines shown (0–2)
  const [typing, setTyping] = useState(false);
  const [choice, setChoice] = useState<DemoChoice | null>(null);
  const [caseStep, setCaseStep] = useState(0); // 0 nothing, 1 the answer, 2 mailing, 3 the timeline
  const [stop, setStop] = useState<MailStop | null>(null);
  const [run, setRun] = useState(0);
  const timers = useRef<number[]>([]);
  const screen = useRef<HTMLDivElement>(null);
  const caseHeading = useRef<HTMLHeadingElement>(null);

  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  const clear = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };
  useEffect(() => clear, []);

  // The opening: typing, line one, typing, line two, then the answers.
  useEffect(() => {
    if (!inView || stage !== "intro") return;
    clear();
    if (reduced) {
      setLines(2);
      setStage("ask");
      return;
    }
    setTyping(true);
    later(t.typing, () => {
      setTyping(false);
      setLines(1);
      later(t.betweenLines, () => {
        setTyping(true);
        later(t.typing, () => {
          setTyping(false);
          setLines(2);
          setStage("ask");
        });
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, stage, run, reduced]);

  // The reply to the visitor's answer.
  useEffect(() => {
    if (stage !== "typing") return;
    later(t.typing, () => setStage("answered"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // Mi caso: the answer flies in, the letters travel, then the dates.
  useEffect(() => {
    if (stage !== "case" || !choice) return;
    caseHeading.current?.focus();
    const mails = choice !== "looksRight";
    if (reduced) {
      setCaseStep(3);
      setStop(mails ? "delivered" : null);
      return;
    }
    setCaseStep(1);
    later(t.intoCase, () => {
      if (!mails) {
        setCaseStep(3);
        return;
      }
      setCaseStep(2);
      let at = t.mailed;
      MAIL_STOPS.forEach((s) => {
        later(at, () => setStop(s));
        at += s === "mailed" ? t.transit : t.delivered;
      });
      later(at, () => setCaseStep(3));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, choice]);

  // Keep the newest line in view inside the phone.
  useEffect(() => {
    const el = screen.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [lines, typing, stage, caseStep, stop, reduced]);

  const pick = (c: DemoChoice) => {
    setChoice(c);
    setStage("typing");
  };
  const restart = (replay: boolean) => {
    clear();
    setChoice(null);
    setCaseStep(0);
    setStop(null);
    setTyping(false);
    if (replay) {
      setLines(0);
      setStage("intro");
      setRun((n) => n + 1);
    } else {
      setStage("ask");
    }
  };

  const s = copy.sample;
  const kase = choice ? cases[choice] : null;

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col" data-testid="alti-demo" data-stage={stage}>
      {/* App bar */}
      <div className="relative z-10 flex items-center gap-2.5 border-b border-slate-200 bg-white px-4 pb-3 pt-3">
        {stage === "case" ? (
          <>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-700">
              <Icon name="clipboard" size={18} />
            </span>
            <p className="flex-1 text-[15px] font-semibold text-blue-900">{copy.caseTitle}</p>
          </>
        ) : (
          <>
            <CharacterAvatar character="assistant" size={36} decorative />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold leading-tight text-blue-900">{byline}</p>
              <p className="text-[12px] leading-tight text-slate-500">{copy.label}</p>
            </div>
          </>
        )}
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-900">{copy.label.split(" · ")[0]}</span>
      </div>

      {stage !== "case" ? (
        <div ref={screen} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-4" aria-live="polite">
          {/* The sample item */}
          <div className="rounded-3xl bg-white px-4 py-3.5 shadow-sm ring-1 ring-black/5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{copy.itemHeader}</p>
            <div className="mt-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[16px] font-semibold leading-tight text-blue-900">{s.company}</p>
                <p className="mt-0.5 text-[12.5px] text-slate-500">{s.original}</p>
              </div>
              <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-[12px] font-semibold text-blue-700">{copy.itemKind}</span>
            </div>
            <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-slate-100 pt-2.5 text-[13px]">
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

          {lines >= 1 && (
            <AltiLine byline={byline} first>
              {copy.intro}
            </AltiLine>
          )}
          {lines >= 2 && (
            <AltiLine byline={byline} first={false}>
              <strong className="font-semibold text-blue-900">{copy.question}</strong>
            </AltiLine>
          )}
          {typing && <Typing label={copy.typing} />}

          {stage === "ask" && (
            <div className="msg-in flex flex-wrap justify-end gap-2 pl-10 pt-1" role="group" aria-label={copy.question}>
              {CHOICES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => pick(c)}
                  className="pressable h-11 rounded-full bg-white px-3.5 text-[14px] font-semibold text-blue-900 shadow-sm ring-1 ring-inset ring-blue-200 hover:-translate-y-0.5 hover:bg-blue-50 hover:ring-blue-300"
                >
                  {copy.choices[c]}
                </button>
              ))}
            </div>
          )}

          {choice && (
            <div className="msg-in flex justify-end">
              <p className="max-w-[80%] rounded-[20px] rounded-br-md bg-blue-900 px-3.5 py-2.5 text-[14.5px] font-medium text-white">{copy.choices[choice]}</p>
            </div>
          )}

          {stage === "typing" && <Typing label={copy.typing} />}

          {stage === "answered" && choice && (
            <>
              <AltiLine byline={byline} first>
                {copy.replies[choice]}
              </AltiLine>
              <div className="msg-in pl-10 pt-1">
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
        kase &&
        choice && (
          <div ref={screen} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3.5 py-4" aria-live="polite">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">{copy.caseLater}</p>
              <h3 ref={caseHeading} tabIndex={-1} className="mt-1.5 text-[16px] font-semibold leading-snug text-blue-900 outline-none">
                {kase.sentence}
              </h3>
            </div>

            {caseStep >= 1 && (
              <div className="into-case flex items-center gap-2.5 rounded-2xl bg-white px-3.5 py-3 shadow-sm ring-1 ring-blue-200" data-testid="demo-into-case">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-900 text-white">
                  <Icon name="check" size={15} strokeWidth={2.5} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[11.5px] font-semibold text-slate-500">{copy.intoCase}</span>
                  <span className="block text-[14px] font-semibold text-blue-900">“{copy.choices[choice]}”</span>
                </span>
              </div>
            )}

            {caseStep >= 2 && <MailCameo copy={copy.mail} stop={stop} />}

            {caseStep >= 3 && (
              <>
                {kase.next.length > 0 && (
                  <section className="msg-in">
                    <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{copy.next}</p>
                    <ul className="mt-2 space-y-2">
                      {kase.next.map((n) => (
                        <li key={n.title} className="rounded-2xl bg-blue-50 px-3.5 py-3 text-blue-900 ring-1 ring-blue-100">
                          {n.day && <p className="text-[12px] font-semibold text-amber-700">{n.day}</p>}
                          <p className="text-[14px] font-semibold leading-snug">{n.title}</p>
                          {n.detail && <p className="mt-0.5 text-[12.5px] leading-snug text-slate-600">{n.detail}</p>}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <section className="msg-in" style={{ animationDelay: "120ms" }}>
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{copy.happened}</p>
                  <ol className="relative mt-2">
                    {kase.happened.map((e, i) => (
                      <li key={`${e.title}-${i}`} className="msg-in relative flex gap-3 pb-3.5" style={{ animationDelay: `${180 + i * 110}ms` }}>
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
              </>
            )}
          </div>
        )
      )}

      {/* Bottom bar: replay, or try another answer */}
      <div className="flex gap-2 border-t border-slate-200 bg-white px-4 py-3">
        {stage === "intro" || stage === "ask" ? (
          <p className="flex-1 text-center text-[12px] leading-snug text-slate-500">{copy.label}</p>
        ) : (
          <>
            <button
              type="button"
              onClick={() => restart(false)}
              className="pressable flex h-10 flex-1 items-center justify-center rounded-full bg-slate-100 text-[14px] font-semibold text-slate-700 hover:bg-slate-200"
            >
              {copy.restart}
            </button>
            <button
              type="button"
              onClick={() => restart(true)}
              className="pressable flex h-10 items-center justify-center gap-1.5 rounded-full bg-blue-900 px-4 text-[14px] font-semibold text-white hover:bg-blue-800"
              data-testid="demo-replay"
            >
              <Icon name="clock" size={15} />
              {copy.replay}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
