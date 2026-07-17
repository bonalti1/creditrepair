// Round history + letter archive (spec §4.3). Demo data until Phase 3 wires
// attack_rounds/letters tables.

const DEMO_ROUNDS = [
  {
    round: 1,
    status: "Enviada",
    mailedAt: "2026-06-05",
    letters: [
      { target: "Equifax", stage: "Limpieza de datos personales" },
      { target: "Experian", stage: "Limpieza de datos personales" },
      { target: "TransUnion", stage: "Limpieza de datos personales" },
    ],
    result: "2 datos personales corregidos",
  },
  {
    round: 2,
    status: "En curso",
    mailedAt: "2026-07-15",
    letters: [
      { target: "Equifax", stage: "Disputa FCRA §611 — cuentas" },
      { target: "Experian", stage: "Disputa FCRA §611 — cuentas" },
      { target: "TransUnion", stage: "Disputa FCRA §611 — consultas" },
      { target: "LexisNexis", stage: "Solicitud de expediente §609" },
      { target: "Innovis", stage: "Solicitud de expediente §609" },
    ],
    result: "Esperando respuesta (~30 días)",
  },
];

export default function Rounds() {
  return (
    <main>
      <h1 className="text-2xl font-bold">Tus rondas</h1>
      <p className="mt-1 text-slate-600">
        Historial de tus ataques y cartas. La siguiente ronda se habilita ~40 días después de cada
        envío, cuando tu reporte se actualiza.
      </p>

      <div className="mt-6 space-y-4">
        {DEMO_ROUNDS.map((r) => (
          <div key={r.round} className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <p className="font-semibold">Ataque #{r.round}</p>
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${
                  r.status === "Enviada" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                }`}
              >
                {r.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">Enviada: {r.mailedAt} · {r.result}</p>
            <ul className="mt-3 space-y-1 text-sm text-slate-700">
              {r.letters.map((l, i) => (
                <li key={i}>
                  📬 {l.target} — {l.stage}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </main>
  );
}
