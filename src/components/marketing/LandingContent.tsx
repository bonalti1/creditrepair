"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { MARKETING } from "@/lib/i18n/marketing";
import LocaleToggle from "@/components/LocaleToggle";
import Logo from "@/components/Logo";
import { CharacterAvatar, CharacterFigure } from "@/components/Character";

// Landing. The brand board in product form: navy field, gold action, and the
// two characters together: the robot, the AI assistant, and Alti, the face of
// the human team. On a phone they stand below the buttons, so the headline and
// the main action stay on the first screen; on a wide screen they stand beside
// the headline. Copy discipline: it describes the service (the client says what is
// wrong, the team prepares and mails the letters) and never a result. No
// guarantees, no "we remove / we fix", no price; results vary. The words live
// in src/lib/i18n/marketing.ts, in Spanish and English.
//
// Sales comes first: with a WhatsApp number configured the main button opens a
// chat with the team, as on /empezar. Without one (the demo) it leads to
// onboarding.

export default function LandingContent() {
  const { locale } = useLocale();
  const c = MARKETING[locale].landing;
  const whatsapp = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  const ctaHref = whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(c.whatsappText)}` : "/onboarding";
  const ctaLabel = whatsapp ? c.talk : c.start;

  return (
    <main className="min-h-dvh bg-slate-50">
      <section className="relative overflow-hidden bg-gradient-to-b from-blue-800 to-blue-900 pb-28 text-white">
        <header className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-2 px-5">
          <Logo size={30} tone="dark" priority />
          <div className="flex shrink-0 items-center gap-2">
            <LocaleToggle tone="dark" />
            <Link
              href="/login"
              className="pressable flex h-11 items-center whitespace-nowrap rounded-full bg-white/10 px-4 text-[15px] font-semibold text-white hover:bg-white/15"
            >
              {c.signIn}
            </Link>
          </div>
        </header>

        <div className="mx-auto max-w-5xl px-6 pt-10 sm:pt-16 lg:grid lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-end lg:gap-8">
          <div className="mx-auto max-w-3xl text-center lg:mx-0 lg:pb-16 lg:text-left">
            <div className="inline-flex items-center gap-3 rounded-full bg-white/10 py-1.5 pl-1.5 pr-5">
              <CharacterAvatar character="assistant" size={44} tone="ivory" decorative />
              <span className="text-balance text-left text-[15px] font-medium leading-snug text-blue-100">{c.assistantHello}</span>
            </div>

            <h1 className="mt-6 font-display text-[42px] font-bold leading-[1.06] sm:text-[66px] lg:text-[60px]">
              {c.headline} <span className="text-amber-400">{c.headlineAccent}</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-[19px] leading-relaxed text-blue-100 sm:text-[21px] lg:mx-0">{c.lead}</p>

            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
              <a
                href={ctaHref}
                className="pressable flex h-14 w-full items-center justify-center rounded-full bg-amber-400 px-10 text-[17px] font-semibold text-blue-900 hover:bg-amber-300 sm:w-auto"
              >
                {ctaLabel}
              </a>
              <Link
                href="/dashboard"
                className="pressable flex h-14 w-full items-center justify-center rounded-full bg-white/10 px-10 text-[17px] font-semibold text-white hover:bg-white/15 sm:w-auto"
              >
                {c.demo}
              </Link>
            </div>
          </div>

          {/* Alti turns toward the robot and the robot toward Alti: the team and the assistant, side by side. */}
          <div className="relative mt-12 flex items-end justify-center gap-2 sm:gap-4 lg:mt-0">
            <figure className="flex flex-col items-center">
              <CharacterFigure
                character="team"
                view="threeQuarter"
                height={250}
                heightClassName="h-[250px] lg:h-[400px]"
                priority
              />
              <figcaption className="mt-3 whitespace-nowrap rounded-full bg-white/10 px-3 py-1 text-center text-[13px] font-medium text-blue-100">
                {c.teamTag}
              </figcaption>
            </figure>
            <figure className="flex flex-col items-center">
              <CharacterFigure
                character="assistant"
                view="threeQuarter"
                height={140}
                heightClassName="h-[140px] lg:h-[205px]"
                priority
              />
              <figcaption className="mt-3 whitespace-nowrap rounded-full bg-white/10 px-3 py-1 text-center text-[13px] font-medium text-blue-100">
                {c.assistantTag}
              </figcaption>
            </figure>
          </div>
        </div>

        <svg
          viewBox="0 0 1440 120"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-20 w-full sm:h-28"
        >
          <path d="M0 62C380 132 1060 -8 1440 54V120H0Z" fill="var(--color-amber-400)" />
          <path d="M0 84C380 146 1060 14 1440 76V120H0Z" fill="var(--color-slate-50)" />
        </svg>
      </section>

      <section className="py-14">
        <div className="mx-auto grid max-w-5xl gap-4 px-6 sm:grid-cols-3">
          {c.cards.map(([title, body]) => (
            <div key={title} className="card p-7">
              <h2 className="font-display text-[22px] font-bold text-blue-700">{title}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-slate-500">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="mx-auto max-w-3xl px-6 pb-10 text-center text-xs leading-relaxed text-slate-500">
        {c.footer}
      </footer>
    </main>
  );
}
