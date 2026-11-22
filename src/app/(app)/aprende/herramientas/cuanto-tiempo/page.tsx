"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import SpeakButton from "@/components/SpeakButton";
import { useLocale } from "@/lib/i18n";
import { DROP_OFF_RULES, dropOffDate, ITEM_TYPES, monthYearLabel, parseMonth, type ItemType } from "@/lib/learn/calculators";

// "¿Hasta cuándo se puede reportar?": the type of item and its date in, the
// latest month it may be reported under the FCRA's time limits out (§ 605,
// 15 U.S.C. § 1681c). The limits of the answer are said on the screen.
// Nothing is saved or sent.

export default function CuantoTiempoPage() {
  const { locale } = useLocale();
  const es = locale === "es";
  const [type, setType] = useState<ItemType>("collection");
  const [month, setMonth] = useState("");
  const rule = DROP_OFF_RULES[type];
  const start = month ? parseMonth(month) : null;
  const result = start ? dropOffDate(type, start) : null;
  const when = result ? monthYearLabel(result.year, result.month, locale) : "";
  const sentence = !result
    ? ""
    : result.alreadyPassed
      ? es
        ? `Según la regla, se podía reportar hasta ${when}. Esa fecha ya pasó. Si todavía aparece, puedes disputarlo como información vieja.`
        : `Under the rule, it could be reported until ${when}. That date has passed. If it still shows, you can dispute it as outdated.`
      : es
        ? `Según la regla, se puede reportar hasta ${when}, más o menos. Después debería salir de tu reporte.`
        : `Under the rule, it can be reported until about ${when}. After that it should come off your report.`;

  return (
    <main className="animate-rise space-y-5" data-testid="tool-drop-off">
      <Link href="/aprende" className="inline-flex h-11 items-center gap-1 px-1 text-[15px] font-medium text-blue-700">
        <Icon name="chevron" size={16} className="rotate-180" />
        {es ? "Aprende" : "Learn"}
      </Link>
      <header className="px-1">
        <h1 className="font-display text-[28px] font-bold leading-tight text-blue-700">{es ? "¿Hasta cuándo se puede reportar?" : "How long can it be reported?"}</h1>
        <p className="mt-2 text-[16px] leading-relaxed text-slate-600">
          {es ? "Elige qué es y escribe su fecha. Te decimos el límite que pone la ley." : "Pick what it is and type its date. We show you the limit the law sets."}
        </p>
      </header>

      <section className="card space-y-4 px-5 py-5">
        <label className="block text-[15px] font-semibold text-slate-900">
          {es ? "¿Qué es?" : "What is it?"}
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ItemType)}
            data-testid="drop-off-type"
            className="mt-2 h-12 w-full rounded-2xl bg-slate-100 px-3 text-[17px] font-normal text-slate-900 outline-none focus:ring-2 focus:ring-blue-300"
          >
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {DROP_OFF_RULES[t].label[locale]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[15px] font-semibold text-slate-900">
          {rule.startsFrom[locale]}
          <span className="block text-[13px] font-normal text-slate-600">{es ? "El mes y el año bastan. Búscalo en tu reporte." : "Month and year are enough. Look for it on your report."}</span>
          <input
            type="month"
            value={month}
            max={new Date().toISOString().slice(0, 7)}
            onChange={(e) => setMonth(e.target.value)}
            data-testid="drop-off-date"
            className="mt-2 h-12 w-full rounded-2xl bg-slate-100 px-3 text-[17px] font-normal text-slate-900 outline-none focus:ring-2 focus:ring-blue-300"
          />
        </label>
      </section>

      <section className="rounded-3xl bg-blue-700 px-5 py-5 text-white" aria-live="polite" data-testid="drop-off-result">
        <h2 data-on-navy className="text-[13px] font-semibold uppercase tracking-wide text-amber-300">{es ? "Resultado" : "Result"}</h2>
        {!result ? (
          <p className="mt-2 text-[17px] leading-snug">{month ? (es ? "Esa fecha no es válida." : "That date is not valid.") : es ? "Escribe la fecha para ver el resultado." : "Type the date to see the result."}</p>
        ) : (
          <>
            <p className="mt-1 font-display text-[30px] font-bold">{when.charAt(0).toUpperCase() + when.slice(1)}</p>
            <p className="mt-1 text-[16px] leading-snug text-blue-100">{sentence}</p>
            <p className="mt-2 text-[14px] leading-snug text-blue-100">{rule.basis[locale]}</p>
            <SpeakButton text={`${sentence} ${rule.basis[locale]}`} tone="dark" label={es ? "el resultado" : "the result"} className="mt-3" />
          </>
        )}
      </section>

      <section className="card px-5 py-5 text-[15px] leading-relaxed text-slate-700" aria-labelledby="limits">
        <h2 id="limits" className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">
          {es ? "Lo que debes saber" : "What to know"}
        </h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>{es ? "Es el tiempo más largo que se puede reportar. Un buró lo puede quitar antes." : "It is the longest it can be reported. A bureau may take it off sooner."}</li>
          <li>{es ? "Si la información es correcta, se queda hasta esa fecha." : "If the information is correct, it stays until that date."}</li>
          <li>{es ? "Pagar la deuda o que la vendan no reinicia el tiempo." : "Paying the debt, or it being sold, does not restart the time."}</li>
          <li>
            {es
              ? "No aplica si pides un trabajo de más de $75,000 al año, o más de $150,000 en crédito o seguro de vida."
              : "It does not apply to a job paying more than $75,000 a year, or more than $150,000 of credit or life insurance."}
          </li>
          <li>{es ? "La fecha exacta puede variar unos días. Esto no es consejo legal." : "The exact day can vary by a few days. This is not legal advice."}</li>
        </ul>
        <p className="mt-3">{es ? "No guardamos ni enviamos lo que escribes aquí." : "We do not save or send what you type here."}</p>
        <Link href="/aprende/cuanto-tiempo" className="mt-1 inline-flex h-11 items-center font-medium text-blue-700 underline underline-offset-2">
          {es ? "Lee la lección: cuánto tiempo se queda algo" : "Read the lesson: how long things stay"}
        </Link>
      </section>
    </main>
  );
}
