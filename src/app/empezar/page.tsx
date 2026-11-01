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
          Empieza a disputar tu crédito en 5 minutos — en español
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
          Software <strong>gratuito</strong> para armar tus disputas, paso a paso. Tú decides qué
          disputar, tú apruebas cada carta, <strong>tú envías tu ataque</strong>. Solo necesitas tu
          suscripción de monitoreo de crédito.
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
        <div className="mt-6 grid gap-4 text-left sm:grid-cols-3">
          {[
            ["🇲🇽 En tu idioma", "Todo en español — la app, las explicaciones y la ayuda. (English también disponible.)"],
            ["📱 En tu teléfono", "Diseñado para usarse desde el celular, con avisos por WhatsApp en cada paso."],
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
