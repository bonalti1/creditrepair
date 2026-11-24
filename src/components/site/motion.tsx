"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion, REDUCED_MOTION_QUERY } from "@/lib/site/interactive";

// Small motion helpers for the website (docs/WEBSITE.md, "Motion"):
//
//  - useReducedMotion: the visitor's "reduce motion" setting, live.
//  - Reveal: a section fades up when it scrolls into view (IntersectionObserver).
//    The server renders it visible; only once the script runs, and only for an
//    element still below the fold, is it hidden until it scrolls in. So a
//    visitor without JavaScript sees everything, and nothing on screen blinks.
//  - StatPictogram: the sourced "1 in N" figures drawn as N marks that fill
//    in when scrolled to, one of them gold. The number itself never changes:
//    the count is the figure the source states.

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.(REDUCED_MOTION_QUERY);
    setReduced(prefersReducedMotion());
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/** Calls back once when the element first comes into view (at once without IntersectionObserver). */
export function useInView<T extends Element>(margin = "0px 0px -10% 0px"): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin, seen]);
  return [ref, seen];
}

export function Reveal({ children, className = "", delay = 0, as = "div" }: { children: React.ReactNode; className?: string; delay?: number; as?: "div" | "li" | "section" }) {
  const ref = useRef<HTMLElement>(null);
  // "shown" on the server and on first paint; "wait" only for an element below the fold.
  const [state, setState] = useState<"shown" | "wait" | "in">("shown");
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || typeof IntersectionObserver === "undefined") return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    setState("wait");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState("in");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const Tag = as as "div";
  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement>}
      data-reveal={state === "shown" ? undefined : state}
      className={className}
      style={state === "in" && delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}

/**
 * "1 in 5": five marks, one gold, filling in one by one when scrolled to.
 * Screen readers get the figure as written (the marks are decorative).
 */
export function StatPictogram({ of, label }: { of: number; label: string }) {
  const reduced = useReducedMotion();
  const [ref, seen] = useInView<HTMLDivElement>();
  const [filled, setFilled] = useState(0);
  useEffect(() => {
    if (!seen) return;
    if (reduced) {
      setFilled(of);
      return;
    }
    let n = 0;
    const step = Math.max(25, Math.round(900 / of));
    const t = window.setInterval(() => {
      n += 1;
      setFilled(n);
      if (n >= of) window.clearInterval(t);
    }, step);
    return () => window.clearInterval(t);
  }, [seen, reduced, of]);
  const size = of > 10 ? "h-2.5 w-2.5" : "h-4 w-4";
  return (
    <div ref={ref} aria-hidden="true" title={label} className={`mt-4 flex flex-wrap gap-1.5 ${of > 10 ? "max-w-[180px]" : ""}`}>
      {Array.from({ length: of }, (_, i) => (
        <span
          key={i}
          className={`${size} rounded-full transition-[opacity,transform] duration-300 ${i === 0 ? "bg-amber-500" : "bg-blue-200"} ${
            i < filled ? "scale-100 opacity-100" : "scale-50 opacity-0"
          }`}
        />
      ))}
    </div>
  );
}
