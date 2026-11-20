"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { MARKETING } from "@/lib/i18n/marketing";
import LocaleToggle from "@/components/LocaleToggle";
import Logo, { CapiAvatar } from "@/components/Logo";

// Landing. The brand board in product form: navy field, gold action, Capi up
// front. Copy discipline (spec §1 + §3): do-it-yourself positioning only, no
// guarantees, no "we repair / we dispute" language, results vary. The words
// live in src/lib/i18n/marketing.ts, in Spanish and English.

export default function LandingContent() {
  const { locale } = useLocale();
  const c = MARKETING[locale].landing;

  return (
    <main className="min-h-dvh bg-slate-50">
      <section className="relative overflow-hidden bg-gradient-to-b from-blue-800 to-blue-900 pb-28 text-white">
        <header className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-2 px-5">
          <Logo size={22} tone="dark" />
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

        <div className="mx-auto max-w-3xl px-6 pt-10 text-center sm:pt-16">
          <div className="inline-flex items-center gap-3 rounded-full bg-white/10 py-1.5 pl-1.5 pr-5">
            <CapiAvatar size={44} ring={false} />
            <span className="text-[15px] font-medium text-blue-100">{c.capiHello}</span>
          </div>

          <h1 className="mt-6 font-display text-[46px] font-black leading-[1.02] sm:text-[72px]">
            {c.headline} <span className="text-amber-400">{c.headlineAccent}</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-[19px] leading-relaxed text-blue-100 sm:text-[21px]">{c.lead}</p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/onboarding"
              className="pressable flex h-14 w-full items-center justify-center rounded-full bg-amber-400 px-10 text-[17px] font-bold text-blue-900 hover:bg-amber-300 sm:w-auto"
            >
              {c.start}
            </Link>
            <Link
              href="/dashboard"
              className="pressable flex h-14 w-full items-center justify-center rounded-full bg-white/10 px-10 text-[17px] font-semibold text-white hover:bg-white/15 sm:w-auto"
            >
              {c.demo}
            </Link>
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
              <h2 className="font-display text-[22px] font-extrabold text-blue-700">{title}</h2>
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
