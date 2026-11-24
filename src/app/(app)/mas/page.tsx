"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { BILLING_COPY } from "@/lib/ux/billingCopy";
import { CLIENT_SHARING_COPY } from "@/lib/partners/sharingCopy";
import { HUMAN_HELP, humanHelpHref } from "@/lib/ux/humanHelp";
import Icon, { type IconName } from "@/components/Icon";
import { CharacterAvatar } from "@/components/Character";
import { isFullService } from "@/lib/service/mode";
import MailingAddress from "@/components/MailingAddress";
import { useTextSize } from "@/lib/ux/textSize";

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
  leading,
}: {
  href: string;
  icon: IconName;
  tint: string;
  title: string;
  desc: string;
  first?: boolean;
  external?: boolean;
  /** Shown in place of the tinted icon. */
  leading?: React.ReactNode;
}) {
  const body = (
    <>
      {leading ?? (
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white ${tint}`}>
          <Icon name={icon} size={20} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-medium text-slate-900">{title}</span>
        <span className="block text-[13px] leading-snug text-slate-500">{desc}</span>
      </span>
      <Icon name="chevron" size={18} className="shrink-0 text-slate-300" />
    </>
  );
  const className = `pressable flex items-center gap-3.5 px-4 py-3.5 hover:bg-slate-50 ${first ? "" : "border-t hairline"}`;
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
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
  // A WhatsApp chat with the team, or null in the demo, where nobody is online.
  const humanHref = humanHelpHref(locale);
  const humanTitle = es ? "Hablar con una persona" : "Talk to a person";
  const { large, setSize } = useTextSize();

  return (
    <main className="animate-rise space-y-6">
      <h1 className="px-1 font-display text-[34px] font-bold leading-tight text-blue-700">{d.nav.more}</h1>

      <section>
        <h2 className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
          {es ? "Tu crédito" : "Your credit"}
        </h2>
        <div className="card overflow-hidden">
          <Row
            first
            href="/caso"
            icon="clock"
            tint="bg-blue-900"
            title={es ? "Mi caso" : "My case"}
            desc={es ? "Todo lo que ha pasado y lo que sigue, con fechas." : "Everything that happened and what comes next, with dates."}
          />
          <Row
            href="/construir"
            icon="sparkle"
            tint="bg-amber-500"
            title={es ? "Construye tu crédito" : "Build your credit"}
            desc={es ? "Tu plan de hábitos, el camino para comprar casa y la guía para ITIN." : "Your plan of habits, the path to buying a home, and the ITIN guide."}
          />
          <Row
            href="/aprende"
            icon="book"
            tint="bg-amber-600"
            title={es ? "Aprende" : "Learn"}
            desc={es ? "Lecciones cortas sobre el crédito, y dos calculadoras." : "Short lessons about credit, and two calculators."}
          />
          <Row
            href="/audit"
            icon="clipboard"
            tint="bg-blue-700"
            title={d.nav.audit}
            desc={es ? "El resumen completo de lo que encontramos." : "The full summary of what we found."}
          />
          <Row
            href="/mas/reportes"
            icon="doc"
            tint="bg-blue-900"
            title={es ? "Mis reportes" : "My reports"}
            desc={es ? "Cada reporte de tu expediente y lo que cambió." : "Every report in your file and what changed."}
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
            desc={es ? "Lee cada carta completa, con su explicación." : "Read every letter in full, with its explanation."}
          />
          <Row
            href="/rounds"
            icon="clock"
            tint="bg-slate-500"
            title={d.nav.rounds}
            desc={es ? "Qué se envió, cuándo responden y qué sigue." : "What was mailed, when they respond, what's next."}
          />
        </div>
      </section>

      {isFullService && (
        <section>
          <h2 className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
            {es ? "Tu servicio" : "Your service"}
          </h2>
          <div className="card overflow-hidden">
            <Row
              first
              href="/acuerdo"
              icon="clipboard"
              tint="bg-blue-900"
              title={es ? "Mi acuerdo" : "My agreement"}
              desc={
                es
                  ? "Tu contrato, tu copia para imprimir y cómo cancelar."
                  : "Your contract, your copy to print, and how to cancel."
              }
            />
            <Row
              href="/pagos"
              icon="doc"
              tint="bg-green-600"
              title={BILLING_COPY[locale].navTitle}
              desc={BILLING_COPY[locale].navDesc}
            />
            <Row
              href="/mas/compartir"
              icon="person"
              tint="bg-slate-700"
              title={CLIENT_SHARING_COPY[locale].navTitle}
              desc={CLIENT_SHARING_COPY[locale].navDesc}
            />
          </div>
        </section>
      )}

      <section>
        <h2 className="px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
          {es ? "Ayuda" : "Help"}
        </h2>
        <div className="card overflow-hidden">
          {humanHref ? (
            <Row
              first
              external
              href={humanHref}
              icon="person"
              tint="bg-green-600"
              leading={<CharacterAvatar character="team" size={40} />}
              title={humanTitle}
              desc={HUMAN_HELP.liveRow[locale]}
            />
          ) : (
            // Demo: not a link, and it says why.
            // Alti stands for the team (never a particular person, never the AI).
            <div className="flex items-center gap-3.5 px-4 py-3.5">
              <CharacterAvatar character="team" size={40} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-[17px] font-medium text-slate-900">{humanTitle}</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-500">
                    {d.nav.demo}
                  </span>
                </span>
                <span className="block text-[13px] leading-snug text-slate-500">{HUMAN_HELP.demoRow[locale]}</span>
              </span>
            </div>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={large}
            onClick={() => setSize(large ? "normal" : "large")}
            data-testid="text-size"
            className="pressable flex w-full items-center gap-3.5 border-t hairline px-4 py-3.5 text-left hover:bg-slate-50"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-700 text-white">
              <Icon name="textSize" size={22} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[17px] font-medium text-slate-900">{es ? "Letra grande" : "Large text"}</span>
              <span className="block text-[13px] leading-snug text-slate-500">
                {es ? "Letras y botones más grandes en este teléfono." : "Bigger text and buttons on this phone."}
              </span>
            </span>
            <span aria-hidden="true" className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${large ? "bg-blue-700" : "bg-slate-300"}`}>
              <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${large ? "left-[22px]" : "left-0.5"}`} />
            </span>
          </button>
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

      {/* With a real account: the return address on every letter (lib/supabase/config.ts decides; nothing in the demo). */}
      <MailingAddress />
    </main>
  );
}
