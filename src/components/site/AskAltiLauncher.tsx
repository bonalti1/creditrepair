"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { CharacterAvatar } from "@/components/Character";
import type { AskCopy, AskCtas } from "./AskAlti";

// The "Ask Alti" button on every public page, and the phone's sticky bar.
// The chat itself (AskAlti.tsx) loads only when someone opens it (or points
// at the button), so a page that nobody chats on ships just this small file.
//
// The panel is a non-modal dialog: Escape or the close button closes it, and
// focus goes back to the button that opened it. On a phone it is a sheet from
// the bottom; on a wide screen, a card in the corner.

const AskAltiChat = dynamic(() => import("./AskAlti"), { ssr: false });

/** Anything on the page can open the chat: window.dispatchEvent(new Event(ASK_OPEN_EVENT)). */
export const ASK_OPEN_EVENT = "credalti:ask-alti";

export default function AskAltiLauncher({
  copy,
  locale,
  byline,
  ctas,
  barLabel,
}: {
  copy: AskCopy;
  locale: "es" | "en";
  byline: string;
  ctas: AskCtas;
  /** The sticky bar's main button ("Start my review"). */
  barLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [bar, setBar] = useState(false);
  // The floating button waits until the visitor scrolls a little, so it never sits on the hero's own content.
  const [floating, setFloating] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const show = useCallback(() => {
    opener.current = (document.activeElement as HTMLElement) ?? null;
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => opener.current?.focus?.(), 0);
  }, []);

  useEffect(() => {
    const onOpen = () => show();
    window.addEventListener(ASK_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(ASK_OPEN_EVENT, onOpen);
  }, [show]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hide]);

  // The phone's sticky bar: shown once the hero is scrolled past, hidden at the footer.
  useEffect(() => {
    const onScroll = () => {
      const footer = document.querySelector("footer");
      const nearEnd = footer ? footer.getBoundingClientRect().top < window.innerHeight - 40 : false;
      setBar(window.scrollY > window.innerHeight * 0.6 && !nearEnd);
      setFloating(window.scrollY > 240);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const prefetch = () => {
    void import("./AskAlti");
  };

  return (
    <>
      {/* Wide screens: the floating button. Phones use the sticky bar below. */}
      {!open && floating && (
        <button
          type="button"
          onClick={show}
          onPointerEnter={prefetch}
          onFocus={prefetch}
          aria-label={copy.open}
          aria-haspopup="dialog"
          className="pressable msg-in fixed bottom-6 right-6 z-40 hidden items-center gap-2.5 rounded-full bg-blue-900 py-2 pl-2 pr-5 text-white shadow-[0_18px_40px_-14px_rgba(18,33,58,0.7)] ring-1 ring-white/20 hover:-translate-y-0.5 hover:bg-blue-800 sm:flex"
          data-testid="ask-launcher"
        >
          <CharacterAvatar character="assistant" size={40} decorative className="ring-2 ring-amber-400" />
          <span className="text-left leading-tight">
            <span className="block text-[15px] font-semibold">{copy.launcher}</span>
            <span data-on-navy className="block text-[12px] font-medium text-amber-300">{byline}</span>
          </span>
        </button>
      )}

      {/* Phones: a sticky bar with the main action and the chat. */}
      <div
        className={`fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-blue-900/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur transition-transform duration-300 motion-reduce:transition-none sm:hidden ${
          bar && !open ? "translate-y-0" : "pointer-events-none translate-y-full"
        }`}
        aria-hidden={!bar || open}
        data-testid="mobile-cta-bar"
      >
        <div className="flex gap-2.5">
          {ctas.start.external ? (
            <a href={ctas.start.href} target="_blank" rel="noopener" tabIndex={bar ? 0 : -1} className="pressable flex h-12 flex-1 items-center justify-center rounded-full bg-amber-400 text-[16px] font-semibold text-blue-900">
              {barLabel}
            </a>
          ) : (
            <Link href={ctas.start.href} tabIndex={bar ? 0 : -1} className="pressable flex h-12 flex-1 items-center justify-center rounded-full bg-amber-400 text-[16px] font-semibold text-blue-900">
              {barLabel}
            </Link>
          )}
          <button
            type="button"
            onClick={show}
            onPointerDown={prefetch}
            tabIndex={bar ? 0 : -1}
            aria-label={copy.open}
            className="pressable flex h-12 items-center gap-2 rounded-full bg-white/10 pl-1.5 pr-4 text-[15px] font-semibold text-white ring-1 ring-inset ring-white/20"
          >
            <CharacterAvatar character="assistant" size={36} decorative />
            {copy.launcher}
          </button>
        </div>
      </div>

      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-modal="false"
          aria-labelledby="ask-alti-title"
          className="msg-in fixed inset-x-0 bottom-0 z-50 flex h-[88dvh] flex-col overflow-hidden rounded-t-[28px] bg-slate-50 shadow-2xl ring-1 ring-black/10 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:h-[min(640px,calc(100dvh-48px))] sm:w-[400px] sm:rounded-[28px]"
          data-testid="ask-panel"
        >
          <div className="flex items-center gap-3 bg-blue-900 px-4 py-3 text-white">
            <CharacterAvatar character="assistant" size={42} decorative className="ring-2 ring-amber-400" />
            <div className="min-w-0 flex-1">
              <p id="ask-alti-title" className="truncate font-display text-[17px] font-semibold leading-tight" data-testid="ask-title">
                {byline}
              </p>
              <p className="flex items-center gap-1.5 text-[12px] text-blue-100">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400" aria-hidden />
                {copy.subtitle}
              </p>
            </div>
            <button
              type="button"
              onClick={hide}
              aria-label={copy.close}
              className="pressable flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/15"
            >
              <Icon name="close" size={20} />
            </button>
          </div>
          <AskAltiChat copy={copy} locale={locale} byline={byline} ctas={ctas} />
        </div>
      )}
    </>
  );
}
