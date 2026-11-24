"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { MARKETING } from "@/lib/i18n/marketing";
import LocaleToggle from "@/components/LocaleToggle";
import Logo from "@/components/Logo";
import { CharacterAvatar, CharacterFigure, type Character } from "@/components/Character";

// /empezar — the paid-traffic funnel page (Meta Click-to-WhatsApp + Google).
// Structure mirrors what converts in this category (what we do → numbered
// steps with real product screenshots → single CTA), with copy that passes our
// own claim guardrails: it describes the service (the client says what is
// wrong, the team prepares and mails the letters), no guarantees, no price,
// results vary. Sales comes first: the CTA opens WhatsApp with the team when a
// number is configured, else it leads to onboarding. The words live in
// src/lib/i18n/marketing.ts (ES and EN).

// Real screens of the app (the demo), retaken with the brand kit's logo and colours.
// Marketing shows no credit-score visuals (docs/BRAND.md, "Compliance"), so
// step 1 is the invited welcome, not the home screen with its score ring.
const STEP_IMAGES = ["/screens/bienvenida.png", "/screens/revisar.png", "/screens/carta.png"];

// Who stands beside each step (docs/BRAND.md): Alti, the AI assistant, where
// he explains the report (step 2). He is the only character.
const STEP_CHARACTERS: Array<{ character: Character; height: number } | null> = [
  null,
  { character: "assistant", height: 230 },
  null,
];

export default function EmpezarContent() {
  const { locale } = useLocale();
  const c = MARKETING[locale].empezar;
  const whatsapp = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  const ctaHref = whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(c.whatsappText)}` : "/onboarding";
  const ctaLabel = whatsapp ? c.ctaWhatsapp : c.ctaStart;

  return (
    <main className="bg-slate-50">
      <section className="relative overflow-hidden bg-gradient-to-b from-blue-800 to-blue-900 px-6 pb-32 pt-5 text-center text-white">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center justify-between gap-3">
            <Logo size={30} tone="dark" priority />
            <LocaleToggle tone="dark" />
          </div>
          {/* Alti, the AI assistant: the one character. */}
          <div className="mt-7 flex justify-center">
            <CharacterAvatar character="assistant" size={76} className="ring-4 ring-blue-800" />
          </div>
          <h1 className="mt-5 font-display text-[35px] font-bold leading-[1.08] sm:text-[56px]">
            {c.headline} <span className="text-amber-400">{c.headlineAccent}</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-[19px] leading-relaxed text-blue-100">
            {c.leadBefore} <strong>{c.leadStrong}</strong> {c.leadAfter}
          </p>
          <a
            href={ctaHref}
            className="pressable mt-8 inline-flex h-14 items-center rounded-full bg-amber-400 px-9 text-[17px] font-semibold text-blue-900 hover:bg-amber-300"
          >
            {ctaLabel}
          </a>
          <p className="mt-4 text-[13px] text-blue-200">{c.underCta}</p>
        </div>
        <svg viewBox="0 0 1440 120" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-x-0 bottom-0 h-20 w-full sm:h-28">
          <path d="M0 62C380 132 1060 -8 1440 54V120H0Z" fill="var(--color-amber-400)" />
          <path d="M0 84C380 146 1060 14 1440 76V120H0Z" fill="var(--color-slate-50)" />
        </svg>
      </section>

      <section className="bg-slate-50 py-14">
        <div className="mx-auto max-w-4xl space-y-14 px-6">
          {c.steps.map((s, index) => {
            const n = index + 1;
            const beside = STEP_CHARACTERS[index];
            return (
              <div key={n} className="grid items-center gap-8 sm:grid-cols-2">
                <div className={n % 2 === 0 ? "sm:order-2" : ""}>
                  <span className="inline-block rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-700">
                    {c.step(n)}
                  </span>
                  {beside && (
                    <span className="ml-2 inline-block text-sm font-semibold text-slate-500">
                      {c.assistantTag}
                    </span>
                  )}
                  <h2 className="mt-3 font-display text-[26px] font-bold leading-tight text-blue-700">{s.title}</h2>
                  <p className="mt-2 text-slate-600">{s.body}</p>
                </div>
                <div className={`flex items-end justify-center gap-3 ${n % 2 === 0 ? "sm:order-1" : ""}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={STEP_IMAGES[index]}
                    alt={s.alt}
                    width={780}
                    height={1688}
                    loading="lazy"
                    className={`card h-auto min-w-0 ${beside ? "w-[62%] max-w-[260px]" : "w-full max-w-[300px]"}`}
                  />
                  {beside && <CharacterFigure character={beside.character} height={beside.height} />}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-14 text-center">
        <h2 className="font-display text-[28px] font-bold text-blue-700">{c.communityTitle}</h2>
        <div className="mt-6 grid gap-4 text-left sm:grid-cols-2">
          {c.community.map(([t, b]) => (
            <div key={t} className="card p-6">
              <p className="font-semibold">{t}</p>
              <p className="mt-1 text-sm text-slate-600">{b}</p>
            </div>
          ))}
        </div>
        <a
          href={ctaHref}
          className="pressable mt-10 inline-flex h-14 items-center rounded-full bg-amber-400 px-9 text-[17px] font-semibold text-blue-900 hover:bg-amber-500"
        >
          {ctaLabel}
        </a>
      </section>

      <section className="border-t border-slate-100 bg-slate-50 py-14">
        <div className="mx-auto max-w-2xl px-6">
          <h2 className="text-center font-display text-[28px] font-bold text-blue-700">{c.faqTitle}</h2>
          <div className="mt-6 space-y-3">
            {c.faq.map(([q, a]) => (
              <details key={q} className="card p-6">
                <summary className="cursor-pointer text-lg font-semibold text-slate-900">{q}</summary>
                <p className="mt-3 text-slate-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-100 px-6 pb-6 pt-8 text-center">
        <p className="mx-auto max-w-2xl text-xs text-slate-500">{c.footer}</p>
        {/* On its own line, with a full-height tap area. */}
        <Link
          href="/"
          className="pressable mt-1 inline-flex h-11 items-center px-4 text-[13px] font-medium text-blue-700 underline"
        >
          {c.more}
        </Link>
      </footer>
    </main>
  );
}
