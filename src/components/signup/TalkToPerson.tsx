"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import Icon from "@/components/Icon";
import { QUESTIONS_ONLY } from "@/lib/calls/config";
import { SIGNUP_COPY } from "@/lib/signup/copy";

// "Rather talk to someone?": a real person on WhatsApp, and "Schedule a call"
// only when calls are turned on (NEXT_PUBLIC_CALLS_ENABLED, off by default).
// A plain person icon, never a character: Alti is the AI, and this leads to
// people (docs/BRAND.md). The WhatsApp message carries the case number, so
// the team finds the signup. Closes with Escape; focus returns to the button
// that opened it (the parent's).

const WHATSAPP = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || null;

export function whatsappLink(text: string, number: string | null = WHATSAPP): string | null {
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null;
}

export function PersonIcon({ size = 32 }: { size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-blue-700 text-white" style={{ width: size, height: size }} aria-hidden="true">
      <Icon name="person" size={Math.round(size * 0.52)} strokeWidth={2.25} />
    </span>
  );
}

export default function TalkToPerson({
  locale,
  caseRef,
  callsEnabled,
  onClose,
  onChosen,
}: {
  locale: "en" | "es";
  caseRef: string;
  callsEnabled: boolean;
  onClose: () => void;
  /** Told when they open WhatsApp or the call page (recorded as "wants a person"). */
  onChosen: () => void;
}) {
  const c = SIGNUP_COPY[locale].talk;
  const href = whatsappLink(c.whatsappText(caseRef));
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("a,button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div ref={panel} role="dialog" aria-modal="false" aria-labelledby="talk-title" className="card animate-rise p-5" data-testid="talk-panel">
      <div className="flex items-center gap-3">
        <PersonIcon size={40} />
        <h2 id="talk-title" className="text-[19px] font-semibold text-slate-900">
          {c.title}
        </h2>
      </div>
      <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{c.lead}</p>
      <div className="mt-4 grid gap-2.5">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onChosen}
            className="pressable flex h-12 items-center justify-center gap-2 rounded-full bg-amber-400 px-5 text-[16px] font-semibold text-blue-900 hover:bg-amber-500"
            data-testid="talk-whatsapp"
          >
            <Icon name="chat" size={18} />
            {c.whatsapp}
          </a>
        ) : (
          <p className="rounded-2xl bg-slate-100 px-4 py-3 text-[14px] leading-snug text-slate-600" data-testid="talk-no-whatsapp">
            {c.noWhatsapp}
          </p>
        )}
        {callsEnabled && (
          <>
            <Link
              href={`/registro/llamada?caso=${encodeURIComponent(caseRef)}`}
              onClick={onChosen}
              className="pressable flex h-12 items-center justify-center gap-2 rounded-full bg-blue-50 px-5 text-[16px] font-semibold text-blue-700"
              data-testid="talk-call"
            >
              <Icon name="clock" size={18} />
              {c.call}
            </Link>
            <p className="px-1 text-[13px] leading-snug text-slate-500">{QUESTIONS_ONLY[locale].short}</p>
          </>
        )}
        <button type="button" onClick={onClose} className="pressable flex h-11 items-center justify-center text-[15px] font-medium text-blue-700">
          {c.close}
        </button>
      </div>
    </div>
  );
}
