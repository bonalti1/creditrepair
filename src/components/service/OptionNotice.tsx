"use client";

import Link from "next/link";
import { OPTION_NAME, OPTION_SUBTITLE, type ServiceOption } from "@/lib/service/options";
import { useServiceOption } from "@/lib/service/useServiceOption";

// Above the agreement: which option this agreement is for, and, during a
// switch, that the current agreement stays in force until the new one is
// signed, with a calm way to keep the current option. Never pushes either.

export default function OptionNotice({ option, previous, locale }: { option: ServiceOption; previous: ServiceOption | null; locale: "en" | "es" }) {
  const { choose } = useServiceOption();
  const es = locale === "es";
  const name = OPTION_NAME[option][locale];
  return (
    <section data-testid="agreement-option" className="card px-5 py-4" aria-live="polite">
      <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{es ? "Tu opción" : "Your option"}</p>
      <p className="mt-1 text-[17px] font-semibold leading-snug text-slate-900">
        {name} <span className="font-normal text-slate-600">· {OPTION_SUBTITLE[option][locale]}</span>
      </p>
      {previous && previous !== option ? (
        <>
          <p className="mt-2 text-[15px] leading-relaxed text-slate-600">
            {es
              ? `Estás cambiando de ${OPTION_NAME[previous].es} a ${name}. Tu acuerdo actual sigue vigente hasta que firmes este; conservas todo lo que ya hiciste. Al firmar tienes 3 días hábiles para cancelar el nuevo sin costo.`
              : `You're changing from ${OPTION_NAME[previous].en} to ${name}. Your current agreement stays in force until you sign this one; you keep everything you've done. After signing you have 3 business days to cancel the new one at no cost.`}
          </p>
          <button
            type="button"
            onClick={async () => {
              if (await choose(previous)) window.location.reload();
            }}
            className="pressable mt-3 h-11 rounded-full bg-slate-100 px-5 text-[15px] font-medium text-slate-900 hover:bg-slate-200"
          >
            {es ? `Seguir con ${OPTION_NAME[previous].es}` : `Keep ${OPTION_NAME[previous].en}`}
          </button>
        </>
      ) : (
        <p className="mt-2 text-[15px] leading-relaxed text-slate-600">
          {es ? "¿Prefieres la otra opción? " : "Prefer the other option? "}
          <Link href="/precios#opciones" className="font-medium text-blue-700 underline-offset-2 hover:underline">
            {es ? "Compara las dos" : "Compare the two"}
          </Link>
        </p>
      )}
    </section>
  );
}
