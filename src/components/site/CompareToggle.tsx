"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import type { CompareRow } from "@/lib/site/copy";
import { LIVE_COPY } from "@/lib/site/live";

// The comparison, as a toggle: "Credalti" or "Many companies", the same six
// questions, the answers swapping in row by row. Our side is product facts
// (facts.ts, the test holds each one); "many companies" is what was observed
// in the industry, never one named company (docs/WEBSITE.md). The toggle is
// two pressed/unpressed buttons; the rows are a list a screen reader can read
// either way, and with reduced motion they swap without moving.

export default function CompareToggle({ locale, rows, note }: { locale: "es" | "en"; rows: CompareRow[]; note: string }) {
  const c = LIVE_COPY[locale].compare;
  const [side, setSide] = useState<"us" | "them">("us");
  const us = side === "us";
  return (
    <div data-testid="compare-toggle">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[14px] font-semibold text-slate-600" id="compare-show">
          {c.label}
        </span>
        <div role="group" aria-labelledby="compare-show" className="relative grid grid-cols-2 rounded-full bg-white p-1 ring-1 ring-slate-200">
          <span
            aria-hidden
            className={`absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full transition-transform duration-300 motion-reduce:transition-none ${us ? "translate-x-0 bg-blue-900" : "translate-x-full bg-slate-600"}`}
          />
          {(["us", "them"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={side === s}
              onClick={() => setSide(s)}
              className={`relative z-10 h-11 rounded-full px-5 text-[15px] font-semibold transition-colors ${side === s ? "text-white" : "text-slate-600 hover:text-blue-900"}`}
              data-testid={`compare-${s}`}
            >
              {s === "us" ? c.showUs : c.showThem}
            </button>
          ))}
        </div>
        <span className="text-[13px] text-slate-500">{c.hint}</span>
      </div>

      <ul className="mt-6 grid gap-3 md:grid-cols-2">
        {rows.map((row, i) => (
          <li
            key={`${side}-${row.topic}`}
            className={`row-swap flex gap-4 rounded-3xl p-5 ring-1 ${us ? "bg-white ring-slate-200" : "bg-slate-100 ring-slate-200"}`}
            style={{ animationDelay: `${i * 55}ms` }}
          >
            <span data-on-navy={us ? "" : undefined} className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${us ? "bg-blue-900 text-amber-400" : "bg-white text-slate-500 ring-1 ring-slate-300"}`}>
              <Icon name={us ? "check" : "info"} size={18} strokeWidth={us ? 2.5 : 2} />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">{row.topic}</p>
              <p className={`mt-1 text-[16px] leading-relaxed ${us ? "text-slate-800" : "text-slate-600"}`}>{us ? row.us : row.them}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[13px] leading-relaxed text-slate-500">{note}</p>
    </div>
  );
}
