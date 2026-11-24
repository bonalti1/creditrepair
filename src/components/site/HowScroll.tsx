"use client";

import { useEffect, useRef, useState } from "react";
import { LIVE_COPY } from "@/lib/site/live";

// "How it works" as a scroll story, with real screens of the app (its demo
// mode, sample data: public/screens/site/). On a wide screen the phone stays
// in place while the steps scroll past it, and its screen changes with the
// step in the middle of the window (IntersectionObserver). On a phone the
// steps are swipeable cards (CSS scroll snap), with dots that follow.
//
// The screens cross-fade (opacity only); with reduced motion they switch at
// once (globals.css). Every step's text is in the page for screen readers and
// search engines; the phone is decorative beside it.

export interface StoryStage {
  title: string;
  body: string;
  alt: string;
  caption: string;
}

/** The app's screenshots are 390 × 844 at 1x. */
const SHOT = { width: 390, height: 844 };

function shot(name: string, locale: "es" | "en") {
  const base = `/screens/site/${name}-${locale}`;
  return { src: `${base}@1x.webp`, srcSet: `${base}@1x.webp 1x, ${base}@2x.webp 2x` };
}

export default function HowScroll({
  stages,
  screens,
  locale,
}: {
  stages: StoryStage[];
  screens: readonly string[];
  locale: "es" | "en";
}) {
  const { stepOf, swipe } = LIVE_COPY[locale].story;
  const [active, setActive] = useState(0);
  const steps = useRef<Array<HTMLLIElement | null>>([]);
  const cards = useRef<HTMLOListElement>(null);
  const [card, setCard] = useState(0);

  // Wide screens: the step crossing the middle of the window is the active one.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    steps.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  // Phones: the card in view sets the dot.
  const onCards = () => {
    const el = cards.current;
    if (!el) return;
    setCard(Math.round(el.scrollLeft / Math.max(1, el.clientWidth * 0.86)));
  };
  const goTo = (i: number) => {
    const el = cards.current?.children[i] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };

  return (
    <div data-testid="how-scroll">
      {/* Wide screens: steps on the left, the sticky phone on the right. */}
      <div className="hidden lg:grid lg:grid-cols-[1fr_340px] lg:gap-20">
        <ol className="relative pl-16">
          {/* The progress rail: a line down the steps, gold up to the step in view. */}
          <span aria-hidden className="absolute bottom-[36vh] left-[19px] top-[36vh] w-1 rounded-full bg-blue-100" />
          <span
            aria-hidden
            className="absolute left-[19px] top-[36vh] w-1 origin-top rounded-full bg-amber-400 transition-transform duration-500 motion-reduce:transition-none"
            style={{ height: `calc(100% - 72vh)`, transform: `scaleY(${stages.length > 1 ? active / (stages.length - 1) : 1})` }}
          />
          {stages.map((stage, i) => (
            <li
              key={stage.title}
              ref={(el) => {
                steps.current[i] = el;
              }}
              data-step={i}
              className="relative flex min-h-[72vh] flex-col justify-center"
            >
              <div className="relative">
                <span
                  aria-hidden
                  className={`absolute -left-16 -top-2.5 flex h-11 w-11 items-center justify-center rounded-full font-display text-[17px] font-bold transition-colors duration-300 motion-reduce:transition-none ${
                    i <= active ? "bg-blue-900 text-white" : "bg-white text-blue-300 ring-2 ring-blue-100"
                  }`}
                >
                  {i + 1}
                </span>
                <div className={`transition-opacity duration-500 motion-reduce:transition-none ${active === i ? "opacity-100" : "opacity-35"}`}>
                  <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-amber-700">{stepOf(i + 1)}</p>
                  <h3 className="mt-2 font-display text-[34px] font-bold leading-tight text-blue-900">{stage.title.replace(/^\d+\.\s*/, "")}</h3>
                  <p className="mt-4 max-w-xl text-[18px] leading-relaxed text-slate-700">{stage.body}</p>
                  <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3.5 py-1.5 text-[14px] font-semibold text-blue-700">{stage.caption}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
        <div className="relative">
          <div className="sticky top-[calc(50vh-300px)]">
            <div className="relative mx-auto w-[300px] rounded-[44px] bg-blue-900 p-2.5 shadow-[0_40px_80px_-30px_rgba(18,33,58,0.6)]" aria-hidden="true">
              <div className="relative overflow-hidden rounded-[34px] bg-white" style={{ aspectRatio: `${SHOT.width} / ${SHOT.height}` }}>
                {screens.map((name, i) => {
                  const img = shot(name, locale);
                  return (
                    // eslint-disable-next-line @next/next/no-img-element -- sized WebP pair, no re-encoding
                    <img
                      key={name}
                      src={img.src}
                      srcSet={img.srcSet}
                      width={SHOT.width}
                      height={SHOT.height}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className={`story-screen absolute inset-0 h-full w-full ${active === i ? "scale-100 opacity-100" : "scale-[0.98] opacity-0"}`}
                    />
                  );
                })}
              </div>
            </div>
            <ol className="mt-6 flex justify-center gap-2" aria-hidden="true">
              {screens.map((name, i) => (
                <li key={name} className={`h-2 rounded-full transition-all duration-300 motion-reduce:transition-none ${active === i ? "w-6 bg-blue-900" : "w-2 bg-blue-200"}`} />
              ))}
            </ol>
          </div>
        </div>
      </div>

      {/* Phones and tablets: swipeable cards. */}
      <div className="lg:hidden">
        <p className="mb-3 text-[14px] font-medium text-slate-500">{swipe}</p>
        <ol ref={cards} onScroll={onCards} className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2">
          {stages.map((stage, i) => {
            const img = shot(screens[i]!, locale);
            return (
              <li key={stage.title} className="card w-[86%] shrink-0 snap-start overflow-hidden sm:w-[60%]">
                <div className="bg-gradient-to-b from-blue-100/70 to-blue-50/0 px-6 pt-6">
                  {/* eslint-disable-next-line @next/next/no-img-element -- sized WebP pair */}
                  <img
                    src={img.src}
                    srcSet={img.srcSet}
                    width={SHOT.width}
                    height={SHOT.height}
                    alt={stage.alt}
                    loading="lazy"
                    decoding="async"
                    className="mx-auto block h-[300px] w-auto rounded-t-[26px] object-cover object-top shadow-[0_20px_40px_-24px_rgba(18,33,58,0.6)] ring-4 ring-blue-900"
                  />
                </div>
                <div className="p-5">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-amber-700">{stepOf(i + 1)}</p>
                  <h3 className="mt-1 text-[19px] font-semibold leading-snug text-blue-900">{stage.title.replace(/^\d+\.\s*/, "")}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{stage.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="mt-3 flex justify-center gap-1">
          {stages.map((stage, i) => (
            <button
              key={stage.title}
              type="button"
              onClick={() => goTo(i)}
              aria-label={stepOf(i + 1)}
              aria-current={card === i ? "step" : undefined}
              className="flex h-11 w-8 items-center justify-center"
            >
              <span className={`h-2 rounded-full transition-all duration-300 motion-reduce:transition-none ${card === i ? "w-6 bg-blue-900" : "w-2 bg-blue-200"}`} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
