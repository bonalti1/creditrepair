"use client";

import { useState } from "react";
import Link from "next/link";

// Onboarding (spec §4.4 day 0 + §5): goal selector. Mortgage-intent users get
// the progress track that later feeds the ABA handoff (Phase 6, post attorney
// sign-off). TODO(Phase 1): persist to profiles.goal via Supabase Auth session.

const GOALS = [
  { key: "mortgage", label: "🏡 Comprar una casa (hipoteca)" },
  { key: "auto", label: "🚗 Comprar un auto" },
  { key: "card", label: "💳 Calificar para mejores tarjetas" },
  { key: "general", label: "📈 Mejorar mi crédito en general" },
] as const;

export default function Onboarding() {
  const [goal, setGoal] = useState<string | null>(null);

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-3xl font-bold">¿Para qué estás reparando tu crédito?</h1>
      <p className="mt-2 text-slate-600">
        Tu meta define tu barra de progreso. Puedes cambiarla cuando quieras.
      </p>
      <div className="mt-8 space-y-3">
        {GOALS.map((g) => (
          <button
            key={g.key}
            onClick={() => setGoal(g.key)}
            className={`w-full rounded-lg border px-5 py-4 text-left text-lg transition ${
              goal === g.key
                ? "border-blue-700 bg-blue-50 font-semibold"
                : "border-slate-300 bg-white hover:bg-slate-50"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>
      <div className="mt-8 rounded-lg bg-slate-100 p-4 text-sm text-slate-600">
        Siguiente paso: conecta tu suscripción de monitoreo de crédito para importar tu reporte de
        los 3 burós. La suscripción es requerida para usar la herramienta.
      </div>
      <Link
        href={goal ? "/dashboard" : "#"}
        aria-disabled={!goal}
        className={`mt-6 inline-block rounded-lg px-6 py-3 font-semibold text-white ${
          goal ? "bg-blue-700 hover:bg-blue-800" : "pointer-events-none bg-slate-300"
        }`}
      >
        Continuar
      </Link>
    </main>
  );
}
