"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Responsive nav: top bar on desktop, thumb-reachable bottom tab bar on mobile.
// Dispute Beast is desktop-web-first; our users live on their phones.

const NAV = [
  { href: "/dashboard", label: "Inicio", icon: "🏠" },
  { href: "/items", label: "Revisar", icon: "🔍" },
  { href: "/attack", label: "Mi ataque", icon: "🛡️" },
  { href: "/rounds", label: "Rondas", icon: "📬" },
];

export default function AppNav() {
  const pathname = usePathname();

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
              {n.label}
            </Link>
          ))}
          <span className="ml-auto rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
            Demo
          </span>
        </nav>
      </header>

      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:hidden">
        <Link href="/" className="font-bold text-blue-700">
          Bonalti Crédito
        </Link>
        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Demo</span>
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
            {n.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
