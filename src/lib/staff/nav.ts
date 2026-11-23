import type { IconName } from "@/components/Icon";
import type { Capability } from "./permissions";
import type { SHELL_TEXT } from "./i18n/ui/shell";

// The console's destinations: the top bar and the phone's tab bar
// (components/staff/StaffShell.tsx) and the console's search (search.ts) read
// the same list, so a page the role may not open is missing from both.

export type NavKey = keyof (typeof SHELL_TEXT)["en"]["nav"];

export interface NavItem {
  href: string;
  label: NavKey;
  icon: IconName;
  needs?: Capability;
}

/** The everyday destinations: tabs on the top bar and on the phone's bottom bar. */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/equipo", label: "home", icon: "home" },
  { href: "/equipo/clientes", label: "clients", icon: "person" },
  { href: "/equipo/respuestas", label: "answers", icon: "chat", needs: "clients.reply" },
];

/** Everything else, under "More". */
export const MORE_NAV: NavItem[] = [
  { href: "/equipo/invitar", label: "invite", icon: "mail", needs: "clients.invite" },
  { href: "/equipo/acreedores", label: "creditors", icon: "doc", needs: "rounds.send" },
  { href: "/equipo/actividad", label: "activity", icon: "clock" },
  { href: "/equipo/piloto", label: "autopilot", icon: "sparkle", needs: "rounds.send" },
  { href: "/equipo/negocio", label: "business", icon: "chart", needs: "business.view" },
  { href: "/equipo/socios", label: "partners", icon: "link", needs: "partners.view" },
  { href: "/equipo/equipo", label: "team", icon: "team", needs: "team.manage" },
  { href: "/equipo/cartas", label: "letters", icon: "clipboard", needs: "letters.edit" },
  { href: "/equipo/planes", label: "plans", icon: "calc", needs: "billing.plans" },
  { href: "/equipo/cobros", label: "invoices", icon: "doc", needs: "billing.plans" },
  { href: "/equipo/perfil", label: "profile", icon: "person" },
  { href: "/equipo/bienvenida", label: "welcome", icon: "book" },
];
