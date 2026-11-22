"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import SpeakButton from "@/components/SpeakButton";
import { useLocale } from "@/lib/i18n";
import { parseAmount, utilization } from "@/lib/learn/calculators";

// The utilization calculator: balances on open cards divided by their limits.
// It only does the arithmetic. No score, no prediction; nothing is saved or sent.

interface Row {
  balance: string;
  limit: string;
}

export default function UtilizacionPage() {
  const { locale } = useLocale();
  const es = locale === "es";
  const [rows, setRows] = useState<Row[]>([{ balance: "", limit: "" }]);

  const cards = rows.map((r) => ({ balance: parseAmount(r.balance || "0"), limit: parseAmount(r.limit || "0") }));
  const filled = rows.some((r) => r.limit.trim() !== "");
  const invalid = rows.some((r) => (r.balance && Number.isNaN(parseAmount(r.balance))) || (r.limit && Number.isNaN(parseAmount(r.limit))));
  const result = utilization(cards);
  const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const sentence =
    result.percent === null
      ? ""
      : es
        ? `Debes ${money(result.totalBalance)} de un límite total de ${money(result.totalLimit)}. Tu utilización es ${result.percent}%.`
        : `You owe ${money(result.totalBalance)} out of a total limit of ${money(result.totalLimit)}. Your utilization is ${result.percent}%.`;

  const update = (i: number, field: keyof Row, value: string) => setRows((current) => current.map((r, j) => (j === i ? { ...r, [field]: value } : r)));

  return (
    <main className="animate-rise space-y-5" data-testid="tool-utilization">
      <Link href="/aprende" className="inline-flex h-11 items-center gap-1 px-1 text-[15px] font-medium text-blue-700">
        <Icon name="chevron" size={16} className="rotate-180" />
        {es ? "Aprende" : "Learn"}
      </Link>
      <header className="px-1">
        <h1 className="font-display text-[28px] font-bold leading-tight text-blue-700">{es ? "Calculadora de utilización" : "Utilization calculator"}</h1>
        <p className="mt-2 text-[16px] leading-relaxed text-slate-600">
          {es
            ? "Escribe lo que debes y el límite de cada tarjeta abierta. Lo ves en tu estado de cuenta."
            : "Type what you owe and the limit of each open card. You can find them on your statement."}
        </p>
      </header>

      <section className="card space-y-4 px-5 py-5">
        {rows.map((row, i) => (
          <fieldset key={i} className={i > 0 ? "border-t hairline pt-4" : ""}>
            <legend className="text-[15px] font-semibold text-slate-900">{es ? `Tarjeta ${i + 1}` : `Card ${i + 1}`}</legend>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <label className="block text-[14px] text-slate-700">
                {es ? "Lo que debes" : "What you owe"}
                <input
                  inputMode="decimal"
                  value={row.balance}
                  onChange={(e) => update(i, "balance", e.target.value)}
                  placeholder="$300"
                  data-testid={`balance-${i}`}
                  className="mt-1 h-12 w-full rounded-2xl bg-slate-100 px-3 text-[17px] text-slate-900 outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-blue-300"
                />
              </label>
              <label className="block text-[14px] text-slate-700">
                {es ? "Límite" : "Limit"}
                <input
                  inputMode="decimal"
                  value={row.limit}
                  onChange={(e) => update(i, "limit", e.target.value)}
                  placeholder="$1,000"
                  data-testid={`limit-${i}`}
                  className="mt-1 h-12 w-full rounded-2xl bg-slate-100 px-3 text-[17px] text-slate-900 outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-blue-300"
                />
              </label>
            </div>
          </fieldset>
        ))}
        {rows.length < 8 && (
          <button
            type="button"
            onClick={() => setRows((r) => [...r, { balance: "", limit: "" }])}
            className="pressable inline-flex h-11 items-center gap-1.5 rounded-full bg-slate-100 px-4 text-[15px] font-semibold text-slate-900"
          >
            <Icon name="plus" size={18} />
            {es ? "Otra tarjeta" : "Another card"}
          </button>
        )}
      </section>

      <section className="rounded-3xl bg-blue-700 px-5 py-5 text-white" aria-live="polite" data-testid="utilization-result">
        <h2 data-on-navy className="text-[13px] font-semibold uppercase tracking-wide text-amber-300">{es ? "Resultado" : "Result"}</h2>
        {invalid ? (
          <p className="mt-2 text-[17px] leading-snug">{es ? "Escribe solo números, por ejemplo 1250." : "Type numbers only, for example 1250."}</p>
        ) : !filled || result.percent === null ? (
          <p className="mt-2 text-[17px] leading-snug">{es ? "Escribe al menos un límite para ver la cuenta." : "Type at least one limit to see the math."}</p>
        ) : (
          <>
            <p className="mt-1 font-display text-[40px] font-bold tabular-nums">{result.percent}%</p>
            <p className="mt-1 text-[16px] leading-snug text-blue-100">{sentence}</p>
            <SpeakButton text={sentence} tone="dark" label={es ? "el resultado" : "the result"} className="mt-3" />
          </>
        )}
      </section>

      <section className="px-1 text-[14px] leading-relaxed text-slate-600">
        <p>
          {es
            ? "Muchos expertos recomiendan usar menos del 30% de tu límite total. Esta calculadora no te dice un puntaje. Cada modelo de puntaje lo mide a su manera."
            : "Many experts suggest using less than 30% of your total limit. This calculator does not give you a score. Each scoring model measures it its own way."}
        </p>
        <p className="mt-2">{es ? "No guardamos ni enviamos lo que escribes aquí." : "We do not save or send what you type here."}</p>
        <Link href="/aprende/utilizacion" className="mt-2 inline-flex h-11 items-center font-medium text-blue-700 underline underline-offset-2">
          {es ? "Lee la lección sobre la utilización" : "Read the lesson on utilization"}
        </Link>
      </section>
    </main>
  );
}
