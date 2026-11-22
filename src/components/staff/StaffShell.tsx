"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { getStaffData, resetDemo } from "@/lib/staff/data";
import { can, ROLE_LABEL, STAFF_ROLES, type Capability, type Viewer } from "@/lib/staff/permissions";
import { demoViewAs } from "@/lib/staff/teamData";
import { StaffViewerContext, useViewer, VIEWER_CHANGED } from "@/lib/staff/useStaff";
import Icon, { type IconName } from "@/components/Icon";
import Logo from "@/components/Logo";

// The frame around every staff screen: logo, the destinations this member's
// role may open, who is signed in (a round initial that opens a menu, so the
// header stays on one line at 1280 pixels with all seven tabs), and a "Demo"
// pill while the clients are invented. From 1280 pixels the tabs share the
// header's line; narrower (a laptop at 1024, a phone) they drop to their own
// row and scroll sideways inside it.
//
// In the demo nobody is signed in, so a bar under the header lets the owner
// look at the console as each role sees it ("Ver como"). It exists only in the
// demo: with a database the role comes from the signed-in member's own row.

const NAV: Array<{ href: string; label: string; icon: IconName; needs?: Capability }> = [
  { href: "/equipo", label: "Inicio", icon: "home" },
  { href: "/equipo/clientes", label: "Clientes", icon: "person" },
  { href: "/equipo/invitar", label: "Invitar", icon: "mail", needs: "clients.invite" },
  { href: "/equipo/acreedores", label: "Acreedores", icon: "doc", needs: "rounds.send" },
  { href: "/equipo/actividad", label: "Actividad", icon: "clock" },
  { href: "/equipo/negocio", label: "Negocio", icon: "chart", needs: "business.view" },
  { href: "/equipo/equipo", label: "Equipo", icon: "team", needs: "team.manage" },
];

/** "Carmen Ruiz" → "CR"; one name → its first letter. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

function MemberMenu({ viewer, demo }: { viewer: Viewer; demo: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const signOut = async () => {
    await getBrowserSupabase()?.auth.signOut();
    window.location.assign("/login");
  };

  const label = `${viewer.name.split(" ")[0]} · ${ROLE_LABEL[viewer.role]}`;
  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        data-testid="viewer"
        className="pressable flex h-9 w-9 items-center justify-center rounded-full bg-blue-900 text-[13px] font-semibold text-white"
      >
        {initials(viewer.name)}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-40 w-60 rounded-2xl border hairline bg-white p-2 shadow-lg">
          <p className="px-3 pb-2 pt-1.5">
            <span className="block text-[15px] font-semibold text-slate-900">{viewer.name}</span>
            <span className="block text-[13px] text-slate-500">{ROLE_LABEL[viewer.role]}</span>
          </p>
          {demo ? (
            <p className="border-t hairline px-3 pb-1 pt-2 text-[12px] leading-snug text-slate-500">En la demo nadie inicia sesión: cambia de rol con «Ver como».</p>
          ) : (
            <button type="button" role="menuitem" onClick={signOut} className="w-full rounded-xl px-3 py-2 text-left text-[14px] font-medium text-blue-700 hover:bg-slate-50">
              Cerrar sesión
            </button>
          )}
        </div>
      )}
    </div>
  );
}

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
          <Link href="/equipo" aria-label="Inicio del equipo" className="flex h-14 items-center gap-3">
            <Logo size={24} priority />
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">Equipo</span>
          </Link>

          <div className="order-2 ml-auto flex items-center gap-2 xl:order-3">
            {demo && (
              <span
                className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-blue-900"
                title="Clientes inventados. Nada se envía."
              >
                Demo
              </span>
            )}
            {/* Who is signed in, as a round initial that opens a small menu: the name and role, and
                with a database the way out. It keeps the header to one line beside seven tabs. */}
            {viewer && <MemberMenu viewer={viewer} demo={demo} />}
          </div>

          <nav
            className="order-3 -mx-4 flex w-[calc(100%+2rem)] items-center gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none] sm:-mx-6 sm:w-[calc(100%+3rem)] sm:px-5 xl:order-2 xl:mx-0 xl:w-auto xl:overflow-visible xl:px-0 xl:pb-0"
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
