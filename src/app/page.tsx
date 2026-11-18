import Link from "next/link";

// Landing. Quiet, confident, mostly whitespace — the product speaks. Copy
// discipline (spec §1 + §3): DIY positioning only, no guarantees, results vary.

export default function Landing() {
  return (
    <main className="min-h-dvh bg-white">
      <header className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <span className="text-[15px] font-semibold tracking-tight text-slate-900">Bonalti</span>
        <Link href="/login" className="text-[15px] font-medium text-blue-700">
          Entrar
        </Link>
      </header>

      <section className="mx-auto max-w-3xl px-6 pb-20 pt-16 text-center sm:pt-24">
        <p className="text-[15px] font-semibold text-blue-700">Bonalti Crédito</p>
        <h1 className="mt-3 text-[44px] font-bold leading-[1.05] text-slate-900 sm:text-[64px]">
          Tu crédito, en tus manos.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-[19px] leading-relaxed text-slate-500 sm:text-[21px]">
          Un asistente con inteligencia artificial que lee tu reporte, te lo explica en español y
          prepara tus cartas de disputa. Tú decides y tú apruebas.
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/onboarding"
            className="pressable flex h-14 w-full items-center justify-center rounded-full bg-blue-700 px-9 text-[17px] font-semibold text-white hover:bg-blue-800 sm:w-auto"
          >
            Empezar gratis
          </Link>
          <Link
            href="/dashboard"
            className="pressable flex h-14 w-full items-center justify-center rounded-full bg-slate-100 px-9 text-[17px] font-semibold text-slate-900 sm:w-auto"
          >
            Ver la demo
          </Link>
        </div>
      </section>

      <section className="bg-slate-50 py-16">
        <div className="mx-auto grid max-w-5xl gap-4 px-6 sm:grid-cols-3">
          {[
            ["Todo en español", "La app, las explicaciones y la ayuda de nuestro equipo. Puedes escucharlas en vez de leerlas."],
            ["Tú tienes el control", "El asistente prepara todo. Nada se envía hasta que tú lo lees y lo apruebas."],
            ["Un solo costo", "El software es gratis. Solo necesitas tu suscripción de monitoreo de crédito."],
          ].map(([title, body]) => (
            <div key={title} className="card p-7">
              <h2 className="text-[21px] font-semibold text-slate-900">{title}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-slate-500">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="mx-auto max-w-3xl px-6 py-10 text-center text-xs leading-relaxed text-slate-500">
        Bonalti Crédito es una herramienta de software DIY (hazlo tú mismo). No disputamos por ti, no
        garantizamos resultados y los resultados varían según cada caso. Disponible en Texas. Esto no
        es asesoría legal.
      </footer>
    </main>
  );
}
