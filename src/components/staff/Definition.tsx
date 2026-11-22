"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

// "Cómo se cuenta": the definition of a number, one tap or hover away. Every
// number on the business dashboard has one, so nobody has to guess what was
// counted. The note is placed on the screen itself (rendered into <body>, not
// inside the card), so a card, a scrolling table or an animated ancestor never
// moves or cuts it, and it never runs off a phone's edge.

const WIDTH = 256;
const MARGIN = 12;

export default function Definition({ label, text }: { label: string; text: string }) {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const id = useId();
  const ref = useRef<HTMLButtonElement>(null);
  const open = pinned || hover;

  const place = () => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const left = Math.min(Math.max(MARGIN, box.left - 8), window.innerWidth - Math.min(WIDTH, window.innerWidth - 2 * MARGIN) - MARGIN);
    setAt({ top: box.bottom + 6, left });
  };

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event.type === "mousedown" && ref.current?.contains(event.target as Node)) return;
      setPinned(false);
      setHover(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <span className="inline-flex">
      <button
        ref={ref}
        type="button"
        onClick={() => {
          place();
          setPinned((v) => !v);
        }}
        onMouseEnter={() => {
          place();
          setHover(true);
        }}
        onMouseLeave={() => setHover(false)}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        aria-label={`Cómo se cuenta: ${label}`}
        // A 44-pixel target around the small circle, for a finger; the negative margin keeps the layout.
        className="group -m-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold text-slate-400 ring-1 ring-slate-200 group-hover:bg-slate-100 group-hover:text-slate-600">?</span>
      </button>
      {open &&
        at &&
        createPortal(
        <span
          id={id}
          role="tooltip"
          style={{ top: at.top, left: at.left, width: WIDTH, maxWidth: `calc(100vw - ${2 * MARGIN}px)` }}
          className="fixed z-50 rounded-2xl bg-slate-900 px-3.5 py-2.5 text-left text-[12.5px] font-normal normal-case leading-snug tracking-normal text-white shadow-lg"
        >
          <span className="block font-semibold">Cómo se cuenta</span>
          {text}
        </span>,
          document.body,
        )}
    </span>
  );
}
