"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/lib/i18n";

// Responsive nav: top bar on desktop, thumb-reachable bottom tab bar on mobile.
// Includes the ES/EN toggle (Spanish default per spec §4.3).

const NAV = [
  { href: "/dashboard", key: "home" as const, icon: "🏠" },
  { href: "/audit", key: "audit" as const, icon: "📋" },
  { href: "/items", key: "review" as const, icon: "🔍" },
  { href: "/attack", key: "attack" as const, icon: "🛡️" },
  { href: "/rounds", key: "rounds" as const, icon: "📬" },
];

function LocaleToggle() {
  const { locale, setLocale } = useLocale();
  return (
    <button
      onClick={() => setLocale(locale === "es" ? "en" : "es")}
      className="rounded-full border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
      aria-label={locale === "es" ? "Switch to English" : "Cambiar a español"}
    >
      {locale === "es" ? "EN" : "ES"}
    </button>
  );
}

export default function AppNav() {
  const pathname = usePathname();
  const { d } = useLocale();

  return (
    <>
      <header className="hidden border-b border-slate-200 bg-white sm:block">
        <nav className="mx-auto flex max-w-4xl items-center gap-6 px-6 py-4">
          <Link href="/" className="font-bold text-blue-700">
            Bonalti Crédito
          </Link>
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`text-sm ${
                pathname.startsWith(n.href)
                  ? "font-semibold text-blue-700"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {d.nav[n.key]}
            </Link>
          ))}
          <div className="ml-auto flex items-center gap-3">
            <LocaleToggle />
            <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
              {d.nav.demo}
            </span>
          </div>
        </nav>
      </header>

      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:hidden">
        <Link href="/" className="font-bold text-blue-700">
          Bonalti Crédito
        </Link>
        <div className="flex items-center gap-2">
          <LocaleToggle />
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            {d.nav.demo}
          </span>
        </div>
      </header>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white sm:hidden">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
              pathname.startsWith(n.href) ? "font-semibold text-blue-700" : "text-slate-500"
            }`}
          >
            <span className="text-lg">{n.icon}</span>
            {d.nav[n.key]}
          </Link>
        ))}
      </nav>
    </>
  );
}
