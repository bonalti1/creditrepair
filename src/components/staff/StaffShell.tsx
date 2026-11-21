"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getStaffData, resetDemo } from "@/lib/staff/data";
import { can, ROLE_LABEL, STAFF_ROLES, type Capability, type Viewer } from "@/lib/staff/permissions";
import { demoViewAs } from "@/lib/staff/teamData";
import { StaffViewerContext, useViewer, VIEWER_CHANGED } from "@/lib/staff/useStaff";
import Icon, { type IconName } from "@/components/Icon";
import Logo from "@/components/Logo";

// The frame around every staff screen: logo, the destinations this member's
// role may open, who is signed in, and a "Demo" pill while the clients are
// invented. Built for a computer first; on a phone the navigation drops to its
// own row and scrolls sideways inside it.
//
// In the demo nobody is signed in, so a bar under the header lets the owner
// look at the console as each role sees it ("Ver como"). It exists only in the
// demo: with a database the role comes from the signed-in member's own row.

const NAV: Array<{ href: string; label: string; icon: IconName; needs?: Capability }> = [
  { href: "/equipo", label: "Inicio", icon: "home" },
  { href: "/equipo/clientes", label: "Clientes", icon: "person" },
  { href: "/equipo/invitar", label: "Invitar", icon: "mail", needs: "clients.invite" },
  { href: "/equipo/actividad", label: "Actividad", icon: "clock" },
  { href: "/equipo/negocio", label: "Negocio", icon: "chart", needs: "business.view" },
  { href: "/equipo/equipo", label: "Equipo", icon: "team", needs: "team.manage" },
];

function Frame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const demo = getStaffData().demo;
  const { viewer, ready } = useViewer();
  const isActive = (href: string) => (href === "/equipo" ? pathname === "/equipo" : pathname.startsWith(href));
  const nav = NAV.filter((n) => !n.needs || can(viewer?.role, n.needs));

  const viewAs = (role: (typeof STAFF_ROLES)[number]) => {
    if (demoViewAs(role)) window.dispatchEvent(new Event(VIEWER_CHANGED));
  };

  return (
    // On paper there is no frame: the header and the footer are screen-only,
    // so a printed page (see /equipo/imprimir) carries nothing but its content.
    <div className="min-h-dvh print:min-h-0">
      <header className="sticky top-0 z-30 border-b hairline bg-white/80 backdrop-blur-xl print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 px-4 sm:px-6">
          <Link href="/equipo" aria-label="Inicio del equipo" className="flex h-14 items-center gap-2.5">
            <Logo size={19} />
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">Equipo</span>
          </Link>

          <div className="order-2 ml-auto flex items-center gap-2 lg:order-3">
            {viewer && (
              <span className="hidden text-[13px] text-slate-500 sm:inline" data-testid="viewer">
                {viewer.name.split(" ")[0]} · {ROLE_LABEL[viewer.role]}
              </span>
            )}
            {demo && (
              <span
                className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-blue-900"
                title="Clientes inventados. Nada se envía."
              >
                Demo
              </span>
            )}
          </div>

          <nav
            className="order-3 -mx-4 flex w-[calc(100%+2rem)] items-center gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none] sm:-mx-6 sm:w-[calc(100%+3rem)] sm:px-5 lg:order-2 lg:mx-0 lg:w-auto lg:overflow-visible lg:px-0 lg:pb-0"
            aria-label="Equipo"
          >
            {ready &&
              nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={isActive(n.href) ? "page" : undefined}
                  className={`pressable flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium ${
                    isActive(n.href) ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Icon name={n.icon} size={16} />
                  {n.label}
                </Link>
              ))}
          </nav>
        </div>

        {demo && viewer && (
          <div className="border-t border-amber-200/70 bg-amber-50" data-testid="view-as">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 sm:px-6">
              <span className="text-[12px] font-semibold uppercase tracking-wide text-blue-900">Solo en la demo · Ver como</span>
              <div className="flex gap-1" role="group" aria-label="Ver la consola como">
                {STAFF_ROLES.map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => viewAs(role)}
                    aria-pressed={viewer.role === role}
                    className={`pressable h-8 rounded-full px-3 text-[13px] font-semibold ${
                      viewer.role === role ? "bg-blue-900 text-white" : "bg-white text-blue-900 hover:bg-amber-100"
                    }`}
                  >
                    {ROLE_LABEL[role]}
                  </button>
                ))}
              </div>
              <span className="text-[12px] text-blue-900/80">
                Estás viendo lo que ve {viewer.name}. Con la base de datos, el rol sale de la cuenta de cada persona.
              </span>
            </div>
          </div>
        )}
      </header>

      <div className="mx-auto max-w-6xl px-4 pb-10 pt-6 sm:px-6 sm:pt-8 print:m-0 print:max-w-none print:p-0">{children}</div>

      {demo && (
        <footer className="mx-auto max-w-6xl px-4 pb-10 sm:px-6 print:hidden">
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

export default function StaffShell({ viewer, children }: { viewer?: Viewer | null; children: React.ReactNode }) {
  return (
    <StaffViewerContext.Provider value={viewer ?? null}>
      <Frame>{children}</Frame>
    </StaffViewerContext.Provider>
  );
}
