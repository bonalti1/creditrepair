"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n";

// Shown when a screen inside the app fails to render. The client's data is on
// the server; nothing they did is lost. In the app's language (this boundary
// sits inside the app's layout, so the language setting is there).
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { locale } = useLocale();
  const es = locale === "es";
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="animate-rise">
      <section className="card px-6 py-8 text-center">
        <h1 className="text-[22px] font-semibold leading-snug text-slate-900">{es ? "Algo no cargó bien" : "Something didn't load"}</h1>
        <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-slate-500">
          {es
            ? "No perdiste nada: tu revisión y tus cartas siguen guardadas. Intenta de nuevo."
            : "Nothing was lost: your review and your letters are still saved. Please try again."}
        </p>
        <button
          type="button"
          onClick={reset}
          className="pressable mt-6 flex h-14 w-full items-center justify-center rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500"
        >
          {es ? "Intentar de nuevo" : "Try again"}
        </button>
        <Link href="/dashboard" className="mt-4 block text-[15px] font-medium text-blue-700">
          {es ? "Volver al inicio" : "Back to home"}
        </Link>
        {error.digest && <p className="mt-5 text-xs text-slate-400">Ref. {error.digest}</p>}
      </section>
    </main>
  );
}
