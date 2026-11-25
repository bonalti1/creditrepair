import type { IconName } from "@/components/Icon";
import type { Capability } from "./permissions";
import type { SHELL_TEXT } from "./i18n/ui/shell";
import { callsEnabled } from "../calls/config";

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
  // Credalti Control (docs/CONTROL.md): the business at a glance, and every lead conversation.
  { href: "/equipo/control", label: "overview", icon: "dashboard" },
  { href: "/equipo/leads", label: "leads", icon: "inbox", needs: "leads.work" },
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
  { href: "/equipo/ofertas", label: "offers", icon: "sparkle", needs: "partners.manage" },
  { href: "/equipo/equipo", label: "team", icon: "team", needs: "team.manage" },
  { href: "/equipo/cartas", label: "letters", icon: "clipboard", needs: "letters.edit" },
  { href: "/equipo/planes", label: "plans", icon: "calc", needs: "billing.plans" },
  { href: "/equipo/cobros", label: "invoices", icon: "doc", needs: "billing.plans" },
  { href: "/equipo/resenas", label: "reviews", icon: "chat" },
  { href: "/equipo/estados", label: "states", icon: "globe" },
  // Content (src/lib/content): the board for content.view; the brand kit and partner material for everyone with content.share.
  { href: "/equipo/contenido", label: "content", icon: "grid", needs: "content.share" },
  // Calls with a person (src/lib/calls): only when turned on (off by default).
  ...(callsEnabled() ? [{ href: "/equipo/llamadas", label: "calls" as const, icon: "clock" as const, needs: "calls.manage" as const }] : []),
  { href: "/equipo/alertas", label: "alerts", icon: "bell" },
  { href: "/equipo/contabilidad", label: "accounting", icon: "calc", needs: "accounting" },
  { href: "/equipo/perfil", label: "profile", icon: "person" },
  { href: "/equipo/bienvenida", label: "welcome", icon: "book" },
];
