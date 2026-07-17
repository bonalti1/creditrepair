"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DEMO_REPORT } from "@/lib/demo";
import { buildAttackPlan } from "@/lib/domain/attack";
import { renderLetter } from "@/lib/letters/templates";
import type { ItemFlag, PlannedLetter } from "@/lib/domain/types";
import { STAGE_EXPLAINERS } from "@/lib/ux/explainers";
import { countByState, useFlags } from "@/lib/ux/flagsStore";

// Attack builder — no black box. Every letter is readable in full BEFORE
// approval, with an "en palabras simples" summary of what it does and which
// law it invokes. The attack reflects the user's real attested review from the
// wizard (shared flags store). Approval is explicit and celebratory.

const DEMO_USER = {
  id: "demo",
  fullName: "Tu Nombre",
  addressLines: ["Tu dirección", "Houston, TX 77002"],
  locale: "es" as const,
};

export default function Attack() {
  const { flags, roundApproved, setRoundApproved, hydrated } = useFlags();
  const [openLetter, setOpenLetter] = useState<number | null>(null);

  const counts = countByState(flags);

  const attestedFlags: ItemFlag[] = useMemo(
    () =>
      Object.entries(flags)
        .filter(([, f]) => f.state === "attested" && f.attestedAt)
        .map(([fingerprint, f]) => ({
          fingerprint,
          reason: f.reason ?? "",
          attested: true,
          attestedAt: f.attestedAt!,
        })),
    [flags],
  );

  const hasPersonalInfo = useMemo(
    () =>
      DEMO_REPORT.items.some(
        (i) =>
          i.category === "personal_info" &&
          attestedFlags.some((f) => f.fingerprint === i.fingerprint),
      ),
    [attestedFlags],
  );

  // Round 1 handles personal-info cleanup; if the user attested no personal-info
  // items, jump straight to the round-2 dispute plan so the attack isn't empty.
  const roundNumber = hasPersonalInfo ? 1 : 2;
  const plan = useMemo(
    () =>
      buildAttackPlan({
        roundNumber,
        items: DEMO_REPORT.items,
        flags: attestedFlags,
        history: {},
      }),
    [roundNumber, attestedFlags],
  );

  if (!hydrated) return null;

  if (attestedFlags.length === 0) {
    return (
      <main>
        <h1 className="text-2xl font-bold">Tu ataque</h1>
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-3xl">🔍</p>
          <h2 className="mt-2 text-lg font-bold">Aún no hay elementos en tu ataque</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
            Tu ataque se arma con los elementos que TÚ marcas y atestiguas en la revisión guiada.
            {counts.flagged > 0 &&
              ` Tienes ${counts.flagged} elemento(s) marcados a los que les falta la atestiguación.`}
          </p>
          <Link
            href="/items"
            className="mt-4 inline-block rounded-lg bg-blue-700 px-6 py-3 font-semibold text-white hover:bg-blue-800"
          >
            Ir a la revisión guiada →
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main>
      <h1 className="text-2xl font-bold">Tu ataque #{roundNumber}</h1>
      <p className="mt-1 text-slate-600">
        {plan.letters.length} carta(s) generadas con tus {attestedFlags.length} elemento(s)
        atestiguados. Lee cada una — nada se envía hasta que tú apruebes.
      </p>

      <div className="mt-6 space-y-3">
        {plan.letters.map((letter, idx) => (
          <LetterCard
            key={idx}
            letter={letter}
            open={openLetter === idx}
            onToggle={() => setOpenLetter(openLetter === idx ? null : idx)}
            roundNumber={roundNumber}
          />
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-blue-200 bg-blue-50 p-6">
        {roundApproved ? (
          <div className="text-center">
            <p className="text-3xl">🎉📬</p>
            <p className="mt-2 font-bold text-green-800">¡Tu ataque va en camino!</p>
            <p className="mt-1 text-sm text-green-700">
              (Demo) En producción: tus cartas se imprimen y envían por correo certificado, y te
              avisamos por WhatsApp. Los burós tienen ~30 días para responder.
            </p>
            <div className="mt-4 flex justify-center gap-3">
              <Link
                href="/rounds"
                className="rounded-lg bg-blue-700 px-5 py-2.5 font-semibold text-white hover:bg-blue-800"
              >
                Seguir mi ronda →
              </Link>
              <button
                onClick={() => setRoundApproved(false)}
                className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm text-slate-600 hover:bg-white"
              >
                Reiniciar demo
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-blue-900">
              Al presionar el botón confirmas que <strong>leíste tus cartas</strong> y que{" "}
              <strong>tú decides enviarlas</strong>. Cada elemento incluido lleva tu atestiguación
              registrada con fecha y hora.
            </p>
            <button
              onClick={() => setRoundApproved(true)}
              className="mt-4 w-full rounded-xl bg-blue-700 px-6 py-4 text-lg font-bold text-white hover:bg-blue-800 sm:w-auto"
            >
              Aprobar y enviar mi ataque ({plan.letters.length} cartas) 🚀
            </button>
          </>
        )}
      </div>
    </main>
  );
}

function LetterCard({
  letter,
  open,
  onToggle,
  roundNumber,
}: {
  letter: PlannedLetter;
  open: boolean;
  onToggle: () => void;
  roundNumber: number;
}) {
  const explainer =
    STAGE_EXPLAINERS[letter.templateKey] ?? STAGE_EXPLAINERS[letter.stage] ?? null;

  const body = useMemo(() => {
    const items = DEMO_REPORT.items.filter((i) => letter.itemFingerprints.includes(i.fingerprint));
    return renderLetter(letter.templateKey, {
      user: DEMO_USER,
      target: letter.target,
      items,
      date: new Date().toISOString(),
      roundNumber,
    });
  }, [letter, roundNumber]);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button onClick={onToggle} className="w-full p-4 text-left hover:bg-slate-50">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold">{letter.target.name}</p>
            <p className="mt-0.5 text-sm text-slate-500">
              {explainer?.name ?? letter.stage} ·{" "}
              {letter.itemFingerprints.length > 0
                ? `${letter.itemFingerprints.length} elemento(s)`
                : "solicitud de expediente"}
            </p>
          </div>
          <span className="text-slate-400">{open ? "▲" : "▼ Leer carta"}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 p-4">
          {explainer && (
            <div className="mb-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
              <p className="font-semibold">En palabras simples:</p>
              <p className="mt-1">{explainer.plain}</p>
            </div>
          )}
          <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 font-serif text-sm text-slate-800">
            {body}
          </pre>
          <p className="mt-2 text-xs text-slate-500">
            La carta se envía en inglés (idioma operativo de los burós). Al enviarse, la redacción
            varía ligeramente para que tu carta sea única.
          </p>
        </div>
      )}
    </div>
  );
}
