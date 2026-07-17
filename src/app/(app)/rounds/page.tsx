"use client";

import { RESPONSE_WINDOW_DAYS, NEXT_ROUND_DAYS } from "@/lib/ux/journey";

// Round history with a real timeline: when letters mailed, when the FCRA
// ~30-day response window closes, when the next round unlocks (~day 40).
// The waiting period is where Dispute Beast users feel abandoned — here the
// clock is always visible and explained.

const DEMO_ROUNDS = [
  {
    round: 1,
    mailedAt: "2026-06-05",
    letters: [
      { target: "Equifax", stage: "Limpieza de datos personales" },
      { target: "Experian", stage: "Limpieza de datos personales" },
      { target: "TransUnion", stage: "Limpieza de datos personales" },
    ],
    outcome: "✅ 2 datos personales corregidos",
  },
  {
    round: 2,
    mailedAt: "2026-07-15",
    letters: [
      { target: "Equifax", stage: "Disputa FCRA §611 — cuentas" },
      { target: "Experian", stage: "Disputa FCRA §611 — cuentas" },
      { target: "TransUnion", stage: "Disputa FCRA §611 — consultas" },
      { target: "LexisNexis", stage: "Solicitud de expediente §609" },
      { target: "Innovis", stage: "Solicitud de expediente §609" },
    ],
    outcome: null,
  },
];

function addDays(iso: string, days: number): Date {
  return new Date(new Date(iso).getTime() + days * 24 * 60 * 60 * 1000);
}

const fmt = (d: Date) => d.toLocaleDateString("es-MX", { day: "numeric", month: "long" });

export default function Rounds() {
  const now = new Date();

  return (
    <main>
      <h1 className="text-2xl font-bold">Tus rondas</h1>
      <p className="mt-1 text-slate-600">
        Cada ronda: tú envías → los burós responden (~{RESPONSE_WINDOW_DAYS} días) → tu reporte se
        actualiza y comparamos (~día {NEXT_ROUND_DAYS}) → armas la siguiente.
      </p>

      <div className="mt-6 space-y-4">
        {[...DEMO_ROUNDS].reverse().map((r) => {
          const responseDue = addDays(r.mailedAt, RESPONSE_WINDOW_DAYS);
          const nextRoundAt = addDays(r.mailedAt, NEXT_ROUND_DAYS);
          const daysToResponse = Math.ceil((responseDue.getTime() - now.getTime()) / 86400000);
          const inProgress = !r.outcome;
          const clockPct = Math.min(
            100,
            Math.round(
              ((now.getTime() - new Date(r.mailedAt).getTime()) /
                (nextRoundAt.getTime() - new Date(r.mailedAt).getTime())) *
                100,
            ),
          );

          return (
            <div key={r.round} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <p className="font-bold">Ataque #{r.round}</p>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    inProgress ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-700"
                  }`}
                >
                  {inProgress ? "En curso" : "Completada"}
                </span>
              </div>

              {inProgress && (
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>📬 Enviado {fmt(new Date(r.mailedAt))}</span>
                    <span>⏳ Respuesta ~{fmt(responseDue)}</span>
                    <span>🔁 Ronda {r.round + 1} ~{fmt(nextRoundAt)}</span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-slate-200">
                    <div
                      className="h-2 rounded-full bg-amber-500 transition-all"
                      style={{ width: `${Math.max(4, clockPct)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-sm text-amber-800">
                    {daysToResponse > 0
                      ? `Los burós tienen ~${daysToResponse} día(s) más para responder. No necesitas hacer nada — te avisamos por WhatsApp.`
                      : "La ventana de respuesta cerró. Tu reporte se re-importa pronto para comparar qué cambió."}
                  </p>
                </div>
              )}

              {r.outcome && <p className="mt-2 text-sm text-green-700">{r.outcome}</p>}

              <ul className="mt-3 space-y-1 text-sm text-slate-700">
                {r.letters.map((l, i) => (
                  <li key={i}>
                    📄 {l.target} — {l.stage}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </main>
  );
}
