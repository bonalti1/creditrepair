"use client";

import { useMemo, useState } from "react";
import { DEMO_REPORT } from "@/lib/demo";
import { buildAttackPlan } from "@/lib/domain/attack";
import type { ItemFlag } from "@/lib/domain/types";

// Attack builder (spec §4.2/§4.3). The user reviews every letter the plan will
// generate and presses the button — the DIY moment. In the demo, all negative
// items are treated as flagged+attested so the plan preview renders; in
// production the plan comes from /api/attacks/build and approval posts to
// /api/attacks/approve, which re-verifies every attestation server-side.

const STAGE_LABEL: Record<string, string> = {
  personal_info_cleanup: "Limpieza de datos personales",
  dispute: "Disputa FCRA §611",
  mov: "Método de verificación §611(a)(6)(B)(iii)",
  furnisher_direct: "Directo al informante §623",
};

export default function Attack() {
  const [roundNumber, setRoundNumber] = useState(1);
  const [approved, setApproved] = useState(false);

  const demoFlags: ItemFlag[] = useMemo(
    () =>
      DEMO_REPORT.items
        .filter((i) => i.negative || i.category === "personal_info")
        .map((i) => ({
          fingerprint: i.fingerprint,
          reason: "demo",
          attested: true,
          attestedAt: new Date().toISOString(),
        })),
    [],
  );

  const plan = useMemo(
    () => buildAttackPlan({ roundNumber, items: DEMO_REPORT.items, flags: demoFlags, history: {} }),
    [roundNumber, demoFlags],
  );

  return (
    <main>
      <h1 className="text-2xl font-bold">Tu ataque #{roundNumber}</h1>
      <p className="mt-1 text-slate-600">
        Revisa las cartas que se generarán. Nada se envía hasta que <strong>tú</strong> apruebes.
      </p>

      <div className="mt-4 flex gap-2">
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            onClick={() => {
              setRoundNumber(n);
              setApproved(false);
            }}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              roundNumber === n ? "bg-blue-700 text-white" : "bg-white text-slate-600 border border-slate-300"
            }`}
          >
            Ronda {n}
          </button>
        ))}
        <span className="ml-2 self-center text-xs text-slate-500">(vista previa de escalación)</span>
      </div>

      <div className="mt-6 space-y-3">
        {plan.letters.length === 0 && (
          <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-600">
            No hay elementos atestiguados para esta ronda. Ve a <strong>Elementos</strong> y marca
            los que creas inexactos.
          </p>
        )}
        {plan.letters.map((letter, idx) => (
          <div key={idx} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold">{letter.target.name}</p>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {STAGE_LABEL[letter.stage] ?? letter.stage}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {letter.itemFingerprints.length > 0
                ? `${letter.itemFingerprints.length} elemento(s) incluidos`
                : "Solicitud de expediente (buró secundario)"}
              {" · "}plantilla: {letter.templateKey}
            </p>
          </div>
        ))}
      </div>

      {plan.letters.length > 0 && (
        <div className="mt-8 rounded-lg border border-blue-200 bg-blue-50 p-5">
          {approved ? (
            <p className="font-semibold text-green-700">
              ✅ Ataque aprobado (demo). En producción: tus cartas se imprimen y envían por correo, y
              recibirás confirmación por WhatsApp.
            </p>
          ) : (
            <>
              <p className="text-sm text-blue-900">
                Al presionar el botón confirmas que revisaste tus cartas y que <strong>tú</strong>{" "}
                decides enviarlas. Cada elemento incluido lleva tu atestiguación de que lo crees
                inexacto, no verificable o desactualizado.
              </p>
              <button
                onClick={() => setApproved(true)}
                className="mt-3 rounded-lg bg-blue-700 px-6 py-3 font-semibold text-white hover:bg-blue-800"
              >
                Aprobar y enviar mi ataque ({plan.letters.length} cartas)
              </button>
            </>
          )}
        </div>
      )}
    </main>
  );
}
