import Link from "next/link";

// /empezar — the paid-traffic funnel page (Meta Click-to-WhatsApp + Google).
// Structure mirrors what converts in this category (hero promise → numbered
// steps with real product screenshots → single CTA), with copy that passes our
// own claim guardrails: DIY positioning, no guarantees, results vary. The CTA
// routes to WhatsApp when configured (the spec's funnel), else to onboarding.

export const metadata = {
  title: "Bonalti Crédito — Empieza en 5 minutos",
  description:
    "Software gratuito de disputas de crédito en español. Tú revisas, tú apruebas, tú envías. Los resultados varían.",
};

const STEPS = [
  {
    n: 1,
    title: "Conecta tu monitoreo e importa tu reporte",
    body: "Con tu suscripción de monitoreo (~$49/mes, el único costo), importamos tu reporte de los 3 burós — Equifax, Experian y TransUnion — y te mostramos exactamente qué sigue, un paso a la vez.",
    img: "/screens/journey.png",
    alt: "Panel de Bonalti mostrando el siguiente paso",
  },
  {
    n: 2,
    title: "Revisa cada elemento, explicado en palabras simples",
    body: "Nada de tecnicismos: te explicamos qué es cada cuenta, cobranza o consulta, y qué verificar. Tú marcas solo lo que crees inexacto, no verificable o desactualizado — y lo confirmas con tu firma electrónica.",
    img: "/screens/revisar.png",
    alt: "Revisión guiada con atestiguación",
  },
  {
    n: 3,
    title: "Lee tus cartas y envía tu ataque con un botón",
    body: "Generamos tus cartas de disputa bajo la ley FCRA y te las mostramos completas, con su explicación. Cuando TÚ apruebas, se imprimen y envían por correo — sin impresora, sin filas en el correo. Cada ~40 días, repites con tu reporte actualizado.",
    img: "/screens/carta.png",
    alt: "Vista previa de carta de disputa con explicación",
  },
];

// The questions Hispanic families actually ask before trusting a credit company.
// Answers stay inside the claim guardrails and promise nothing we can't control.
const FAQ: Array<[string, string]> = [
  [
    "Ya me estafaron antes. ¿Cómo sé que esto es diferente?",
    "No te pedimos que confíes a ciegas: tú ves cada carta antes de que salga, tú decides qué disputar, y no firmas contratos. Tampoco prometemos resultados — quien te los promete, te está mintiendo.",
  ],
  [
    "¿Cuánto cuesta en total?",
    "Solo tu suscripción de monitoreo de crédito (~$49 al mes). La app, las cartas, el envío por correo y la ayuda de nuestro equipo van incluidos. Cancelas cuando quieras.",
  ],
  [
    "¿Esto tiene que ver con mi estatus migratorio?",
    "No. Revisar y disputar tu propio reporte de crédito es un derecho de todo consumidor bajo la ley federal (FCRA). Bonalti no te pide información migratoria. (Esto no es asesoría legal.)",
  ],
  [
    "¿Necesito número de Seguro Social?",
    "El servicio de monitoreo verifica tu identidad para mostrarte tu reporte. Si usas ITIN en lugar de Seguro Social, escríbenos por WhatsApp antes de empezar y te decimos tus opciones.",
  ],
  [
    "No soy bueno(a) con la tecnología. ¿Voy a poder?",
    "Sí. Es un chat, como WhatsApp: el asistente te va diciendo qué sigue. Puedes escuchar las explicaciones en vez de leerlas, y si quieres, una persona del equipo te acompaña en vivo — gratis.",
  ],
  [
    "¿Ustedes disputan por mí?",
    "No — y eso te protege. El asistente prepara todo (lee tu reporte, escribe las cartas, las envía por correo), pero tú decides y tú apruebas. Son 3 toques por ronda, unos 5 minutos al mes.",
  ],
];

