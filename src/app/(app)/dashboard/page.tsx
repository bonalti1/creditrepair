import { DEMO_REPORT } from "@/lib/demo";

const BUREAU_LABEL: Record<string, string> = {
  equifax: "Equifax",
  experian: "Experian",
  transunion: "TransUnion",
};

// Report view (spec §4.3). Demo-backed until Phase 1 wires the monitoring
// partner import + Supabase Auth.

export default function Dashboard() {
  const items = DEMO_REPORT.items;
  const negatives = items.filter((i) => i.negative);

  return (
    <main>
      <h1 className="text-2xl font-bold">Mi reporte</h1>
      <p className="mt-1 text-slate-600">
        Importado el {new Date(DEMO_REPORT.pulledAt).toLocaleDateString("es-MX")} · {items.length}{" "}
        elementos en 3 burós
      </p>

      <div className="mt-6 grid grid-cols-3 gap-4">
        {Object.entries(BUREAU_LABEL).map(([key, label]) => {
          const count = items.filter((i) => i.bureau === key).length;
          const neg = negatives.filter((i) => i.bureau === key).length;
          return (
            <div key={key} className="rounded-lg border border-slate-200 bg-white p-5">
              <p className="font-semibold">{label}</p>
              <p className="mt-1 text-sm text-slate-600">{count} elementos</p>
              <p className={`text-sm ${neg > 0 ? "text-red-600" : "text-green-600"}`}>
                {neg} posiblemente negativos
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-8 rounded-lg border border-blue-200 bg-blue-50 p-5">
        <p className="font-semibold text-blue-900">Tu progreso</p>
        <p className="mt-1 text-sm text-blue-800">
          Meta: lista para hipoteca 🏡 — {negatives.length} elementos por revisar. Marca los que
          creas inexactos en la pestaña <strong>Elementos</strong> y arma tu primer ataque. Los
          resultados varían según cada caso.
        </p>
      </div>
    </main>
  );
}
