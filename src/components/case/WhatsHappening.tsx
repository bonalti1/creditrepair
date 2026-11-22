"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useCase } from "@/lib/case/useCase";
import { useLocale } from "@/lib/i18n";
import Icon from "@/components/Icon";
import SpeakButton from "@/components/SpeakButton";
import { ExampleBadge } from "./CaseViews";

// "¿Qué está pasando?" in one tap, from every screen of the client app: a
// button in the header opens the one status sentence (the same one Home shows
// at the top), with "Escuchar" and a link to "Mi caso". A native <dialog>, so
// focus moves into it, Escape closes it and focus returns to the button.

function Sentence({ onClose }: { onClose: () => void }) {
  const { locale } = useLocale();
  const es = locale === "es";
  const view = useCase(locale);
  if (!view.ready) return <p className="mt-3 text-[16px] text-slate-500">{es ? "Un momento…" : "One moment…"}</p>;
  return (
    <>
      {view.example && <ExampleBadge className="mt-2" />}
      <p className="mt-3 text-[18px] font-medium leading-snug text-slate-900" data-testid="whats-happening-sentence">
        {view.timeline.sentence}
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <SpeakButton text={view.timeline.sentence} label={es ? "qué está pasando" : "what's happening"} />
        <Link
          href="/caso"
          onClick={onClose}
          className="pressable inline-flex h-11 items-center gap-1 rounded-full bg-amber-400 px-4 text-[15px] font-semibold text-blue-900 hover:bg-amber-500"
        >
          {es ? "Ver mi caso" : "See my case"}
          <Icon name="chevron" size={16} />
        </Link>
      </div>
    </>
  );
}

export default function WhatsHappening() {
  const { locale } = useLocale();
  const es = locale === "es";
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const title = es ? "¿Qué está pasando?" : "What's happening?";

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={title}
        aria-haspopup="dialog"
        data-testid="whats-happening"
        className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700"
      >
        <Icon name="info" size={20} />
      </button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          // A tap outside the panel closes it.
          if (e.target === dialog.current) setOpen(false);
        }}
        aria-labelledby="whats-happening-title"
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-3xl bg-white p-0 text-left shadow-xl backdrop:bg-slate-900/40"
      >
        <div className="px-5 pb-5 pt-4">
          <div className="flex items-center justify-between gap-3">
            <h2 id="whats-happening-title" className="text-[13px] font-semibold uppercase tracking-wide text-blue-700">
              {title}
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={es ? "Cerrar" : "Close"}
              className="pressable -mr-2 flex h-11 w-11 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
            >
              <Icon name="close" size={20} />
            </button>
          </div>
          {open && <Sentence onClose={() => setOpen(false)} />}
        </div>
      </dialog>
    </>
  );
}
