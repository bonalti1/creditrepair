"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/lib/i18n";
import Icon, { type IconName } from "@/components/Icon";

// Three destinations, like a good phone app: where you stand, your assistant,
// and everything else. Translucent bars keep the content feeling continuous.

const NAV: Array<{ href: string; key: "home" | "assistant" | "more"; icon: IconName }> = [
  { href: "/dashboard", key: "home", icon: "home" },
  { href: "/asistente", key: "assistant", icon: "chat" },
  { href: "/mas", key: "more", icon: "grid" },
];

const MORE_PATHS = ["/mas", "/audit", "/items", "/attack", "/rounds", "/goal"];

function LocaleToggle() {
  const { locale, setLocale } = useLocale();
  return (
    <button
      onClick={() => setLocale(locale === "es" ? "en" : "es")}
      className="pressable flex h-8 items-center gap-1.5 rounded-full bg-slate-100 px-3 text-xs font-semibold text-slate-700"
      aria-label={locale === "es" ? "Switch to English" : "Cambiar a español"}
    >
      <Icon name="globe" size={14} />
      {locale === "es" ? "EN" : "ES"}
    </button>
  );
}

export default function AppNav() {
  const pathname = usePathname();
  const { d } = useLocale();

  const isActive = (href: string) =>
    href === "/mas" ? MORE_PATHS.some((p) => pathname.startsWith(p)) : pathname.startsWith(href);

  return (
    <>
      <header className="sticky top-0 z-30 border-b hairline bg-white/75 backdrop-blur-xl">
        <div className="mx-auto flex h-12 max-w-2xl items-center justify-between px-4 sm:h-14 sm:px-6">
          <Link href="/" className="text-[15px] font-semibold tracking-tight text-slate-900">
            Bonalti
          </Link>

          <nav className="hidden items-center gap-1 sm:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`pressable rounded-full px-4 py-1.5 text-sm font-medium ${
                  isActive(n.href) ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {d.nav[n.key]}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500">
              {d.nav.demo}
            </span>
            <LocaleToggle />
          </div>
        </div>
      </header>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t hairline bg-white/80 backdrop-blur-xl sm:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto flex max-w-md">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(n.href) ? "page" : undefined}
              className={`pressable flex flex-1 flex-col items-center gap-1 pb-2 pt-2.5 text-[11px] font-medium ${
                isActive(n.href) ? "text-blue-700" : "text-slate-400"
              }`}
            >
              <Icon name={n.icon} size={26} strokeWidth={isActive(n.href) ? 2 : 1.6} />
              {d.nav[n.key]}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
