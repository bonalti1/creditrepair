"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { SiteCopy } from "@/lib/site/copy";
import type { DemoCase, DemoChoice } from "@/lib/site/demo";
import AltiDemo from "./AltiDemo";
import type { AskCopy, AskCtas } from "./AskAlti";

// The home page's hero phone: two tabs, "Try the example" (the scripted
// example, AltiDemo) and "Ask Alti" (the live chat, loaded only when chosen).
// A real tab list: arrow keys move between the tabs, and the panel is labelled
// by its tab. The phone is pure CSS, sized so nothing moves while it plays.

const AskAltiChat = dynamic(() => import("./AskAlti"), { ssr: false, loading: () => <div className="flex-1" /> });

type Tab = "example" | "ask";

export default function HeroPhone({
  demo,
  cases,
  byline,
  tabs,
  ask,
  ctas,
  locale,
}: {
  demo: SiteCopy["home"]["demo"];
  cases: Record<DemoChoice, DemoCase>;
  byline: string;
  tabs: { example: string; ask: string; label: string };
  ask: AskCopy;
  ctas: AskCtas;
  locale: "es" | "en";
}) {
  const [tab, setTab] = useState<Tab>("example");
  const order: Tab[] = ["example", "ask"];
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = order[(order.indexOf(tab) + 1) % 2]!;
    setTab(next);
    document.getElementById(`hero-tab-${next}`)?.focus();
  };
  return (
    <div className="relative mx-auto w-full max-w-[360px]" data-testid="hero-phone">
      <div className="relative rounded-[48px] bg-blue-900 p-[10px] shadow-[0_40px_80px_-30px_rgba(0,0,0,0.6)] ring-1 ring-white/25">
        <div className="relative flex h-[690px] flex-col overflow-hidden rounded-[38px] bg-slate-50">
          <div aria-hidden className="absolute left-1/2 top-2.5 z-20 h-[26px] w-[96px] -translate-x-1/2 rounded-full bg-blue-900" />
          <div role="tablist" aria-label={tabs.label} className="relative z-10 mx-3 mt-11 grid grid-cols-2 gap-1 rounded-full bg-slate-200/70 p-1" onKeyDown={onKey}>
            {order.map((t) => (
              <button
                key={t}
                id={`hero-tab-${t}`}
                role="tab"
                type="button"
                aria-selected={tab === t}
                aria-controls={`hero-panel-${t}`}
                tabIndex={tab === t ? 0 : -1}
                onClick={() => setTab(t)}
                className={`h-9 rounded-full text-[13.5px] font-semibold transition-colors ${tab === t ? "bg-white text-blue-900 shadow-sm" : "text-slate-600 hover:text-blue-900"}`}
                data-testid={`hero-tab-${t}`}
              >
                {t === "example" ? tabs.example : tabs.ask}
              </button>
            ))}
          </div>
          <div id={`hero-panel-${tab}`} role="tabpanel" aria-labelledby={`hero-tab-${tab}`} className="mt-2 flex min-h-0 flex-1 flex-col">
            {tab === "example" ? (
              <AltiDemo copy={demo} cases={cases} byline={byline} />
            ) : (
              <>
                <div className="flex items-center gap-2.5 border-b border-slate-200 bg-white px-4 py-3">
                  <p className="min-w-0 flex-1 text-[15px] font-semibold leading-tight text-blue-900">
                    {byline}
                    <span className="block text-[12px] font-normal text-slate-500">{ask.subtitle}</span>
                  </p>
                </div>
                <AskAltiChat copy={ask} locale={locale} byline={byline} ctas={ctas} variant="phone" />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
