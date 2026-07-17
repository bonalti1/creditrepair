"use client";

import { useMemo, useState } from "react";
import { DEMO_REPORT } from "@/lib/demo";
import { ATTESTATION_TEXT } from "@/lib/compliance/attestation";

// Negative-item finder + flagging + attestation (spec §4.3, Armor #2).
// The attestation checkbox is per item, uses the exact ATTESTATION_TEXT, and an
// item cannot enter the attack builder without it. The server enforces the same
// invariant at approval time. TODO(Phase 2): persist flags via item_flags table.

const BUREAU_LABEL: Record<string, string> = {
  equifax: "Equifax",
  experian: "Experian",
  transunion: "TransUnion",
};

const CATEGORY_LABEL: Record<string, string> = {
  tradeline: "Cuenta",
  inquiry: "Consulta",
  public_record: "Registro público",
  personal_info: "Dato personal",
};

interface LocalFlag {
  flagged: boolean;
  attested: boolean;
  attestedAt: string | null;
}

export default function Items() {
  const items = DEMO_REPORT.items;
  const [flags, setFlags] = useState<Record<string, LocalFlag>>({});

  const attestedCount = useMemo(
    () => Object.values(flags).filter((f) => f.flagged && f.attested).length,
    [flags],
  );

  const toggleFlag = (fp: string) =>
    setFlags((prev) => {
      const cur = prev[fp];
      return {
        ...prev,
        [fp]: cur?.flagged
          ? { flagged: false, attested: false, attestedAt: null }
          : { flagged: true, attested: false, attestedAt: null },
      };
    });

  const toggleAttest = (fp: string) =>
    setFlags((prev) => {
      const cur = prev[fp];
      if (!cur?.flagged) return prev;
      return {
        ...prev,
        [fp]: cur.attested
          ? { ...cur, attested: false, attestedAt: null }
          : { ...cur, attested: true, attestedAt: new Date().toISOString() },
      };
    });

  return (
    <main>
      <h1 className="text-2xl font-bold">Elementos de tu reporte</h1>
      <p className="mt-1 text-slate-600">
        Marca los elementos que crees que son inexactos, no verificables o desactualizados.{" "}
        <strong>Solo tú decides qué disputar.</strong> No marques información que sabes que es
        correcta y actual.
      </p>

      <div className="mt-6 space-y-3">
        {items.map((item) => {
          const f = flags[item.fingerprint];
          return (
            <div
              key={item.fingerprint}
              className={`rounded-lg border bg-white p-4 ${
                f?.flagged ? "border-blue-400" : "border-slate-200"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold">{item.name}</p>
                  <p className="text-sm text-slate-500">
                    {BUREAU_LABEL[item.bureau]} · {CATEGORY_LABEL[item.category]}
                    {item.negative && (
                      <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                        posiblemente negativo
                      </span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => toggleFlag(item.fingerprint)}
                  className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold ${
                    f?.flagged
                      ? "bg-slate-200 text-slate-700"
                      : "bg-blue-700 text-white hover:bg-blue-800"
                  }`}
                >
                  {f?.flagged ? "Quitar" : "Marcar para disputar"}
                </button>
              </div>

              {f?.flagged && (
                <label className="mt-3 flex items-start gap-2 rounded-md bg-blue-50 p-3 text-sm text-slate-800">
                  <input
                    type="checkbox"
                    checked={f.attested}
                    onChange={() => toggleAttest(item.fingerprint)}
                    className="mt-0.5"
                  />
                  <span>
                    {ATTESTATION_TEXT.es}
                    {f.attested && f.attestedAt && (
                      <span className="mt-1 block text-xs text-slate-500">
                        Registrado: {new Date(f.attestedAt).toLocaleString("es-MX")}
                      </span>
                    )}
                  </span>
                </label>
              )}
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-4 mt-8 rounded-lg border border-slate-200 bg-white p-4 shadow">
        <p className="text-sm">
          <strong>{attestedCount}</strong> elemento(s) marcados y atestiguados — listos para tu
          ataque. Los elementos sin atestiguación no se incluyen en ninguna carta.
        </p>
      </div>
    </main>
  );
}
