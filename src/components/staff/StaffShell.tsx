"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getStaffData, resetDemo } from "@/lib/staff/data";
import Icon, { type IconName } from "@/components/Icon";
import Logo from "@/components/Logo";

// The frame around every staff screen: logo, three destinations, and a "Demo"
// pill while the clients are invented. Built for a computer first; on a phone
// the navigation drops to its own row.

const NAV: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/equipo", label: "Inicio", icon: "home" },
  { href: "/equipo/clientes", label: "Clientes", icon: "person" },
  { href: "/equipo/invitar", label: "Invitar", icon: "mail" },
];

export default function StaffShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const demo = getStaffData().demo;
  const isActive = (href: string) => (href === "/equipo" ? pathname === "/equipo" : pathname.startsWith(href));

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b hairline bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 px-4 sm:px-6">
          <Link href="/equipo" aria-label="Inicio del equipo" className="flex h-14 items-center gap-2.5">
            <Logo size={19} />
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">Equipo</span>
          </Link>

          {demo && (
            <span
              className="order-2 ml-auto rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-blue-900 sm:order-3"
              title="Clientes inventados. Nada se envía."
            >
              Demo
            </span>
          )}

          <nav className="order-3 -mx-1 flex w-full items-center gap-1 pb-2 sm:order-2 sm:mx-0 sm:w-auto sm:pb-0" aria-label="Equipo">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={isActive(n.href) ? "page" : undefined}
                className={`pressable flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium ${
                  isActive(n.href) ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Icon name={n.icon} size={16} />
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 pb-10 pt-6 sm:px-6 sm:pt-8">{children}</div>

      {demo && (
        <footer className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">
          <p className="border-t hairline pt-4 text-xs leading-relaxed text-slate-500">
            Demostración: los clientes son inventados y nada se envía por correo. Lo que hagas aquí se guarda solo en
            este navegador.{" "}
            <button
              type="button"
              onClick={() => {
                resetDemo();
                window.location.reload();
              }}
              className="font-medium text-blue-700 underline-offset-2 hover:underline"
            >
              Reiniciar la demo
            </button>
          </p>
        </footer>
      )}
    </div>
  );
}
