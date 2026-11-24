"use client";

import { useId, useState } from "react";
import Icon from "@/components/Icon";
import { DROP_OFF_RULES, dropOffDate, ITEM_TYPES, monthYearLabel, parseAmount, parseMonth, utilization, type ItemType } from "@/lib/learn/calculators";
import { LIVE_COPY } from "@/lib/site/live";

// The two calculators from Aprende (src/lib/learn/calculators.ts), as website
// widgets: card utilization (balances ÷ limits) and "how long can this stay"
// (the FCRA's time limits, 15 U.S.C. §1681c). Arithmetic on what the visitor
// types, nothing saved or sent, no score and no prediction. A tab list
// switches between them; results are announced politely.

type Tab = "util" | "stay";

export default function Tools({ locale }: { locale: "es" | "en" }) {
  const c = LIVE_COPY[locale].tools;
  const [tab, setTab] = useState<Tab>("util");
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "util", label: c.tabUtil },
    { id: "stay", label: c.tabStay },
  ];
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = tab === "util" ? "stay" : "util";
    setTab(next);
    document.getElementById(`tool-tab-${next}`)?.focus();
  };
  return (
    <div className="card overflow-hidden" data-testid="site-tools">
      <div role="tablist" aria-label={c.title} onKeyDown={onKey} className="flex gap-1 border-b border-slate-200 bg-slate-50 p-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            id={`tool-tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            aria-controls={`tool-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            className={`h-11 flex-1 rounded-2xl px-3 text-[15px] font-semibold transition-colors ${tab === t.id ? "bg-white text-blue-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-blue-900"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id={`tool-panel-${tab}`} role="tabpanel" aria-labelledby={`tool-tab-${tab}`} className="p-6 sm:p-8">
        {tab === "util" ? <Utilization locale={locale} /> : <StayCalculator locale={locale} />}
        <p className="mt-6 flex items-center gap-2 text-[13px] text-slate-500">
          <Icon name="info" size={15} />
          {c.privacy}
        </p>
      </div>
    </div>
  );
}

const input = "h-12 w-full rounded-2xl bg-slate-100 px-4 text-[16px] tabular-nums text-slate-900 placeholder:text-slate-400";

function Utilization({ locale }: { locale: "es" | "en" }) {
  const c = LIVE_COPY[locale].tools.util;
  const id = useId();
  const [cards, setCards] = useState([
    { balance: "450", limit: "1500" },
    { balance: "", limit: "" },
  ]);
  const parsed = cards.map((card) => ({ balance: parseAmount(card.balance), limit: parseAmount(card.limit) }));
  const result = utilization(parsed.filter((p) => Number.isFinite(p.balance) && Number.isFinite(p.limit)));
  const pct = result.percent;
  const band = pct === null ? null : pct < 30 ? c.low : pct <= 50 ? c.mid : c.high;
  const bar = pct === null ? 0 : Math.min(100, pct);
  const set = (i: number, key: "balance" | "limit", value: string) => setCards((all) => all.map((card, j) => (j === i ? { ...card, [key]: value } : card)));

  return (
    <div>
      <h3 className="text-[20px] font-semibold text-blue-900">{c.title}</h3>
      <p className="mt-1 text-[15px] text-slate-600">{c.lead}</p>
      <ul className="mt-5 space-y-3">
        {cards.map((card, i) => (
          <li key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2.5">
            <label className="block text-[13px] font-semibold text-slate-600" htmlFor={`${id}-b${i}`}>
              {c.card(i + 1)} · {c.balance}
              <input id={`${id}-b${i}`} inputMode="decimal" value={card.balance} onChange={(e) => set(i, "balance", e.target.value)} placeholder="0" className={`${input} mt-1`} />
            </label>
            <label className="block text-[13px] font-semibold text-slate-600" htmlFor={`${id}-l${i}`}>
              {c.limit}
              <input id={`${id}-l${i}`} inputMode="decimal" value={card.limit} onChange={(e) => set(i, "limit", e.target.value)} placeholder="0" className={`${input} mt-1`} />
            </label>
            <button
              type="button"
              onClick={() => setCards((all) => all.filter((_, j) => j !== i))}
              disabled={cards.length === 1}
              aria-label={`${c.remove}: ${c.card(i + 1)}`}
              className="pressable flex h-12 w-12 items-center justify-center rounded-2xl text-slate-500 hover:bg-slate-100 disabled:opacity-30"
            >
              <Icon name="close" size={18} />
            </button>
          </li>
        ))}
      </ul>
      {cards.length < 6 && (
        <button type="button" onClick={() => setCards((all) => [...all, { balance: "", limit: "" }])} className="pressable mt-3 inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[15px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-200 hover:bg-blue-50">
          <Icon name="plus" size={16} strokeWidth={2.25} />
          {c.add}
        </button>
      )}
      <div className="mt-6 rounded-3xl bg-blue-900 p-5 text-white" aria-live="polite" data-testid="util-result">
        {pct === null ? (
          <p className="text-[16px] text-blue-100">{c.empty}</p>
        ) : (
          <>
            <p className="font-display text-[24px] font-bold tabular-nums">{c.result(pct)}</p>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/15" aria-hidden>
              <div className="h-full origin-left rounded-full bg-amber-400 transition-transform duration-500 motion-reduce:transition-none" style={{ transform: `scaleX(${bar / 100})` }} />
            </div>
            <div className="relative mt-1 h-4 text-[11px] text-blue-200" aria-hidden>
              <span className="absolute left-[30%] -translate-x-1/2">30%</span>
            </div>
            {band && <p className="mt-1 text-[15px] text-blue-50">{band}</p>}
          </>
        )}
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-slate-500">{c.note}</p>
    </div>
  );
}

function StayCalculator({ locale }: { locale: "es" | "en" }) {
  const c = LIVE_COPY[locale].tools.stay;
  const id = useId();
  const [type, setType] = useState<ItemType>("collection");
  const [month, setMonth] = useState("2021-03");
  const start = parseMonth(month);
  const result = start ? dropOffDate(type, start) : null;
  const rule = DROP_OFF_RULES[type];
  const when = result ? monthYearLabel(result.year, result.month, locale) : "";

  return (
    <div>
      <h3 className="text-[20px] font-semibold text-blue-900">{c.title}</h3>
      <p className="mt-1 text-[15px] text-slate-600">{c.lead}</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="block text-[13px] font-semibold text-slate-600" htmlFor={`${id}-t`}>
          {c.type}
          <select id={`${id}-t`} value={type} onChange={(e) => setType(e.target.value as ItemType)} className={`${input} mt-1`}>
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {DROP_OFF_RULES[t].label[locale]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[13px] font-semibold text-slate-600" htmlFor={`${id}-d`}>
          {c.date}: {rule.startsFrom[locale]}
          <input id={`${id}-d`} type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={`${input} mt-1`} />
        </label>
      </div>
      <div className="mt-6 rounded-3xl bg-blue-900 p-5 text-white" aria-live="polite" data-testid="stay-result">
        {!result ? (
          <p className="text-[16px] text-blue-100">{c.empty}</p>
        ) : (
          <>
            <p className="font-display text-[22px] font-bold leading-snug">{result.alreadyPassed ? c.passed(when) : c.result(when)}</p>
            <p className="mt-2 text-[15px] text-blue-50">{c.accurate}</p>
            <p className="text-[15px] text-blue-50">{c.wrong}</p>
          </>
        )}
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-slate-500">
        {rule.basis[locale]} {rule.inLaw ? c.lawNote : c.practiceNote}
      </p>
    </div>
  );
}
