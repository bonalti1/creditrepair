"use client";

import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { moderatorMessages, runOfShow, type ScriptVars } from "@/lib/webinars/scripts";
import { CopyButton } from "./bits";

// The host's script and the run of show, in English and Spanish, with the
// three call-to-action moments marked; and the moderator's chat messages
// with a copy button each. Printable (the console's frame hides in print).

export function RunOfShow({ vars, lang, compact = false, currentAt = null }: { vars: ScriptVars; lang: "en" | "es"; compact?: boolean; currentAt?: number | null }) {
  const t = useTx();
  return (
    <ol className="space-y-2" data-testid="run-of-show">
      {runOfShow(vars).map((s) => (
        <li key={s.at} aria-current={currentAt === s.at ? "step" : undefined} className={`break-inside-avoid rounded-[12px] border px-4 py-3 ${s.cta ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"} ${currentAt === s.at ? "ring-2 ring-blue-700" : ""}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold text-blue-900">
              <span className="font-mono tabular-nums">{String(s.at).padStart(2, "0")}:00</span> · {s.title[lang]}
            </p>
            <p className="text-[12.5px] tabular-nums text-slate-500">
              {s.minutes} min
              {s.cta && <span className="ml-2 rounded-full bg-amber-400 px-2 py-0.5 font-semibold text-blue-900">{t(`Invitación ${s.cta}`, `Call to action ${s.cta}`)}</span>}
            </p>
          </div>
          {!compact && (
            <>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-slate-800">
                <span className="font-semibold">{t("Presenta", "Host")}:</span> {s.host[lang]}
              </p>
              <p className="mt-1 text-[13.5px] leading-snug text-slate-600">
                <span className="font-semibold">{t("Modera", "Moderator")}:</span> {s.moderator[lang]}
              </p>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

export function ModeratorMessages({ vars, lang }: { vars: ScriptVars; lang: "en" | "es" }) {
  const t = useTx();
  return (
    <ul className="space-y-2" data-testid="moderator-messages">
      {moderatorMessages(vars).map((m) => (
        <li key={m.key} className="break-inside-avoid rounded-[12px] border border-slate-200 bg-white px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-slate-500">{m.when[lang]}</p>
            <span className="print:hidden">
              <CopyButton text={m.text[lang]} label={m.when[lang]} testId={`copy-${m.key}`} />
            </span>
          </div>
          <p className="mt-1 select-all whitespace-pre-line text-[14.5px] leading-relaxed text-slate-900 [overflow-wrap:anywhere]">{m.text[lang]}</p>
        </li>
      ))}
      <li className="text-[12.5px] text-slate-500">{t("Los mensajes salen en el idioma elegido arriba; cada uno ya pasó las reglas de lo que se puede decir.", "The messages are in the language chosen above; each one already passed the rules on what we can say.")}</li>
    </ul>
  );
}

export default function ScriptView({ vars, lang, setLang, title }: { vars: ScriptVars; lang: "en" | "es"; setLang: (l: "en" | "es") => void; title: string }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  return (
    <div data-testid="script-view">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <span className="text-[13px] font-semibold text-slate-600">{t("Idioma del guion", "Script language")}:</span>
        {(["es", "en"] as const).map((l) => (
          <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} className={`pressable inline-flex h-11 items-center rounded-full border px-4 text-[14px] font-semibold md:h-10 ${lang === l ? "border-blue-900 bg-blue-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
            {l === "es" ? "Español" : "English"}
          </button>
        ))}
        <button type="button" onClick={() => window.print()} className="pressable ml-auto inline-flex h-11 items-center rounded-[10px] border border-slate-300 bg-white px-4 text-[14px] font-semibold text-blue-900 hover:border-amber-500">
          {t("Imprimir", "Print")}
        </button>
      </div>
      <h2 className="mt-4 font-display text-[18px] font-semibold text-blue-900" lang={lang}>
        {title}
      </h2>
      {vars.prices.complete.includes("[") && (
        <p className="mt-1 rounded-[10px] bg-amber-50 px-3 py-2 text-[13px] text-blue-900 print:hidden">
          {t("«[price]»: todavía no hay un plan ofrecido con ese nombre. Quien presenta lee el precio del plan aprobado (Planes / Precios).", "“[price]”: no offered plan has that name yet. The host reads the price of the approved plan (Plans / Pricing).")}
        </p>
      )}
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[3fr_2fr]" lang={lang}>
        <section aria-label={t("Orden del show y guion", "Run of show and script")}>
          <h3 className="console-label mb-2">{t("Orden del show (45 minutos)", "Run of show (45 minutes)")}</h3>
          <RunOfShow vars={vars} lang={lang} />
        </section>
        <section aria-label={t("Mensajes del moderador", "Moderator's messages")}>
          <h3 className="console-label mb-2">{t("Mensajes para el chat", "Chat messages")}</h3>
          <ModeratorMessages vars={vars} lang={lang} />
        </section>
      </div>
      <p className="mt-4 text-[12px] text-slate-500" lang={locale}>
        {t("Reglas en vivo: nunca prometas resultados ni fechas, nunca digas «gratis», nunca pidas números personales en el chat, y la persona siempre decide qué está mal. Alti es una IA y se dice.", "Rules on air: never promise results or dates, never say “free”, never ask for personal numbers in the chat, and the person always decides what is wrong. Alti is an AI, and we say so.")}
      </p>
    </div>
  );
}
