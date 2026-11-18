"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import Icon, { type IconName } from "@/components/Icon";

// "Más": everything beyond Home and the conversation, as grouped rows that say
// what each thing is for. Familiar from every phone's Settings screen.

function Row({
  href,
  icon,
  tint,
  title,
  desc,
  first,
  external,
}: {
  href: string;
  icon: IconName;
  tint: string;
  title: string;
  desc: string;
  first?: boolean;
  external?: boolean;
}) {
  const body = (
    <>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white ${tint}`}>
        <Icon name={icon} size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-medium text-slate-900">{title}</span>
        <span className="block text-[13px] leading-snug text-slate-500">{desc}</span>
      </span>
      <Icon name="chevron" size={18} className="shrink-0 text-slate-300" />
    </>
  );
  const className = `pressable flex items-center gap-3.5 px-4 py-3.5 hover:bg-slate-50 ${first ? "" : "border-t hairline"}`;
  return external ? (
    <a href={href} className={className}>
      {body}
    </a>
  ) : (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}

export default function Mas() {
  const { locale, setLocale, d } = useLocale();
  const es = locale === "es";
  const whatsapp = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  const humanHref = whatsapp
    ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(es ? "Hola, necesito ayuda con mi cuenta de Bonalti." : "Hi, I need help with my Bonalti account.")}`
    : "/asistente";

  return (
    <main className="animate-rise space-y-6">
      <h1 className="px-1 text-[34px] font-bold leading-tight text-slate-900">{d.nav.more}</h1>

      <section>
        <h2 className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
          {es ? "Tu crédito" : "Your credit"}
        </h2>
        <div className="card overflow-hidden">
          <Row
            first
            href="/audit"
            icon="clipboard"
            tint="bg-blue-700"
            title={d.nav.audit}
            desc={es ? "El resumen completo de lo que encontramos." : "The full summary of what we found."}
          />
          <Row
            href="/items"
            icon="search"
            tint="bg-slate-700"
            title={d.nav.review}
            desc={es ? "Revisa o cambia tus decisiones." : "Review or change your decisions."}
          />
          <Row
            href="/attack"
            icon="doc"
            tint="bg-blue-500"
            title={es ? "Mis cartas" : "My letters"}
            desc={es ? "Lee cada carta completa antes de enviar." : "Read every letter in full before sending."}
          />
          <Row
            href="/rounds"
            icon="clock"
            tint="bg-slate-500"
            title={d.nav.rounds}
            desc={es ? "Qué enviaste, cuándo responden y qué sigue." : "What you sent, when they respond, what's next."}
          />
        </div>
      </section>

      <section>
        <h2 className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
          {es ? "Ayuda" : "Help"}
        </h2>
        <div className="card overflow-hidden">
          <Row
            first
            external={Boolean(whatsapp)}
            href={humanHref}
            icon="person"
            tint="bg-green-600"
            title={es ? "Hablar con una persona" : "Talk to a person"}
            desc={es ? "Nuestro equipo te ayuda por WhatsApp. Gratis." : "Our team helps you on WhatsApp. Free."}
          />
          <button
            type="button"
            onClick={() => setLocale(es ? "en" : "es")}
            className="pressable flex w-full items-center gap-3.5 border-t hairline px-4 py-3.5 text-left hover:bg-slate-50"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
              <Icon name="globe" size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[17px] font-medium text-slate-900">{es ? "Idioma" : "Language"}</span>
              <span className="block text-[13px] text-slate-500">{es ? "Español" : "English"}</span>
            </span>
            <span className="text-[15px] font-medium text-blue-700">{es ? "English" : "Español"}</span>
          </button>
        </div>
      </section>
    </main>
  );
}
