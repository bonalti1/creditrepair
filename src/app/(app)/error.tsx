"use client";

import { useEffect } from "react";
import Link from "next/link";

// Shown when a screen inside the app fails to render. The client's data is on
// the server; nothing they did is lost. Spanish first, English underneath,
// because this boundary sits above the language setting.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="animate-rise">
      <section className="card px-6 py-8 text-center">
        <h1 className="text-[22px] font-semibold leading-snug text-slate-900">Algo no cargó bien</h1>
        <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-slate-500">
          No perdiste nada: tu revisión y tus cartas siguen guardadas. Intenta de nuevo.
        </p>
        <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-slate-500">
          Something didn&apos;t load. Nothing was lost; please try again.
        </p>
        <button
          type="button"
          onClick={reset}
          className="pressable mt-6 flex h-14 w-full items-center justify-center rounded-full bg-amber-400 text-[17px] font-semibold text-blue-900 hover:bg-amber-500"
        >
          Intentar de nuevo
        </button>
        <Link href="/dashboard" className="mt-4 block text-[15px] font-medium text-blue-700">
          Volver al inicio
        </Link>
        {error.digest && <p className="mt-5 text-xs text-slate-400">Ref. {error.digest}</p>}
      </section>
    </main>
  );
}