export default function Empezar() {
  const whatsapp = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  const ctaHref = whatsapp
    ? `https://wa.me/${whatsapp}?text=${encodeURIComponent("¡Hola! Quiero empezar a revisar mi crédito con Bonalti.")}`
    : "/onboarding";
  const ctaLabel = whatsapp ? "Escríbenos por WhatsApp →" : "Empezar ahora — es gratis →";

  return (
    <main className="bg-white">
      <section className="mx-auto max-w-3xl px-6 pb-12 pt-16 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Bonalti Crédito</p>
        <h1 className="mt-3 text-4xl font-bold leading-tight sm:text-5xl">
          Tu asistente de crédito con IA — tú solo das el OK
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
          La IA hace el trabajo pesado: lee tu reporte, encuentra lo negativo, te lo explica,
          escribe tus cartas y las envía por correo. <strong>Tú decides qué disputar y tú
          apruebas</strong> — 3 toques por ronda, ~5 minutos al mes. Software gratuito; solo
          necesitas tu suscripción de monitoreo.
        </p>
        <a
          href={ctaHref}
          className="mt-8 inline-block rounded-xl bg-blue-700 px-8 py-4 text-lg font-bold text-white shadow-lg hover:bg-blue-800"
        >
          {ctaLabel}
        </a>
        <p className="mt-3 text-xs text-slate-500">
          Sin contratos de servicio · Ayuda en vivo gratis si la quieres · Cancela tu monitoreo cuando quieras
        </p>
      </section>

      <section className="border-t border-slate-100 bg-slate-50 py-14">
        <div className="mx-auto max-w-4xl space-y-14 px-6">
          {STEPS.map((s) => (
            <div key={s.n} className="grid items-center gap-8 sm:grid-cols-2">
              <div className={s.n % 2 === 0 ? "sm:order-2" : ""}>
                <span className="inline-block rounded-full bg-blue-100 px-3 py-1 text-sm font-bold text-blue-700">
                  Paso {s.n}
                </span>
                <h2 className="mt-3 text-2xl font-bold">{s.title}</h2>
                <p className="mt-2 text-slate-600">{s.body}</p>
              </div>
              <div className={s.n % 2 === 0 ? "sm:order-1" : ""}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={s.img}
                  alt={s.alt}
                  className="w-full rounded-xl border border-slate-200 shadow-md"
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-14 text-center">
        <h2 className="text-2xl font-bold">Hecho para nuestra comunidad</h2>
        <div className="mt-6 grid gap-4 text-left sm:grid-cols-2">
          {[
            ["🤖 La IA trabaja, tú mandas", "Tu asistente prepara todo y te avisa por WhatsApp. Las compañías que 'lo hacen por ti' son las que acaban demandadas — aquí TÚ tienes el control, y eso te protege."],
            ["🤝 Ayuda humana gratis", "¿Prefieres que alguien te acompañe? Nuestro equipo te guía en vivo por WhatsApp mientras tú decides. Sin costo extra."],
            ["🇲🇽 En tu idioma", "Todo en español — la app, las explicaciones y la ayuda. (English también disponible.)"],
            ["⚖️ Con la ley de tu lado", "Tus cartas usan tus derechos bajo la ley federal FCRA. Tú las lees antes de enviar."],
          ].map(([t, b]) => (
            <div key={t} className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="font-semibold">{t}</p>
              <p className="mt-1 text-sm text-slate-600">{b}</p>
            </div>
          ))}
        </div>
        <a
          href={ctaHref}
          className="mt-10 inline-block rounded-xl bg-blue-700 px-8 py-4 text-lg font-bold text-white shadow-lg hover:bg-blue-800"
        >
          {ctaLabel}
        </a>
      </section>

      <section className="border-t border-slate-100 bg-slate-50 py-14">
        <div className="mx-auto max-w-2xl px-6">
          <h2 className="text-center text-2xl font-bold">Preguntas que nos hacen siempre</h2>
          <div className="mt-6 space-y-3">
            {FAQ.map(([q, a]) => (
              <details key={q} className="rounded-xl border border-slate-200 bg-white p-5">
                <summary className="cursor-pointer text-lg font-semibold text-slate-900">{q}</summary>
                <p className="mt-3 text-slate-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-100 px-6 py-8 text-center">
        <p className="mx-auto max-w-2xl text-xs text-slate-500">
          Bonalti Crédito es una herramienta de software DIY (hazlo tú mismo): no disputamos por ti y
          no garantizamos resultados — los resultados varían según cada caso. Disputar información
          correcta y actual no es el propósito de la herramienta. Requiere una suscripción activa de
          monitoreo de crédito (~$49/mes). Disponible en Texas. Esto no es asesoría legal.{" "}
          <Link href="/" className="text-blue-700 underline">
            Más información
          </Link>
        </p>
      </footer>
    </main>
  );
}
