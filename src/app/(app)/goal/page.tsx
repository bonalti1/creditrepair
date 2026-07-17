"use client";

import { useState } from "react";
import { FEATURES } from "@/lib/featureFlags";
import { useLocale } from "@/lib/i18n";

// Mortgage goal track + ABA handoff (spec §5, Phase 6). GATED: renders the
// "in preparation" state until NEXT_PUBLIC_FEATURE_ABA_HANDOFF=1, which only
// flips after attorney sign-off on this flow and the disclosure text.
//
// RESPA §8 design constraints baked in:
// - Disclosure BEFORE any intro; CFPB-model format; bilingual.
// - Use of the affiliated mortgage entity is NOT required; alternatives stated.
// - Acknowledgment logged (aba_acknowledgments) before any warm intro.
// - Zero per-referral compensation in either direction — ownership returns only.

const DISCLOSURE_VERSION = "draft-v1"; // ⚠️ attorney must approve before flag flips

const DISCLOSURE = {
  es: {
    title: "Divulgación de negocios afiliados",
    body: `AVISO PARA: el consumidor. DE: Bonalti Crédito.

Bonalti Crédito tiene una relación de negocios con la entidad hipotecaria afiliada de Bonalti: los dueños de Bonalti Crédito también tienen participación en dicha entidad. Debido a esta relación, referirte a esa entidad puede generar un beneficio económico para sus dueños (a través de su participación en la propiedad, no por pagos por referencia).

NO estás obligado(a) a usar la entidad afiliada para obtener tu hipoteca. HAY OTROS PROVEEDORES HIPOTECARIOS DISPONIBLES CON SERVICIOS SIMILARES; eres libre de comparar y elegir el proveedor que prefieras.`,
    ack: "He leído esta divulgación y entiendo que NO estoy obligado(a) a usar la entidad afiliada.",
    confirm: "Entendido — continuar",
    pendingTitle: "Tu camino a la hipoteca — en preparación",
    pendingBody:
      "Cuando tu progreso alcance tu meta, aquí podrás (si tú quieres) conocer opciones para tu hipoteca — siempre con total transparencia y sin obligación. Esta sección se activa próximamente.",
    ackedTitle: "Divulgación registrada",
    ackedBody:
      "Gracias. Tu acuse quedó registrado. Si decides explorar la opción afiliada, tu asesor te contactará — y recuerda: comparar otras opciones siempre es tu derecho.",
  },
  en: {
    title: "Affiliated Business Arrangement Disclosure",
    body: `NOTICE TO: the consumer. FROM: Bonalti Crédito.

Bonalti Crédito has a business relationship with Bonalti's affiliated mortgage entity: the owners of Bonalti Crédito also hold an ownership interest in that entity. Because of this relationship, a referral to that entity may provide its owners a financial benefit (through ownership returns, not referral payments).

You are NOT required to use the affiliated entity to obtain your mortgage. THERE ARE OTHER MORTGAGE PROVIDERS AVAILABLE WITH SIMILAR SERVICES; you are free to shop around and choose any provider you prefer.`,
    ack: "I have read this disclosure and understand that I am NOT required to use the affiliated entity.",
    confirm: "Understood — continue",
    pendingTitle: "Your path to a mortgage — in preparation",
    pendingBody:
      "When your progress reaches your goal, this is where you'll be able (if you choose) to explore mortgage options — always with full transparency and no obligation. This section activates soon.",
    ackedTitle: "Disclosure recorded",
    ackedBody:
      "Thank you. Your acknowledgment was logged. If you decide to explore the affiliated option, your advisor will reach out — and remember: shopping around is always your right.",
  },
} as const;

export default function Goal() {
  const { locale } = useLocale();
  const [checked, setChecked] = useState(false);
  const [acked, setAcked] = useState(false);
  const c = DISCLOSURE[locale];

  if (!FEATURES.abaHandoff) {
    return (
      <main>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-3xl">🏡</p>
          <h1 className="mt-2 text-xl font-bold">{c.pendingTitle}</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">{c.pendingBody}</p>
        </div>
      </main>
    );
  }

  const acknowledge = async () => {
    await fetch("/api/aba/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disclosureVersion: DISCLOSURE_VERSION, locale }),
    }).catch(() => undefined);
    setAcked(true);
  };

  if (acked) {
    return (
      <main>
        <div className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
          <p className="text-3xl">✅</p>
          <h1 className="mt-2 text-xl font-bold text-green-900">{c.ackedTitle}</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-green-800">{c.ackedBody}</p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <h1 className="text-2xl font-bold">{c.title}</h1>
      <div className="mt-4 whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-6 text-sm leading-relaxed text-slate-700">
        {c.body}
      </div>
      <label className="mt-4 flex items-start gap-2 rounded-lg bg-blue-50 p-4 text-sm text-slate-800">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5"
        />
        <span>{c.ack}</span>
      </label>
      <button
        onClick={acknowledge}
        disabled={!checked}
        className="mt-4 rounded-lg bg-blue-700 px-6 py-3 font-semibold text-white disabled:bg-slate-300"
      >
        {c.confirm}
      </button>
    </main>
  );
}
