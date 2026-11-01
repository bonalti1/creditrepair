"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Onboarding: goal selector (spec §5 — feeds the mortgage track) → Texas gate
// (v1 is TX-only; other states join the waitlist, since expansion is a legal
// project, not a config change) → Plan Asistido choice (free live help over
// WhatsApp; the user always decides and sends — assistance never disputes for
// them). TODO(Phase 1): persist goal/assisted to profiles on auth.

const GOALS = [
  { key: "mortgage", label: "🏡 Comprar una casa (hipoteca)" },
  { key: "auto", label: "🚗 Comprar un auto" },
  { key: "card", label: "💳 Calificar para mejores tarjetas" },
  { key: "general", label: "📈 Mejorar mi crédito en general" },
] as const;

const STATES = [
  "TX", "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM",
  "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY",
];

function save(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState<"goal" | "state" | "assist" | "waitlist-done">("goal");
  const [goal, setGoal] = useState<string | null>(null);
  const [state, setState] = useState("TX");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const whatsappNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;

  const joinWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await fetch("/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, state, locale: "es" }),
    }).catch(() => undefined);
    setBusy(false);
    setStep("waitlist-done");
  };

  const finish = (assisted: boolean) => {
    save("bonalti.assisted", assisted ? "1" : "0");
    if (assisted && whatsappNumber) {
      window.open(
        `https://wa.me/${whatsappNumber}?text=${encodeURIComponent("¡Hola! Quiero ayuda en vivo para revisar mi crédito con Bonalti.")}`,
        "_blank",
      );
    }
    router.push("/dashboard");
  };

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      {step === "goal" && (
        <>
          <h1 className="text-3xl font-bold">¿Para qué estás reparando tu crédito?</h1>
          <p className="mt-2 text-slate-600">Tu meta define tu barra de progreso. Puedes cambiarla cuando quieras.</p>
          <div className="mt-8 space-y-3">
            {GOALS.map((g) => (
              <button
                key={g.key}
                onClick={() => setGoal(g.key)}
                className={`w-full rounded-lg border px-5 py-4 text-left text-lg transition ${
                  goal === g.key ? "border-blue-700 bg-blue-50 font-semibold" : "border-slate-300 bg-white hover:bg-slate-50"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              if (goal) {
                save("bonalti.goal", goal);
                setStep("state");
              }
            }}
            disabled={!goal}
            className="mt-6 rounded-lg bg-blue-700 px-6 py-3 font-semibold text-white disabled:bg-slate-300"
          >
            Continuar
          </button>
        </>
      )}

      {step === "state" && (
        <>
          <h1 className="text-3xl font-bold">¿En qué estado vives?</h1>
          <p className="mt-2 text-slate-600">Por ahora Bonalti está disponible solo en Texas. Pronto en más estados.</p>
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="mt-6 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-lg outline-none focus:border-blue-500"
          >
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s === "TX" ? "Texas (TX)" : s}
              </option>
            ))}
          </select>

          {state === "TX" ? (
            <button
              onClick={() => setStep("assist")}
              className="mt-6 rounded-lg bg-blue-700 px-6 py-3 font-semibold text-white"
            >
              Continuar
            </button>
          ) : (
            <form onSubmit={joinWaitlist} className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
              <p className="text-sm font-semibold text-amber-900">
                Todavía no llegamos a tu estado — pero estamos en camino.
              </p>
              <p className="mt-1 text-sm text-amber-800">Déjanos tu correo y te avisamos en cuanto abramos ahí.</p>
              <div className="mt-3 flex gap-2">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@correo.com"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-blue-700 px-5 py-2.5 font-semibold text-white disabled:bg-slate-300"
                >
                  Avisarme
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {step === "assist" && (
        <>
          <h1 className="text-3xl font-bold">¿Cómo quieres hacerlo?</h1>
          <p className="mt-2 text-slate-600">
            De cualquier forma, <strong>tú decides y tú envías</strong> — así funciona Bonalti.
          </p>
          <div className="mt-8 space-y-3">
            <button
              onClick={() => finish(false)}
              className="w-full rounded-xl border-2 border-slate-300 bg-white px-5 py-5 text-left hover:border-blue-400"
            >
              <p className="text-lg font-semibold">🚀 Yo solo(a), con la guía de la app</p>
              <p className="mt-1 text-sm text-slate-600">
                La app te explica cada elemento en palabras simples, paso a paso.
              </p>
            </button>
            <button
              onClick={() => finish(true)}
              className="w-full rounded-xl border-2 border-green-300 bg-green-50 px-5 py-5 text-left hover:border-green-500"
            >
              <p className="text-lg font-semibold">🤝 Plan Asistido — con ayuda en vivo (gratis)</p>
              <p className="mt-1 text-sm text-slate-600">
                Una persona de nuestro equipo te acompaña por WhatsApp mientras TÚ revisas y apruebas.
                Sin costo extra.
              </p>
            </button>
          </div>
          <p className="mt-6 text-xs text-slate-500">
            La asistencia es educativa: te explicamos y acompañamos, pero cada decisión, atestiguación y
            envío es tuyo. Los resultados varían según cada caso.
          </p>
        </>
      )}

      {step === "waitlist-done" && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
          <p className="text-3xl">📬</p>
          <h1 className="mt-2 text-2xl font-bold text-green-900">¡Listo! Te avisamos pronto.</h1>
          <p className="mt-2 text-sm text-green-800">
            En cuanto Bonalti abra en tu estado, serás de los primeros en saberlo.
          </p>
          <Link href="/" className="mt-4 inline-block text-sm font-semibold text-blue-700">
            ← Volver al inicio
          </Link>
        </div>
      )}
    </main>
  );
}
