"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import OptionComparison, { type ComparisonPrice } from "@/components/service/OptionComparison";
import { useLocale } from "@/lib/i18n";
import { OPTION_NAME, type ServiceOption } from "@/lib/service/options";
import { useServiceOption } from "@/lib/service/useServiceOption";

type Prices = Record<ServiceOption, ComparisonPrice | null>;

// The client's own option, and changing it: before signing, the choice is
// simply recorded; after signing, choosing the other option opens its
// agreement at /acuerdo (the current one stays in force until they sign).

export default function OptionSwitcher({
  prices,
  monitoring,
}: {
  prices: { en: Prices; es: Prices };
  monitoring: { en: string; es: string };
  initialLocale?: "en" | "es";
}) {
  const { locale } = useLocale();
  const es = locale === "es";
  const router = useRouter();
  const { option, signed, chosen, switchPending, hydrated, choose } = useServiceOption();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!hydrated) return null;

  const current = signed ?? chosen;
  return (
    <main className="animate-rise space-y-5">
      <header className="px-1">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-slate-900">{es ? "Mi opción" : "My option"}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-500">
          {current
            ? es
              ? `Hoy tienes ${OPTION_NAME[option].es}. Puedes cambiar cuando quieras: conservas todo lo que ya hiciste.`
              : `Today you have ${OPTION_NAME[option].en}. You can change anytime: you keep everything you've done.`
            : es
              ? "Elige cómo quieres trabajar con nosotros. Las dos opciones empiezan con tu revisión."
              : "Choose how you want to work with us. Both options start with your review."}
        </p>
        {signed && (
          <p className="mt-2 text-[14px] leading-relaxed text-slate-500">
            {es
              ? "Si cambias, firmas el acuerdo de la otra opción, con sus propios 3 días hábiles para cancelar sin costo. Tu acuerdo actual sigue vigente hasta que firmes, y no se cobra dos veces el mismo periodo."
              : "If you change, you sign the other option's agreement, with its own 3 business days to cancel at no cost. Your current agreement stays in force until you sign, and no period is charged twice."}
          </p>
        )}
      </header>
      {switchPending && chosen && (
        <p className="card px-5 py-4 text-[15px] text-slate-700">
          {es ? `Tu cambio a ${OPTION_NAME[chosen].es} espera tu firma.` : `Your change to ${OPTION_NAME[chosen].en} waits for your signature.`}{" "}
          <a href="/acuerdo" className="font-medium text-blue-700 underline-offset-2 hover:underline">
            {es ? "Firmar ahora" : "Sign now"}
          </a>
        </p>
      )}
      <OptionComparison
        locale={locale}
        prices={prices[locale]}
        monitoring={monitoring[locale]}
        chosen={current}
        busy={busy}
        headingLevel={2}
        onChoose={async (next) => {
          setError(null);
          setBusy(true);
          const ok = await choose(next, "app");
          setBusy(false);
          if (!ok) return setError(es ? "No se pudo guardar. Inténtalo de nuevo." : "It could not be saved. Please try again.");
          // A new option's agreement is signed at /acuerdo (before signing too: it is the agreement for the option chosen).
          if (next !== signed) router.push("/acuerdo");
        }}
      />
      {error && <p role="alert" className="px-1 text-[14px] text-red-700">{error}</p>}
    </main>
  );
}
