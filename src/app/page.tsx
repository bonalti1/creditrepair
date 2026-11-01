import Link from "next/link";

// Landing. Copy discipline (spec §1 + §3): DIY positioning only — "tu ataque",
// "tú envías", "tus disputas". No guarantees, no "X puntos en Y días",
// no "nosotros eliminamos". Results-vary language everywhere.

export default function Landing() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Bonalti Crédito</p>
      <h1 className="mt-2 text-4xl font-bold leading-tight">
        Tú disputas. Nosotros te damos la herramienta.
      </h1>
      <p className="mt-4 text-lg text-slate-600">
        Software gratuito para armar <strong>tus disputas</strong> de crédito, paso a paso y en
        español. Tú revisas cada elemento, tú apruebas cada carta y <strong>tú envías tu ataque</strong>.
        Requiere una suscripción activa de monitoreo de crédito.
      </p>
      <ul className="mt-8 space-y-3 text-slate-700">
        <li>📄 Importa tu reporte de los 3 burós (Equifax, Experian, TransUnion)</li>
        <li>🔍 Encuentra elementos que crees inexactos, no verificables o desactualizados</li>
        <li>✍️ Genera tus cartas de disputa (FCRA §611) — tú las apruebas antes de enviar</li>
        <li>🔁 Rondas de ataque cada ~40 días, con seguimiento por WhatsApp</li>
      </ul>
      <div className="mt-10 flex gap-4">
        <Link
          href="/onboarding"
          className="rounded-lg bg-blue-700 px-6 py-3 font-semibold text-white hover:bg-blue-800"
        >
          Empezar — es gratis
        </Link>
        <Link
          href="/dashboard"
          className="rounded-lg border border-slate-300 px-6 py-3 font-semibold text-slate-700 hover:bg-slate-100"
        >
          Ver demo
        </Link>
      </div>
      <p className="mt-10 text-sm text-slate-500">
        Bonalti Crédito es una herramienta de software DIY (hazlo tú mismo). No disputamos por ti, no
        garantizamos resultados y los resultados varían según cada caso. Esto no es asesoría legal.
      </p>
    </main>
  );
}
